/**
 * Content Extractor
 * Extracts actual content values from HTML based on cms-manifest selectors
 */

import type { CMSManifest, PageManifest, LinkFieldValue } from '@see-ms/types';
import * as cheerio from 'cheerio';
import { isLikelyImagePath, normalizeImageSeedPath } from './assets';
import { sharedComponentTypeName } from './transformer';
import { normalizeRoute } from './parser';

export interface ExtractedContent {
    pages: Record<string, PageContent>;
    global?: PageContent;
    /** Per shared-component content, keyed by its single-type name (nav, footer…). */
    components?: Record<string, PageContent>;
}

/**
 * Field value can be a string or a link object
 */
export type FieldValue = string | LinkFieldValue;

export interface PageContent {
    fields: Record<string, FieldValue>;
    collections: Record<string, CollectionItem[]>;
}

export interface CollectionItem {
    [key: string]: FieldValue;
}

/**
 * Extract a link as a composite object
 */
function extractLinkValue($element: cheerio.Cheerio<any>): LinkFieldValue {
    const href = $element.attr('href') || $element.attr('to') || '';
    const text = $element.text().trim();
    const target = $element.attr('target');
    const newTab = target === '_blank';

    // Normalise internal URLs so relative page refs like "contact.html" become
    // "/contact". External links, mailto:, tel:, and anchors are left as-is.
    const isExternal = /^(https?:|mailto:|tel:|#|\/\/)/.test(href);
    const url = (!isExternal && href) ? normalizeRoute(href) : href;

    return {
        url,
        text: text,
        newTab: newTab || undefined,
    };
}

/**
 * Extract every field of a collection item (or nested child item) into `out`.
 * Looks in descendants first, then falls back to the element itself — a tag
 * chip like `<a class="...tag">Featured</a>` IS the field, which find() can't
 * match. Shared by the flat-field and nested-children extraction paths.
 */
function extractItemFields(
    $: cheerio.CheerioAPI,
    $elem: cheerio.Cheerio<any>,
    fields: Record<string, any>,
    out: CollectionItem
): void {
    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
        const fieldSelector = typeof fieldConfig === 'string'
            ? fieldConfig
            : (fieldConfig as any).selector || fieldConfig;
        const fieldType = typeof fieldConfig === 'object' ? (fieldConfig as any).type : undefined;

        let fieldElement = $elem.find(fieldSelector as string).first();
        if (fieldElement.length === 0 && $elem.is(fieldSelector as string)) {
            fieldElement = $elem;
        }
        if (fieldElement.length === 0) continue;

        if (fieldType === 'image' || fieldName === 'image' || fieldName.includes('image')) {
            out[fieldName] = fieldElement.attr('src') || fieldElement.find('img').attr('src') || '';
        } else if (fieldType === 'link' || fieldName === 'link' || fieldName === 'url') {
            const linkElement = fieldElement.is('a') || fieldElement.is('NuxtLink') || fieldElement.is('nuxt-link')
                ? fieldElement
                : fieldElement.find('a, NuxtLink, nuxt-link').first();
            if (linkElement.length > 0) {
                out[fieldName] = extractLinkValue(linkElement);
            }
        } else {
            out[fieldName] = extractFieldText(fieldElement, fieldType);
        }
    }
}

/**
 * Extract the text value for a non-media / non-link field.
 *
 * `rich` fields keep their full inner text (formatting children are part of the
 * value). Everything else (plain leaf fields) takes only the element's *direct*
 * text: if a selector ever resolves to a container, this prevents slurping the
 * whole subtree into one field — the failure mode that produced multi-kilobyte
 * blobs and overflowed Postgres `varchar(255)`. Whitespace is collapsed so
 * multi-line source markup doesn't yield ragged values.
 */
function extractFieldText($element: cheerio.Cheerio<any>, fieldType?: string): string {
    const raw = fieldType === 'rich'
        ? $element.text()
        : $element.clone().children().remove().end().text();
    return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Text of the Nth non-empty direct text node of an element. Mirrors the
 * textNodeIndex convention used by the detector/renderer/editor.
 */
function nthDirectTextRun($element: cheerio.Cheerio<any>, index: number): string {
    const el: any = $element[0];
    if (!el || !Array.isArray(el.children)) return '';
    const runs = el.children.filter(
        (n: any) => n.type === 'text' && typeof n.data === 'string' && n.data.trim().length > 0
    );
    const node = runs[index];
    return node ? String(node.data).replace(/\s+/g, ' ').trim() : '';
}

/**
 * Extract content from HTML based on manifest selectors
 */
export function extractContentFromHTML(
    html: string,
    _pageName: string,
    pageManifest: PageManifest
): PageContent {
    const $ = cheerio.load(html);

    const content: PageContent = {
        fields: {},
        collections: {},
    };

    // Extract single fields
    if (pageManifest.fields) {
        for (const [fieldName, field] of Object.entries(pageManifest.fields)) {
            const selector = field.selector;
            const element = $(selector).first();

            if (element.length > 0) {
                if (field.type === 'image') {
                    // Extract image src
                    const src = element.attr('src') || element.find('img').attr('src') || '';
                    content.fields[fieldName] = src;
                } else if (field.type === 'link') {
                    // Extract link as composite object
                    const linkElement = element.is('a') || element.is('NuxtLink') || element.is('nuxt-link')
                        ? element
                        : element.find('a, NuxtLink, nuxt-link').first();
                    if (linkElement.length > 0) {
                        content.fields[fieldName] = extractLinkValue(linkElement);
                    }
                } else if (typeof field.textNodeIndex === 'number') {
                    // Field is a specific direct text run of the element.
                    content.fields[fieldName] = nthDirectTextRun(element, field.textNodeIndex);
                } else {
                    // Extract text content (direct text only for plain fields)
                    content.fields[fieldName] = extractFieldText(element, field.type);
                }
            }
        }
    }

    // Extract collections
    if (pageManifest.collections) {
        for (const [collectionName, collection] of Object.entries(pageManifest.collections)) {
            const items: CollectionItem[] = [];
            const collectionElements = $(collection.selector);

            collectionElements.each((_, elem) => {
                const item: CollectionItem = {};
                const $elem = $(elem);

                // Extract each flat field within the collection item
                extractItemFields($, $elem, collection.fields, item);

                // Nested children → an array of child items (Strapi repeatable
                // component). e.g. a news card with repeating tag chips.
                if (collection.children) {
                    for (const [childFieldName, childDef] of Object.entries(collection.children)) {
                        const childSelector = (childDef as any).selector;
                        const childFields = (childDef as any).fields;
                        const childItems: CollectionItem[] = [];
                        $elem.find(childSelector).each((_ci, childEl) => {
                            const childItem: CollectionItem = {};
                            extractItemFields($, $(childEl), childFields, childItem);
                            if (Object.keys(childItem).length > 0) childItems.push(childItem);
                        });
                        if (childItems.length > 0) (item as any)[childFieldName] = childItems;
                    }
                }

                // Only add item if it has some content
                if (Object.keys(item).length > 0) {
                    items.push(item);
                }
            });

            if (items.length > 0) {
                content.collections[collectionName] = items;
            }
        }
    }

    return content;
}

/**
 * Extract content from all pages based on manifest
 * Stores the manifest alongside extracted content for use in formatForStrapi
 */
export function extractAllContent(
    htmlFiles: Map<string, string>,
    manifest: CMSManifest,
    // Shared components (nav/footer) are detected from their .vue templates, so
    // their field selectors target the original section markup. When the page
    // map passed as `htmlFiles` has that markup replaced by <Component/> tags
    // (the `extract components` path), extracting against it yields nothing.
    // Callers can pass the pristine HTML here so component seed still resolves;
    // it defaults to `htmlFiles` for callers that already pass original HTML.
    componentHtmlFiles: Map<string, string> = htmlFiles
): ExtractedContent & { manifest: CMSManifest } {
    const extractedContent: ExtractedContent = {
        pages: {},
    };

    for (const [pageName, pageManifest] of Object.entries(manifest.pages)) {
        const html = htmlFiles.get(pageName);

        if (html) {
            const content = extractContentFromHTML(html, pageName, pageManifest);
            extractedContent.pages[pageName] = content;
        }
    }

    if (manifest.global?.fields) {
        const firstPage = Object.keys(manifest.pages)[0];
        const firstHtml = firstPage ? htmlFiles.get(firstPage) : undefined;
        if (firstHtml) {
            extractedContent.global = extractContentFromHTML(firstHtml, "global", {
                fields: manifest.global.fields,
                collections: {}
            });
        }
    }

    // Shared-global components → one seed entry each (un-prefixed fields),
    // extracted from a page that contains the component.
    extractedContent.components = {};
    for (const [compName, comp] of Object.entries(manifest.global?.components || {})) {
        const c = comp as any;
        if (c.role === 'collection-item') continue;
        const mode = c.contentMode || 'shared-global';
        if (mode !== 'shared-global' && mode !== 'auto') continue;
        const fields = c.fields || {};
        if (Object.keys(fields).length === 0) continue;
        const pageId = (c.pages && c.pages[0]) || Object.keys(manifest.pages)[0];
        const html = pageId ? componentHtmlFiles.get(pageId) : undefined;
        if (!html) continue;
        const typeName = sharedComponentTypeName(compName);
        extractedContent.components[typeName] = extractContentFromHTML(html, typeName, {
            fields,
            collections: {}
        });
    }

    return { ...extractedContent, manifest };
}

/**
 * Normalize image paths for seed data
 * Converts absolute/relative paths to public asset paths
 */
export function normalizeImagePath(imageSrc: string): string {
    return normalizeImageSeedPath(imageSrc);
}

/**
 * Check if a value is a link object
 */
function isLinkValue(value: FieldValue): value is LinkFieldValue {
    return typeof value === 'object' && value !== null && 'url' in value && 'text' in value;
}

/**
 * Convert extracted content to Strapi seed format
 */
export function formatForStrapi(extracted: ExtractedContent): Record<string, any> {
    const seedData: Record<string, any> = {};

    for (const [pageName, content] of Object.entries(extracted.pages)) {
        // Format single type fields
        if (Object.keys(content.fields).length > 0) {
            const formattedFields: Record<string, any> = {};

            for (const [fieldName, value] of Object.entries(content.fields)) {
                if (isLinkValue(value)) {
                    // Keep link objects as-is for Strapi component
                    formattedFields[fieldName] = value;
                } else if (fieldName.includes('image') || fieldName.includes('img') || fieldName.includes('bg') || isLikelyImagePath(value)) {
                    // Normalize image paths
                    formattedFields[fieldName] = normalizeImagePath(value);
                } else {
                    formattedFields[fieldName] = value;
                }
            }

            seedData[pageName] = formattedFields;
        }

        // Format collection types
        for (const [collectionName, items] of Object.entries(content.collections)) {
            const formattedItems = items.map((item, index) => {
                const formattedItem: Record<string, any> = {};

                for (const [fieldName, value] of Object.entries(item)) {
                    if (isLinkValue(value)) {
                        // Keep link objects as-is for Strapi component
                        formattedItem[fieldName] = value;
                    } else if (fieldName === 'image' || fieldName.includes('image') || fieldName.includes('img') || isLikelyImagePath(value)) {
                        // Normalize image paths
                        formattedItem[fieldName] = normalizeImagePath(value);
                    } else {
                        formattedItem[fieldName] = value;
                    }
                }

                // Deterministic identity so re-seeding upserts instead of duplicating.
                formattedItem.seemsKey = `${collectionName}-${index}`;

                return formattedItem;
            });

            seedData[collectionName] = formattedItems;
        }
    }

    if (extracted.global && Object.keys(extracted.global.fields).length > 0) {
        const formattedFields: Record<string, any> = {};
        for (const [fieldName, value] of Object.entries(extracted.global.fields)) {
            if (isLinkValue(value)) {
                formattedFields[fieldName] = value;
            } else if (fieldName.includes('image') || fieldName.includes('img') || fieldName.includes('bg') || isLikelyImagePath(value)) {
                formattedFields[fieldName] = normalizeImagePath(value);
            } else {
                formattedFields[fieldName] = value;
            }
        }
        seedData.global = formattedFields;
    }

    // Per shared-component seed entries (nav, footer, …), un-prefixed.
    for (const [typeName, pc] of Object.entries(extracted.components || {})) {
        if (!pc?.fields || Object.keys(pc.fields).length === 0) continue;
        const formattedFields: Record<string, any> = {};
        for (const [fieldName, value] of Object.entries(pc.fields)) {
            if (isLinkValue(value)) {
                formattedFields[fieldName] = value;
            } else if (fieldName.includes('image') || fieldName.includes('img') || fieldName.includes('bg') || isLikelyImagePath(value)) {
                formattedFields[fieldName] = normalizeImagePath(value);
            } else {
                formattedFields[fieldName] = value;
            }
        }
        seedData[typeName] = formattedFields;
    }

    return seedData;
}

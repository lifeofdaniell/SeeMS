/**
 * Content Extractor
 * Extracts actual content values from HTML based on cms-manifest selectors
 */

import type { CMSManifest, PageManifest, LinkFieldValue } from '@see-ms/types';
import * as cheerio from 'cheerio';
import { isLikelyImagePath, normalizeImageSeedPath } from './assets';

export interface ExtractedContent {
    pages: Record<string, PageContent>;
    global?: PageContent;
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

    return {
        url: href,
        text: text,
        newTab: newTab || undefined,
    };
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

                // Extract each field within the collection item
                for (const [fieldName, fieldConfig] of Object.entries(collection.fields)) {
                    // Get selector from field config
                    const fieldSelector = typeof fieldConfig === 'string'
                        ? fieldConfig
                        : (fieldConfig as any).selector || fieldConfig;
                    const fieldType = typeof fieldConfig === 'object' ? (fieldConfig as any).type : undefined;

                    const fieldElement = $elem.find(fieldSelector as string).first();

                    if (fieldElement.length > 0) {
                        // Check field type or infer from name
                        if (fieldType === 'image' || fieldName === 'image' || fieldName.includes('image')) {
                            const src = fieldElement.attr('src') || fieldElement.find('img').attr('src') || '';
                            item[fieldName] = src;
                        } else if (fieldType === 'link' || fieldName === 'link' || fieldName === 'url') {
                            // Extract link as composite object
                            const linkElement = fieldElement.is('a') || fieldElement.is('NuxtLink') || fieldElement.is('nuxt-link')
                                ? fieldElement
                                : fieldElement.find('a, NuxtLink, nuxt-link').first();
                            if (linkElement.length > 0) {
                                item[fieldName] = extractLinkValue(linkElement);
                            }
                        } else {
                            // Extract text (direct text only for plain fields)
                            item[fieldName] = extractFieldText(fieldElement, fieldType);
                        }
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
    manifest: CMSManifest
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

    return seedData;
}

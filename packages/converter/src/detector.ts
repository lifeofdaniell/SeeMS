/**
 * Auto-detection of editable fields from Vue components
 */

import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import path from 'path';
import type { FieldMapping, CollectionMapping } from '@see-ms/types';

/**
 * Clean class name - remove utility prefixes and normalize
 */
function cleanClassName(className: string): string {
    return className
        .split(' ')
        .filter(cls => !cls.startsWith('c-') && !cls.startsWith('w-'))
        .filter(cls => cls.length > 0)
        .join(' ');
}

/**
 * Get primary semantic class from an element
 * Returns both original selector and normalized field name
 */
function getPrimaryClass(classAttr: string | undefined): { selector: string; fieldName: string } | null {
    if (!classAttr) return null;

    const cleaned = cleanClassName(classAttr);
    const classes = cleaned.split(' ').filter(c => c.length > 0);

    if (classes.length === 0) return null;

    const original = classes[0];

    return {
        selector: original,  // Keep original with dashes for CSS selector
        fieldName: original.replace(/-/g, '_')  // Normalize for field name
    };
}

/**
 * Get context modifier from parent classes (cc-* prefixes)
 */
function getContextModifier(_$: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string | null {
    // Look up the parent tree for cc-* modifiers
    let $current = $el.parent();
    let depth = 0;

    while ($current.length > 0 && depth < 5) {
        const classes = $current.attr('class');
        if (classes) {
            const ccClass = classes.split(' ').find(c => c.startsWith('cc-'));
            if (ccClass) {
                return ccClass.replace('cc-', '').replace(/-/g, '_');
            }
        }
        $current = $current.parent();
        depth++;
    }

    return null;
}

/**
 * Check if element is decorative (shouldn't be editable)
 */
function isDecorativeImage(_$: cheerio.CheerioAPI, $img: cheerio.Cheerio<any>): boolean {
    const $parent = $img.parent();
    const parentClass = $parent.attr('class') || '';

    // Skip images in these contexts
    const decorativePatterns = [
        'nav', 'logo', 'icon', 'arrow', 'button',
        'quote', 'pagination', 'footer', 'link'
    ];

    return decorativePatterns.some(pattern =>
        parentClass.includes(pattern) || parentClass.includes(`${pattern}_`)
    );
}

/**
 * Check if element is inside a button or link
 */
function isInsideButton($: cheerio.CheerioAPI, el: any): boolean {
    const $el = $(el);
    const $button = $el.closest('button, a, NuxtLink, .c_button, .c_icon_button');
    return $button.length > 0;
}

/**
 * Analyze a Vue file and extract template content
 */
export function extractTemplateFromVue(vueContent: string): string {
    const templateMatch = vueContent.match(/<template>([\s\S]*?)<\/template>/);
    if (!templateMatch) {
        return '';
    }
    return templateMatch[1];
}

/**
 * Detect editable fields from Vue template content
 */
export function detectEditableFields(templateHtml: string): {
    fields: Record<string, FieldMapping>;
    collections: Record<string, CollectionMapping>;
} {
    const $ = cheerio.load(templateHtml);
    const detectedFields: Record<string, FieldMapping> = {};
    const detectedCollections: Record<string, CollectionMapping> = {};

    // Track which elements are part of collections
    const collectionElements = new Set<any>();
    const processedCollectionClasses = new Set<string>();

    // 1. Detect collections FIRST
    const potentialCollections = new Map<string, any[]>();

    $('[class]').each((_, el) => {
        const primaryClass = getPrimaryClass($(el).attr('class'));

        // Only detect top-level collection containers
        if (primaryClass && (
            primaryClass.fieldName.includes('card') ||
            primaryClass.fieldName.includes('item') ||
            primaryClass.fieldName.includes('post') ||
            primaryClass.fieldName.includes('feature')
        ) && !primaryClass.fieldName.includes('image') && !primaryClass.fieldName.includes('inner')) {
            if (!potentialCollections.has(primaryClass.fieldName)) {
                potentialCollections.set(primaryClass.fieldName, []);
            }
            potentialCollections.get(primaryClass.fieldName)?.push(el);
        }
    });

    // Process collections
    potentialCollections.forEach((elements, className) => {
        if (elements.length >= 2) {
            const $first = $(elements[0]);
            const collectionFields: Record<string, any> = {};

            // Mark this collection as processed
            processedCollectionClasses.add(className);

            // Mark all elements in this collection
            elements.forEach(el => {
                collectionElements.add(el);
                $(el).find('*').each((_, child) => {
                    collectionElements.add(child);
                });
            });

            // Get the original selector for the collection
            const collectionClassInfo = getPrimaryClass($(elements[0]).attr('class'));
            const collectionSelector = collectionClassInfo ? `.${collectionClassInfo.selector}` : `.${className}`;

            // Detect fields within collection
            // Images
            // @ts-ignore
            $first.find('img').each((_, img) => {
                if (isInsideButton($, img)) return;

                const $img = $(img);
                const $parent = $img.parent();
                const parentClassInfo = getPrimaryClass($parent.attr('class'));

                if (parentClassInfo && parentClassInfo.fieldName.includes('image')) {
                    collectionFields.image = `.${parentClassInfo.selector}`;
                    return false; // Only first image
                }
            });

            // Tags/categories
            // @ts-ignore
            $first.find('div').each((_, el) => {
                const classInfo = getPrimaryClass($(el).attr('class'));
                if (classInfo && classInfo.fieldName.includes('tag') && !classInfo.fieldName.includes('container')) {
                    collectionFields.tag = `.${classInfo.selector}`;
                    return false;
                }
            });

            // Headings
            $first.find('h1, h2, h3, h4, h5, h6').first().each((_, el) => {
                const classInfo = getPrimaryClass($(el).attr('class'));
                if (classInfo) {
                    collectionFields.title = `.${classInfo.selector}`;
                }
            });

            // Descriptions
            $first.find('p').first().each((_, el) => {
                const classInfo = getPrimaryClass($(el).attr('class'));
                if (classInfo) {
                    collectionFields.description = `.${classInfo.selector}`;
                }
            });

            // Links
            // @ts-ignore
            $first.find('a, NuxtLink').not('.c_button, .c_icon_button').each((_, el) => {
                const $link = $(el);
                const linkText = $link.text().trim();

                if (linkText) {
                    const classInfo = getPrimaryClass($link.attr('class'));
                    collectionFields.link = classInfo ? `.${classInfo.selector}` : 'a';
                    return false; // Only first link
                }
            });

            if (Object.keys(collectionFields).length > 0) {
                let collectionName = className;
                if (!collectionName.endsWith('s')) {
                    collectionName += 's';
                }

                detectedCollections[collectionName] = {
                    selector: collectionSelector,
                    fields: collectionFields,
                };
            }
        }
    });

    // 2. Detect individual fields
    const $body = $('body');

    // Headings
    $body.find('h1, h2, h3, h4, h5, h6').each((index, el) => {
        if (collectionElements.has(el)) return;

        const $el = $(el);
        const text = $el.text().trim();
        const classInfo = getPrimaryClass($el.attr('class'));

        if (text) {
            let fieldName: string;
            let selector: string;

            if (classInfo && !classInfo.fieldName.startsWith('heading_')) {
                // Has semantic class
                fieldName = classInfo.fieldName;
                selector = `.${classInfo.selector}`;
            } else {
                // Generic heading - use parent context
                const $parent = $el.closest('[class*="header"], [class*="hero"], [class*="cta"]').first();
                const parentClassInfo = getPrimaryClass($parent.attr('class'));
                const modifier = getContextModifier($, $el);

                if (parentClassInfo) {
                    fieldName = modifier ? `${modifier}_${parentClassInfo.fieldName}` : parentClassInfo.fieldName;
                    selector = classInfo ? `.${classInfo.selector}` : `.${parentClassInfo.selector}`;
                } else if (modifier) {
                    fieldName = `${modifier}_heading`;
                    selector = classInfo ? `.${classInfo.selector}` : el.tagName.toLowerCase();
                } else {
                    fieldName = `heading_${index}`;
                    selector = classInfo ? `.${classInfo.selector}` : el.tagName.toLowerCase();
                }
            }

            detectedFields[fieldName] = {
                selector: selector,
                type: 'plain',
                editable: true,
            };
        }
    });

    // Paragraphs
    $body.find('p').each((_index, el) => {
        if (collectionElements.has(el)) return;

        const $el = $(el);
        const text = $el.text().trim();
        const classInfo = getPrimaryClass($el.attr('class'));

        if (text && text.length > 20 && classInfo) {
            const hasFormatting = $el.find('strong, em, b, i, a, NuxtLink').length > 0;

            detectedFields[classInfo.fieldName] = {
                selector: `.${classInfo.selector}`,
                type: hasFormatting ? 'rich' : 'plain',
                editable: true,
            };
        }
    });

    // Content images only (skip decorative)
    $body.find('img').each((_index, el) => {
        if (collectionElements.has(el)) return;
        if (isInsideButton($, el)) return;

        const $el = $(el);

        // Skip decorative images
        if (isDecorativeImage($, $el)) return;

        const $parent = $el.parent();
        const parentClassInfo = getPrimaryClass($parent.attr('class'));

        if (parentClassInfo) {
            const fieldName = parentClassInfo.fieldName.includes('image')
                ? parentClassInfo.fieldName
                : `${parentClassInfo.fieldName}_image`;

            detectedFields[fieldName] = {
                selector: `.${parentClassInfo.selector}`,
                type: 'image',
                editable: true,
            };
        }
    });

    // Button text
    $body.find('NuxtLink.c_button, a.c_button, .c_button').each((_index, el) => {
        if (collectionElements.has(el)) return;

        const $el = $(el);
        const text = $el.contents().filter(function() {
            return this.type === 'text' || (this.type === 'tag' && this.name === 'div');
        }).first().text().trim();

        if (text && text.length > 2) {
            const $parent = $el.closest('[class*="cta"]').first();
            const parentClassInfo = getPrimaryClass($parent.attr('class'));
            const fieldName = parentClassInfo ? `${parentClassInfo.fieldName}_button_text` : 'button_text';

            detectedFields[fieldName] = {
                selector: `.c_button`,
                type: 'plain',
                editable: true,
            };
        }
    });

    return {
        fields: detectedFields,
        collections: detectedCollections,
    };
}

/**
 * Analyze all Vue pages in a directory
 */
export async function analyzeVuePages(pagesDir: string): Promise<Record<string, {
    fields: Record<string, FieldMapping>;
    collections: Record<string, CollectionMapping>;
}>> {
    const results: Record<string, any> = {};

    const vueFiles = await fs.readdir(pagesDir);

    for (const file of vueFiles) {
        if (file.endsWith('.vue')) {
            const filePath = path.join(pagesDir, file);
            const content = await fs.readFile(filePath, 'utf-8');
            const template = extractTemplateFromVue(content);

            if (template) {
                const pageName = file.replace('.vue', '');
                results[pageName] = detectEditableFields(template);
            }
        }
    }

    return results;
}

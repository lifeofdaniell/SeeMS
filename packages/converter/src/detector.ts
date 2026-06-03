/**
 * Auto-detection of editable fields from Vue components
 * Enhanced with universal detection, expanded collection keywords, and data-cms attributes
 */

import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import type { FieldMapping, CollectionMapping, CollectionFieldMapping, CollectionChildMapping, DataCMSAttributes, FieldType } from '@see-ms/types';
import { htmlPathToPageId } from './routes';

/**
 * Text element selectors for universal detection
 * Note: div is handled separately with additional checks
 */
const TEXT_SELECTORS = [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'span', 'li', 'blockquote', 'figcaption',
    'label', 'td', 'th', 'dt', 'dd', 'cite', 'q',
    // div is NOT included here - handled separately to only detect text-only divs
];

/**
 * Elements/classes to ignore during detection
 */
const IGNORE_PATTERNS = [
    '.sr-only', '.visually-hidden', '[aria-hidden="true"]',
    'script', 'style', 'noscript', 'template'
];

/**
 * Class patterns that suggest decorative/non-editable content
 */
const DECORATIVE_CLASS_PATTERNS = [
    'icon', 'arrow', 'pagination', 'breadcrumb',
    'loader', 'spinner', 'skeleton', 'placeholder'
];

/**
 * Detection options
 */
export interface DetectionOptions {
    /** Custom collection classes to detect */
    collectionClasses?: string[];
    /** Minimum items for collection detection */
    collectionMin?: number;
    /** Enable universal detection (default: true) */
    universalDetection?: boolean;
    /** Selectors to ignore */
    ignoreSelectors?: string[];
    /** Classes to ignore */
    ignoreClasses?: string[];
    /**
     * Nested child definitions keyed by the normalized collection class name
     * (dashes → underscores, lowercase). Each entry describes repeating child
     * items living inside each parent collection item.
     * e.g. { "w_tab_pane": [{ fieldName: "items", selector: ".faq-item" }] }
     */
    collectionChildren?: Record<string, Array<{ fieldName: string; selector: string }>>;
}

/**
 * Parse data-cms attributes from an element
 */
export function parseDataCMSAttributes($el: cheerio.Cheerio<any>): DataCMSAttributes | null {
    const name = $el.attr('data-cms');
    const type = $el.attr('data-cms-type') as any;
    const ignore = $el.attr('data-cms-ignore') !== undefined;
    const group = $el.attr('data-cms-group');

    if (!name && !type && !ignore && !group) return null;

    return { name, type, ignore, group };
}

/**
 * Check if class name matches user-provided collection classes
 * No auto-detection - only matches exact classes from user input
 */
function isCollectionClass(className: string, customClasses?: string[]): boolean {
    if (!customClasses || customClasses.length === 0) return false;

    const normalizedName = className.toLowerCase().replace(/-/g, '_');

    for (const customClass of customClasses) {
        const normalizedCustom = customClass.toLowerCase().replace(/-/g, '_');
        if (normalizedName === normalizedCustom) {
            return true;
        }
    }

    return false;
}

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
    const $button = $el.closest('button, a, NuxtLink, nuxt-link, .c_button, .c_icon_button');
    return $button.length > 0;
}

/**
 * Check if element should be ignored based on patterns
 */
function shouldIgnoreElement(
    _$: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
    options: DetectionOptions = {}
): boolean {
    // Check data-cms-ignore attribute
    if ($el.attr('data-cms-ignore') !== undefined) return true;

    // Check if matches ignore patterns
    for (const pattern of IGNORE_PATTERNS) {
        if ($el.is(pattern)) return true;
        if ($el.closest(pattern).length > 0) return true;
    }

    for (const selector of options.ignoreSelectors || []) {
        if ($el.is(selector)) return true;
        if ($el.closest(selector).length > 0) return true;
    }

    // Check for decorative class patterns
    const className = $el.attr('class') || '';
    for (const ignoredClass of options.ignoreClasses || []) {
        if (className.split(/\s+/).includes(ignoredClass)) return true;
    }
    for (const pattern of DECORATIVE_CLASS_PATTERNS) {
        if (className.toLowerCase().includes(pattern)) return true;
    }

    return false;
}

/**
 * Check if an element is an editable "leaf" element
 * A leaf element has:
 * - ZERO child elements (no nested HTML tags)
 * - ONE or more text nodes (actual content exists)
 *
 * Examples:
 * - <div>Test</div> → true (no children, has text)
 * - <div></div> → false (no children, no text)
 * - <div><span>Test</span></div> → false (has child element)
 * - <p>Hello <strong>world</strong></p> → false (has child element)
 */
export function isEditableLeaf($el: cheerio.Cheerio<any>): boolean {
    // Must have ZERO child ELEMENTS (no nested HTML tags)
    if ($el.children().length > 0) {
        return false;
    }

    // Must have actual text content (child TEXT NODE)
    const text = $el.text().trim();
    if (text.length === 0) {
        return false; // Skip empty elements like <div></div>
    }

    return true;
}

// Global index counter for truly unique field names
let globalFieldIndex = 0;

/**
 * Reset global field index (call at start of detection)
 */
function resetGlobalFieldIndex(): void {
    globalFieldIndex = 0;
}

/**
 * Generate a unique field name from element context
 * Priority: data-cms > id > aria-label > class > parent context > content-based > global index
 */
function generateFieldName(
    _$: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
    elementType: string,
    _index: number
): string {
    // 1. Check for data-cms attribute (highest priority)
    const dataCms = $el.attr('data-cms');
    if (dataCms) return dataCms.replace(/-/g, '_');

    // 2. Check for id attribute
    const id = $el.attr('id');
    if (id) return id.replace(/-/g, '_');

    // 3. Check for aria-label
    const ariaLabel = $el.attr('aria-label');
    if (ariaLabel) return ariaLabel.replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();

    // 4. Check for semantic class (not utility classes)
    const classInfo = getPrimaryClass($el.attr('class'));
    if (classInfo && !classInfo.fieldName.startsWith('w_') && !classInfo.fieldName.startsWith('c_')) {
        return classInfo.fieldName;
    }

    // 5. Use parent context + element type
    const $parent = $el.parent();
    const parentClassInfo = getPrimaryClass($parent.attr('class'));
    if (parentClassInfo && !parentClassInfo.fieldName.startsWith('w_') && !parentClassInfo.fieldName.startsWith('c_')) {
        return `${parentClassInfo.fieldName}_${elementType}`;
    }

    // 6. Look for section context
    const $section = $el.closest('section, [class*="section"], [class*="hero"], [class*="cta"], [class*="about"]').first();
    const sectionClassInfo = getPrimaryClass($section.attr('class'));
    if (sectionClassInfo && $section.length > 0) {
        return `${sectionClassInfo.fieldName}_${elementType}`;
    }

    // 7. Content-based naming (use first few words of text)
    const text = $el.text().trim();
    if (text.length > 0 && text.length < 50) {
        // Use first 2-3 words as name
        const words = text.split(/\s+/).slice(0, 3);
        const contentName = words.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (contentName.length > 2 && contentName.length < 30) {
            return `${elementType}_${contentName}`;
        }
    }

    // 8. Fallback with GLOBAL unique index (guaranteed unique)
    return `${elementType}_${globalFieldIndex++}`;
}

/**
 * Build a unique CSS selector for an element
 * Tries multiple strategies and VALIDATES uniqueness for each
 * Falls back to full path from root if nothing else works
 */
export function buildUniqueSelector($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
    const tag = ($el.prop('tagName') || 'div').toLowerCase();

    // Strategy 1: ID is always unique
    const id = $el.attr('id');
    if (id) {
        const selector = `#${id}`;
        if ($(selector).length === 1) return selector;
    }

    // Strategy 2: data-cms attribute
    const dataCms = $el.attr('data-cms');
    if (dataCms) {
        const selector = `[data-cms="${dataCms}"]`;
        if ($(selector).length === 1) return selector;
    }

    // Strategy 3: Try class combinations until we find a unique one
    const className = $el.attr('class');
    if (className) {
        const classes = className.split(' ').filter(c => c.length > 2 && !c.startsWith('w-'));

        // Try single classes first
        for (const cls of classes) {
            const selector = `.${cls}`;
            if ($(selector).length === 1) return selector;
        }

        // Try tag + class combinations
        for (const cls of classes) {
            const selector = `${tag}.${cls}`;
            if ($(selector).length === 1) return selector;
        }

        // Try multiple class combinations
        for (let i = 2; i <= Math.min(classes.length, 3); i++) {
            const combo = classes.slice(0, i).map(c => `.${c}`).join('');
            if ($(combo).length === 1) return combo;
        }
    }

    // Strategy 4: Build path with nth-of-type (guaranteed unique)
    return buildFullPath($, $el);
}

/**
 * Build a positional path selector for an element.
 *
 * Climbs from the element toward <body>, adding `:nth-of-type` wherever there
 * are same-tag siblings, and returns as soon as the accumulated descendant path
 * resolves to exactly one element in the document. This guarantees uniqueness
 * (verified, not assumed) while keeping the selector as short as possible. If
 * the element is somehow unreachable to uniqueness, it returns the fullest path
 * built up to <body>.
 *
 * The previous implementation hard-stopped at 4 levels and never verified the
 * result, so deeply-nested Webflow markup with reused classes produced ambiguous
 * paths that matched many elements — at extraction time `$(selector).first()`
 * then landed on a wrong/container element and slurped its whole subtree.
 */
export function buildFullPath($: cheerio.CheerioAPI, $el: cheerio.Cheerio<any>): string {
    const segments: string[] = [];
    let current = $el;

    while (current.length && current.prop('tagName')) {
        const tag = (current.prop('tagName') || '').toLowerCase();
        if (!tag || tag === 'html' || tag === 'body') break;

        const $parent = current.parent();
        const $siblings = $parent.children(tag);

        let segment = tag;
        if ($siblings.length > 1) {
            const index = $siblings.index(current) + 1;
            segment = `${tag}:nth-of-type(${index})`;
        }

        segments.unshift(segment);

        // Stop as soon as the accumulated path uniquely identifies the element.
        const candidate = segments.join(' > ');
        if ($(candidate).length === 1) {
            return candidate;
        }

        current = $parent;
    }

    return segments.join(' > ');
}

/**
 * Determine field type from element and content
 */
export function determineFieldType($el: cheerio.Cheerio<any>, tagName: string): FieldType {
    // Check data-cms-type attribute first
    const dataCmsType = $el.attr('data-cms-type') as FieldType | undefined;
    if (dataCmsType) return dataCmsType;

    // Check for rich text indicators
    const hasFormatting = $el.find('strong, em, b, i, br, a').length > 0;
    const innerHTML = $el.html() || '';
    const hasHtmlTags = /<[^>]+>/.test(innerHTML);

    if (hasFormatting || hasHtmlTags) {
        return 'rich';
    }

    // Links
    if (tagName === 'a' || tagName === 'nuxt-link' || $el.is('NuxtLink')) {
        return 'link';
    }

    return 'plain';
}

/**
 * Detect fields within a child collection element.
 * Used for nested repeatable components (e.g. FAQ items inside a tab pane).
 * Applies the same semantic heuristics as collection field detection.
 */
function detectChildFields(
    _$: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>
): Record<string, CollectionFieldMapping> {
    const fields: Record<string, CollectionFieldMapping> = {};

    // Image
    const $img = $el.find('img').first();
    if ($img.length) {
        const $imgParent = $img.parent();
        const parentClassInfo = getPrimaryClass($imgParent.attr('class'));
        if (parentClassInfo && parentClassInfo.fieldName.includes('image')) {
            fields.image = { selector: `.${parentClassInfo.selector}`, type: 'image', attribute: 'src' };
        } else {
            fields.image = { selector: 'img', type: 'image', attribute: 'src' };
        }
    }

    // Rich text block (e.g. Webflow .w-richtext)
    const $rich = $el.find('[class*="richtext"], [class*="rich-text"], .w-richtext').first();
    if ($rich.length) {
        const classInfo = getPrimaryClass($rich.attr('class'));
        const fieldName = classInfo && !classInfo.fieldName.startsWith('w_') ? classInfo.fieldName : 'answer';
        fields[fieldName] = {
            selector: classInfo ? `.${classInfo.selector}` : '.w-richtext',
            type: 'rich',
        };
    }

    // Heading — typically the question / title
    const $heading = $el.find('h1, h2, h3, h4, h5, h6').first();
    if ($heading.length) {
        const classInfo = getPrimaryClass($heading.attr('class'));
        const tagName = ($heading.prop('tagName') || 'h3').toLowerCase();
        const fieldName = classInfo && !classInfo.fieldName.startsWith('w_') ? classInfo.fieldName : 'question';
        if (!fields[fieldName]) {
            fields[fieldName] = {
                selector: classInfo ? `.${classInfo.selector}` : tagName,
                type: 'plain',
            };
        }
    }

    // Paragraph — typically the answer / description (only if no richtext found)
    if (!fields.answer) {
        const $p = $el.find('p').first();
        if ($p.length) {
            const classInfo = getPrimaryClass($p.attr('class'));
            const fieldName = classInfo && !classInfo.fieldName.startsWith('w_') ? classInfo.fieldName : 'answer';
            if (!fields[fieldName]) {
                fields[fieldName] = {
                    selector: classInfo ? `.${classInfo.selector}` : 'p',
                    type: 'plain',
                };
            }
        }
    }

    // Link
    const $link = $el.find('a, NuxtLink, nuxt-link').not('.c_button, .c_icon_button').first();
    if ($link.length && $link.text().trim()) {
        const classInfo = getPrimaryClass($link.attr('class'));
        fields.link = {
            selector: classInfo ? `.${classInfo.selector}` : 'a',
            type: 'link',
            attribute: 'href',
        };
    }

    return fields;
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
 * Universal detection: finds ALL text, images, and links
 */
export function detectEditableFields(
    templateHtml: string,
    options: DetectionOptions = {}
): {
    fields: Record<string, FieldMapping>;
    collections: Record<string, CollectionMapping>;
} {
    const $ = cheerio.load(templateHtml);
    const detectedFields: Record<string, FieldMapping> = {};
    const detectedCollections: Record<string, CollectionMapping> = {};
    const { collectionClasses, collectionMin = 2, universalDetection = true } = options;

    // Reset global field index for this detection run
    resetGlobalFieldIndex();

    // Track which elements are part of collections or already processed
    const collectionElements = new Set<any>();
    const processedElements = new Set<any>();
    const usedFieldNames = new Set<string>();

    // Helper to get unique field name
    const getUniqueFieldName = (baseName: string): string => {
        let name = baseName;
        let counter = 1;
        while (usedFieldNames.has(name)) {
            name = `${baseName}_${counter++}`;
        }
        usedFieldNames.add(name);
        return name;
    };

    // ========================================
    // PHASE 0: Process data-cms attributes first (highest priority)
    // ========================================
    $('[data-cms]').each((_, el) => {
        const $el = $(el);
        if (shouldIgnoreElement($, $el, options)) return;

        const fieldName = $el.attr('data-cms')!.replace(/-/g, '_');
        const tagName = ($el.prop('tagName') || 'div').toLowerCase();
        const fieldType = determineFieldType($el, tagName);
        const selector = buildUniqueSelector($, $el);

        detectedFields[getUniqueFieldName(fieldName)] = {
            selector,
            type: fieldType,
            editable: true,
            source: 'attribute',
        };

        processedElements.add(el);
    });

    // ========================================
    // PHASE 1: Detect collections
    // Only from: data-cms-collection attribute OR user-provided collection classes
    // ========================================
    const potentialCollections = new Map<string, any[]>();

    // Method 1: Detect by data-cms-collection attribute (highest priority)
    $('[data-cms-collection]').each((_, el) => {
        const $el = $(el);
        const collectionName = $el.attr('data-cms-collection')!;
        const normalizedName = collectionName.replace(/-/g, '_');

        if (!potentialCollections.has(normalizedName)) {
            potentialCollections.set(normalizedName, []);
        }
        potentialCollections.get(normalizedName)?.push(el);
    });

    // Method 2: Detect by user-provided collection classes (from CLI input)
    if (collectionClasses && collectionClasses.length > 0) {
        $('[class]').each((_, el) => {
            const primaryClass = getPrimaryClass($(el).attr('class'));

            // Skip elements that shouldn't be collections
            if (!primaryClass) return;
            if (primaryClass.fieldName.includes('image')) return;
            if (primaryClass.fieldName.includes('inner')) return;
            if (primaryClass.fieldName.includes('wrapper') && !primaryClass.fieldName.includes('card')) return;

            // Check if this matches user-provided collection classes
            if (isCollectionClass(primaryClass.fieldName, collectionClasses)) {
                if (!potentialCollections.has(primaryClass.fieldName)) {
                    potentialCollections.set(primaryClass.fieldName, []);
                }
                potentialCollections.get(primaryClass.fieldName)?.push(el);
            }
        });
    }

    // Process collections
    potentialCollections.forEach((elements, className) => {
        if (elements.length >= collectionMin) {
            const $first = $(elements[0]);
            const collectionFields: Record<string, any> = {};

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

            // Detect fields within collection - Images
            $first.find('img').each((_, img) => {
                if (isInsideButton($, img)) return;
                const $img = $(img);
                const $parent = $img.parent();
                const parentClassInfo = getPrimaryClass($parent.attr('class'));

                if (parentClassInfo && parentClassInfo.fieldName.includes('image')) {
                    collectionFields.image = { selector: `.${parentClassInfo.selector}`, type: 'image', attribute: 'src' };
                    return false;
                } else {
                    collectionFields.image = { selector: 'img', type: 'image', attribute: 'src' };
                    return false;
                }
            });

            // Tags/categories
            $first.find('[class*="tag"]').not('[class*="container"]').first().each((_, el) => {
                const classInfo = getPrimaryClass($(el).attr('class'));
                if (classInfo) {
                    collectionFields.tag = { selector: `.${classInfo.selector}`, type: 'plain' };
                }
            });

            // Headings (title)
            $first.find('h1, h2, h3, h4, h5, h6').first().each((_, el) => {
                const classInfo = getPrimaryClass($(el).attr('class'));
                const selector = classInfo ? `.${classInfo.selector}` : (el as any).tagName?.toLowerCase() || 'h2';
                collectionFields.title = { selector, type: 'plain' };
            });

            // Descriptions (paragraphs)
            $first.find('p').first().each((_, el) => {
                const classInfo = getPrimaryClass($(el).attr('class'));
                const selector = classInfo ? `.${classInfo.selector}` : 'p';
                collectionFields.description = { selector, type: 'plain' };
            });

            // Links
            $first.find('a, NuxtLink, nuxt-link').not('.c_button, .c_icon_button').first().each((_, el) => {
                const $link = $(el);
                const linkText = $link.text().trim();
                if (linkText) {
                    const classInfo = getPrimaryClass($link.attr('class'));
                    collectionFields.link = { selector: classInfo ? `.${classInfo.selector}` : 'a', type: 'link', attribute: 'href' };
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

                // Nested children — className is already normalized (underscores, lowercase)
                const childrenConfig = options.collectionChildren?.[className];
                if (childrenConfig?.length) {
                    const children: Record<string, CollectionChildMapping> = {};
                    for (const childDef of childrenConfig) {
                        const $firstChild = $first.find(childDef.selector).first();
                        if (!$firstChild.length) continue;
                        const childFields = detectChildFields($, $firstChild);
                        if (Object.keys(childFields).length > 0) {
                            children[childDef.fieldName] = {
                                selector: childDef.selector,
                                fields: childFields,
                            };
                        }
                    }
                    if (Object.keys(children).length > 0) {
                        detectedCollections[collectionName].children = children;
                    }
                }
            }
        }
    });

    // ========================================
    // PHASE 2: Universal field detection (all remaining elements)
    // ========================================
    if (universalDetection) {
        const $body = $('body');
        let textIndex = 0;
        let imageIndex = 0;
        let linkIndex = 0;

        // 2a. Detect ALL text elements (h1-h6, p, span, etc. AND divs)
        // CRITICAL: Only detect LEAF elements (no child elements, has text content)
        const allTextSelectors = [...TEXT_SELECTORS, 'div'].join(', ');
        $body.find(allTextSelectors).each((_, el) => {
            if (collectionElements.has(el)) return;
            if (processedElements.has(el)) return;

            const $el = $(el);

            // Skip ignored elements
            if (shouldIgnoreElement($, $el, options)) return;

            // Skip anchors - they're handled by link detection
            const tagName = ($el.prop('tagName') || 'div').toLowerCase();
            if (tagName === 'a' || tagName === 'nuxt-link' || $el.is('NuxtLink')) return;

            // Skip elements inside links/buttons (will be handled with link detection)
            if (isInsideButton($, el)) return;

            // CRITICAL: Only detect LEAF elements
            // Must have ZERO child elements and actual text content
            if (!isEditableLeaf($el)) return;

            const fieldName = generateFieldName($, $el, tagName, textIndex++);
            const fieldType = determineFieldType($el, tagName);
            const selector = buildUniqueSelector($, $el);

            detectedFields[getUniqueFieldName(fieldName)] = {
                selector,
                type: fieldType,
                editable: true,
                source: 'auto',
            };

            processedElements.add(el);
        });

        // 2b. Detect ALL images
        $body.find('img').each((_, el) => {
            if (collectionElements.has(el)) return;
            if (processedElements.has(el)) return;

            const $el = $(el);

            // Skip ignored elements
            if (shouldIgnoreElement($, $el, options)) return;

            // Skip decorative images (icons, arrows, etc.)
            if (isDecorativeImage($, $el)) return;

            const fieldName = generateFieldName($, $el, 'image', imageIndex++);
            const selector = buildUniqueSelector($, $el);

            detectedFields[getUniqueFieldName(fieldName)] = {
                selector,
                type: 'image',
                editable: true,
                source: 'auto',
                attribute: 'src',
            };

            processedElements.add(el);
        });

        // 2c. Detect ALL links (as composite fields with URL + text, or href-only for image links)
        $body.find('a, NuxtLink, nuxt-link').each((_, el) => {
            if (collectionElements.has(el)) return;
            if (processedElements.has(el)) return;

            const $el = $(el);

            // Skip ignored elements
            if (shouldIgnoreElement($, $el, options)) return;

            // Check if this is a link wrapping only an image
            const hasOnlyImage = $el.children().length === 1 && $el.find('img').length === 1;
            const linkText = $el.text().trim();

            // Skip completely empty links with no image (icon-only, no content)
            if (!hasOnlyImage && (!linkText || linkText.length < 2)) return;

            const fieldName = generateFieldName($, $el, 'link', linkIndex++);
            const selector = buildUniqueSelector($, $el);

            detectedFields[getUniqueFieldName(fieldName)] = {
                selector,
                type: 'link',
                editable: true,
                source: 'auto',
                attribute: 'href',
            };

            processedElements.add(el);
        });

        // 2d. Detect button text
        $body.find('button, .c_button, [class*="button"]').each((_, el) => {
            if (collectionElements.has(el)) return;
            if (processedElements.has(el)) return;

            const $el = $(el);

            // Skip ignored elements
            if (shouldIgnoreElement($, $el, options)) return;

            // Get direct text content
            const text = $el.clone().children().remove().end().text().trim();
            if (!text || text.length < 2) return;

            const fieldName = generateFieldName($, $el, 'button', textIndex++);
            const selector = buildUniqueSelector($, $el);

            detectedFields[getUniqueFieldName(fieldName)] = {
                selector,
                type: 'plain',
                editable: true,
                source: 'auto',
            };

            processedElements.add(el);
        });
    }

    return {
        fields: detectedFields,
        collections: detectedCollections,
    };
}

function extractTemplateFromAstro(content: string): string {
    return content.replace(/^---[\s\S]*?---\n?/, '').trim();
}

/**
 * Analyze all pages (Vue or Astro) in a directory for CMS fields
 */
export async function analyzeVuePages(
    pagesDir: string,
    options: DetectionOptions = {}
): Promise<Record<string, {
    fields: Record<string, FieldMapping>;
    collections: Record<string, CollectionMapping>;
}>> {
    const results: Record<string, any> = {};

    const pageFiles = await glob('**/*.{vue,astro}', { cwd: pagesDir, nodir: true });

    for (const file of pageFiles) {
        const filePath = path.join(pagesDir, file);
        const content = await fs.readFile(filePath, 'utf-8');

        let template: string;
        let pageName: string;

        if (file.endsWith('.vue')) {
            template = extractTemplateFromVue(content);
            pageName = htmlPathToPageId(file.replace(/\.vue$/i, '.html'));
        } else {
            template = extractTemplateFromAstro(content);
            pageName = htmlPathToPageId(file.replace(/\.astro$/i, '.html'));
        }

        if (template) {
            results[pageName] = detectEditableFields(template, options);
        }
    }

    return results;
}

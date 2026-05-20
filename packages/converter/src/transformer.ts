/**
 * Transform CMS manifest to Strapi schemas
 */

import type { CMSManifest, StrapiSchema, FieldMapping } from '@see-ms/types';

/**
 * Link component schema for Strapi
 * This is a shared component that represents a link with URL and text
 */
export const LINK_COMPONENT_SCHEMA = {
    collectionName: 'components_shared_links',
    info: {
        displayName: 'Link',
        icon: 'link',
        description: 'A link with URL and text'
    },
    options: {},
    attributes: {
        url: {
            type: 'string' as const,
            required: true
        },
        text: {
            type: 'string' as const,
            required: true
        },
        newTab: {
            type: 'boolean' as const,
            default: false
        }
    }
};

/**
 * Map field type to Strapi field type
 * Returns type info including whether it's a component
 */
function mapFieldTypeToStrapi(fieldType: string): { type: string; isComponent?: boolean; component?: string } {
    if (fieldType === 'link') {
        return {
            type: 'component',
            isComponent: true,
            component: 'shared.link'
        };
    }

    const typeMap: Record<string, string> = {
        plain: 'string',
        rich: 'richtext',
        html: 'richtext',
        image: 'media',
        icon: 'media',
        email: 'email',
        phone: 'string',
    };

    return { type: typeMap[fieldType] || 'string' };
}

/**
 * Generate proper plural form for a word
 */
function pluralize(word: string): string {
    // Handle special cases
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('z') ||
        word.endsWith('ch') || word.endsWith('sh')) {
        return word + 'es';
    }

    // Handle words ending in 'y' preceded by consonant
    if (word.endsWith('y') && word.length > 1) {
        const secondLast = word[word.length - 2];
        if (!'aeiou'.includes(secondLast.toLowerCase())) {
            return word.slice(0, -1) + 'ies';
        }
    }

    // Default: just add 's'
    return word + 's';
}

/**
 * Convert a page manifest to a Strapi schema (single type)
 */
function pageToStrapiSchema(pageName: string, fields: Record<string, FieldMapping>): StrapiSchema {
    const attributes: Record<string, any> = {};

    // Convert each field
    for (const [fieldName, field] of Object.entries(fields)) {
        const strapiType = mapFieldTypeToStrapi(field.type);

        if (strapiType.isComponent) {
            // Link field - use component type
            attributes[fieldName] = {
                type: 'component',
                component: strapiType.component,
                repeatable: false,
            };
        } else {
            attributes[fieldName] = {
                type: strapiType.type,
                required: field.required || false,
            };

            if (field.default && typeof field.default === 'string') {
                attributes[fieldName].default = field.default;
            }
        }
    }

    // Generate display name
    const displayName = pageName
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Use kebab-case consistently (keep the original pageName format)
    // This matches Strapi conventions and avoids conversion issues
    const kebabCaseName = pageName;

    // Generate plural name
    const pluralName = pluralize(kebabCaseName);

    return {
        kind: 'singleType',
        collectionName: kebabCaseName,
        info: {
            singularName: kebabCaseName,
            pluralName: pluralName,
            displayName: displayName,
        },
        options: {
            draftAndPublish: true,
        },
        attributes,
    };
}

/**
 * Convert a collection to a Strapi schema (collection type)
 */
function collectionToStrapiSchema(
    collectionName: string,
    collection: any
): StrapiSchema {
    const attributes: Record<string, any> = {};

    // Convert each field in the collection
    for (const [fieldName, fieldConfig] of Object.entries(collection.fields)) {
        // Get type from field config if available, otherwise infer from name
        let fieldType: string | undefined;

        if (typeof fieldConfig === 'object' && fieldConfig !== null && 'type' in fieldConfig) {
            fieldType = (fieldConfig as any).type;
        }

        if (fieldType) {
            // Use the detected field type
            const strapiType = mapFieldTypeToStrapi(fieldType);

            if (strapiType.isComponent) {
                attributes[fieldName] = {
                    type: 'component',
                    component: strapiType.component,
                    repeatable: false,
                };
            } else {
                attributes[fieldName] = {
                    type: strapiType.type,
                };
            }
        } else {
            // Fallback: Determine type based on field name
            let type = 'string';

            if (fieldName === 'image' || fieldName.includes('image')) {
                type = 'media';
            } else if (fieldName === 'description' || fieldName === 'content') {
                type = 'richtext';
            } else if (fieldName === 'link' || fieldName === 'url') {
                // Use link component for link fields
                attributes[fieldName] = {
                    type: 'component',
                    component: 'shared.link',
                    repeatable: false,
                };
                continue;
            } else if (fieldName === 'title' || fieldName === 'tag') {
                type = 'string';
            }

            attributes[fieldName] = {
                type,
            };
        }
    }

    // Generate display name
    const displayName = collectionName
        .split(/[-_]/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    // Convert underscores to kebab-case for consistency
    const kebabCaseName = collectionName.replace(/_/g, '-');

    // Get singular name (remove trailing 's')
    const singularName = kebabCaseName.endsWith('s')
        ? kebabCaseName.slice(0, -1)
        : kebabCaseName;

    return {
        kind: 'collectionType',
        collectionName: kebabCaseName,
        info: {
            singularName: singularName,
            pluralName: kebabCaseName,
            displayName: displayName,
        },
        options: {
            draftAndPublish: true,
        },
        attributes,
    };
}

/**
 * Check if any field in the manifest uses link type
 */
function hasLinkFields(manifest: CMSManifest): boolean {
    // Check page fields
    for (const page of Object.values(manifest.pages)) {
        if (page.fields) {
            for (const field of Object.values(page.fields)) {
                if (field.type === 'link') return true;
            }
        }
        // Check collection fields
        if (page.collections) {
            for (const collection of Object.values(page.collections)) {
                for (const fieldConfig of Object.values(collection.fields)) {
                    if (typeof fieldConfig === 'object' && fieldConfig !== null) {
                        if ((fieldConfig as any).type === 'link') return true;
                    }
                }
            }
        }
    }
    // Check global fields
    if (manifest.global?.fields) {
        for (const field of Object.values(manifest.global.fields)) {
            if (field.type === 'link') return true;
        }
    }
    return false;
}

/**
 * Transform entire manifest to Strapi schemas
 * Returns content type schemas and optionally the link component schema
 */
export function manifestToSchemas(manifest: CMSManifest): Record<string, StrapiSchema> {
    const schemas: Record<string, StrapiSchema> = {};

    // Convert pages to single types
    for (const [pageName, page] of Object.entries(manifest.pages)) {
        // Only create schema if page has fields
        if (page.fields && Object.keys(page.fields).length > 0) {
            schemas[pageName] = pageToStrapiSchema(pageName, page.fields);
        }

        // Convert collections to collection types
        if (page.collections) {
            for (const [collectionName, collection] of Object.entries(page.collections)) {
                schemas[collectionName] = collectionToStrapiSchema(collectionName, collection);
            }
        }
    }

    // Add global schema if present
    if (manifest.global?.fields && Object.keys(manifest.global.fields).length > 0) {
        schemas['global'] = pageToStrapiSchema('global', manifest.global.fields);
    }

    return schemas;
}

/**
 * Get the link component schema if needed
 */
export function getLinkComponentSchema(manifest: CMSManifest): typeof LINK_COMPONENT_SCHEMA | null {
    return hasLinkFields(manifest) ? LINK_COMPONENT_SCHEMA : null;
}

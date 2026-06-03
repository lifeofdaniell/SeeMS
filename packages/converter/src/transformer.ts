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
            // Anchor text is unbounded (can wrap a sentence/blurb), so use a
            // SQL text column — `string` (varchar(255)) overflows on long links.
            type: 'text' as const,
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

/** Strapi maps a `string` attribute to SQL varchar(255); `text` is unbounded. */
const STRAPI_STRING_MAX = 255;

/**
 * Upgrade `string` attributes to `text` when their seed content would overflow
 * varchar(255). Webflow content (paragraphs, marquees, long copy) regularly
 * exceeds 255 chars; left as `string` it makes Postgres reject the insert with
 * "value too long for type character varying(255)" and the seed fails with a
 * generic 500. Run this after both the schemas and the seed data exist (the
 * manifest alone doesn't carry content). Short fields stay `string` so the admin
 * UI keeps single-line inputs. Mutates `contentTypes`; returns the count changed.
 */
export function upgradeLongStringFieldsToText(
    contentTypes: Record<string, any>,
    seedData: Record<string, any>
): number {
    let upgraded = 0;

    for (const [name, schema] of Object.entries(contentTypes)) {
        const attributes = schema?.attributes;
        const data = seedData?.[name];
        if (!attributes || data == null) continue;

        const rows: any[] = Array.isArray(data) ? data : [data];

        for (const [fieldName, attr] of Object.entries<any>(attributes)) {
            if (!attr || attr.type !== 'string') continue;

            const overflows = rows.some((row) => {
                const value = row?.[fieldName];
                return typeof value === 'string' && value.length > STRAPI_STRING_MAX;
            });

            if (overflows) {
                attr.type = 'text';
                upgraded++;
            }
        }
    }

    return upgraded;
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
 * Build Strapi attributes from a flat field map.
 * Shared by collection items and nested component schemas.
 */
function buildAttributes(fields: Record<string, any>): Record<string, any> {
    const attributes: Record<string, any> = {};

    for (const [fieldName, fieldConfig] of Object.entries(fields)) {
        let fieldType: string | undefined;

        if (typeof fieldConfig === 'object' && fieldConfig !== null && 'type' in fieldConfig) {
            fieldType = (fieldConfig as any).type;
        }

        if (fieldType) {
            const strapiType = mapFieldTypeToStrapi(fieldType);
            if (strapiType.isComponent) {
                attributes[fieldName] = { type: 'component', component: strapiType.component, repeatable: false };
            } else {
                attributes[fieldName] = { type: strapiType.type };
            }
        } else {
            // Name-based fallback
            if (fieldName === 'image' || fieldName.includes('image')) {
                attributes[fieldName] = { type: 'media' };
            } else if (fieldName === 'description' || fieldName === 'content' || fieldName === 'answer') {
                attributes[fieldName] = { type: 'richtext' };
            } else if (fieldName === 'link' || fieldName === 'url') {
                attributes[fieldName] = { type: 'component', component: 'shared.link', repeatable: false };
            } else {
                attributes[fieldName] = { type: 'string' };
            }
        }
    }

    return attributes;
}

/**
 * Convert a collection to a Strapi schema (collection type).
 * Returns the collection schema plus any component schemas needed for children.
 */
function collectionToStrapiSchema(
    collectionName: string,
    collection: any
): { schema: StrapiSchema; componentSchemas: Record<string, any> } {
    const attributes = buildAttributes(collection.fields);
    const componentSchemas: Record<string, any> = {};

    // Nested children → Strapi repeatable component fields
    if (collection.children) {
        for (const [childFieldName, childDef] of Object.entries<any>(collection.children)) {
            const kebabCollection = collectionName.replace(/_/g, '-').replace(/--+/g, '-');
            const uid = childDef.componentUid || `default.${kebabCollection}-${childFieldName}`;
            // "default.faq-groups-items" → key "default/faq-groups-items" for file path
            const componentKey = uid.replace('.', '/');

            attributes[childFieldName] = { type: 'component', component: uid, repeatable: true };

            const displayName = uid
                .split(/[.\-_]/)
                .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(' ');

            componentSchemas[componentKey] = {
                collectionName: uid.replace(/\./g, '_'),
                info: { displayName, icon: 'layer' },
                options: {},
                attributes: buildAttributes(childDef.fields),
            };
        }
    }

    const displayName = collectionName
        .split(/[-_]/)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    const kebabCaseName = collectionName.replace(/_/g, '-').replace(/--+/g, '-');
    const singularName = kebabCaseName.endsWith('s')
        ? kebabCaseName.slice(0, -1)
        : kebabCaseName;

    return {
        schema: {
            kind: 'collectionType',
            collectionName: kebabCaseName,
            info: { singularName, pluralName: kebabCaseName, displayName },
            options: { draftAndPublish: true },
            attributes,
        },
        componentSchemas,
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
    if (manifest.global?.components) {
        for (const component of Object.values(manifest.global.components)) {
            for (const field of Object.values(component.fields || {})) {
                if (field.type === 'link') return true;
            }
        }
    }
    return false;
}

/**
 * Transform entire manifest to Strapi schemas.
 * Returns content-type schemas AND any Strapi component schemas needed for
 * nested children (keyed as "category/name", e.g. "default/faq-groups-items").
 */
export function manifestToSchemas(manifest: CMSManifest): {
    contentTypes: Record<string, StrapiSchema>;
    componentSchemas: Record<string, any>;
} {
    const contentTypes: Record<string, StrapiSchema> = {};
    const componentSchemas: Record<string, any> = {};

    // Convert pages to single types
    for (const [pageName, page] of Object.entries(manifest.pages)) {
        if (page.fields && Object.keys(page.fields).length > 0) {
            contentTypes[pageName] = pageToStrapiSchema(pageName, page.fields);
        }

        // Convert collections to collection types
        if (page.collections) {
            for (const [collectionName, collection] of Object.entries(page.collections)) {
                const { schema, componentSchemas: childSchemas } = collectionToStrapiSchema(collectionName, collection);
                contentTypes[collectionName] = schema;
                Object.assign(componentSchemas, childSchemas);
            }
        }
    }

    // Add global schema if present
    if (manifest.global?.fields && Object.keys(manifest.global.fields).length > 0) {
        contentTypes['global'] = pageToStrapiSchema('global', manifest.global.fields);
    }

    return { contentTypes, componentSchemas };
}

/**
 * Get the link component schema if needed
 */
export function getLinkComponentSchema(manifest: CMSManifest): typeof LINK_COMPONENT_SCHEMA | null {
    return hasLinkFields(manifest) ? LINK_COMPONENT_SCHEMA : null;
}

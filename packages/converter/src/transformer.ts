/**
 * Transform CMS manifest to Strapi schemas
 */

import type { CMSManifest, StrapiSchema, FieldMapping } from '@see-ms/types';

/**
 * Map field type to Strapi field type
 */
function mapFieldTypeToStrapi(fieldType: string): string {
  const typeMap: Record<string, string> = {
    plain: 'string',
    rich: 'richtext',
    html: 'richtext',
    image: 'media',
    link: 'string',
    email: 'email',
    phone: 'string',
  };

  return typeMap[fieldType] || 'string';
}

/**
 * Convert a page manifest to a Strapi schema (single type)
 */
function pageToStrapiSchema(pageName: string, fields: Record<string, FieldMapping>): StrapiSchema {
  const attributes: Record<string, any> = {};

  // Convert each field
  for (const [fieldName, field] of Object.entries(fields)) {
    attributes[fieldName] = {
      type: mapFieldTypeToStrapi(field.type),
      required: field.required || false,
    };

    if (field.default) {
      attributes[fieldName].default = field.default;
    }
  }

  // Generate display name
  const displayName = pageName
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return {
    kind: 'singleType',
    collectionName: pageName.replace(/-/g, '_'),
    info: {
      singularName: pageName.replace(/-/g, '_'),
      pluralName: pageName.replace(/-/g, '_'),
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
  for (const [fieldName, _selector] of Object.entries(collection.fields)) {
    // Determine type based on field name
    let type = 'string';

    if (fieldName === 'image' || fieldName.includes('image')) {
      type = 'media';
    } else if (fieldName === 'description' || fieldName === 'content') {
      type = 'richtext';
    } else if (fieldName === 'link' || fieldName === 'url') {
      type = 'string';
    } else if (fieldName === 'title' || fieldName === 'tag') {
      type = 'string';
    }

    attributes[fieldName] = {
      type,
    };
  }

  // Generate display name
  const displayName = collectionName
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  // Get singular name (remove trailing 's')
  const singularName = collectionName.endsWith('s')
    ? collectionName.slice(0, -1)
    : collectionName;

  return {
    kind: 'collectionType',
    collectionName: collectionName.replace(/[-_]/g, '_'),
    info: {
      singularName: singularName.replace(/[-_]/g, '_'),
      pluralName: collectionName.replace(/[-_]/g, '_'),
      displayName: displayName,
    },
    options: {
      draftAndPublish: true,
    },
    attributes,
  };
}

/**
 * Transform entire manifest to Strapi schemas
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

  return schemas;
}

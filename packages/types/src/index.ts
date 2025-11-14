/**
 * Core type definitions for SeeMS CMS manifest and configuration
 */

export type FieldType = 'plain' | 'rich' | 'html' | 'image' | 'link' | 'email' | 'phone';

export interface FieldMapping {
  /** CSS selector for the field in the DOM */
  selector: string;
  /** Type of content this field contains */
  type: FieldType;
  /** Optional default value */
  default?: string;
  /** Whether this field is required */
  required?: boolean;
  /** Whether this field should be editable in the editor */
  editable?: boolean;
}

export interface CollectionFieldMapping {
  /** CSS selector relative to the collection item */
  selector: string;
  /** Type of content this field contains */
  type: FieldType;
  /** Optional attribute to extract (e.g., 'src' for images, 'href' for links) */
  attribute?: string;
}

export interface CollectionMapping {
  /** CSS selector for the repeating collection items */
  selector: string;
  /** Fields within each collection item */
  fields: Record<string, CollectionFieldMapping | string>;
  /** Optional limit for number of items */
  limit?: number;
}

export interface PageManifest {
  /** Single fields on the page */
  fields?: Record<string, FieldMapping>;
  /** Repeating collections on the page */
  collections?: Record<string, CollectionMapping>;
  /** Page metadata */
  meta?: {
    title?: string;
    description?: string;
    route?: string;
  };
}

export interface CMSManifest {
  /** Version of the manifest schema */
  version: string;
  /** Pages in the site */
  pages: Record<string, PageManifest>;
  /** Global/shared fields across all pages */
  global?: {
    fields?: Record<string, FieldMapping>;
  };
  /** Custom overrides from developer */
  overrides?: ManifestOverrides;
}

export interface ManifestOverrides {
  /** Pages to exclude from conversion */
  excludePages?: string[];
  /** Selectors to ignore during auto-detection */
  ignoreSelectors?: string[];
  /** Custom field mappings to override auto-detected ones */
  customFields?: Record<string, Record<string, FieldMapping>>;
}

export interface ConversionOptions {
  /** Path to Webflow export directory */
  inputDir: string;
  /** Path to output Nuxt project */
  outputDir: string;
  /** Optional overrides file path */
  overridesPath?: string;
  /** Whether to generate Strapi schemas immediately */
  generateStrapi?: boolean;
  /** CMS backend type */
  cmsBackend?: 'strapi' | 'contentful' | 'sanity';
  /** Boilerplate source - GitHub URL or local path */
  boilerplate?: string;
}

export interface StrapiFieldType {
  type: 'string' | 'text' | 'richtext' | 'media' | 'email' | 'url';
  required?: boolean;
  unique?: boolean;
  default?: any;
}

export interface StrapiSchema {
  kind: 'singleType' | 'collectionType';
  collectionName: string;
  info: {
    singularName: string;
    pluralName: string;
    displayName: string;
  };
  options: {
    draftAndPublish: boolean;
  };
  attributes: Record<string, StrapiFieldType | { type: 'relation'; relation: string; target: string }>;
}

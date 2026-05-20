/**
 * Core type definitions for SeeMS CMS manifest and configuration
 */

export type FieldType = 'plain' | 'rich' | 'html' | 'image' | 'icon' | 'link' | 'email' | 'phone';

/**
 * Link field value structure with both URL and text editable
 */
export interface LinkFieldValue {
  /** The link URL/href */
  url: string;
  /** The visible link text */
  text: string;
  /** Whether to open in new tab */
  newTab?: boolean;
}

/**
 * Data attributes parsed from HTML elements for CMS control
 */
export interface DataCMSAttributes {
  /** Field name: data-cms="field-name" */
  name?: string;
  /** Field type override: data-cms-type="rich" */
  type?: FieldType;
  /** Ignore this element: data-cms-ignore */
  ignore?: boolean;
  /** Group for nested fields: data-cms-group="hero" */
  group?: string;
}

export interface FieldMapping {
  /** CSS selector for the field in the DOM */
  selector: string;
  /** Type of content this field contains */
  type: FieldType;
  /** Optional default value (string for text, LinkFieldValue for links) */
  default?: string | LinkFieldValue;
  /** Whether this field is required */
  required?: boolean;
  /** Whether this field should be editable in the editor */
  editable?: boolean;
  /** How this field was detected: 'auto' (by algorithm) or 'attribute' (via data-cms) */
  source?: 'auto' | 'attribute';
  /** Attribute to extract value from (e.g., 'src' for images, 'href' for links) */
  attribute?: string;
  /** Provider-specific mapping metadata. Keep optional so the core manifest remains portable. */
  providers?: Record<string, Record<string, unknown>>;
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

/**
 * Shared component extracted from multiple pages
 */
export interface SharedComponent {
  /** Component name (e.g., 'Nav', 'Footer') */
  name: string;
  /** Original CSS selector for the component */
  selector: string;
  /** Pages where this component appears */
  pages: string[];
  /** Editable fields within the component */
  fields?: Record<string, FieldMapping>;
  /** How confident the extractor is that this should be componentized */
  confidence?: 'high' | 'medium' | 'low';
  /** Why this component was detected */
  reason?: string;
}

export interface CMSManifest {
  /** Version of the manifest schema */
  version: string;
  /** Pages in the site */
  pages: Record<string, PageManifest>;
  /** Global/shared content (for shared components like Nav, Footer) */
  global?: {
    fields?: Record<string, FieldMapping>;
    /** Shared components extracted from pages */
    components?: Record<string, SharedComponent>;
  };
  /** Custom overrides from developer */
  overrides?: ManifestOverrides;
  /** Provider-specific manifest metadata */
  providers?: Record<string, Record<string, unknown>>;
}

export interface SeeMSConfig {
  cms?: {
    provider?: 'strapi' | 'contentful' | 'sanity';
    strapi?: {
      scaffold?: boolean;
      directory?: string;
      packageManager?: 'npm' | 'pnpm' | 'yarn';
      install?: boolean;
    };
  };
  collections?: Array<{
    className: string;
    name?: string;
    selector?: string;
  }>;
  components?: {
    enabled?: boolean;
    minOccurrences?: number;
    minSectionSize?: number;
    include?: string[];
    exclude?: string[];
  };
  ignore?: {
    selectors?: string[];
    classes?: string[];
  };
  fields?: Record<string, Record<string, Partial<FieldMapping>>>;
  editor?: {
    enabled?: boolean;
    previewParam?: string;
  };
}

export interface ConversionReport {
  generatedAt: string;
  stages: Array<'scan' | 'analyze' | 'plan' | 'convert' | 'cms' | 'editor'>;
  pages: Array<{
    source: string;
    pageId: string;
    route: string;
    output: string;
  }>;
  assets: {
    css: number;
    images: number;
    fonts: number;
    js: number;
    preservedStructure: boolean;
  };
  components: Array<{
    name: string;
    selector: string;
    pages: string[];
    confidence?: 'high' | 'medium' | 'low';
    reason?: string;
  }>;
  cms: {
    provider: 'strapi' | 'contentful' | 'sanity';
    fields: number;
    collections: number;
    schemas: number;
    seedPages: number;
  };
  warnings: string[];
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
  /** Custom collection classes to detect */
  collectionClasses?: string[];
  /** Mapping of collection class names to their display names */
  collectionNames?: Record<string, string>;
  /** Minimum items for collection detection */
  collectionMin?: number;
  /** Whether to extract shared components */
  extractComponents?: boolean;
  /** Skip interactive prompts (for CI/CD) */
  skipPrompts?: boolean;
  /** Whether to generate initial CMS content from HTML */
  generateContent?: boolean;
  /** Whether to install and wire the inline editor */
  editor?: boolean;
  /** Path to see-ms.config.ts/json */
  configPath?: string;
  /** Resolved project configuration */
  config?: SeeMSConfig;
}

/**
 * Multi-step conversion pipeline configuration
 */
export interface ConversionPipelineConfig {
  /** Phase 1: HTML to Vue conversion steps */
  htmlPhase: {
    extractComponents: boolean;
    detectCollections: boolean;
    detectFields: boolean;
    transformToVue: boolean;
    collectionClasses?: string[];
  };
  /** Phase 2: CMS setup steps */
  cmsPhase: {
    generateManifest: boolean;
    generateSchemas: boolean;
    generateContent: boolean;
  };
}

/**
 * Conversion pipeline state (stored in .cms-convert-state.json)
 */
export interface ConversionState {
  /** When the conversion started */
  startedAt: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Completed steps */
  completedSteps: string[];
  /** Configuration used */
  config: ConversionPipelineConfig;
  /** Detected shared components */
  sharedComponents?: SharedComponent[];
}

export interface StrapiFieldType {
  type: 'string' | 'text' | 'richtext' | 'media' | 'email' | 'url' | 'component' | 'boolean';
  required?: boolean;
  unique?: boolean;
  default?: any;
  /** For component type: the component name (e.g., 'shared.link') */
  component?: string;
  /** For component type: whether it's a repeatable component */
  repeatable?: boolean;
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

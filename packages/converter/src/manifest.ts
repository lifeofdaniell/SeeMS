/**
 * Manifest generation
 */

import type { CMSManifest, PageManifest, CollectionFieldMapping } from '@see-ms/types';
import type { SharedComponent } from '@see-ms/types';
import fs from 'fs-extra';
import path from 'path';
import { analyzeVuePages, detectEditableFields, DetectionOptions } from './detector';

/**
 * Manifest generation options
 */
export interface ManifestOptions {
  /** Custom collection classes to detect */
  collectionClasses?: string[];
  /** Mapping of collection class names to display names */
  collectionNames?: Record<string, string>;
  /** Shared components extracted during conversion */
  sharedComponents?: SharedComponent[];
  /** Directory containing extracted shared Vue components */
  componentsDir?: string;
  /** Selectors to ignore during field detection */
  ignoreSelectors?: string[];
  /** Classes to ignore during field detection */
  ignoreClasses?: string[];
  /** CMS provider */
  provider?: 'strapi' | 'contentful' | 'sanity';
  /** Route lookup by page id */
  pageRoutes?: Record<string, string>;
  /**
   * Nested child definitions keyed by normalized collection class name.
   * e.g. { "w_tab_pane": [{ fieldName: "items", selector: ".faq-item" }] }
   */
  collectionChildren?: Record<string, Array<{ fieldName: string; selector: string }>>;
}

/**
 * Internal: attach shared component fields to an in-progress manifest.
 * Mutates manifest in place.
 */
async function attachComponentFields(
  manifest: CMSManifest,
  options: ManifestOptions
): Promise<void> {
  if (!options.sharedComponents?.length || !options.componentsDir) return;

  const componentDetectionOptions: DetectionOptions = {
    collectionClasses: options.collectionClasses,
    ignoreSelectors: options.ignoreSelectors,
    ignoreClasses: options.ignoreClasses,
  };

  const globalFields: NonNullable<CMSManifest["global"]>["fields"] = {};
  const components = manifest.global?.components || {};

  for (const component of options.sharedComponents) {
    const componentPath = path.join(options.componentsDir, `${component.name}.vue`);
    if (!(await fs.pathExists(componentPath))) continue;

    const content = await fs.readFile(componentPath, "utf-8");
    const templateMatch = content.match(/<template>([\s\S]*?)<\/template>/);
    if (!templateMatch) continue;

    const detection = detectEditableFields(templateMatch[1], componentDetectionOptions);
    const prefixedFields = Object.fromEntries(
      Object.entries(detection.fields).map(([fieldName, field]) => [
        `${component.name}_${fieldName}`,
        field
      ])
    );
    const collectionFields = Object.fromEntries(
      Object.entries(detection.fields).map(([fieldName, field]) => [
        fieldName,
        {
          selector: field.selector,
          type: field.type,
          attribute: field.attribute
        } satisfies CollectionFieldMapping
      ])
    );

    const contentMode = component.contentMode || "shared-global";
    const role = component.role || "shared-section";

    const isSharedGlobal = role !== "collection-item" && (contentMode === "shared-global" || contentMode === "auto");
    components[component.name] = {
      ...component,
      role,
      contentMode,
      // shared-global → its own single type (un-prefixed fields).
      // collection-item → un-prefixed. per-page → prefixed (merged into pages).
      fields: (role === "collection-item" || isSharedGlobal) ? detection.fields : prefixedFields
    };

    if (role === "collection-item") {
      for (const pageId of component.pages || []) {
        if (!manifest.pages[pageId]) continue;
        const collectionName = resolveCollectionName(component.collectionName || toCollectionName(component.name), pageId);
        manifest.pages[pageId].collections = {
          ...manifest.pages[pageId].collections,
          [collectionName]: {
            selector: component.selector,
            fields: collectionFields,
            componentName: component.name,
            storage: component.collectionStorage || "collection-type"
          }
        };
      }
    } else if (contentMode === "per-page") {
      for (const pageId of component.pages || []) {
        if (!manifest.pages[pageId]) continue;
        manifest.pages[pageId].fields = {
          ...manifest.pages[pageId].fields,
          ...prefixedFields
        };
      }
    }
    // shared-global / auto: becomes a per-component single type, built from
    // components[name].fields in the transformer — nothing to merge here.
  }

  if (manifest.global) {
    manifest.global.components = components;
    if (Object.keys(globalFields || {}).length > 0) {
      manifest.global.fields = globalFields;
    }
  }
}

/**
 * Internal: build page manifest entries from a detection map, applying
 * collection name remappings if configured.
 */
function buildPages(
  analyzed: Record<string, { fields: Record<string, any>; collections: Record<string, any> }>,
  options: ManifestOptions
): Record<string, PageManifest> {
  const pages: Record<string, PageManifest> = {};

  for (const [pageName, detection] of Object.entries(analyzed)) {
    let collections = detection.collections;

    if (options.collectionNames && Object.keys(options.collectionNames).length > 0) {
      collections = {};
      for (const [collectionKey, collection] of Object.entries(detection.collections)) {
        let newName = collectionKey;
        for (const [className, displayName] of Object.entries(options.collectionNames)) {
          const normalizedClassName = className.replace(/-/g, '_');
          if (collectionKey === normalizedClassName) {
            newName = displayName;
            break;
          }
        }
        collections[newName] = collection;
      }
    }

    pages[pageName] = {
      fields: detection.fields,
      collections,
      meta: {
        route: options.pageRoutes?.[pageName] || (pageName === 'index' ? '/' : `/${pageName}`),
      },
    };
  }

  return pages;
}

/**
 * Internal: assemble the skeleton CMSManifest from page map + options.
 */
function assembleManifest(pages: Record<string, PageManifest>, options: ManifestOptions): CMSManifest {
  return {
    version: '1.0',
    pages,
    global: options.sharedComponents && options.sharedComponents.length > 0
      ? {
          components: Object.fromEntries(
            options.sharedComponents.map((component) => [component.name, component])
          ),
        }
      : undefined,
    providers: {
      [options.provider || 'strapi']: { version: '1' }
    }
  };
}

/**
 * Generate CMS manifest from already-converted Vue pages directory.
 * Used during the normal conversion flow — reads .vue files that still have
 * their static HTML content (before reactive transformation).
 */
export async function generateManifest(
  pagesDir: string,
  options: ManifestOptions = {}
): Promise<CMSManifest> {
  const collectionItemSelectors = options.sharedComponents
    ?.filter((component) => component.role === "collection-item")
    .map((component) => component.selector) || [];

  const detectionOptions: DetectionOptions = {
    collectionClasses: options.collectionClasses,
    ignoreSelectors: [
      ...(options.ignoreSelectors || []),
      ...collectionItemSelectors
    ],
    ignoreClasses: options.ignoreClasses,
    collectionChildren: options.collectionChildren,
  };

  const analyzed = await analyzeVuePages(pagesDir, detectionOptions);
  const pages = buildPages(analyzed, options);
  const manifest = assembleManifest(pages, options);
  await attachComponentFields(manifest, options);
  return manifest;
}

/**
 * Generate CMS manifest directly from raw HTML strings.
 * Used by `cms extract collections` — runs detection on the original Webflow
 * HTML so already-transformed Vue files (which contain {{ content.x }} syntax)
 * don't confuse the field detector.
 */
export async function generateManifestFromHtmlMap(
  htmlContentMap: Map<string, string>,
  pageRoutes: Record<string, string>,
  options: ManifestOptions = {}
): Promise<CMSManifest> {
  const collectionItemSelectors = options.sharedComponents
    ?.filter((component) => component.role === "collection-item")
    .map((component) => component.selector) || [];

  const detectionOptions: DetectionOptions = {
    collectionClasses: options.collectionClasses,
    ignoreSelectors: [
      ...(options.ignoreSelectors || []),
      ...collectionItemSelectors
    ],
    ignoreClasses: options.ignoreClasses,
    collectionChildren: options.collectionChildren,
  };

  const analyzed: Record<string, { fields: Record<string, any>; collections: Record<string, any> }> = {};
  for (const [pageName, html] of htmlContentMap.entries()) {
    analyzed[pageName] = detectEditableFields(html, detectionOptions);
  }

  const pages = buildPages(analyzed, { ...options, pageRoutes });
  const manifest = assembleManifest(pages, options);
  await attachComponentFields(manifest, options);
  return manifest;
}

function toCollectionName(name: string): string {
  const base = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();

  if (base.endsWith("s")) return base;
  return `${base}s`;
}

function resolveCollectionName(collectionName: string, pageId: string): string {
  return collectionName === pageId ? `${collectionName}_items` : collectionName;
}

/**
 * Write manifest to file
 * Only writes to public directory - this is where the editor overlay loads from
 */
export async function writeManifest(
  outputDir: string,
  manifest: CMSManifest
): Promise<void> {
  const manifestContent = JSON.stringify(manifest, null, 2);

  // Write to public directory for client-side access (editor overlay)
  const publicDir = path.join(outputDir, 'public');
  await fs.ensureDir(publicDir);
  const publicManifestPath = path.join(publicDir, 'cms-manifest.json');
  await fs.writeFile(publicManifestPath, manifestContent, 'utf-8');
}

/**
 * Read manifest from file (from public directory)
 */
export async function readManifest(outputDir: string): Promise<CMSManifest> {
  const manifestPath = path.join(outputDir, 'public', 'cms-manifest.json');
  const content = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Manifest generation
 */

import type { CMSManifest, PageManifest } from '@see-ms/types';
import fs from 'fs-extra';
import path from 'path';
import { analyzeVuePages, DetectionOptions } from './detector';

/**
 * Manifest generation options
 */
export interface ManifestOptions {
  /** Custom collection classes to detect */
  collectionClasses?: string[];
  /** Mapping of collection class names to display names */
  collectionNames?: Record<string, string>;
}

/**
 * Generate CMS manifest from analyzed pages
 */
export async function generateManifest(
  pagesDir: string,
  options: ManifestOptions = {}
): Promise<CMSManifest> {
  // Build detection options
  const detectionOptions: DetectionOptions = {
    collectionClasses: options.collectionClasses,
  };

  // Analyze all Vue pages
  const analyzed = await analyzeVuePages(pagesDir, detectionOptions);

  // Build the manifest
  const pages: Record<string, PageManifest> = {};

  for (const [pageName, detection] of Object.entries(analyzed)) {
    // Apply collection name mappings if provided
    let collections = detection.collections;
    if (options.collectionNames && Object.keys(options.collectionNames).length > 0) {
      collections = {};
      for (const [collectionKey, collection] of Object.entries(detection.collections)) {
        // Check if this collection should be renamed
        let newName = collectionKey;
        for (const [className, displayName] of Object.entries(options.collectionNames)) {
          const normalizedClassName = className.replace(/-/g, '_');
          if (collectionKey.includes(normalizedClassName) || collectionKey === normalizedClassName) {
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
        route: pageName === 'index' ? '/' : `/${pageName}`,
      },
    };
  }

  const manifest: CMSManifest = {
    version: '1.0',
    pages,
  };

  return manifest;
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

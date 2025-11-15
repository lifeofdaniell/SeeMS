/**
 * Manifest generation
 */

import type { CMSManifest, PageManifest } from '@see-ms/types';
import fs from 'fs-extra';
import path from 'path';
import { analyzeVuePages } from './detector';

/**
 * Generate CMS manifest from analyzed pages
 */
export async function generateManifest(pagesDir: string): Promise<CMSManifest> {
  // Analyze all Vue pages
  const analyzed = await analyzeVuePages(pagesDir);

  // Build the manifest
  const pages: Record<string, PageManifest> = {};

  for (const [pageName, detection] of Object.entries(analyzed)) {
    pages[pageName] = {
      fields: detection.fields,
      collections: detection.collections,
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
 */
export async function writeManifest(
  outputDir: string,
  manifest: CMSManifest
): Promise<void> {
  const manifestPath = path.join(outputDir, 'cms-manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Read manifest from file
 */
export async function readManifest(outputDir: string): Promise<CMSManifest> {
  const manifestPath = path.join(outputDir, 'cms-manifest.json');
  const content = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(content);
}

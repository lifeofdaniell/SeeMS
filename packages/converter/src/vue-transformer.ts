/**
 * Transform static Vue files to use reactive content from Strapi
 */

import * as cheerio from 'cheerio';
import fs from 'fs-extra';
import path from 'path';
import type { CMSManifest, CollectionMapping } from '@see-ms/types';

/**
 * Replace element content with Vue template binding
 */
function replaceWithBinding(
  _$: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
  fieldName: string,
  type: string
): void {
  if (type === 'image') {
    const $img = $el.find('img').first();
    if ($img.length) {
      // Replace src with Vue binding
      $img.attr(':src', `content.${fieldName}`);
      $img.removeAttr('src');
    }
  } else if (type === 'rich') {
    // For rich text, use v-html
    $el.attr('v-html', `content.${fieldName}`);
    $el.empty(); // Remove static content
  } else {
    // For plain text, use {{ }}
    $el.empty();
    $el.text(`{{ content.${fieldName} }}`);
  }
}

/**
 * Transform collection elements to use v-for
 */
function transformCollection(
  $: cheerio.CheerioAPI,
  collectionName: string,
  collection: CollectionMapping
): void {
  // Find all collection items
  const $items = $(collection.selector);

  if ($items.length === 0) return;

  // Get the first item as template
  const $first = $items.first();

  // Add v-for to first item
  $first.attr('v-for', `(item, index) in content.${collectionName}`);
  $first.attr(':key', 'index');

  // Replace fields within the collection item
  Object.entries(collection.fields).forEach(([fieldName, selector]) => {
    const $fieldEl = $first.find(selector as string);
    if ($fieldEl.length) {
      if (fieldName === 'image') {
        const $img = $fieldEl.find('img').first();
        if ($img.length) {
          $img.attr(':src', 'item.image');
          $img.removeAttr('src');
        }
      } else if (fieldName === 'link') {
        $fieldEl.attr(':to', 'item.link');
        $fieldEl.removeAttr('to');
        $fieldEl.removeAttr('href');
      } else {
        $fieldEl.empty();
        $fieldEl.text(`{{ item.${fieldName} }}`);
      }
    }
  });

  // Remove duplicate items (keep only first as template)
  $items.slice(1).remove();
}

/**
 * Transform a Vue file to use reactive content
 */
export async function transformVueToReactive(
  vueFilePath: string,
  pageName: string,
  manifest: CMSManifest
): Promise<void> {
  const pageManifest = manifest.pages[pageName];
  if (!pageManifest) return;

  // Read the Vue file
  const vueContent = await fs.readFile(vueFilePath, 'utf-8');

  // Check if already transformed (has useStrapiContent call)
  if (vueContent.includes('useStrapiContent')) {
    console.log(`  Skipping ${pageName} - already transformed`);
    return;
  }

  // Extract template content
  const templateMatch = vueContent.match(/<template>([\s\S]*?)<\/template>/);
  if (!templateMatch) return;

  const templateContent = templateMatch[1];

  // Load template content (cheerio will wrap in html/body, we'll strip it later)
  const $ = cheerio.load(templateContent, { xmlMode: false });

  // Transform collections first (they contain fields)
  if (pageManifest.collections) {
    Object.entries(pageManifest.collections).forEach(([collectionName, collection]) => {
      transformCollection($, collectionName, collection);
    });
  }

  // Transform individual fields
  if (pageManifest.fields) {
    Object.entries(pageManifest.fields).forEach(([fieldName, field]) => {
      const $elements = $(field.selector);
      $elements.each((_, el) => {
        const $el = $(el);
        replaceWithBinding($, $el, fieldName, field.type);
      });
    });
  }

  // Get transformed template - extract from body if cheerio wrapped it
  let transformedTemplate = $.html();

  // Remove cheerio's auto-added html/head/body wrapper tags
  const bodyMatch = transformedTemplate.match(/<body>([\s\S]*)<\/body>/);
  if (bodyMatch) {
    transformedTemplate = bodyMatch[1];
  }

  // Also clean up any remaining html/head tags
  transformedTemplate = transformedTemplate
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head><\/head>/gi, '')
    .trim();

  // Remove the single wrapper <div> if it exists (from htmlToVueComponent)
  // This regex matches a div that wraps all the content
  const wrapperDivMatch = transformedTemplate.match(/^<div>\s*([\s\S]*?)\s*<\/div>$/);
  if (wrapperDivMatch) {
    transformedTemplate = wrapperDivMatch[1].trim();
  }

  // Generate new script setup (no pending, just content)
  const scriptSetup = `<script setup lang="ts">
// Auto-generated reactive content from Strapi
const { content } = useStrapiContent('${pageName}');
</script>`;

  // Single root element - no pending check wrapper
  // Just indent the content properly
  const finalTemplate = transformedTemplate.split('\n').map(line => '  ' + line).join('\n');

  // Combine into new Vue component
  const newVueContent = `${scriptSetup}

<template>
${finalTemplate}
</template>
`;

  // Write back to file
  await fs.writeFile(vueFilePath, newVueContent, 'utf-8');
}

/**
 * Transform all Vue pages in a directory
 */
export async function transformAllVuePages(
  pagesDir: string,
  manifest: CMSManifest
): Promise<void> {
  const vueFiles = await fs.readdir(pagesDir);

  for (const file of vueFiles) {
    if (file.endsWith('.vue')) {
      const pageName = file.replace('.vue', '');
      const vueFilePath = path.join(pagesDir, file);
      await transformVueToReactive(vueFilePath, pageName, manifest);
    }
  }
}

/**
 * Transform static Vue files to use reactive content from Strapi
 */

import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import type { CMSManifest, CollectionMapping } from "@see-ms/types";
import { htmlPathToPageId } from "./routes";

/**
 * Check if element is a safe leaf (no structural children)
 * Structural children would be destroyed by empty()
 */
function isSafeToEmpty($el: cheerio.Cheerio<any>): boolean {
  // If element has child elements, it's not safe to empty
  // (would destroy nested structure)
  return $el.children().length === 0;
}

/**
 * Replace element content with Vue template binding
 */
function replaceWithBinding(
  _$: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
  fieldName: string,
  type: string
): void {
  if (type === "image") {
    // Check if element is an img or contains an img
    if ($el.is("img")) {
      $el.attr(":src", `content.${fieldName}`);
      $el.removeAttr("src");
    } else {
      const $img = $el.find("img").first();
      if ($img.length) {
        // Replace src with Vue binding
        $img.attr(":src", `content.${fieldName}`);
        $img.removeAttr("src");
      }
    }
  } else if (type === "link") {
    // Link field uses composite {url, text, newTab} object
    // Find the anchor element
    const $link = $el.is("a") || $el.is("NuxtLink") || $el.is("nuxt-link") ? $el : $el.find("a, NuxtLink, nuxt-link").first();
    if ($link.length) {
      const isNuxtLink = $link.is("NuxtLink") || $link.is("nuxt-link");
      $link.attr(isNuxtLink ? ":to" : ":href", `content.${fieldName}?.url`);
      $link.attr(":target", `content.${fieldName}?.newTab ? '_blank' : undefined`);
      $link.removeAttr("href");
      if (isNuxtLink) $link.removeAttr("to");
      $link.removeAttr("target");
      // Only empty if safe (no nested children)
      if (isSafeToEmpty($link)) {
        $link.empty();
        $link.text(`{{ content.${fieldName}?.text }}`);
      }
    }
  } else if (type === "rich") {
    // SAFETY CHECK: Don't empty elements with children (would destroy structure)
    if (!isSafeToEmpty($el)) {
      return;
    }
    // For rich text, use v-html
    $el.attr("v-html", `content.${fieldName}`);
    $el.empty(); // Remove static content
  } else {
    // SAFETY CHECK: Don't empty elements with children (would destroy structure)
    if (!isSafeToEmpty($el)) {
      return;
    }
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
  $first.attr("v-for", `(item, index) in content.${collectionName}`);
  $first.attr(":key", "index");

  // Replace fields within the collection item
  Object.entries(collection.fields).forEach(([fieldName, fieldConfig]) => {
    // Get selector from field config
    const selector = typeof fieldConfig === "string"
      ? fieldConfig
      : (fieldConfig as any).selector || fieldConfig;
    const fieldType = typeof fieldConfig === "object" ? (fieldConfig as any).type : undefined;

    const $fieldEl = $first.find(selector as string);
    if ($fieldEl.length) {
      // Determine type from config or field name
      const isImage = fieldType === "image" || fieldName === "image" || fieldName.includes("image");
      const isLink = fieldType === "link" || fieldName === "link" || fieldName === "url";

      if (isImage) {
        // Check if element is img or contains img
        if ($fieldEl.is("img")) {
          $fieldEl.attr(":src", `item.${fieldName}`);
          $fieldEl.removeAttr("src");
        } else {
          const $img = $fieldEl.find("img").first();
          if ($img.length) {
            $img.attr(":src", `item.${fieldName}`);
            $img.removeAttr("src");
          }
        }
      } else if (isLink) {
        // Link uses composite {url, text, newTab} object
        const $link = $fieldEl.is("a") || $fieldEl.is("NuxtLink") || $fieldEl.is("nuxt-link") ? $fieldEl : $fieldEl.find("a, NuxtLink, nuxt-link").first();
        if ($link.length) {
          const isNuxtLink = $link.is("NuxtLink") || $link.is("nuxt-link");
          $link.attr(isNuxtLink ? ":to" : ":href", `item.${fieldName}?.url`);
          $link.attr(":target", `item.${fieldName}?.newTab ? '_blank' : undefined`);
          $link.removeAttr("href");
          $link.removeAttr("target");
          $link.removeAttr("to");
          $link.empty();
          $link.text(`{{ item.${fieldName}?.text }}`);
        }
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
  const vueContent = await fs.readFile(vueFilePath, "utf-8");

  // Check if already transformed (has useStrapiContent call)
  if (vueContent.includes("useStrapiContent")) {
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
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head><\/head>/gi, "")
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
  const finalTemplate = transformedTemplate.split("\n").map(line => "  " + line).join("\n");

  // Combine into new Vue component
  const newVueContent = `${scriptSetup}

<template>
${finalTemplate}
</template>
`;

  // Write back to file
  await fs.writeFile(vueFilePath, newVueContent, "utf-8");
}

/**
 * Transform all Vue pages in a directory
 */
export async function transformAllVuePages(
  pagesDir: string,
  manifest: CMSManifest
): Promise<void> {
  const vueFiles = await glob("**/*.vue", { cwd: pagesDir, nodir: true });

  for (const file of vueFiles) {
    if (file.endsWith(".vue")) {
      const pageName = htmlPathToPageId(file.replace(/\.vue$/i, ".html"));
      const vueFilePath = path.join(pagesDir, file);
      await transformVueToReactive(vueFilePath, pageName, manifest);
    }
  }
}

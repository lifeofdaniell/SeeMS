/**
 * HTML Parser for Webflow exports
 * Handles conversion to Vue/Nuxt format
 */

import * as cheerio from 'cheerio';
import path from 'path';

export interface ParsedPage {
  fileName: string;
  title: string;
  htmlContent: string;
  cssFiles: string[];
  embeddedStyles: string;
  images: string[];
  links: string[];
}

/**
 * Normalize a path to absolute format
 * Examples:
 * - index.html -> /
 * - about.html -> /about
 * - ../index.html -> /
 * - press-release/article.html -> /press-release/article
 */
function normalizeRoute(href: string): string {
    // Remove .html extension
    let route = href.replace('.html', '');

    // Handle various index patterns
    if (route === 'index' || route === '/index' || route.endsWith('/index')) {
        return '/';
    }

    // Handle parent directory references
    if (route === '..' || route === '../' || route === '/..' || route === '../index') {
        return '/';
    }

    // Remove all relative path indicators
    route = route.replace(/\.\.\//g, '').replace(/\.\//g, '');

    // Normalize the path
    const normalized = path.posix.normalize(route);

    // Ensure it starts with /
    if (!normalized.startsWith('/')) {
        return '/' + normalized;
    }

    // If it became just '.' after normalization, return '/'
    if (normalized === '.' || normalized === '') {
        return '/';
    }

    return normalized;
}

/**
 * Normalize asset path to absolute
 * Examples:
 * - images/logo.svg -> /assets/images/logo.svg
 * - ../images/logo.svg -> /assets/images/logo.svg
 * - /assets/../images/logo.svg -> /assets/images/logo.svg
 */
function normalizeAssetPath(src: string): string {
  if (!src || src.startsWith('http') || src.startsWith('https')) {
    return src;
  }

  // Remove any ../ or ./ at the start
  let normalized = src.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');

  // If it already starts with /assets/, clean up any ../ in the middle
  if (normalized.startsWith('/assets/')) {
    normalized = normalized.replace(/\/\.\.\//g, '/');
    return normalized;
  }

  // Otherwise, add /assets/ prefix
  return `/assets/${normalized}`;
}

/**
 * Parse a Webflow HTML file
 */
export function parseHTML(html: string, fileName: string): ParsedPage {
  const $ = cheerio.load(html);

  // Extract page title
  const title = $('title').text() || fileName.replace('.html', '');

  // Find all CSS files
  const cssFiles: string[] = [];
  $('link[rel="stylesheet"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      cssFiles.push(href);
    }
  });

  // Extract embedded styles (from .global-embed or style tags in body)
  let embeddedStyles = '';

  // Get styles from .global-embed class
  $('.global-embed style').each((_, el) => {
    embeddedStyles += $(el).html() + '\n';
  });

  // Get style tags before closing body
  $('body > style').each((_, el) => {
    embeddedStyles += $(el).html() + '\n';
  });

  // Remove the global-embed elements and body style tags from DOM
  $('.global-embed').remove();
  $('body > style').remove();

  // Remove all script tags from body
  $('body script').remove();

  // Get all images for asset mapping
  const images: string[] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      images.push(src);
    }
  });

  // Get all links
  const links: string[] = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      links.push(href);
    }
  });

  // Get ONLY the body's inner content (not the body tag itself)
  const htmlContent = $('body').html() || '';

  return {
    fileName,
    title,
    htmlContent,
    cssFiles,
    embeddedStyles,
    images,
    links,
  };
}

/**
 * Transform HTML content for Nuxt/Vue
 * - Convert <a> to <NuxtLink>
 * - Fix image paths (add /assets/ prefix for public folder)
 * - Remove any remaining html/head/body tags
 * - Remove srcset and sizes attributes from images
 */
export function transformForNuxt(html: string): string {
  const $ = cheerio.load(html);

  // Remove any html, head, body tags that might have leaked through
  $('html, head, body').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.html() || '');
  });

  // Remove all script tags
  $('script').remove();

  // 1. Convert <a> tags to <NuxtLink>
  $('a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href');

    if (!href) return;

    // Check if it's an internal link
    const isExternal = href.startsWith('http://') ||
                       href.startsWith('https://') ||
                       href.startsWith('mailto:') ||
                       href.startsWith('tel:') ||
                       href.startsWith('#');

    if (!isExternal) {
      // Normalize the route
      const route = normalizeRoute(href);

      $el.attr('to', route);
      $el.removeAttr('href');

      // Change tag name to NuxtLink
      const content = $el.html();
      const classes = $el.attr('class') || '';

      $el.replaceWith(`<nuxt-link to="${route}" class="${classes}">${content}</nuxt-link>`);
    }
  });

  // 2. Fix image paths and remove srcset/sizes
  $('img').each((_, el) => {
    const $el = $(el);
    const src = $el.attr('src');

    if (src) {
      // Normalize the asset path
      const normalizedSrc = normalizeAssetPath(src);
      $el.attr('src', normalizedSrc);
    }

    // Remove srcset and sizes attributes
    $el.removeAttr('srcset');
    $el.removeAttr('sizes');
  });

  // Note: CSS background-image paths are NOT changed here
  // They will be handled by the webflow-assets.ts Vite plugin

  return $.html();
}

/**
 * Convert transformed HTML to Vue component
 */
export function htmlToVueComponent(html: string, pageName: string): string {
  return `
<script setup lang="ts">
// Page: ${pageName}
</script>

<template>
  <div>
    ${html}
  </div>
</template>
`;
}

/**
 * Deduplicate styles - remove duplicate CSS rules
 */
export function deduplicateStyles(styles: string): string {
  if (!styles.trim()) return '';

  // Split by comments that indicate file sources
  const sections = styles.split(/\/\* From .+ \*\//);

  // Keep only unique style content
  const uniqueStyles = new Set<string>();

  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed) {
      uniqueStyles.add(trimmed);
    }
  }

  return Array.from(uniqueStyles).join('\n\n');
}

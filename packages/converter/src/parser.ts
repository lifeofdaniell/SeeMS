/**
 * HTML Parser for Webflow exports
 * Handles conversion to Vue/Nuxt format
 */

import * as cheerio from "cheerio";
import path from "path";
import { normalizePublicAssetPath } from "./assets";

export interface ParsedPage {
  fileName: string;
  title: string;
  htmlContent: string;
  cssFiles: string[];
  embeddedStyles: string;
  images: string[];
  links: string[];
  wfPage?: string;
  wfSite?: string;
  bodyClass?: string;
}

export interface ScriptTag {
  src: string;
  integrity?: string;
  crossorigin?: string;
}

export interface PageScripts {
  headCdn: ScriptTag[];
  headInline: string[];
  bodyCdn: ScriptTag[];
  bodyInline: string[];
}

export function extractPageScripts(html: string): PageScripts {
  const $ = cheerio.load(html);
  const headCdn: ScriptTag[] = [];
  const headInline: string[] = [];
  const bodyCdn: ScriptTag[] = [];
  const bodyInline: string[] = [];

  $("head script").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    if (src) {
      headCdn.push({ src, integrity: $el.attr("integrity"), crossorigin: $el.attr("crossorigin") });
    } else {
      const content = $el.html()?.trim();
      if (content) headInline.push(content);
    }
  });

  $("body script").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    if (src) {
      // Skip local dev server URLs that would always 404 in real environments
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(src)) return;
      bodyCdn.push({ src, integrity: $el.attr("integrity"), crossorigin: $el.attr("crossorigin") });
    } else {
      const content = $el.html()?.trim();
      if (content) bodyInline.push(content);
    }
  });

  return { headCdn, headInline, bodyCdn, bodyInline };
}

/**
 * Normalize a path to absolute format
 * Examples:
 * - index.html -> /
 * - about.html -> /about
 * - ../index.html -> /
 * - press-release/article.html -> /press-release/article
 */
function normalizeRoute(href: string, currentFile?: string): string {
  const [pathPart, suffix = ""] = href.split(/(?=[?#])/);
  // Remove .html extension
  let route = pathPart.replace(/\.html$/i, "");

  // Handle various index patterns
  if (route === "index" || route === "/index" || route.endsWith("/index")) {
    const parent = route.replace(/(^|\/)index$/, "");
    return `${parent ? (parent.startsWith("/") ? parent : `/${parent}`) : "/"}${suffix}`;
  }

  // Handle parent directory references
  if (route === ".." || route === "../" || route === "/.." || route === "../index") {
    return `/${suffix}`;
  }

  if (currentFile && !route.startsWith("/")) {
    route = path.posix.join(path.posix.dirname(currentFile.replace(/\\/g, "/")), route);
  }

  // Normalize the path
  const normalized = path.posix.normalize(route);

  // Ensure it starts with /
  if (!normalized.startsWith("/")) {
    return `/${normalized}${suffix}`;
  }

  // If it became just '.' after normalization, return '/'
  if (normalized === "." || normalized === "") {
    return `/${suffix}`;
  }

  return `${normalized}${suffix}`;
}

/**
 * Normalize asset path to absolute
 * Examples:
 * - images/logo.svg -> /assets/images/logo.svg
 * - ../images/logo.svg -> /assets/images/logo.svg
 * - /assets/../images/logo.svg -> /assets/images/logo.svg
 */
/**
 * Parse a Webflow HTML file
 */
export function parseHTML(html: string, fileName: string): ParsedPage {
  const $ = cheerio.load(html);

  // Extract page title
  const title = $("title").text() || fileName.replace(".html", "");

  // Extract Webflow page/site identifiers and body class for Astro wrappers
  const wfPage = $("html").attr("data-wf-page");
  const wfSite = $("html").attr("data-wf-site");
  const bodyClass = $("body").attr("class") || "";

  // Find all CSS files
  const cssFiles: string[] = [];
  $("link[rel=\"stylesheet\"]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      cssFiles.push(href);
    }
  });

  // Extract embedded styles (from .global-embed or style tags in body)
  let embeddedStyles = "";

  // Get styles from .global-embed class
  $(".global-embed style").each((_, el) => {
    embeddedStyles += $(el).html() + "\n";
  });

  $(".w-embed > style").each((_, el) => {
    embeddedStyles += $(el).html() + "\n";
  });

  // Get style tags before closing body
  $("body > style").each((_, el) => {
    embeddedStyles += $(el).html() + "\n";
  });

  // Remove the global-embed elements and body style tags from DOM
  $(".global-embed").remove();
  $("body > style").remove();
  $(".w-embed > style").remove();

  // Remove all script tags from body
  $("body script").remove();

  // Get all images for asset mapping
  const images: string[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (src) {
      images.push(src);
    }
  });

  // Get all links
  const links: string[] = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      links.push(href);
    }
  });

  // Get ONLY the body's inner content (not the body tag itself)
  const htmlContent = $("body").html() || "";

  return {
    fileName,
    title,
    htmlContent,
    cssFiles,
    embeddedStyles,
    images,
    links,
    wfPage,
    wfSite,
    bodyClass,
  };
}

/**
 * Transform HTML content for Nuxt/Vue
 * - Convert <a> to <NuxtLink>
 * - Fix image paths (add /assets/ prefix for public folder)
 * - Remove any remaining html/head/body tags
 * - Remove srcset and sizes attributes from images
 */
export function transformForNuxt(
  html: string,
  currentFile?: string,
  options: { linkMode?: "nuxt" | "anchor" } = {}
): string {
  const $ = cheerio.load(html);
  const linkMode = options.linkMode || "nuxt";

  // Remove any html, head, body tags that might have leaked through
  $("html, head, body").each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.html() || "");
  });

  // Remove all script tags
  $("script").remove();

  // 1. Convert <a> tags to <NuxtLink>
  $("a").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href");

    if (!href) return;

    // Check if it's an internal link
    const isExternal = href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("#");

    if (!isExternal && linkMode === "nuxt") {
      // Normalize the route
      const route = normalizeRoute(href, currentFile);
      const content = $el.html();
      const attrs = { ...$el.attr() };
      delete attrs.href;
      attrs.to = route;

      const attrString = Object.entries(attrs)
        .map(([name, value]) => `${name}="${escapeAttribute(value ?? "")}"`)
        .join(" ");

      $el.replaceWith(`<nuxt-link ${attrString}>${content}</nuxt-link>`);
    } else if (!isExternal) {
      $el.attr("href", normalizeRoute(href, currentFile));
    }
  });

  // 2. Fix image paths and remove srcset/sizes
  $("img").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    if (src) $el.attr("src", normalizePublicAssetPath(src));
    $el.removeAttr("srcset");
    $el.removeAttr("sizes");
    // Lazy-loaded data-src (Lottie JSON, deferred images)
    const dataSrc = $el.attr("data-src");
    if (dataSrc) $el.attr("data-src", normalizePublicAssetPath(dataSrc));
  });

  // 3. Fix video src, poster, and inline style background-image
  $("video").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    if (src) $el.attr("src", normalizePublicAssetPath(src));
    const poster = $el.attr("poster");
    if (poster) $el.attr("poster", normalizePublicAssetPath(poster));
    const style = $el.attr("style");
    if (style) {
      $el.attr("style", style.replace(
        /url\((['"]?)((?:videos|images|documents|fonts)\/[^'")\s]+)\1\)/g,
        (_m, q, p) => `url(${q}/${p}${q})`
      ));
    }
  });

  // 4. Fix <source> src (inside <video> / <audio>)
  $("source").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src");
    if (src) $el.attr("src", normalizePublicAssetPath(src));
  });

  // 5. Fix Webflow background-video data attributes
  $("[data-poster-url]").each((_, el) => {
    const $el = $(el);
    const val = $el.attr("data-poster-url");
    if (val) $el.attr("data-poster-url", normalizePublicAssetPath(val));
  });

  $("[data-video-urls]").each((_, el) => {
    const $el = $(el);
    const val = $el.attr("data-video-urls");
    if (val) {
      const normalized = val.split(",").map(u => normalizePublicAssetPath(u.trim())).join(",");
      $el.attr("data-video-urls", normalized);
    }
  });

  // 6. Fix Lottie / general data-src on non-img elements (e.g. lottie-player, div)
  $("[data-src]").each((_, el) => {
    if ($(el).is("img")) return; // already handled above
    const $el = $(el);
    const val = $el.attr("data-src");
    if (val) $el.attr("data-src", normalizePublicAssetPath(val));
  });

  return $.html();
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Convert transformed HTML to Vue component
 * @param html - The transformed HTML content
 * @param pageName - The page name for comments
 * @param componentImports - Optional array of shared component names to import
 */
export function htmlToVueComponent(
  html: string,
  pageName: string,
  componentImports?: string[],
  componentImportBase = "~/components"
): string {
  // Generate component imports if any
  let importsSection = "";
  if (componentImports && componentImports.length > 0) {
    importsSection = componentImports
      .map(name => `import ${name} from '${componentImportBase}/${name}.vue';`)
      .join("\n");
    html = restoreComponentTags(replaceComponentMarkers(html), componentImports);
  }

  return `<script setup lang="ts">
// Page: ${pageName}
${importsSection}
</script>

<template>
  <div>
    ${html}
  </div>
</template>
`;
}

function replaceComponentMarkers(html: string): string {
  return html.replace(/<!--COMPONENT:(\w+)-->/g, "<$1 />");
}

function restoreComponentTags(html: string, componentImports: string[]): string {
  let restored = html;
  for (const name of componentImports) {
    const lowered = name.toLowerCase();
    restored = restored
      .replace(new RegExp(`<${lowered}\\s*><\\/${lowered}>`, "g"), `<${name} />`)
      .replace(new RegExp(`<${lowered}\\s*\\/>`, "g"), `<${name} />`);
  }
  return restored;
}

/**
 * Deduplicate styles - remove duplicate CSS rules
 */
export function deduplicateStyles(styles: string): string {
  if (!styles.trim()) return "";

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

  return Array.from(uniqueStyles).join("\n\n");
}

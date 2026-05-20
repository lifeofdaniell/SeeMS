/**
 * Component Extractor
 * Detects reused HTML sections across pages and extracts them as Vue components
 */

import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import * as crypto from "crypto";
import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import type { SharedComponent } from "@see-ms/types";
import { htmlPathToPageId } from "./routes";

/**
 * Parsed page with its HTML content
 */
export interface ParsedPage {
  name: string;
  filePath: string;
  sourcePath: string;
  $: CheerioAPI;
  sections: SectionInfo[];
}

/**
 * Information about a section in a page
 */
export interface SectionInfo {
  /** CSS selector for the section */
  selector: string;
  /** Structural fingerprint (hash of DOM structure) */
  fingerprint: string;
  /** Cheerio element reference */
  $element: Cheerio<any>;
  /** Original HTML content */
  html: string;
  /** Suggested component name */
  suggestedName: string;
}

/**
 * Extracted component ready to be written
 */
export interface ExtractedComponent {
  name: string;
  selector: string;
  pages: string[];
  html: string;
  fingerprint: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Class name patterns that suggest semantic component types
 */
const COMPONENT_NAME_PATTERNS: Record<string, RegExp[]> = {
  Nav: [/nav/i, /navbar/i, /navigation/i, /header.*nav/i, /main.*menu/i],
  Footer: [/footer/i, /site.*footer/i],
  Header: [/header/i, /site.*header/i, /page.*header/i],
  Sidebar: [/sidebar/i, /side.*bar/i, /aside/i]
};

/**
 * Minimum HTML length for a section to be considered for extraction
 * Prevents extracting tiny elements like single icons or spacers
 */
const DEFAULT_MIN_SECTION_SIZE = 200;

export interface ComponentExtractionOptions {
  minOccurrences?: number;
  minSectionSize?: number;
  include?: string[];
  exclude?: string[];
}

/**
 * Parse all HTML files in a directory
 */
export async function parseAllPages(
  inputDir: string,
  options: Pick<ComponentExtractionOptions, "minSectionSize"> = {}
): Promise<ParsedPage[]> {
  const pages: ParsedPage[] = [];
  const htmlFiles = await glob("**/*.html", { cwd: inputDir, nodir: true });

  for (const file of htmlFiles) {
    if (!file.endsWith(".html")) continue;

    const filePath = path.join(inputDir, file);
    const html = await fs.readFile(filePath, "utf-8");
    const $ = cheerio.load(html);

    const pageName = htmlPathToPageId(file);
    const sections = extractSections($, options.minSectionSize ?? DEFAULT_MIN_SECTION_SIZE);

    pages.push({
      name: pageName,
      filePath,
      sourcePath: file,
      $,
      sections
    });
  }

  return pages;
}

/**
 * Extract top-level sections from a page
 * Gets all direct children of body (or main wrapper) regardless of tag/class
 */
function extractSections($: CheerioAPI, minSectionSize: number): SectionInfo[] {
  const sections: SectionInfo[] = [];
  const seen = new Set<string>();

  // Find the main content container
  // Webflow often wraps everything in a div, so check for that pattern
  let $container = $("body");
  const $bodyChildren = $container.children();

  // If body has only one child div that contains most content, use that as container
  if ($bodyChildren.length === 1 && $bodyChildren.first().is("div")) {
    const $wrapper = $bodyChildren.first();
    // Only use wrapper if it has multiple children (actual sections)
    if ($wrapper.children().length > 1) {
      $container = $wrapper;
    }
  }

  // Get all direct children as potential sections
  $container.children().each((_, el) => {
    const $element = $(el);
    const tagName = ($element.prop("tagName") || "").toLowerCase();

    // Skip script, style, and other non-content elements
    if (["script", "style", "link", "meta", "noscript", "template"].includes(tagName)) {
      return;
    }

    // Skip global-embed elements (Webflow embedded styles/scripts)
    const className = $element.attr("class") || "";
    if (className.includes("global-embed") || className.includes("globalembed")) {
      return;
    }

    const html = $.html($element);

    // Skip if we've already processed this element
    const elementId = getElementIdentifier($, $element);
    if (seen.has(elementId)) return;
    seen.add(elementId);

    const fingerprint = createFingerprint($, $element);
    const suggestedName = suggestComponentName($element);
    const semanticName = ["TheNav", "TheFooter", "TheHeader", "TheSidebar", "Nav", "Footer", "Header", "Sidebar"].includes(suggestedName);

    // Skip very small sections unless they are semantic site chrome
    if (!semanticName && html.length < minSectionSize) return;

    const uniqueSelector = buildUniqueSelector($, $element);

    sections.push({
      selector: uniqueSelector,
      fingerprint,
      $element,
      html,
      suggestedName
    });
  });

  return sections;
}

/**
 * Get a unique identifier for an element (for deduplication)
 */
function getElementIdentifier(_$: CheerioAPI, $element: Cheerio<any>): string {
  const tag = $element.prop("tagName")?.toLowerCase() || "div";
  const className = $element.attr("class") || "";
  const id = $element.attr("id") || "";
  return `${tag}#${id}.${className}`;
}

/**
 * Create a structural fingerprint for an element
 * This ignores text content and specific URLs, focusing only on structure
 */
function createFingerprint($: CheerioAPI, $element: Cheerio<any>): string {
  const structure = getStructure($, $element);
  return crypto.createHash("md5").update(structure).digest("hex").substring(0, 12);
}

/**
 * Get the structural representation of an element
 */
function getStructure($: CheerioAPI, $element: Cheerio<any>, depth: number = 0): string {
  if (depth > 10) return ""; // Prevent infinite recursion

  const tag = $element.prop("tagName")?.toLowerCase() || "div";
  const classNames = normalizeClasses($element.attr("class") || "");

  let structure = `${tag}`;
  if (classNames) {
    structure += `.${classNames}`;
  }

  // Get children structure
  const children: string[] = [];
  $element.children().each((_, child) => {
    const $child = $(child);
    const childStructure = getStructure($, $child, depth + 1);
    if (childStructure) {
      children.push(childStructure);
    }
  });

  if (children.length > 0) {
    // If many identical children, compress to count notation
    const childCounts = countIdentical(children);
    const compressedChildren = childCounts
      .map(({ item, count }) => (count > 1 ? `${item}*${count}` : item))
      .join(",");
    structure += `[${compressedChildren}]`;
  }

  return structure;
}

/**
 * Normalize class names for fingerprinting
 * Removes only Webflow utility classes (w-*) and spacing utilities
 * Keeps c-* prefixed classes as they can be semantic component classes
 */
function normalizeClasses(classes: string): string {
  return classes
    .split(/\s+/)
    .filter((c) => {
      // Remove Webflow utility classes only
      if (c.startsWith("w-")) return false;
      // Remove spacing utilities
      if (c.match(/^(p|m|pt|pb|pl|pr|px|py|mt|mb|ml|mr|mx|my)-\d/)) return false;
      return c.length > 0;
    })
    .sort()
    .join(".");
}

/**
 * Count identical consecutive items in an array
 */
function countIdentical(items: string[]): Array<{ item: string; count: number }> {
  const result: Array<{ item: string; count: number }> = [];

  for (const item of items) {
    const last = result[result.length - 1];
    if (last && last.item === item) {
      last.count++;
    } else {
      result.push({ item, count: 1 });
    }
  }

  return result;
}

/**
 * Suggest a component name based on element attributes
 */
function suggestComponentName($element: Cheerio<any>): string {
  const tag = $element.prop("tagName")?.toLowerCase() || "";
  const className = $element.attr("class") || "";
  const id = $element.attr("id") || "";

  // Check semantic tag names first
  if (tag === "nav") return "TheNav";
  if (tag === "footer") return "TheFooter";
  if (tag === "header") return "TheHeader";
  if (tag === "aside") return "TheSidebar";

  // Check class names against patterns (including c- prefixed names)
  // Normalize c- prefix for pattern matching
  const normalizedClassName = className.replace(/\bc-/g, "");
  const searchText = `${className} ${normalizedClassName} ${id}`.toLowerCase();
  for (const [name, patterns] of Object.entries(COMPONENT_NAME_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(searchText)) {
        return name;
      }
    }
  }

  // Fallback: use primary class name (strip c- prefix for naming)
  const primaryClass = className.split(" ").find((c) => !c.startsWith("w-") && c.length > 2);
  if (primaryClass) {
    // Remove c- prefix if present for cleaner component name
    const cleanName = primaryClass.replace(/^c-/, "");
    return pascalCase(cleanName);
  }

  return "SharedSection";
}

/**
 * Convert a string to PascalCase
 */
function pascalCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

/**
 * Build a unique CSS selector for an element
 * Keeps c-* prefixed classes as they can be semantic
 */
function buildUniqueSelector($: CheerioAPI, $element: Cheerio<any>): string {
  const tag = $element.prop("tagName")?.toLowerCase() || "div";
  const id = $element.attr("id");
  const className = $element.attr("class");

  // ID is always unique
  if (id) {
    return `#${id}`;
  }

  // Try class-based selector (keep c-* classes, only filter w-* Webflow utilities)
  if (className) {
    const primaryClasses = className
      .split(" ")
      .filter((c) => !c.startsWith("w-") && c.length > 2)
      .slice(0, 2);

    if (primaryClasses.length > 0) {
      const selector = `${tag}.${primaryClasses.join(".")}`;
      if ($(selector).length === 1) {
        return selector;
      }
      return `.${primaryClasses.join(".")}`;
    }
  }

  // Fallback to tag + nth-child
  const $parent = $element.parent();
  const siblings = $parent.children(tag);
  if (siblings.length > 1) {
    const index = siblings.index($element) + 1;
    return `${tag}:nth-child(${index})`;
  }

  return tag;
}

/**
 * Find shared sections across pages (appear in 2+ pages with similar structure)
 */
export function findSharedSections(
  pages: ParsedPage[],
  options: Pick<ComponentExtractionOptions, "minOccurrences" | "include" | "exclude"> = {}
): ExtractedComponent[] {
  // Group sections by fingerprint
  const fingerprintMap = new Map<string, { section: SectionInfo; page: ParsedPage }[]>();

  for (const page of pages) {
    for (const section of page.sections) {
      const existing = fingerprintMap.get(section.fingerprint) || [];
      existing.push({ section, page });
      fingerprintMap.set(section.fingerprint, existing);
    }
  }

  // Filter to only sections that appear in 2+ pages
  const sharedComponents: ExtractedComponent[] = [];
  const usedNames = new Set<string>();

  for (const [fingerprint, occurrences] of fingerprintMap.entries()) {
    // Must appear in at least 2 different pages
    const uniquePages = new Set(occurrences.map((o) => o.page.name));
    if (uniquePages.size < (options.minOccurrences ?? 2)) continue;

    // Use the first occurrence as the template
    const template = occurrences[0];

    // Generate unique component name
    let name = template.section.suggestedName;
    if (options.include?.length && !options.include.some((item) => name.toLowerCase().includes(item.toLowerCase()))) {
      const semanticNames = ["TheNav", "TheFooter", "TheHeader", "TheSidebar", "Nav", "Footer", "Header", "Sidebar"];
      if (!semanticNames.includes(name)) continue;
    }
    if (options.exclude?.some((item) => name.toLowerCase().includes(item.toLowerCase()))) continue;

    let counter = 1;
    while (usedNames.has(name)) {
      name = `${template.section.suggestedName}${counter++}`;
    }
    usedNames.add(name);

    const confidence = getComponentConfidence(name, uniquePages.size, pages.length);

    sharedComponents.push({
      name,
      selector: template.section.selector,
      pages: [...uniquePages],
      html: template.section.html,
      fingerprint,
      confidence,
      reason: confidence === "high"
        ? "Semantic or repeated site-wide section"
        : "Repeated section with matching DOM structure"
    });
  }

  return sharedComponents;
}

function getComponentConfidence(name: string, pageCount: number, totalPages: number): "high" | "medium" | "low" {
  const semanticNames = ["thenav", "thefooter", "theheader", "nav", "footer", "header"];
  if (semanticNames.includes(name.toLowerCase())) return "high";
  if (pageCount === totalPages || pageCount >= 3) return "medium";
  return "low";
}

/**
 * Extract a component and create Vue SFC
 */
export function createVueComponent(component: ExtractedComponent): string {
  // Clean up the HTML for Vue
  let html = component.html;

  // Remove Webflow-specific attributes
  html = html.replace(/\s*data-w-id="[^"]*"/g, "");
  html = html.replace(/\s*data-wf-page="[^"]*"/g, "");
  html = html.replace(/\s*data-wf-site="[^"]*"/g, "");

  return `<script setup lang="ts">
/**
 * ${component.name} Component
 * Shared across pages: ${component.pages.join(", ")}
 *
 * To make content editable, add fields to the 'global' section in cms-manifest.json
 */
const { content } = useStrapiContent('global')
</script>

<template>
${html}
</template>

<style scoped>
/* Component-specific styles if needed */
</style>
`;
}

/**
 * Replace a section in HTML with a component marker comment
 * Using HTML comments to preserve PascalCase component names (Cheerio lowercases tags)
 * The marker will be replaced with actual component tags after serialization
 */
export function replaceWithComponent(
  $: CheerioAPI,
  selector: string,
  componentName: string
): void {
  const $element = $(selector);
  if ($element.length > 0) {
    // Use marker comment to preserve PascalCase (Cheerio lowercases HTML tags)
    $element.replaceWith(`<!--COMPONENT:${componentName}-->`);
  }
}

/**
 * Replace component marker comments with actual Vue component tags
 * Call this after Cheerio serialization to preserve PascalCase
 */
export function replaceComponentMarkers(html: string): string {
  return html.replace(/<!--COMPONENT:(\w+)-->/g, "<$1 />");
}

/**
 * Write extracted components to disk
 */
export async function writeComponents(
  outputDir: string,
  components: ExtractedComponent[]
): Promise<SharedComponent[]> {
  const componentsDir = path.join(outputDir, "components");
  await fs.ensureDir(componentsDir);

  const sharedComponents: SharedComponent[] = [];

  for (const component of components) {
    const vueContent = createVueComponent(component);
    const filePath = path.join(componentsDir, `${component.name}.vue`);

    await fs.writeFile(filePath, vueContent, "utf-8");

    sharedComponents.push({
      name: component.name,
      selector: component.selector,
      pages: component.pages,
      confidence: component.confidence,
      reason: component.reason
      // Fields will be detected separately
    });
  }

  return sharedComponents;
}

/**
 * Main entry point: extract shared components from HTML pages
 */
export async function extractSharedComponents(
  inputDir: string,
  outputDir: string,
  options: ComponentExtractionOptions = {}
): Promise<SharedComponent[]> {
  // Parse all HTML pages
  const pages = await parseAllPages(inputDir, options);

  if (pages.length < 2) {
    // Need at least 2 pages to find shared components
    return [];
  }

  // Find sections that appear across multiple pages
  const sharedSections = findSharedSections(pages, options);

  if (sharedSections.length === 0) {
    return [];
  }

  // Write components to disk
  const componentsToWrite = sharedSections.filter((component) => component.confidence !== "low");
  const components = await writeComponents(outputDir, componentsToWrite);

  return components;
}

/**
 * Transform static Vue files to use reactive content from Strapi
 */

import * as cheerio from "cheerio";
import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import type { CMSManifest, CollectionMapping } from "@see-ms/types";
import { htmlPathToPageId } from "./routes";
import { sharedComponentTypeName } from "./transformer";

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
 * Bind a plain-text field.
 *
 * Leaf element  → empty it and drop in `{{ expr }}` (original behaviour).
 * Element with child elements → replace ONLY its own direct text node with the
 * binding, leaving the children (which carry their own fields) intact. This is
 * what lets `<h2>Our <span class="text-red">Core Values</span></h2>` become two
 * plain fields without destroying the styled span. No-op if there is no direct
 * text node to replace, so it's safe for any plain field.
 */
function bindPlainText($el: cheerio.Cheerio<any>, expr: string, textNodeIndex?: number): void {
  if (typeof textNodeIndex === "number") {
    replaceDirectTextNode($el, expr, textNodeIndex);
    return;
  }
  if (isSafeToEmpty($el)) {
    $el.empty();
    $el.text(expr);
    return;
  }
  replaceDirectTextNode($el, expr, 0);
}

/** Replace the element's Nth non-empty direct text node, preserving the
 *  surrounding whitespace (so the separator before/after a sibling survives). */
function replaceDirectTextNode($el: cheerio.Cheerio<any>, expr: string, index: number): void {
  const el: any = $el[0];
  if (!el || !Array.isArray(el.children)) return;
  let count = 0;
  for (const node of el.children) {
    if (node.type === "text" && typeof node.data === "string" && node.data.trim()) {
      if (count === index) {
        const m = node.data.match(/^(\s*)[\s\S]*?(\s*)$/);
        node.data = `${m ? m[1] : ""}${expr}${m ? m[2] : ""}`;
        return;
      }
      count++;
    }
  }
}

/**
 * Replace element content with Vue template binding
 */
function replaceWithBinding(
  _$: cheerio.CheerioAPI,
  $el: cheerio.Cheerio<any>,
  fieldName: string,
  type: string,
  textNodeIndex?: number
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
    // Plain text. For a leaf this empties + sets {{ }}; for an element that also
    // has child elements (e.g. a heading with a styled <span> or a <br> split) it
    // replaces only the targeted direct text node, leaving the children and their
    // fields intact.
    bindPlainText($el, `{{ content.${fieldName} }}`, textNodeIndex);
  }
}

/**
 * Apply a Vue binding to a field element within a given context element.
 * prefix is the JS variable name, e.g. "item" or "child".
 */
function applyFieldBinding(
  _$: cheerio.CheerioAPI,
  $context: cheerio.Cheerio<any>,
  selector: string,
  fieldName: string,
  fieldType: string | undefined,
  prefix: string
): void {
  const $fieldEl = $context.find(selector);
  if (!$fieldEl.length) return;

  const isImage = fieldType === "image" || fieldName === "image" || fieldName.includes("image");
  const isLink  = fieldType === "link"  || fieldName === "link"  || fieldName === "url";

  if (isImage) {
    if ($fieldEl.is("img")) {
      $fieldEl.attr(":src", `${prefix}.${fieldName}`);
      $fieldEl.removeAttr("src");
    } else {
      const $img = $fieldEl.find("img").first();
      if ($img.length) {
        $img.attr(":src", `${prefix}.${fieldName}`);
        $img.removeAttr("src");
      }
    }
  } else if (isLink) {
    const $link = $fieldEl.is("a") || $fieldEl.is("NuxtLink") || $fieldEl.is("nuxt-link")
      ? $fieldEl
      : $fieldEl.find("a, NuxtLink, nuxt-link").first();
    if ($link.length) {
      const isNuxtLink = $link.is("NuxtLink") || $link.is("nuxt-link");
      $link.attr(isNuxtLink ? ":to" : ":href", `${prefix}.${fieldName}?.url`);
      $link.attr(":target", `${prefix}.${fieldName}?.newTab ? '_blank' : undefined`);
      $link.removeAttr("href");
      $link.removeAttr("target");
      $link.removeAttr("to");
      $link.empty();
      $link.text(`{{ ${prefix}.${fieldName}?.text }}`);
    }
  } else if (fieldType === "rich") {
    $fieldEl.attr("v-html", `${prefix}.${fieldName}`);
    $fieldEl.empty();
  } else {
    bindPlainText($fieldEl, `{{ ${prefix}.${fieldName} }}`);
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
  const $items = $(collection.selector);
  if ($items.length === 0) return;

  const $first = $items.first();

  if (collection.componentName) {
    $first.replaceWith(`<!--COLLECTION_COMPONENT:${collection.componentName}:${collectionName}-->`);
    $items.slice(1).remove();
    return;
  }

  // v-for on the parent item
  $first.attr("v-for", `(item, index) in content.${collectionName}`);
  $first.attr(":key", "index");

  // Bind flat fields on the parent item
  Object.entries(collection.fields).forEach(([fieldName, fieldConfig]) => {
    const selector = typeof fieldConfig === "string"
      ? fieldConfig
      : (fieldConfig as any).selector || fieldConfig;
    const fieldType = typeof fieldConfig === "object" ? (fieldConfig as any).type : undefined;
    applyFieldBinding($, $first, selector as string, fieldName, fieldType, "item");
  });

  // Nested children — each child group gets its own v-for inside the parent
  if (collection.children) {
    Object.entries(collection.children).forEach(([childFieldName, childDef]) => {
      const $childItems = $first.find(childDef.selector);
      if ($childItems.length === 0) return;

      const $firstChild = $childItems.first();
      $firstChild.attr("v-for", `(child, ci) in item.${childFieldName}`);
      $firstChild.attr(":key", "ci");

      Object.entries(childDef.fields).forEach(([fieldName, fieldConfig]) => {
        const selector = typeof fieldConfig === "string"
          ? fieldConfig
          : (fieldConfig as any).selector || fieldConfig;
        const fieldType = typeof fieldConfig === "object" ? (fieldConfig as any).type : undefined;
        applyFieldBinding($, $firstChild, selector as string, fieldName, fieldType, "child");
      });

      // Remove duplicate child items (keep first as template)
      $childItems.slice(1).remove();
    });
  }

  // Remove duplicate parent items (keep first as template)
  $items.slice(1).remove();
}

/**
 * Transform a Vue file to use reactive content
 */
export async function transformVueToReactive(
  vueFilePath: string,
  pageName: string,
  manifest: CMSManifest,
  options: { target?: "nuxt" | "astro-vue" } = {}
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

  // Only import components that are top-level on this page (not nested inside
  // another component). topLevelPages is set by the extract commands. When
  // absent (e.g. older manifest or convert path), fall back to component.pages.
  const componentNames = Object.entries(manifest.global?.components || {})
    .filter(([, c]) => {
      const topLevel = (c as any).topLevelPages as string[] | undefined;
      const pageList = topLevel ?? (c as any).pages ?? [];
      return pageList.includes(pageName);
    })
    .map(([name]) => name);
  const templateContent = maskComponentTags(templateMatch[1], componentNames);

  // Wrap the template in a sentinel root before parsing. A component marker
  // comment that is the first node of the template (e.g. a nav extracted from
  // the very top of <body>) would otherwise be hoisted *outside* <html> by the
  // HTML parser, and then dropped when we slice the body out below — leaving the
  // component imported but never rendered (the nav silently disappears). Keeping
  // everything inside one element preserves every node, comments included.
  const ROOT_ATTR = "data-seems-root";
  const $ = cheerio.load(`<div ${ROOT_ATTR}>${templateContent}</div>`, { xmlMode: false });

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
        replaceWithBinding($, $el, fieldName, field.type, field.textNodeIndex);
      });
    });
  }

  // Get the transformed template back out of the sentinel wrapper. Reading the
  // wrapper's inner HTML keeps leading/trailing comment markers that the parser
  // would push outside <body>, and yields no html/head/body tags to strip.
  let transformedTemplate = ($(`[${ROOT_ATTR}]`).html() ?? "").trim();

  // Remove the single wrapper <div> if it exists (from htmlToVueComponent)
  // This regex matches a div that wraps all the content
  const wrapperDivMatch = transformedTemplate.match(/^<div>\s*([\s\S]*?)\s*<\/div>$/);
  if (wrapperDivMatch) {
    transformedTemplate = wrapperDivMatch[1].trim();
  }

  const perPageComponentNames = componentNames.filter((name) => {
    const component = manifest.global?.components?.[name];
    return component?.contentMode === "per-page" && component.pages.includes(pageName);
  });
  transformedTemplate = restoreCollectionComponentTags(transformedTemplate);
  transformedTemplate = restoreComponentTags(transformedTemplate, componentNames, perPageComponentNames, options.target);

  // Generate new script setup
  let scriptSetup: string;
  if (options.target === "astro-vue") {
    // Astro SSR: content arrives as a prop from the Astro page frontmatter.
    // No composable needed — the Astro page fetches from Strapi server-side.
    const componentImports = componentNames
      .map((name) => `import ${name} from '~/src/components/${name}.vue';`)
      .join("\n");
    scriptSetup = `<script setup lang="ts">
// Auto-generated — content is passed from the Astro page (server-side Strapi fetch)
${componentImports ? componentImports + "\n" : ""}defineProps<{ content: Record<string, any>; globals?: Record<string, any> }>();
</script>`;
  } else {
    // Nuxt: content is fetched client-side via the auto-imported composable
    scriptSetup = `<script setup lang="ts">
// Auto-generated reactive content from Strapi
const { content } = useStrapiContent('${pageName}');
</script>`;
  }

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

export async function transformSharedComponentsToReactive(
  componentsDir: string,
  manifest: CMSManifest,
  options: { target?: "nuxt" | "astro-vue" } = {}
): Promise<void> {
  const components = manifest.global?.components || {};

  for (const [componentName, component] of Object.entries(components)) {
    const fields = component.fields || {};

    const filePath = path.join(componentsDir, `${componentName}.vue`);
    if (!(await fs.pathExists(filePath))) continue;

    const vueContent = await fs.readFile(filePath, "utf-8");
    const templateMatch = vueContent.match(/<template>([\s\S]*?)<\/template>/);
    if (!templateMatch) continue;

    // Always restore child component markers (<!--COMPONENT:X-->) to <X />
    // regardless of whether this component has CMS fields, so nested
    // components written as markers survive into the final .vue file.
    const existingScriptMatch = vueContent.match(/<script\b[^>]*>([\s\S]*?)<\/script>/);
    const existingImportLines = existingScriptMatch
      ? existingScriptMatch[1].split('\n').filter(l => l.trimStart().startsWith('import '))
      : [];
    const existingImports = existingImportLines.join('\n');
    const childNames = existingImportLines
      .map(l => { const m = l.match(/^import\s+(\w+)\s+from/); return m ? m[1] : null; })
      .filter((n): n is string => n !== null);

    if (Object.keys(fields).length === 0) {
      // No CMS fields — only marker restoration needed.
      if (childNames.length > 0) {
        const restored = restoreComponentTags(templateMatch[1], childNames);
        if (restored !== templateMatch[1]) {
          const scriptBlock = existingImports ? `<script setup lang="ts">\n${existingImports}\n</script>\n\n` : '';
          await fs.writeFile(filePath, `${scriptBlock}<template>\n${restored.trim()}\n</template>\n`, 'utf-8');
        }
      }
      continue;
    }

    // Mask any already-processed child component tags back to comment markers
    // before loading into Cheerio. On subsequent runs (e.g. re-extract),
    // Cheerio would lowercase the tag name and encode `&&` → `&amp;&amp;` in
    // Vue binding attributes, corrupting the output. Masking first means
    // Cheerio only ever sees a plain comment, which it preserves untouched,
    // and restoreComponentTags below converts it back to the correct tag.
    let templateSource = templateMatch[1];
    for (const child of childNames) {
      templateSource = templateSource
        .replace(new RegExp(`<${child}(\\s[^>]*)?>\\s*<\\/${child}>`, 'g'), `<!--COMPONENT:${child}-->`)
        .replace(new RegExp(`<${child}(\\s[^>]*)?\\/>`, 'g'), `<!--COMPONENT:${child}-->`);
    }

    const $ = cheerio.load(templateSource, { xmlMode: false });
    const isCollectionItem = component.role === "collection-item";
    const isPerPage = component.contentMode === "per-page";
    const contentSource = isCollectionItem ? "item" : isPerPage ? "componentContent" : "content";

    Object.entries(fields).forEach(([fieldName, field]) => {
      const originalName = fieldName.startsWith(`${componentName}_`)
        ? fieldName.slice(componentName.length + 1)
        : fieldName;
      const selector = field.selector;
      $(selector).each((_, el) => {
        replaceWithBinding($, $(el), fieldName, field.type, field.textNodeIndex);
      });
      if (originalName !== fieldName) {
        $(selector).each((_, el) => {
          replaceWithBinding($, $(el), fieldName, field.type, field.textNodeIndex);
        });
      }
    });

    let transformedTemplate = $.html();
    const bodyMatch = transformedTemplate.match(/<body>([\s\S]*)<\/body>/);
    if (bodyMatch) transformedTemplate = bodyMatch[1];
    transformedTemplate = transformedTemplate
      .replace(/<\/?html[^>]*>/gi, "")
      .replace(/<head><\/head>/gi, "")
      .trim();

    for (const fieldName of Object.keys(fields)) {
      transformedTemplate = transformedTemplate.replaceAll(`content.${fieldName}`, `${contentSource}.${fieldName}`);
    }

    const isAstroVue = options.target === "astro-vue";
    // Nuxt auto-imports the composable; astro shared sections receive their own
    // single type's content as a prop from the page (no client-side fetch).
    // For astro-vue, also accept `globals` so nested child components can
    // receive their own Strapi data (forwarded from the page via :globals).
    const contentSetup = isCollectionItem
      ? `const props = defineProps<{ item?: Record<string, any> }>();
const item = props.item ?? {};`
      : isPerPage
      ? `const props = defineProps<{ content: Record<string, any> }>();
const componentContent = props.content || {};`
      : isAstroVue
      ? `const props = defineProps<{ content?: Record<string, any>; globals?: Record<string, any> }>();
const content = props.content ?? {};
const globals = props.globals;`
      : `const { content } = useStrapiContent('global');`;

    // Restore child component markers → <X /> after Cheerio processing.
    // Pass target so astro-vue child components get :content and :globals bindings.
    if (childNames.length > 0) {
      transformedTemplate = restoreComponentTags(transformedTemplate, childNames, [], options.target);
    }

    const scriptSetup = `<script setup lang="ts">
${existingImports ? existingImports + '\n' : ''}${contentSetup}
</script>`;

    await fs.writeFile(filePath, `${scriptSetup}

<template>
${transformedTemplate}
</template>
`, "utf-8");
  }
}

function restoreComponentTags(
  html: string,
  componentNames: string[],
  perPageComponentNames: string[] = [],
  target?: "nuxt" | "astro-vue"
): string {
  let restored = html;
  for (const name of componentNames) {
    const lowered = name.toLowerCase();
    const tag = perPageComponentNames.includes(name)
      ? `<${name} :content="content" />`
      : target === "astro-vue"
      // astro shared section: feed it its own single type's content from the
      // page's `globals` (the .astro fetches /api/<type> per shared component).
      // Also forward globals so nested child components can access their data.
      ? `<${name} :content="globals && globals['${sharedComponentTypeName(name)}']" :globals="globals" />`
      : `<${name} />`;
    restored = restored
      .replace(new RegExp(`<!--COMPONENT:${name}-->`, "g"), tag)
      .replace(new RegExp(`<${lowered}\\s*><\\/${lowered}>`, "g"), tag)
      .replace(new RegExp(`<${lowered}\\s*\\/>`, "g"), tag);
  }
  return restored;
}

function restoreCollectionComponentTags(html: string): string {
  return html.replace(
    /<!--COLLECTION_COMPONENT:(\w+):([\w-]+)-->/g,
    (_match, componentName, collectionName) =>
      `<${componentName} v-for="(item, index) in content.${collectionName}" :key="index" :item="item" />`
  );
}

function maskComponentTags(html: string, componentNames: string[]): string {
  let masked = html;
  for (const name of componentNames) {
    masked = masked
      .replace(new RegExp(`<${name}\\s*\\/>`, "g"), `<!--COMPONENT:${name}-->`)
      .replace(new RegExp(`<${name}\\s*>\\s*<\\/${name}>`, "g"), `<!--COMPONENT:${name}-->`);
  }
  return masked;
}

/**
 * Transform all Vue pages in a directory
 */
export async function transformAllVuePages(
  pagesDir: string,
  manifest: CMSManifest,
  options: { target?: "nuxt" | "astro-vue" } = {}
): Promise<void> {
  const vueFiles = await glob("**/*.vue", { cwd: pagesDir, nodir: true });

  for (const file of vueFiles) {
    if (file.endsWith(".vue")) {
      const pageName = htmlPathToPageId(file.replace(/\.vue$/i, ".html"));
      const vueFilePath = path.join(pagesDir, file);
      await transformVueToReactive(vueFilePath, pageName, manifest, options);
    }
  }
}

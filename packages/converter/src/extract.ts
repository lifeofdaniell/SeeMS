/**
 * Extract commands — post-conversion, surgical operations on an existing project.
 *
 *  extract collections  — define collection types, regenerate manifest/schemas/seed,
 *                         and rebuild page files so v-for bindings are correct.
 *
 *  extract components   — pull ONE component out of the original HTML by selector,
 *                         write its .vue file, replace it in all pages, and
 *                         re-wire the manifest/schemas/seed.
 *
 * Both commands re-generate page Vue files from the original Webflow HTML
 * (stored in state.json → inputDir).  This avoids having to surgically patch
 * already-transformed templates that contain {{ content.x }} syntax.
 */

import path from 'path';
import pc from 'picocolors';
import fs from 'fs-extra';
import * as cheerio from 'cheerio';

import { loadConversionState, writeConversionState, hashSourceFiles } from './conversion-state';
import { generateManifest, generateManifestFromHtmlMap, writeManifest, readManifest } from './manifest';
import { manifestToSchemas, getLinkComponentSchema, upgradeLongStringFieldsToText } from './transformer';
import { writeAllSchemas, writeAllComponentSchemas, clearGeneratedSchemas, createStrapiReadme, writeLinkComponentSchema } from './schema-writer';
import { extractAllContent, formatForStrapi } from './content-extractor';
import { writeSeedData, createSeedReadme } from './seed-writer';
import {
  scanAssets, findHTMLFiles, readHTMLFile,
  writeVueComponent, formatVueFiles,
  generateBaseLayout, writeAstroVuePage, sharedComponentsDir,
} from './filesystem';
import { getPageRouteInfo, htmlPathToPageId } from './routes';
import { loadSeeMSConfig, writeSeeMSConfig, normalizeConfig, mergeConfig, minimalConfig } from './config';
import {
  createEditorContentComposable,
  createStrapiContentComposable,
  createAstroStrapiContentComposable,
  createStrapiBootstrap,
  setupEditorOverlay,
} from './editor-integration';
import { replaceWithComponent } from './component-extractor';
import { parseHTML, transformForNuxt, htmlToVueComponent, extractPageScripts } from './parser';
import type { ParsedPage } from './parser';
import { transformAllVuePages, transformSharedComponentsToReactive } from './vue-transformer';
import type { SeeMSConfig, SharedComponent, CMSManifest } from '@see-ms/types';
import type { ProjectTarget } from './boilerplate';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireState(projectDir: string) {
  const state = await loadConversionState(projectDir);
  if (!state) {
    throw new Error(
      `No conversion state found in "${projectDir}".\n` +
      `Run 'cms convert' first.`
    );
  }
  if (!(await fs.pathExists(state.inputDir))) {
    throw new Error(
      `Original source directory no longer exists: ${state.inputDir}\n` +
      `The extract commands need the original Webflow HTML to work from.`
    );
  }
  return state;
}

async function readHtmlFiles(inputDir: string) {
  const htmlFiles = await findHTMLFiles(inputDir);
  const htmlContentMap = new Map<string, string>();
  for (const htmlFile of htmlFiles) {
    const html = await readHTMLFile(inputDir, htmlFile);
    htmlContentMap.set(htmlPathToPageId(htmlFile), html);
  }
  return { htmlFiles, htmlContentMap };
}

function buildPageRoutes(htmlFiles: string[]): Record<string, string> {
  return Object.fromEntries(
    htmlFiles.map(f => {
      const info = getPageRouteInfo(f);
      return [info.pageId, info.route];
    })
  );
}

/**
 * Re-generate all page files from source HTML (fresh, no reactive bindings yet).
 * Handles both Nuxt (.vue) and Astro (.astro) targets.
 *
 * For astro-vue: writes Vue SFCs in src/components/pages/ (rendered server-side by
 * Astro's Vue integration — no client:only hydration) and Astro wrappers in src/pages/
 * that fetch from Strapi server-side and pass content as a prop.
 *
 * Pass an htmlContentMap that may have already been modified (e.g. component markers
 * injected by replaceWithComponent).  Pass manifest so Astro wrappers can include the
 * correct collection fetches for each page.
 */
async function regeneratePageFiles(
  htmlFiles: string[],
  htmlContentMap: Map<string, string>,
  originalHtmlContentMap: Map<string, string>,
  projectDir: string,
  target: ProjectTarget,
  cssFiles: string[],
  editorEnabled: boolean,
  pageComponentMap: Map<string, string[]>,
  manifest?: CMSManifest
): Promise<void> {
  if (target === 'astro-vue') {
    // Two-pass: parse all pages first, then deduplicate scripts, then write
    type AstroData = { htmlFile: string; pageName: string; parsed: ParsedPage; transformed: string };
    const astroDataMap = new Map<string, AstroData>();
    const pageScriptsMap = new Map<string, ReturnType<typeof extractPageScripts>>();

    for (const htmlFile of htmlFiles) {
      const pageName = htmlPathToPageId(htmlFile);
      const html = htmlContentMap.get(pageName)!;
      const parsed = parseHTML(html, htmlFile);
      const transformed = transformForNuxt(parsed.htmlContent, htmlFile, { linkMode: 'anchor' });
      // Extract scripts from original HTML (before component substitutions stripped them)
      pageScriptsMap.set(pageName, extractPageScripts(originalHtmlContentMap.get(pageName) ?? html));
      astroDataMap.set(pageName, { htmlFile, pageName, parsed, transformed });
    }

    // Find body inline scripts shared across 2+ pages → go in BaseLayout
    const inlineScriptCounts = new Map<string, number>();
    for (const scripts of pageScriptsMap.values()) {
      const seenInPage = new Set<string>();
      for (const content of scripts.bodyInline) {
        if (!seenInPage.has(content)) {
          inlineScriptCounts.set(content, (inlineScriptCounts.get(content) ?? 0) + 1);
          seenInPage.add(content);
        }
      }
    }
    const sharedBodyInlineSet = new Set(
      [...inlineScriptCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([content]) => content)
    );

    // Regenerate BaseLayout (CSS order + CDN scripts come from the first page)
    const firstPageName = htmlFiles[0] ? htmlPathToPageId(htmlFiles[0]) : null;
    const firstScripts = firstPageName ? pageScriptsMap.get(firstPageName) : null;
    const firstParsed = firstPageName ? astroDataMap.get(firstPageName)?.parsed : null;
    const cssOrderFromHtml = (firstParsed?.cssFiles ?? []).map((f: string) => path.basename(f));
    const cssFilesOrdered = [...cssFiles].sort((a, b) => {
      const ai = cssOrderFromHtml.indexOf(path.basename(a));
      const bi = cssOrderFromHtml.indexOf(path.basename(b));
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    await generateBaseLayout(projectDir, {
      cssFiles: cssFilesOrdered,
      headCdnScripts: firstScripts?.headCdn ?? [],
      headInlineScripts: firstScripts?.headInline ?? [],
      bodyCdnScripts: firstScripts?.bodyCdn ?? [],
      sharedBodyInlineScripts: Array.from(sharedBodyInlineSet),
    });

    // Write Vue SFC + Astro wrapper per page
    const vueComponentsDir = path.join(projectDir, 'src', 'components', 'pages');

    for (const { htmlFile, pageName, parsed, transformed } of astroDataMap.values()) {
      // --- Vue SFC (src/components/pages/<name>.vue) ---
      // Just the static template for now; transformVueToReactive will add
      // `defineProps<{content}>` and Vue reactive bindings in the next step.
      const vueName = htmlFile.replace('.html', '.vue');
      const vuePath = path.join(vueComponentsDir, vueName);
      await fs.ensureDir(path.dirname(vuePath));
      await fs.writeFile(vuePath, `<template>\n${transformed}\n</template>\n`, 'utf-8');

      // --- Astro wrapper (src/pages/<name>.astro) ---
      // Shared with the converter: server-side Strapi fetch (page + its
      // collections) + SSR'd Vue page. Keeps extract and convert in lockstep.
      const scripts = pageScriptsMap.get(pageName);
      const uniqueScripts = scripts?.bodyInline.filter(s => !sharedBodyInlineSet.has(s)) ?? [];
      const pageCollections = Object.keys(manifest?.pages[pageName]?.collections || {});
      await writeAstroVuePage(projectDir, htmlFile, pageName, {
        title: parsed.title,
        wfPage: parsed.wfPage,
        wfSite: parsed.wfSite,
        bodyClass: parsed.bodyClass,
        uniqueBodyInlineScripts: uniqueScripts,
      }, editorEnabled, pageCollections, pageComponentMap.get(pageName) || []);
    }
  } else {
    for (const htmlFile of htmlFiles) {
      const pageName = htmlPathToPageId(htmlFile);
      const html = htmlContentMap.get(pageName)!;
      const parsed = parseHTML(html, htmlFile);
      const transformed = transformForNuxt(parsed.htmlContent, htmlFile, { linkMode: 'nuxt' });
      const componentImports = pageComponentMap.get(pageName);
      const vueComponent = htmlToVueComponent(transformed, pageName, componentImports);
      await writeVueComponent(projectDir, htmlFile, vueComponent, target, cssFiles, editorEnabled);
    }
    await formatVueFiles(projectDir, target);
  }
}

async function regenerateSchemasAndSeed(
  projectDir: string,
  manifest: Awaited<ReturnType<typeof generateManifest>>,
  htmlContentMap: Map<string, string>,
  provider: string,
  // Pristine HTML for shared-component (nav/footer) seed extraction. When the
  // page map above has those sections replaced by component tags, their seed
  // must come from the original markup instead. Defaults to htmlContentMap.
  originalHtmlContentMap: Map<string, string> = htmlContentMap
): Promise<void> {
  // Clear stale schemas before writing fresh ones so renamed / removed
  // collections don't leave orphaned files that confuse Strapi.
  await clearGeneratedSchemas(projectDir);

  const { contentTypes, componentSchemas } = manifestToSchemas(manifest);

  // Build seed data BEFORE writing schemas so we can apply the same safety net
  // the convert path uses: promote string→text where content would overflow
  // varchar(255). Without this, re-extracting reverts long fields to `string`
  // and seeding 500s. (Seed content is the only place the lengths are known.)
  const extracted = extractAllContent(htmlContentMap, manifest, originalHtmlContentMap);
  const seedData = formatForStrapi(extracted);
  const promoted = upgradeLongStringFieldsToText(contentTypes, seedData);
  if (promoted > 0) console.log(pc.dim(`  ✓ Promoted ${promoted} long string field(s) to text`));

  await writeAllSchemas(projectDir, contentTypes);
  await writeAllComponentSchemas(projectDir, componentSchemas);
  await createStrapiReadme(projectDir);
  const linkSchema = getLinkComponentSchema(manifest);
  if (linkSchema) await writeLinkComponentSchema(projectDir);
  if (provider === 'strapi') await createStrapiBootstrap(projectDir);
  console.log(pc.green(`  ✓ ${Object.keys(contentTypes).length} Strapi content types`));

  await writeSeedData(projectDir, seedData);
  await createSeedReadme(projectDir);
  const pagesWithContent = Object.keys(manifest.pages).filter(k => {
    const d = seedData[k];
    return d && (Array.isArray(d) ? d.length > 0 : Object.keys(d).length > 0);
  }).length;
  console.log(pc.green(`  ✓ Seed data extracted from ${pagesWithContent} pages`));
}



function toComponentName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_\s]/g, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('');
}

// ---------------------------------------------------------------------------
// extract collections
// ---------------------------------------------------------------------------

export interface ExtractCollectionsOptions {
  collections: Array<{
    className: string;
    collectionName: string;
    /** Nested repeating children within each item */
    children?: Array<{ fieldName: string; selector: string }>;
  }>;
  configPath?: string;
  config?: SeeMSConfig;
}

export async function runExtractCollections(
  projectDir: string,
  options: ExtractCollectionsOptions
): Promise<void> {
  const state = await requireState(projectDir);
  const { inputDir, target } = state;

  const loadedConfig = options.configPath ? await loadSeeMSConfig(options.configPath) : {};
  const mergedConfig = normalizeConfig(mergeConfig(loadedConfig, options.config || {}));
  const provider = mergedConfig.cms?.provider || 'strapi';
  const editorEnabled = mergedConfig.editor?.enabled !== false;

  const { collections } = options;
  const collectionClasses = collections.map(c => c.className);
  const collectionNames = Object.fromEntries(collections.map(c => [c.className, c.collectionName]));

  // Build children map keyed by normalized class name (dashes→underscores, lowercase)
  const collectionChildren: Record<string, Array<{ fieldName: string; selector: string }>> = {};
  for (const c of collections) {
    if (c.children?.length) {
      const key = c.className.toLowerCase().replace(/-/g, '_');
      collectionChildren[key] = c.children;
    }
  }

  // Read original HTML
  console.log(pc.blue('\n🔍 Reading source HTML files...'));
  const { htmlFiles, htmlContentMap } = await readHtmlFiles(inputDir);
  const originalHtmlContentMap = new Map(htmlContentMap);
  const pageRoutes = buildPageRoutes(htmlFiles);
  const assets = await scanAssets(inputDir);
  console.log(pc.green(`  ✓ ${htmlFiles.length} HTML files`));

  // Carry over existing shared components so a previous extract-components run
  // isn't wiped out.  Also build the pageComponentMap for page re-generation.
  let sharedComponents: SharedComponent[] = [];
  const pageComponentMap = new Map<string, string[]>();

  try {
    const existingManifest = await readManifest(projectDir);
    const componentEntries = Object.entries(existingManifest.global?.components || {});
    sharedComponents = componentEntries.map(([, c]) => c as SharedComponent);

    for (const [pageName] of Object.entries(existingManifest.pages)) {
      const names: string[] = [];
      for (const [compName, comp] of componentEntries) {
        if ((comp as any).pages?.includes(pageName)) names.push(compName);
      }
      if (names.length) pageComponentMap.set(pageName, names);
    }

    // Apply component replacements in htmlContentMap so re-generated pages still
    // have the component tags
    for (const component of sharedComponents) {
      if (component.role === 'collection-item') continue;
      for (const [pageName, html] of htmlContentMap.entries()) {
        if (!component.pages?.includes(pageName)) continue;
        const $ = cheerio.load(html);
        if ($(component.selector).length > 0) {
          replaceWithComponent($, component.selector, component.name);
          htmlContentMap.set(pageName, $.html());
        }
      }
    }
  } catch {
    // No existing manifest — start fresh
  }

  // Generate manifest from original HTML (not the transformed Vue files)
  console.log(pc.blue('\n🔍 Detecting CMS fields and collections...'));
  const manifest = await generateManifestFromHtmlMap(originalHtmlContentMap, pageRoutes, {
    collectionClasses,
    collectionNames,
    collectionChildren,
    sharedComponents,
    componentsDir: sharedComponentsDir(projectDir, target),
    ignoreSelectors: mergedConfig.ignore?.selectors,
    ignoreClasses: mergedConfig.ignore?.classes,
    provider: provider as any,
  });
  await writeManifest(projectDir, manifest);

  const totalFields = Object.values(manifest.pages).reduce((n, p) => n + Object.keys(p.fields || {}).length, 0);
  const totalCollections = Object.values(manifest.pages).reduce((n, p) => n + Object.keys(p.collections || {}).length, 0);
  console.log(pc.green(`  ✓ ${totalFields} fields, ${totalCollections} collections across ${Object.keys(manifest.pages).length} pages`));

  // Re-generate page files from original HTML so v-for and all bindings are
  // correct (the existing files have the useStrapiContent guard and won't
  // accept a re-transformation otherwise).
  console.log(pc.blue('\n⚙️  Rebuilding page files with collection bindings...'));
  await regeneratePageFiles(htmlFiles, htmlContentMap, originalHtmlContentMap, projectDir, target, assets.css, editorEnabled, pageComponentMap, manifest);
  console.log(pc.green(`  ✓ Rebuilt ${htmlFiles.length} pages`));

  // Transform to reactive (fresh files, no guard to skip).
  // For astro-vue: Vue SFCs live in src/components/pages/ (not src/pages/).
  // transformVueToReactive emits defineProps instead of useStrapiContent so
  // Vue renders server-side; the Astro wrapper fetches from Strapi.
  const vueDir = target === 'astro-vue'
    ? path.join(projectDir, 'src', 'components', 'pages')
    : path.join(projectDir, 'pages');
  await transformAllVuePages(vueDir, manifest, { target });
  await transformSharedComponentsToReactive(sharedComponentsDir(projectDir, target), manifest, { target });
  console.log(pc.green(`  ✓ Reactive bindings applied`));

  // Composables
  console.log(pc.blue('\n🔌 Regenerating content runtime...'));
  if (target === 'nuxt') {
    await createEditorContentComposable(projectDir);
    await createStrapiContentComposable(projectDir, manifest);
  } else {
    await createAstroStrapiContentComposable(projectDir, manifest);
  }
  console.log(pc.green('  ✓ Composables updated'));

  // Regenerate the inline editor overlay too — the pages import '../cms-editor',
  // so re-extracting without this leaves a dangling import (convert/extract parity).
  if (editorEnabled) {
    await setupEditorOverlay(projectDir, target);
    console.log(pc.green('  ✓ Editor overlay regenerated'));
  }

  // Schemas + seed
  console.log(pc.blue('\n📋 Regenerating schemas and seed data...'));
  await regenerateSchemasAndSeed(projectDir, manifest, originalHtmlContentMap, provider);

  // Persist to config + state
  const updatedConfig: SeeMSConfig = minimalConfig({
    ...loadedConfig,
    collections: collections.map(c => ({ className: c.className, name: c.collectionName })),
  });
  await writeSeeMSConfig(projectDir, updatedConfig);

  await writeConversionState(projectDir, {
    ...state,
    collections: collections.map(c => ({
      className: c.className,
      name: c.collectionName,
      children: c.children,
    })),
    sources: await hashSourceFiles(inputDir),
  });
  console.log(pc.green('  ✓ Config and state updated'));
}

// ---------------------------------------------------------------------------
// extract components (single component by selector)
// ---------------------------------------------------------------------------

export interface ExtractComponentOptions {
  /** Human-readable name, e.g. "tabs", "hero-section" */
  name: string;
  /** CSS selector for the component's root element, e.g. ".w-tabs" */
  selector: string;
  role?: 'shared-section' | 'collection-item';
  collectionName?: string;
  collectionStorage?: 'collection-type' | 'page-repeatable' | 'global-repeatable';
  contentMode?: 'shared-global' | 'per-page' | 'auto';
  configPath?: string;
  config?: SeeMSConfig;
}

export async function runExtractComponent(
  projectDir: string,
  options: ExtractComponentOptions
): Promise<void> {
  const state = await requireState(projectDir);
  const { inputDir, target, collections: stateCollections } = state;

  const loadedConfig = options.configPath ? await loadSeeMSConfig(options.configPath) : {};
  const mergedConfig = normalizeConfig(mergeConfig(loadedConfig, options.config || {}));
  const provider = mergedConfig.cms?.provider || 'strapi';
  const editorEnabled = mergedConfig.editor?.enabled !== false;

  const componentName = toComponentName(options.name);
  const { selector, role = 'shared-section' } = options;

  console.log(pc.blue(`\n🔍 Reading source HTML files...`));
  const { htmlFiles, htmlContentMap } = await readHtmlFiles(inputDir);
  const originalHtmlContentMap = new Map(htmlContentMap);
  const pageRoutes = buildPageRoutes(htmlFiles);
  const assets = await scanAssets(inputDir);
  console.log(pc.green(`  ✓ ${htmlFiles.length} HTML files`));

  // Find which pages have the selector and grab the first occurrence as template
  const pagesWithComponent: string[] = [];
  let componentOuterHtml: string | null = null;

  for (const [pageName, html] of htmlContentMap.entries()) {
    const $ = cheerio.load(html);
    const $matches = $(selector);
    if ($matches.length === 0) continue;
    pagesWithComponent.push(pageName);
    if (!componentOuterHtml) {
      componentOuterHtml = $.html($matches.first())!;
    }
  }

  if (!componentOuterHtml || pagesWithComponent.length === 0) {
    throw new Error(
      `No elements found matching "${selector}" in any HTML file.\n` +
      `Check the selector against the original Webflow export in: ${inputDir}`
    );
  }

  console.log(pc.green(`  ✓ Found "${selector}" on ${pagesWithComponent.length} page(s): ${pagesWithComponent.join(', ')}`));

  // Write the component Vue file (static for now; transformer will add bindings)
  const componentsDir = sharedComponentsDir(projectDir, target);
  await fs.ensureDir(componentsDir);
  const componentFilePath = path.join(componentsDir, `${componentName}.vue`);

  const componentFileContent = `<template>\n${componentOuterHtml}\n</template>\n`;
  await fs.writeFile(componentFilePath, componentFileContent, 'utf-8');
  console.log(pc.green(`  ✓ Created components/${componentName}.vue`));

  // Apply component marker to htmlContentMap for affected pages
  for (const pageName of pagesWithComponent) {
    const html = htmlContentMap.get(pageName)!;
    const $ = cheerio.load(html);
    replaceWithComponent($, selector, componentName);
    htmlContentMap.set(pageName, $.html());
  }

  // Also carry over any previously extracted components
  let existingSharedComponents: SharedComponent[] = [];
  const pageComponentMap = new Map<string, string[]>();

  try {
    const existingManifest = await readManifest(projectDir);
    const componentEntries = Object.entries(existingManifest.global?.components || {});
    existingSharedComponents = componentEntries
      .map(([, c]) => c as SharedComponent)
      .filter(c => c.name !== componentName); // exclude the one we're replacing

    for (const [pageName] of Object.entries(existingManifest.pages)) {
      const names: string[] = [];
      for (const [compName, comp] of componentEntries) {
        if (compName === componentName) continue;
        if ((comp as any).pages?.includes(pageName)) names.push(compName);
      }
      if (names.length) pageComponentMap.set(pageName, names);
    }

    // Apply existing component markers to the htmlContentMap too
    for (const component of existingSharedComponents) {
      if (component.role === 'collection-item') continue;
      for (const [pageName, html] of htmlContentMap.entries()) {
        if (!component.pages?.includes(pageName)) continue;
        const $ = cheerio.load(html);
        if ($(component.selector).length > 0) {
          replaceWithComponent($, component.selector, component.name);
          htmlContentMap.set(pageName, $.html());
        }
      }
    }
  } catch {
    // No existing manifest — fresh start
  }

  // Add new component to each page's import list
  for (const pageName of pagesWithComponent) {
    const existing = pageComponentMap.get(pageName) || [];
    pageComponentMap.set(pageName, [...existing, componentName]);
  }

  // Build the SharedComponent descriptor for manifest generation
  const newSharedComponent: SharedComponent = {
    name: componentName,
    selector,
    pages: pagesWithComponent,
    role,
    contentMode: (options.contentMode as any) || (role === 'collection-item' ? 'auto' : 'shared-global'),
    confidence: 'high',
    reason: 'manually extracted',
    collectionName: role === 'collection-item'
      ? (options.collectionName || componentName.toLowerCase() + 's')
      : undefined,
    collectionStorage: role === 'collection-item'
      ? ((options.collectionStorage as any) || 'collection-type')
      : undefined,
  };

  const allSharedComponents = [...existingSharedComponents, newSharedComponent];

  // Collection info preserved from state
  const collectionClasses = stateCollections.map(c => c.className);
  const collectionNames = Object.fromEntries(stateCollections.map(c => [c.className, c.name]));

  // Re-generate all page files from the (now-modified) htmlContentMap.
  // Pass a null manifest here — we generate it just after from the fresh pages.
  console.log(pc.blue('\n⚙️  Rebuilding pages with component tag...'));
  await regeneratePageFiles(htmlFiles, htmlContentMap, originalHtmlContentMap, projectDir, target, assets.css, editorEnabled, pageComponentMap);
  console.log(pc.green(`  ✓ Rebuilt ${htmlFiles.length} pages`));

  // Generate the manifest from the same componentized HTML map we extract seed
  // data from (below), NOT from the generated .vue files. The .vue files have
  // the nav/footer replaced by component tags, which shifts the positional
  // `div:nth-of-type(...)` paths relative to the original HTML — so selectors
  // built against the .vue DOM landed on the wrong element when read back
  // against the original HTML at extraction time (e.g. body content resolving
  // to the announcement bar). Detecting and extracting against one DOM keeps
  // the selectors valid for both. Matches `extract collections`' behaviour.
  console.log(pc.blue('\n🔍 Detecting CMS fields...'));
  const vueComponentsDir = target === 'astro-vue'
    ? path.join(projectDir, 'src', 'components', 'pages')
    : path.join(projectDir, 'pages');

  const manifest = await generateManifestFromHtmlMap(htmlContentMap, pageRoutes, {
    collectionClasses,
    collectionNames,
    sharedComponents: allSharedComponents,
    componentsDir,
    ignoreSelectors: mergedConfig.ignore?.selectors,
    ignoreClasses: mergedConfig.ignore?.classes,
    provider: provider as any,
  });
  await writeManifest(projectDir, manifest);
  console.log(pc.green(`  ✓ Manifest updated`));

  // Now re-generate pages again with manifest so the Astro wrappers get
  // the correct Strapi collection fetches injected.
  if (target === 'astro-vue') {
    await regeneratePageFiles(htmlFiles, htmlContentMap, originalHtmlContentMap, projectDir, target, assets.css, editorEnabled, pageComponentMap, manifest);
  }

  // Transform Vue SFCs to reactive — emits defineProps for astro-vue
  console.log(pc.blue('\n⚡ Applying reactive bindings...'));
  await transformAllVuePages(vueComponentsDir, manifest, { target });
  await transformSharedComponentsToReactive(componentsDir, manifest, { target });
  console.log(pc.green(`  ✓ Done`));

  // Composables
  console.log(pc.blue('\n🔌 Regenerating content runtime...'));
  if (target === 'nuxt') {
    await createEditorContentComposable(projectDir);
    await createStrapiContentComposable(projectDir, manifest);
  } else {
    await createAstroStrapiContentComposable(projectDir, manifest);
  }
  console.log(pc.green('  ✓ Composables updated'));

  // Regenerate the inline editor overlay too — the pages import '../cms-editor',
  // so re-extracting without this leaves a dangling import (convert/extract parity).
  if (editorEnabled) {
    await setupEditorOverlay(projectDir, target);
    console.log(pc.green('  ✓ Editor overlay regenerated'));
  }

  // Schemas + seed
  // Extract against the SAME componentized map the manifest selectors were built
  // from (htmlContentMap), not the pristine original — otherwise the positional
  // selectors point at the wrong elements (see manifest generation note above).
  console.log(pc.blue('\n📋 Regenerating schemas and seed data...'));
  await regenerateSchemasAndSeed(projectDir, manifest, htmlContentMap, provider, originalHtmlContentMap);

  // Update config + state
  const updatedConfig: SeeMSConfig = minimalConfig({
    ...loadedConfig,
    components: {
      enabled: true,
      rules: [
        ...(loadedConfig.components?.rules || []).filter((r: any) => r.name !== componentName),
        {
          name: componentName,
          selector,
          role,
          ...(options.collectionName ? { collectionName: options.collectionName } : {}),
          ...(options.collectionStorage ? { collectionStorage: options.collectionStorage } : {}),
          ...(options.contentMode ? { contentMode: options.contentMode } : {}),
        },
      ],
    },
    collections: stateCollections.map(c => ({ className: c.className, name: c.name })),
  });
  await writeSeeMSConfig(projectDir, updatedConfig);

  await writeConversionState(projectDir, {
    ...state,
    extractComponents: true,
    sources: await hashSourceFiles(inputDir),
  });
  console.log(pc.green('  ✓ Config and state updated'));
}

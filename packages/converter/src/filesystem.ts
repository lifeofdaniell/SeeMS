/**
 * File system utilities for copying Webflow assets
 */

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import { execSync } from 'child_process';
import pc from 'picocolors';
import { isResponsiveImageVariant } from './assets';
import type { ProjectTarget } from './boilerplate';
import type { ScriptTag } from './parser';

export interface AssetPaths {
  css: string[];       // Goes to assets/css/ (nuxt) or public/assets/css/ (astro-vue)
  images: string[];    // Goes to public/assets/images/
  fonts: string[];     // Goes to public/assets/fonts/
  js: string[];        // Goes to public/assets/js/
  videos: string[];    // Goes to public/assets/videos/
  documents: string[]; // Goes to public/assets/documents/
}

/**
 * Scan Webflow export directory for assets
 */
export async function scanAssets(webflowDir: string): Promise<AssetPaths> {
  const assets: AssetPaths = {
    css: [],
    images: [],
    fonts: [],
    js: [],
    videos: [],
    documents: [],
  };

  assets.css = await glob('css/**/*.css', { cwd: webflowDir });
  const imageFiles = await glob('images/**/*', { cwd: webflowDir, nodir: true });
  assets.images = imageFiles.filter(file => !isResponsiveImageVariant(file));
  assets.fonts = await glob('fonts/**/*', { cwd: webflowDir, nodir: true });
  assets.js = await glob('js/**/*.js', { cwd: webflowDir });
  assets.videos = await glob('videos/**/*', { cwd: webflowDir, nodir: true });
  assets.documents = await glob('documents/**/*', { cwd: webflowDir, nodir: true });

  return assets;
}

/**
 * Copy CSS files — Nuxt: assets/css/  Astro: public/assets/css/
 */
export async function copyCSSFiles(
  webflowDir: string,
  outputDir: string,
  cssFiles: string[],
  target: ProjectTarget = 'nuxt'
): Promise<void> {
  const targetDir = target === 'astro-vue'
    ? path.join(outputDir, 'public', 'assets', 'css')
    : path.join(outputDir, 'assets', 'css');
  await fs.ensureDir(targetDir);

  for (const file of cssFiles) {
    const source = path.join(webflowDir, file);
    const relative = path.relative('css', file);
    const target = path.join(targetDir, relative);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target);
  }
}

/**
 * Copy images to public/assets/images/
 */
export async function copyImages(
  webflowDir: string,
  outputDir: string,
  imageFiles: string[]
): Promise<void> {
  const targetDir = path.join(outputDir, 'public', 'assets', 'images');
  await fs.ensureDir(targetDir);

  for (const file of imageFiles) {
    const source = path.join(webflowDir, file);
    const relative = path.relative('images', file);
    const target = path.join(targetDir, relative);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target);
  }
}

/**
 * Copy fonts to public/assets/fonts/
 */
export async function copyFonts(
  webflowDir: string,
  outputDir: string,
  fontFiles: string[]
): Promise<void> {
  const targetDir = path.join(outputDir, 'public', 'assets', 'fonts');
  await fs.ensureDir(targetDir);

  for (const file of fontFiles) {
    const source = path.join(webflowDir, file);
    const relative = path.relative('fonts', file);
    const target = path.join(targetDir, relative);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target);
  }
}

/**
 * Copy JS files to public/assets/js/
 */
export async function copyJSFiles(
  webflowDir: string,
  outputDir: string,
  jsFiles: string[]
): Promise<void> {
  const targetDir = path.join(outputDir, 'public', 'assets', 'js');
  await fs.ensureDir(targetDir);

  for (const file of jsFiles) {
    const source = path.join(webflowDir, file);
    const relative = path.relative('js', file);
    const target = path.join(targetDir, relative);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target);
  }
}

async function copyGenericPublicAssets(
  webflowDir: string,
  outputDir: string,
  files: string[],
  subfolder: string
): Promise<void> {
  if (files.length === 0) return;
  const targetDir = path.join(outputDir, 'public', 'assets', subfolder);
  await fs.ensureDir(targetDir);
  for (const file of files) {
    const source = path.join(webflowDir, file);
    const relative = path.relative(subfolder, file);
    const target = path.join(targetDir, relative);
    await fs.ensureDir(path.dirname(target));
    await fs.copy(source, target);
  }
}

/**
 * Copy all assets to their proper locations
 */
export async function copyAllAssets(
  webflowDir: string,
  outputDir: string,
  assets: AssetPaths,
  target: ProjectTarget = 'nuxt'
): Promise<void> {
  await copyCSSFiles(webflowDir, outputDir, assets.css, target);
  await copyImages(webflowDir, outputDir, assets.images);
  await copyFonts(webflowDir, outputDir, assets.fonts);
  await copyJSFiles(webflowDir, outputDir, assets.js);
  await copyGenericPublicAssets(webflowDir, outputDir, assets.videos ?? [], 'videos');
  await copyGenericPublicAssets(webflowDir, outputDir, assets.documents ?? [], 'documents');
}

/**
 * Find all HTML files in Webflow export (including subfolders)
 */
const WEBFLOW_COMPONENT_FILE = /(?:^|\/)component-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.html$/i;

export async function findHTMLFiles(webflowDir: string): Promise<string[]> {
  const htmlFiles = await glob('**/*.html', { cwd: webflowDir, nodir: true });
  return htmlFiles.filter(f => !WEBFLOW_COMPONENT_FILE.test(f));
}

/**
 * Read HTML file content
 */
export async function readHTMLFile(webflowDir: string, fileName: string): Promise<string> {
  const filePath = path.join(webflowDir, fileName);
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * Write Vue component to pages directory
 * Handles nested paths (e.g., press-release/article.html -> pages/press-release/article.vue)
 */
export async function writeVueComponent(
  outputDir: string,
  fileName: string,
  content: string,
  target: ProjectTarget = 'nuxt',
  cssFiles: string[] = [],
  editorEnabled = false
): Promise<void> {
  if (target === 'astro-vue') {
    const componentDir = path.join(outputDir, 'src', 'components', 'pages');
    const astroPagesDir = path.join(outputDir, 'src', 'pages');
    const vueName = fileName.replace('.html', '.vue');
    const astroName = fileName.replace('.html', '.astro');
    const vuePath = path.join(componentDir, vueName);
    const astroPath = path.join(astroPagesDir, astroName);
    const relativeVueImport = ensureRelativeImport(path.relative(path.dirname(astroPath), vuePath));
    const cssLinks = [
      ...cssFiles.map(file => `/assets/css/${path.basename(file)}`),
      '/assets/css/main.css',
    ]
      .map(href => `<link rel="stylesheet" href="${href}" />`)
      .join('\n');
    const editorScript = editorEnabled ? "\n<script>\n  import '../cms-editor';\n</script>\n" : "";

    await fs.ensureDir(path.dirname(vuePath));
    await fs.ensureDir(path.dirname(astroPath));
    await fs.writeFile(vuePath, content, 'utf-8');
    await fs.writeFile(astroPath, `---
import Page from '${relativeVueImport}';
---

${cssLinks}
<Page client:only="vue" />
${editorScript}
`, 'utf-8');
    return;
  }

  const pagesDir = path.join(outputDir, 'pages');
  const vueName = fileName.replace('.html', '.vue');
  const targetPath = path.join(pagesDir, vueName);

  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, content, 'utf-8');
}

function ensureRelativeImport(importPath: string): string {
  const normalized = importPath.split(path.sep).join('/');
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

export interface BaseLayoutOptions {
  cssFiles: string[];
  headCdnScripts: ScriptTag[];
  headInlineScripts: string[];
  bodyCdnScripts: ScriptTag[];
  sharedBodyInlineScripts: string[];
}

/**
 * Generate src/layouts/BaseLayout.astro — the single HTML shell for all pages.
 */
export async function generateBaseLayout(
  outputDir: string,
  options: BaseLayoutOptions
): Promise<void> {
  const { cssFiles, headCdnScripts, headInlineScripts, bodyCdnScripts, sharedBodyInlineScripts } = options;

  const layoutsDir = path.join(outputDir, 'src', 'layouts');
  await fs.ensureDir(layoutsDir);

  const cssLinks = cssFiles
    .map(f => `  <link rel="stylesheet" href="/assets/css/${path.basename(f)}" />`)
    .join('\n');
  const mainCssLink = `  <link rel="stylesheet" href="/assets/css/main.css" />`;

  const headCdnTags = headCdnScripts
    .map(s => {
      const integrity = s.integrity ? ` integrity="${s.integrity}"` : '';
      const crossorigin = s.crossorigin ? ` crossorigin="${s.crossorigin}"` : '';
      return `  <script src="${s.src}"${integrity}${crossorigin} is:inline></script>`;
    })
    .join('\n');

  const headInlineTags = headInlineScripts
    .map(s => `  <script is:inline>${s}</script>`)
    .join('\n');

  const bodyCdnTags = bodyCdnScripts
    .map(s => {
      let src = s.src;
      if (!src.startsWith('http') && !src.startsWith('//')) {
        const basename = src.replace(/^\.?\//, '').replace(/^js\//, '');
        src = `/assets/js/${basename}`;
      }
      const integrity = s.integrity ? ` integrity="${s.integrity}"` : '';
      const crossorigin = s.crossorigin ? ` crossorigin="${s.crossorigin}"` : '';
      return `  <script src="${src}"${integrity}${crossorigin} is:inline></script>`;
    })
    .join('\n');

  const sharedInlineTags = sharedBodyInlineScripts
    .map(s => `  <script is:inline>${s}</script>`)
    .join('\n');

  const content = `---
// see-ms:generated
interface Props {
  title: string;
  wfPage?: string;
  wfSite?: string;
  bodyClass?: string;
}
const { title, wfPage, wfSite, bodyClass = '' } = Astro.props;
---
<!DOCTYPE html>
<html lang="en" data-wf-page={wfPage} data-wf-site={wfSite}>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
${cssLinks}
${mainCssLink}
${headCdnTags}
${headInlineTags}
</head>
<body class={bodyClass}>
  <slot />
${bodyCdnTags}
${sharedInlineTags}
  <slot name="page-scripts" />
</body>
</html>
`;

  await fs.writeFile(path.join(layoutsDir, 'BaseLayout.astro'), content, 'utf-8');
}

/**
 * Write a pure Astro page with HTML body inline.
 * No Vue component wrapper — DOM is server-rendered so scripts work natively.
 */
export async function writeAstroPage(
  outputDir: string,
  fileName: string,
  htmlBody: string,
  pageOptions: {
    title?: string;
    wfPage?: string;
    wfSite?: string;
    bodyClass?: string;
    uniqueBodyInlineScripts?: string[];
  } = {}
): Promise<void> {
  const astroPagesDir = path.join(outputDir, 'src', 'pages');
  const astroName = fileName.replace('.html', '.astro');
  const astroPath = path.join(astroPagesDir, astroName);
  const layoutPath = path.join(outputDir, 'src', 'layouts', 'BaseLayout.astro');
  const relativeLayoutImport = ensureRelativeImport(
    path.relative(path.dirname(astroPath), layoutPath)
  );

  const { title = '', wfPage = '', wfSite = '', bodyClass = '', uniqueBodyInlineScripts = [] } = pageOptions;
  const safeTitle = title.replace(/"/g, '&quot;');
  const safeWfPage = wfPage.replace(/"/g, '&quot;');
  const safeWfSite = wfSite.replace(/"/g, '&quot;');
  const safeBodyClass = bodyClass.replace(/"/g, '&quot;');

  const pageScriptsSlot = uniqueBodyInlineScripts.length > 0
    ? `\n  <Fragment slot="page-scripts">\n${uniqueBodyInlineScripts.map(s => `    <script is:inline>${s}</script>`).join('\n')}\n  </Fragment>`
    : '';

  await fs.ensureDir(path.dirname(astroPath));
  await fs.writeFile(astroPath, `---
// see-ms:generated
import BaseLayout from '${relativeLayoutImport}';
---
<BaseLayout title="${safeTitle}" wfPage="${safeWfPage}" wfSite="${safeWfSite}" bodyClass="${safeBodyClass}">
${htmlBody}${pageScriptsSlot}
</BaseLayout>
`, 'utf-8');
}

/**
 * Write an Astro page that server-renders the page's content-bound Vue
 * component, fetching its content from Strapi at render time.
 *
 * The `.vue` (written by writeVueComponent) holds the markup + `{{ content.* }}`
 * bindings; here we fetch `/api/<pageName>` server-side and pass the result as
 * the `content` prop. The component is rendered WITHOUT a client directive, so
 * Astro server-renders it to static HTML — the DOM is present at load for the
 * Webflow/gsap scripts, and the editor overlay (preview mode) edits that same
 * DOM by selector. If Strapi is unreachable the page still renders (empty
 * content) instead of failing the build.
 */
export async function writeAstroVuePage(
  outputDir: string,
  fileName: string,
  pageName: string,
  pageOptions: {
    title?: string;
    wfPage?: string;
    wfSite?: string;
    bodyClass?: string;
    uniqueBodyInlineScripts?: string[];
  } = {},
  editorEnabled = false,
  collectionNames: string[] = []
): Promise<void> {
  const astroPagesDir = path.join(outputDir, 'src', 'pages');
  const componentDir = path.join(outputDir, 'src', 'components', 'pages');
  const astroName = fileName.replace('.html', '.astro');
  const vueName = fileName.replace('.html', '.vue');
  const astroPath = path.join(astroPagesDir, astroName);
  const vuePath = path.join(componentDir, vueName);
  const layoutPath = path.join(outputDir, 'src', 'layouts', 'BaseLayout.astro');
  const editorPath = path.join(outputDir, 'src', 'cms-editor');

  const relativeLayoutImport = ensureRelativeImport(path.relative(path.dirname(astroPath), layoutPath));
  const relativeVueImport = ensureRelativeImport(path.relative(path.dirname(astroPath), vuePath));
  const relativeEditorImport = ensureRelativeImport(path.relative(path.dirname(astroPath), editorPath));

  const { title = '', wfPage = '', wfSite = '', bodyClass = '', uniqueBodyInlineScripts = [] } = pageOptions;
  const safeTitle = title.replace(/"/g, '&quot;');
  const safeWfPage = wfPage.replace(/"/g, '&quot;');
  const safeWfSite = wfSite.replace(/"/g, '&quot;');
  const safeBodyClass = bodyClass.replace(/"/g, '&quot;');

  const pageScriptsSlot = uniqueBodyInlineScripts.length > 0
    ? `\n  <Fragment slot="page-scripts">\n${uniqueBodyInlineScripts.map(s => `    <script is:inline>${s}</script>`).join('\n')}\n  </Fragment>`
    : '';
  const editorScript = editorEnabled
    ? `\n<script>\n  import '${relativeEditorImport}';\n</script>\n`
    : '';

  // Fetch each collection the page renders and attach it under content[<name>]
  // so the Vue component can v-for over content.<collection>.
  const collectionFetches = collectionNames.map((name) => {
    const v = `_${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    // Strapi's collection REST route is the kebab-case pluralName, which the
    // schema generator derives from the manifest key by `_` → `-`. The Vue
    // template still binds the underscore key, so fetch by route, store by key.
    const route = name.replace(/_/g, '-');
    return `  const ${v}Res = await fetch(\`\${strapiUrl}/api/${route}?populate=*\`);
  if (${v}Res.ok) {
    const ${v}Json = await ${v}Res.json();
    content['${name}'] = ${v}Json?.data ?? [];
  }`;
  }).join('\n');

  await fs.ensureDir(path.dirname(astroPath));
  await fs.writeFile(astroPath, `---
// see-ms:generated
import BaseLayout from '${relativeLayoutImport}';
import Page from '${relativeVueImport}';

const strapiUrl = import.meta.env.PUBLIC_STRAPI_URL || 'http://localhost:1337';
let content: Record<string, any> = {};
try {
  const response = await fetch(\`\${strapiUrl}/api/${pageName}?populate=*\`);
  if (response.ok) {
    const json = await response.json();
    content = json?.data?.attributes ?? json?.data ?? {};
  }${collectionFetches ? '\n' + collectionFetches : ''}
} catch (error) {
  console.warn('[SeeMS] Could not fetch Strapi content for "${pageName}":', error instanceof Error ? error.message : error);
}
---
<BaseLayout title="${safeTitle}" wfPage="${safeWfPage}" wfSite="${safeWfSite}" bodyClass="${safeBodyClass}">
  <Page content={content} />${pageScriptsSlot}
</BaseLayout>${editorScript}
`, 'utf-8');
}

/**
 * Format Vue files with Prettier
 */
export async function formatVueFiles(outputDir: string, target: ProjectTarget = 'nuxt'): Promise<void> {
  const pagesDir = target === 'astro-vue'
    ? path.join(outputDir, 'src', 'components', 'pages')
    : path.join(outputDir, 'pages');
  
  try {
    console.log(pc.blue('\n✨ Formatting Vue files with Prettier...'));
    
    // Check if prettier is available
    execSync('prettier --version', { stdio: 'ignore' });
    
    // Format all Vue files in pages directory
    execSync(`prettier --write "${pagesDir}/**/*.vue"`, { 
      cwd: outputDir,
      stdio: 'inherit' 
    });
    
    console.log(pc.green('  ✓ Vue files formatted'));
  } catch (error) {
    console.log(pc.yellow('  ⚠ Prettier not available, skipping formatting'));
  }
}

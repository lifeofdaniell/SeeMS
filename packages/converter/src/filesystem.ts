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

export interface AssetPaths {
  css: string[];      // Goes to assets/css/
  images: string[];   // Goes to public/assets/images/
  fonts: string[];    // Goes to public/assets/fonts/
  js: string[];       // Goes to public/assets/js/
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
  };

  // Find CSS files
  const cssFiles = await glob('css/**/*.css', { cwd: webflowDir });
  assets.css = cssFiles;

  // Find images
  const imageFiles = await glob('images/**/*', { cwd: webflowDir, nodir: true });
  assets.images = imageFiles.filter(file => !isResponsiveImageVariant(file));

  // Find fonts
  const fontFiles = await glob('fonts/**/*', { cwd: webflowDir, nodir: true });
  assets.fonts = fontFiles;

  // Find JS files
  const jsFiles = await glob('js/**/*.js', { cwd: webflowDir });
  assets.js = jsFiles;

  return assets;
}

/**
 * Copy CSS files to assets/css/
 */
export async function copyCSSFiles(
  webflowDir: string,
  outputDir: string,
  cssFiles: string[]
): Promise<void> {
  const targetDir = path.join(outputDir, 'assets', 'css');
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

/**
 * Copy all assets to their proper locations
 */
export async function copyAllAssets(
  webflowDir: string,
  outputDir: string,
  assets: AssetPaths
): Promise<void> {
  await copyCSSFiles(webflowDir, outputDir, assets.css);
  await copyImages(webflowDir, outputDir, assets.images);
  await copyFonts(webflowDir, outputDir, assets.fonts);
  await copyJSFiles(webflowDir, outputDir, assets.js);
}

/**
 * Find all HTML files in Webflow export (including subfolders)
 */
export async function findHTMLFiles(webflowDir: string): Promise<string[]> {
  // Find all HTML files recursively
  const htmlFiles = await glob('**/*.html', { cwd: webflowDir, nodir: true });
  return htmlFiles;
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
    const cssImports = cssFiles
      .map(file => `import '${ensureRelativeImport(path.relative(path.dirname(astroPath), path.join(outputDir, 'assets', 'css', path.relative('css', file))))}';`)
      .join('\n');
    const editorScript = editorEnabled ? "\n<script>\n  import '../cms-editor';\n</script>\n" : "";

    await fs.ensureDir(path.dirname(vuePath));
    await fs.ensureDir(path.dirname(astroPath));
    await fs.writeFile(vuePath, content, 'utf-8');
    await fs.writeFile(astroPath, `---
import Page from '${relativeVueImport}';
${cssImports}
---

<Page client:load />
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

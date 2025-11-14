/**
 * File system utilities for copying Webflow assets
 */

import fs from 'fs-extra';
import path from 'path';
import { glob } from 'glob';
import { execSync } from 'child_process';
import pc from 'picocolors';

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
  const imageFiles = await glob('images/**/*', { cwd: webflowDir });
  assets.images = imageFiles;

  // Find fonts
  const fontFiles = await glob('fonts/**/*', { cwd: webflowDir });
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
    const target = path.join(targetDir, path.basename(file));
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
    const target = path.join(targetDir, path.basename(file));
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
    const target = path.join(targetDir, path.basename(file));
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
    const target = path.join(targetDir, path.basename(file));
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
  const htmlFiles = await glob('**/*.html', { cwd: webflowDir });
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
  content: string
): Promise<void> {
  const pagesDir = path.join(outputDir, 'pages');
  
  // Convert HTML path to Vue path
  // e.g., press-release/article.html -> press-release/article.vue
  const vueName = fileName.replace('.html', '.vue');
  const targetPath = path.join(pagesDir, vueName);

  // Ensure the directory exists
  await fs.ensureDir(path.dirname(targetPath));

  await fs.writeFile(targetPath, content, 'utf-8');
}

/**
 * Format Vue files with Prettier
 */
export async function formatVueFiles(outputDir: string): Promise<void> {
  const pagesDir = path.join(outputDir, 'pages');
  
  try {
    console.log(pc.blue('\n✨ Formatting Vue files with Prettier...'));
    
    // Check if prettier is available
    execSync('npx prettier --version', { stdio: 'ignore' });
    
    // Format all Vue files in pages directory
    execSync(`npx prettier --write "${pagesDir}/**/*.vue"`, { 
      cwd: outputDir,
      stdio: 'inherit' 
    });
    
    console.log(pc.green('  ✓ Vue files formatted'));
  } catch (error) {
    console.log(pc.yellow('  ⚠ Prettier not available, skipping formatting'));
  }
}

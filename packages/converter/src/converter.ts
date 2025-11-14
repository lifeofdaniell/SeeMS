/**
 * Main conversion logic
 */

import type { ConversionOptions } from '@see-ms/types';
import pc from 'picocolors';
import fs from 'fs-extra';
import {
  scanAssets,
  copyAllAssets,
  findHTMLFiles,
  readHTMLFile,
  writeVueComponent,
  formatVueFiles,
} from './filesystem';
import { parseHTML, transformForNuxt, htmlToVueComponent, deduplicateStyles } from './parser';
import {
  writeWebflowAssetPlugin,
  updateNuxtConfig,
  writeEmbeddedStyles,
} from './config-updater';
import { setupBoilerplate } from './boilerplate';

export async function convertWebflowExport(options: ConversionOptions): Promise<void> {
  const { inputDir, outputDir, boilerplate } = options;

  console.log(pc.cyan('🚀 Starting Webflow to Nuxt conversion...'));
  console.log(pc.dim(`Input: ${inputDir}`));
  console.log(pc.dim(`Output: ${outputDir}`));

  try {
    // Step 0: Setup boilerplate first
    await setupBoilerplate(boilerplate, outputDir);

    // Step 1: Verify input directory exists
    const inputExists = await fs.pathExists(inputDir);
    if (!inputExists) {
      throw new Error(`Input directory not found: ${inputDir}`);
    }

    // Step 2: Scan for assets
    console.log(pc.blue('\n📂 Scanning assets...'));
    const assets = await scanAssets(inputDir);
    console.log(pc.green(`  ✓ Found ${assets.css.length} CSS files`));
    console.log(pc.green(`  ✓ Found ${assets.images.length} images`));
    console.log(pc.green(`  ✓ Found ${assets.fonts.length} fonts`));
    console.log(pc.green(`  ✓ Found ${assets.js.length} JS files`));

    // Step 3: Copy assets to output
    console.log(pc.blue('\n📦 Copying assets...'));
    await copyAllAssets(inputDir, outputDir, assets);
    console.log(pc.green('  ✓ Assets copied successfully'));

    // Step 4: Find all HTML files (including in subfolders)
    console.log(pc.blue('\n🔍 Finding HTML files...'));
    const htmlFiles = await findHTMLFiles(inputDir);
    console.log(pc.green(`  ✓ Found ${htmlFiles.length} HTML files`));

    // Step 5: Convert HTML files to Vue components
    console.log(pc.blue('\n⚙️  Converting HTML to Vue components...'));
    let allEmbeddedStyles = '';

    for (const htmlFile of htmlFiles) {
      const html = await readHTMLFile(inputDir, htmlFile);
      const parsed = parseHTML(html, htmlFile);

      // Collect embedded styles
      if (parsed.embeddedStyles) {
        allEmbeddedStyles += `\n/* From ${htmlFile} */\n${parsed.embeddedStyles}\n`;
      }

      // Transform HTML for Nuxt
      const transformed = transformForNuxt(parsed.htmlContent);

      // Convert to Vue component
      const pageName = htmlFile.replace('.html', '').replace(/\//g, '-');
      const vueComponent = htmlToVueComponent(transformed, pageName);

      // Write to pages directory (this will overwrite existing files)
      await writeVueComponent(outputDir, htmlFile, vueComponent);
      console.log(pc.green(`  ✓ Created ${htmlFile.replace('.html', '.vue')}`));
    }

    // Step 6: Format Vue files with Prettier
    await formatVueFiles(outputDir);

    // Step 7: Deduplicate and write embedded styles to main.css
    if (allEmbeddedStyles.trim()) {
      console.log(pc.blue('\n✨ Writing embedded styles...'));
      const dedupedStyles = deduplicateStyles(allEmbeddedStyles);
      await writeEmbeddedStyles(outputDir, dedupedStyles);
      console.log(pc.green('  ✓ Embedded styles added to main.css'));
    }

    // Step 8: Generate/overwrite webflow-assets.ts
    console.log(pc.blue('\n🔧 Generating webflow-assets.ts plugin...'));
    await writeWebflowAssetPlugin(outputDir, assets.css);
    console.log(pc.green('  ✓ Plugin generated (existing file overwritten)'));

    // Step 9: Update nuxt.config.ts
    console.log(pc.blue('\n⚙️  Updating nuxt.config.ts...'));
    try {
      await updateNuxtConfig(outputDir, assets.css);
      console.log(pc.green('  ✓ Config updated'));
    } catch (error) {
      console.log(pc.yellow('  ⚠ Could not update nuxt.config.ts automatically'));
      console.log(pc.dim('    Please add CSS files manually'));
    }

    // Success!
    console.log(pc.green('\n✅ Conversion completed successfully!'));
    console.log(pc.cyan('\n📋 Next steps:'));
    console.log(pc.dim(`  1. cd ${outputDir}`));
    console.log(pc.dim('  2. pnpm install'));
    console.log(pc.dim('  3. pnpm dev'));
  } catch (error) {
    console.error(pc.red('\n❌ Conversion failed:'));
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    throw error;
  }
}

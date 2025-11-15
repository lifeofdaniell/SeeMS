/**
 * Main conversion logic
 */

import type { ConversionOptions } from '@see-ms/types';
import pc from 'picocolors';
import path from 'path';
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
import { createEditorPlugin, addEditorDependency, createSaveEndpoint } from './editor-integration';
import { setupBoilerplate } from './boilerplate';
import { generateManifest, writeManifest } from './manifest';
import { manifestToSchemas } from './transformer';
import { writeAllSchemas, createStrapiReadme } from './schema-writer';
import { extractAllContent, formatForStrapi } from './content-extractor';
import { writeSeedData, createSeedReadme } from './seed-writer';

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

        // Step 5: Read and store HTML content (before converting to Vue)
        // We need this for content extraction later
        const htmlContentMap = new Map<string, string>();

        for (const htmlFile of htmlFiles) {
            const html = await readHTMLFile(inputDir, htmlFile);
            const pageName = htmlFile.replace('.html', '').replace(/\//g, '-');
            htmlContentMap.set(pageName, html);
        }

        // Step 6: Convert HTML files to Vue components
        console.log(pc.blue('\n⚙️  Converting HTML to Vue components...'));
        let allEmbeddedStyles = '';

        for (const htmlFile of htmlFiles) {
            const html = htmlContentMap.get(htmlFile.replace('.html', '').replace(/\//g, '-'))!;
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

        // Step 7: Format Vue files with Prettier
        await formatVueFiles(outputDir);

        // Step 8: Generate CMS manifest
        console.log(pc.blue('\n🔍 Analyzing pages for CMS fields...'));
        const pagesDir = path.join(outputDir, 'pages');
        const manifest = await generateManifest(pagesDir);
        await writeManifest(outputDir, manifest);

        const totalFields = Object.values(manifest.pages).reduce(
            (sum, page) => sum + Object.keys(page.fields || {}).length,
            0
        );
        const totalCollections = Object.values(manifest.pages).reduce(
            (sum, page) => sum + Object.keys(page.collections || {}).length,
            0
        );

        console.log(pc.green(`  ✓ Detected ${totalFields} fields across ${Object.keys(manifest.pages).length} pages`));
        console.log(pc.green(`  ✓ Detected ${totalCollections} collections`));
        console.log(pc.green('  ✓ Generated cms-manifest.json'));

        // Step 9: Extract content from original HTML
        console.log(pc.blue('\n📝 Extracting content from HTML...'));
        const extractedContent = extractAllContent(htmlContentMap, manifest);
        const seedData = formatForStrapi(extractedContent);

        await writeSeedData(outputDir, seedData);
        await createSeedReadme(outputDir);

        const totalExtracted = Object.keys(seedData).reduce((sum, key) => {
            const data = seedData[key];
            if (Array.isArray(data)) {
                return sum + data.length;
            }
            return sum + Object.keys(data).length;
        }, 0);

        console.log(pc.green(`  ✓ Extracted ${totalExtracted} content items`));
        console.log(pc.green('  ✓ Generated cms-seed/seed-data.json'));

        // Step 10: Generate Strapi schemas
        console.log(pc.blue('\n📋 Generating Strapi schemas...'));
        const schemas = manifestToSchemas(manifest);
        await writeAllSchemas(outputDir, schemas);
        await createStrapiReadme(outputDir);

        console.log(pc.green(`  ✓ Generated ${Object.keys(schemas).length} Strapi content types`));
        console.log(pc.dim('    View schemas in: cms-schemas/'));

        // Step 11: Deduplicate and write embedded styles to main.css
        if (allEmbeddedStyles.trim()) {
            console.log(pc.blue('\n✨ Writing embedded styles...'));
            const dedupedStyles = deduplicateStyles(allEmbeddedStyles);
            await writeEmbeddedStyles(outputDir, dedupedStyles);
            console.log(pc.green('  ✓ Embedded styles added to main.css'));
        }

        // Step 12: Generate/overwrite webflow-assets.ts
        console.log(pc.blue('\n🔧 Generating webflow-assets.ts plugin...'));
        await writeWebflowAssetPlugin(outputDir, assets.css);
        console.log(pc.green('  ✓ Plugin generated (existing file overwritten)'));

        // Step 13: Update nuxt.config.ts
        console.log(pc.blue('\n⚙️  Updating nuxt.config.ts...'));
        try {
            await updateNuxtConfig(outputDir, assets.css);
            console.log(pc.green('  ✓ Config updated'));
        } catch (error) {
            console.log(pc.yellow('  ⚠  Could not update nuxt.config.ts automatically'));
            console.log(pc.dim('    Please add CSS files manually'));
        }

        console.log(pc.blue('\n🎨 Setting up editor overlay...'));
        await createEditorPlugin(outputDir);
        await addEditorDependency(outputDir);
        await createSaveEndpoint(outputDir);
        console.log(pc.green('  ✓ Editor plugin created'));
        console.log(pc.green('  ✓ Editor dependency added'));
        console.log(pc.green('  ✓ Save endpoint created'));

        // Success!
        console.log(pc.green('\n✅ Conversion completed successfully!'));
        console.log(pc.cyan('\n📋 Next steps:'));
        console.log(pc.dim(`  1. cd ${outputDir}`));
        console.log(pc.dim('  2. Review cms-manifest.json and cms-seed/seed-data.json'));
        console.log(pc.dim('  3. Set up Strapi and install schemas from cms-schemas/'));
        console.log(pc.dim('  4. Seed Strapi with data from cms-seed/'));
        console.log(pc.dim('  5. pnpm install && pnpm dev'));
        console.log(pc.dim('  6. Visit http://localhost:3000?preview=true to edit inline!'));

    } catch (error) {
        console.error(pc.red('\n❌ Conversion failed:'));
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        throw error;
    }
}

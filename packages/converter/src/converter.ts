/**
 * Main conversion logic
 */

import type { ConversionOptions } from '@see-ms/types';
import pc from 'picocolors';
import path from 'path';
import {
    copyAllAssets,
    readHTMLFile,
    writeVueComponent,
    formatVueFiles,
} from './filesystem';
import { parseHTML, transformForNuxt, htmlToVueComponent, deduplicateStyles } from './parser';
import {
    writeWebflowAssetPlugin,
    updateNuxtConfig,
    writeEmbeddedStyles,
    addStrapiUrlToConfig,
} from './config-updater';
import { createEditorPlugin, createEditorContentComposable, createStrapiContentComposable, addEditorDependency, createSaveEndpoint, createPublishEndpoint, createStrapiBootstrap } from './editor-integration';
import { setupBoilerplate } from './boilerplate';
import { generateManifest, writeManifest } from './manifest';
import { transformAllVuePages } from './vue-transformer';
import { manifestToSchemas, getLinkComponentSchema } from './transformer';
import { writeAllSchemas, createStrapiReadme, writeLinkComponentSchema } from './schema-writer';
import { extractAllContent, formatForStrapi } from './content-extractor';
import { writeSeedData, createSeedReadme } from './seed-writer';
import { extractSharedComponents, replaceWithComponent, replaceComponentMarkers } from './component-extractor';
import * as cheerio from 'cheerio';
import { analyzeWebflowExport, createConversionReport, writeConversionReport } from './analyzer';
import { loadSeeMSConfig, mergeConfig, normalizeConfig, writeSeeMSConfig } from './config';
import { getPageRouteInfo, htmlPathToPageId } from './routes';

export async function convertWebflowExport(options: ConversionOptions): Promise<void> {
    const { inputDir, outputDir, boilerplate } = options;
    const loadedConfig = options.configPath ? await loadSeeMSConfig(options.configPath) : {};
    const config = normalizeConfig(mergeConfig(loadedConfig, options.config || {}));
    const provider = options.cmsBackend || config.cms?.provider || 'strapi';
    const editorEnabled = options.editor ?? config.editor?.enabled ?? true;
    const shouldGenerateContent = options.generateContent !== false;
    const collectionClasses = options.collectionClasses || config.collections?.map(collection => collection.className);
    const collectionNames = options.collectionNames || Object.fromEntries(
        (config.collections || []).map(collection => [collection.className, collection.name || collection.className])
    );

    console.log(pc.cyan('🚀 Starting Webflow to Nuxt conversion...'));
    console.log(pc.dim(`Input: ${inputDir}`));
    console.log(pc.dim(`Output: ${outputDir}`));

    try {
        // Step 0: Analyze input and setup boilerplate
        const analysis = await analyzeWebflowExport(inputDir, config);
        await setupBoilerplate(boilerplate, outputDir);
        await writeSeeMSConfig(outputDir, config);

        // Step 1: Scan for assets
        console.log(pc.blue('\n📂 Scanning assets...'));
        const assets = analysis.assets;
        console.log(pc.green(`  ✓ Found ${assets.css.length} CSS files`));
        console.log(pc.green(`  ✓ Found ${assets.images.length} images`));
        console.log(pc.green(`  ✓ Found ${assets.fonts.length} fonts`));
        console.log(pc.green(`  ✓ Found ${assets.js.length} JS files`));

        // Step 2: Copy assets to output
        console.log(pc.blue('\n📦 Copying assets...'));
        await copyAllAssets(inputDir, outputDir, assets);
        console.log(pc.green('  ✓ Assets copied successfully'));

        // Step 3: Find all HTML files (including in subfolders)
        console.log(pc.blue('\n🔍 Finding HTML files...'));
        const htmlFiles = analysis.pages.map((page) => page.sourcePath);
        console.log(pc.green(`  ✓ Found ${htmlFiles.length} HTML files`));

        // Step 5: Read and store HTML content (before converting to Vue)
        // We need this for content extraction later
        const htmlContentMap = new Map<string, string>();

        for (const htmlFile of htmlFiles) {
            const html = await readHTMLFile(inputDir, htmlFile);
            const pageName = htmlPathToPageId(htmlFile);
            htmlContentMap.set(pageName, html);
            console.log(pc.dim(`  Stored: ${pageName} from ${htmlFile}`));
        }

        // Step 5.5: Extract shared components (navbar, footer, etc.)
        console.log(pc.blue('\n🧩 Extracting shared components...'));
        const sharedComponents = config.components?.enabled === false
            ? []
            : await extractSharedComponents(inputDir, outputDir, {
                minOccurrences: config.components?.minOccurrences,
                minSectionSize: config.components?.minSectionSize,
                include: config.components?.include,
                exclude: config.components?.exclude,
            });

        // Track which components are used per page
        const pageComponentMap = new Map<string, string[]>();

        if (sharedComponents.length > 0) {
            console.log(pc.green(`  ✓ Extracted ${sharedComponents.length} shared components:`));
            for (const component of sharedComponents) {
                console.log(pc.dim(`    - ${component.name} (found in ${component.pages.length} pages)`));
            }

            // Replace shared sections in HTML with component tags
            // This modifies htmlContentMap to use component imports
            for (const [pageName, html] of htmlContentMap.entries()) {
                const $ = cheerio.load(html);
                let modified = false;
                const usedComponents: string[] = [];

                for (const component of sharedComponents) {
                    // Check if this page has the component
                    if (component.pages.includes(pageName)) {
                        replaceWithComponent($, component.selector, component.name);
                        usedComponents.push(component.name);
                        modified = true;
                    }
                }

                if (modified) {
                    // Serialize HTML and replace component markers with PascalCase tags
                    const serializedHtml = replaceComponentMarkers($.html());
                    htmlContentMap.set(pageName, serializedHtml);
                    pageComponentMap.set(pageName, usedComponents);
                }
            }
        } else {
            console.log(pc.dim('  No shared components detected across pages'));
        }

        // Step 6: Convert HTML files to Vue components
        console.log(pc.blue('\n⚙️  Converting HTML to Vue components...'));
        let allEmbeddedStyles = '';

        for (const htmlFile of htmlFiles) {
            const pageName = htmlPathToPageId(htmlFile);
            const html = htmlContentMap.get(pageName)!;
            const parsed = parseHTML(html, htmlFile);

            // Collect embedded styles
            if (parsed.embeddedStyles) {
                allEmbeddedStyles += `\n/* From ${htmlFile} */\n${parsed.embeddedStyles}\n`;
            }

            // Transform HTML for Nuxt
            const transformed = transformForNuxt(parsed.htmlContent, htmlFile);

            // Get shared component imports for this page
            const componentImports = pageComponentMap.get(pageName);

            // Convert to Vue component (with component imports if any)
            const vueComponent = htmlToVueComponent(transformed, pageName, componentImports);

            // Write to pages directory (this will overwrite existing files)
            await writeVueComponent(outputDir, htmlFile, vueComponent);
            console.log(pc.green(`  ✓ Created ${htmlFile.replace('.html', '.vue')}`));
        }

        // Step 7: Format Vue files with Prettier
        await formatVueFiles(outputDir);

        // Step 8: Generate CMS manifest
        console.log(pc.blue('\n🔍 Analyzing pages for CMS fields...'));
        const pagesDir = path.join(outputDir, 'pages');
        const pageRoutes = Object.fromEntries(
            htmlFiles.map((htmlFile) => {
                const info = getPageRouteInfo(htmlFile);
                return [info.pageId, info.route];
            })
        );
        const manifest = await generateManifest(pagesDir, {
            collectionClasses,
            collectionNames,
            sharedComponents,
            ignoreSelectors: config.ignore?.selectors,
            ignoreClasses: config.ignore?.classes,
            provider,
            pageRoutes,
        });
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

        // Step 8.5: Transform Vue files to use reactive content
        console.log(pc.blue('\n⚡ Transforming Vue files to reactive templates...'));
        await transformAllVuePages(pagesDir, manifest);
        console.log(pc.green(`  ✓ Transformed ${Object.keys(manifest.pages).length} pages to use Vue template syntax`));

        // Step 9: Extract content from original HTML
        console.log(pc.blue('\n📝 Extracting content from HTML...'));
        console.log(pc.dim(`  HTML map has ${htmlContentMap.size} entries`));
        console.log(pc.dim(`  Manifest has ${Object.keys(manifest.pages).length} pages`));

        let seedData: Record<string, any> = {};
        if (shouldGenerateContent) {
            const extractedContent = extractAllContent(htmlContentMap, manifest);
            seedData = formatForStrapi(extractedContent);

            await writeSeedData(outputDir, seedData);
            await createSeedReadme(outputDir);
        }

        // Count pages that had content extracted (not boilerplate-only pages)
        const pagesWithContent = Object.keys(manifest.pages).filter(key => {
            const data = seedData[key];
            if (!data) return false;
            if (Array.isArray(data)) return data.length > 0;
            return Object.keys(data).length > 0;
        }).length;

        if (shouldGenerateContent) {
            console.log(pc.green(`  ✓ Extracted content from ${pagesWithContent} pages`));
            console.log(pc.green(`  ✓ Generated cms-seed/seed-data.json`));
        } else {
            console.log(pc.dim('  Skipped initial CMS content generation'));
        }

        // Step 10: Generate Strapi schemas
        console.log(pc.blue('\n📋 Generating Strapi schemas...'));
        const schemas = manifestToSchemas(manifest);
        await writeAllSchemas(outputDir, schemas);
        await createStrapiReadme(outputDir);

        // Write link component schema if any link fields exist
        const linkSchema = getLinkComponentSchema(manifest);
        if (linkSchema) {
            await writeLinkComponentSchema(outputDir);
            console.log(pc.dim('  ✓ Generated shared.link component schema'));
        }

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

        if (editorEnabled) {
            console.log(pc.blue('\n🎨 Setting up editor overlay...'));
            await createEditorPlugin(outputDir);
            await createEditorContentComposable(outputDir);
            await createStrapiContentComposable(outputDir);
            await addEditorDependency(outputDir);
            await createSaveEndpoint(outputDir);
            await createPublishEndpoint(outputDir);
            await createStrapiBootstrap(outputDir);
            await addStrapiUrlToConfig(outputDir);
            console.log(pc.green('  ✓ Editor plugin created'));
            console.log(pc.green('  ✓ Editor content composable created'));
            console.log(pc.green('  ✓ Strapi content composable created'));
            console.log(pc.green('  ✓ Editor dependency added'));
            console.log(pc.green('  ✓ Save endpoint created'));
            console.log(pc.green('  ✓ Publish endpoint created'));
            console.log(pc.green('  ✓ Strapi bootstrap file generated'));
            console.log(pc.green('  ✓ Strapi config added'));
        } else {
            console.log(pc.dim('\n🎨 Editor overlay disabled by config'));
        }

        const report = createConversionReport({
            analysis,
            provider,
            stages: ['scan', 'analyze', 'plan', 'convert', 'cms', ...(editorEnabled ? ['editor' as const] : [])],
            components: sharedComponents,
            fields: totalFields,
            collections: totalCollections,
            schemas: Object.keys(schemas).length,
            seedPages: pagesWithContent,
            warnings: []
        });
        await writeConversionReport(outputDir, report);
        console.log(pc.green('  ✓ Generated see-ms-report.md and see-ms-report.json'));

        // Success!
        console.log(pc.green('\n✅ Conversion completed successfully!'));
        console.log(pc.cyan('\n📋 Next steps:'));
        console.log(pc.dim(`  1. cd ${outputDir}`));
        console.log(pc.dim('  2. Review cms-manifest.json and cms-seed/seed-data.json'));
        console.log(pc.dim('  3. Set up Strapi and install schemas from cms-schemas/'));
        console.log(pc.dim('  4. Copy strapi-bootstrap/index.ts to your Strapi project at src/index.ts'));
        console.log(pc.dim('     (This auto-enables public read permissions on Strapi startup)'));
        console.log(pc.dim('  5. Seed Strapi with data from cms-seed/'));
        console.log(pc.dim('  6. pnpm install && pnpm dev'));
        console.log(pc.dim('  7. Visit http://localhost:3000?preview=true to edit inline!'));

    } catch (error) {
        console.error(pc.red('\n❌ Conversion failed:'));
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        throw error;
    }
}

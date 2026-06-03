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
    generateBaseLayout,
    writeAstroVuePage,
} from './filesystem';
import { parseHTML, transformForNuxt, htmlToVueComponent, deduplicateStyles, extractPageScripts } from './parser';
import type { ParsedPage, PageScripts } from './parser';
import {
    writeWebflowAssetPlugin,
    updateNuxtConfig,
    writeEmbeddedStyles,
    addStrapiUrlToConfig,
} from './config-updater';
import {
    createAstroEditorClient,
    createAstroSaveEndpoint,
    createAstroStrapiContentComposable,
    createEditorPlugin,
    createEditorContentComposable,
    createStrapiContentComposable,
    addEditorDependency,
    createSaveEndpoint,
    createPublishEndpoint,
    createStrapiBootstrap
} from './editor-integration';
import { setupBoilerplate } from './boilerplate';
import { generateManifest, writeManifest } from './manifest';
import { transformAllVuePages, transformSharedComponentsToReactive } from './vue-transformer';
import { manifestToSchemas, getLinkComponentSchema, upgradeLongStringFieldsToText } from './transformer';
import { writeAllSchemas, writeAllComponentSchemas, clearGeneratedSchemas, createStrapiReadme, writeLinkComponentSchema } from './schema-writer';
import { extractAllContent, formatForStrapi } from './content-extractor';
import { writeSeedData, createSeedReadme } from './seed-writer';
import { extractSharedComponents, replaceWithComponent } from './component-extractor';
import * as cheerio from 'cheerio';
import { analyzeWebflowExport, createConversionReport, writeConversionReport } from './analyzer';
import { loadSeeMSConfig, mergeConfig, normalizeConfig, writeSeeMSConfig } from './config';
import { getPageRouteInfo, htmlPathToPageId } from './routes';
import { writeConversionState, hashSourceFiles } from './conversion-state';
import {
    getGeneratedAssetFiles,
    getGeneratedPageFiles,
    getGeneratedRuntimeFiles,
    keepPreviousNonPageFiles,
    loadGeneratedFileState,
    removeStaleGeneratedFiles,
    toPosixPath,
    writeGeneratedFileState,
} from './generated-state';

export async function convertWebflowExport(options: ConversionOptions): Promise<void> {
    const { inputDir, outputDir, boilerplate } = options;
    const loadedConfig = options.configPath ? await loadSeeMSConfig(options.configPath) : {};
    const config = normalizeConfig(mergeConfig(loadedConfig, options.config || {}));
    const target = options.target || config.target || 'nuxt';
    const provider = options.cmsBackend || config.cms?.provider || 'strapi';
    const editorEnabled = options.editor ?? config.editor?.enabled ?? true;
    const shouldGenerateContent = options.generateContent !== false;
    const collectionClasses = options.collectionClasses || config.collections?.map(collection => collection.className);
    const collectionNames = options.collectionNames || Object.fromEntries(
        (config.collections || []).map(collection => [collection.className, collection.name || collection.className])
    );

    console.log(pc.cyan(`🚀 Starting Webflow to ${target === 'astro-vue' ? 'Astro + Vue' : 'Nuxt'} conversion...`));
    console.log(pc.dim(`Input: ${inputDir}`));
    console.log(pc.dim(`Output: ${outputDir}`));

    try {
        // Step 0: Analyze input and setup boilerplate
        const analysis = await analyzeWebflowExport(inputDir, config);
        await setupBoilerplate(boilerplate, outputDir, target, editorEnabled);
        await writeSeeMSConfig(outputDir, options.config || {});
        const previousGeneratedState = await loadGeneratedFileState(outputDir);
        const generatedFiles = new Set<string>(getGeneratedRuntimeFiles(target, editorEnabled));

        // Step 1: Scan for assets
        console.log(pc.blue('\n📂 Scanning assets...'));
        const assets = analysis.assets;
        getGeneratedAssetFiles(assets).forEach((file) => generatedFiles.add(file));
        console.log(pc.green(`  ✓ Found ${assets.css.length} CSS files`));
        console.log(pc.green(`  ✓ Found ${assets.images.length} images`));
        console.log(pc.green(`  ✓ Found ${assets.fonts.length} fonts`));
        console.log(pc.green(`  ✓ Found ${assets.js.length} JS files`));
        if (assets.videos?.length) console.log(pc.green(`  ✓ Found ${assets.videos.length} video files`));
        if (assets.documents?.length) console.log(pc.green(`  ✓ Found ${assets.documents.length} document files`));

        // Step 2: Copy assets to output
        console.log(pc.blue('\n📦 Copying assets...'));
        await copyAllAssets(inputDir, outputDir, assets, target);
        console.log(pc.green('  ✓ Assets copied successfully'));

        // Step 3: Find all HTML files (including in subfolders)
        console.log(pc.blue('\n🔍 Finding HTML files...'));
        const htmlFiles = analysis.pages.map((page) => page.sourcePath);
        getGeneratedPageFiles(htmlFiles, target).forEach((file) => generatedFiles.add(file));
        console.log(pc.green(`  ✓ Found ${htmlFiles.length} HTML files`));

        const removedStalePageFiles = await removeStaleGeneratedFiles(
            outputDir,
            previousGeneratedState,
            keepPreviousNonPageFiles(previousGeneratedState, generatedFiles)
        );
        if (removedStalePageFiles.length > 0) {
            console.log(pc.green(`  ✓ Removed ${removedStalePageFiles.length} stale generated page files`));
        }

        // Step 5: Read and store HTML content (before converting to Vue)
        // We need this for content extraction later
        const htmlContentMap = new Map<string, string>();
        const originalHtmlContentMap = new Map<string, string>();

        for (const htmlFile of htmlFiles) {
            const html = await readHTMLFile(inputDir, htmlFile);
            const pageName = htmlPathToPageId(htmlFile);
            htmlContentMap.set(pageName, html);
            originalHtmlContentMap.set(pageName, html);
            console.log(pc.dim(`  Stored: ${pageName} from ${htmlFile}`));
        }

        // Step 5.5: Extract shared components (navbar, footer, etc.)
        // For astro-vue: skip — pure Astro pages embed all HTML inline (Phase 1A)
        console.log(pc.blue('\n🧩 Extracting shared components...'));
        const sharedComponents = config.components?.enabled === false || target === 'astro-vue'
            ? []
            : await extractSharedComponents(inputDir, outputDir, {
                minOccurrences: config.components?.minOccurrences,
                minPages: config.components?.minPages,
                minSectionSize: config.components?.minSectionSize,
                match: config.components?.match,
                writeConfidence: config.components?.writeConfidence,
                include: config.components?.include,
                exclude: config.components?.exclude,
                rules: config.components?.rules,
            });

        // Track which components are used per page
        const pageComponentMap = new Map<string, string[]>();

        if (sharedComponents.length > 0) {
            sharedComponents.forEach((component) => {
                generatedFiles.add(toPosixPath(path.join('components', `${component.name}.vue`)));
            });
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
                    if (component.role === 'collection-item') {
                        continue;
                    }
                    // Check if this page has the component
                    if (component.pages.includes(pageName)) {
                        replaceWithComponent($, component.selector, component.name);
                        usedComponents.push(component.name);
                        modified = true;
                    }
                }

                if (modified) {
                    // Keep component markers as comments until final Vue generation.
                    // Cheerio parses self-closing custom tags as wrappers in HTML mode.
                    const serializedHtml = $.html();
                    htmlContentMap.set(pageName, serializedHtml);
                    pageComponentMap.set(pageName, usedComponents);
                }
            }
        } else {
            console.log(pc.dim('  No shared components detected across pages'));
        }

        // Step 6: Convert HTML files to pages
        console.log(pc.blue('\n⚙️  Converting HTML to pages...'));
        let allEmbeddedStyles = '';

        // For astro-vue: two-pass — collect parsed data first, then deduplicate scripts and write
        type AstroPageData = { htmlFile: string; pageName: string; parsed: ParsedPage; transformed: string };
        const astroPageDataMap = new Map<string, AstroPageData>();
        const pageScriptsMap = new Map<string, PageScripts>();

        for (const htmlFile of htmlFiles) {
            const pageName = htmlPathToPageId(htmlFile);
            const html = htmlContentMap.get(pageName)!;
            const parsed = parseHTML(html, htmlFile);

            // Collect embedded styles
            if (parsed.embeddedStyles) {
                allEmbeddedStyles += `\n/* From ${htmlFile} */\n${parsed.embeddedStyles}\n`;
            }

            // Transform HTML
            const transformed = transformForNuxt(parsed.htmlContent, htmlFile, {
                linkMode: target === 'astro-vue' ? 'anchor' : 'nuxt',
            });

            if (target === 'astro-vue') {
                // Extract scripts from original HTML (before parseHTML strips them)
                pageScriptsMap.set(pageName, extractPageScripts(originalHtmlContentMap.get(pageName)!));
                astroPageDataMap.set(pageName, { htmlFile, pageName, parsed, transformed });
            } else {
                const componentImports = pageComponentMap.get(pageName);
                const vueComponent = htmlToVueComponent(transformed, pageName, componentImports);
                await writeVueComponent(outputDir, htmlFile, vueComponent, target, assets.css, editorEnabled);
                console.log(pc.green(`  ✓ Created ${htmlFile.replace('.html', '.vue')}`));
            }
        }

        // For astro-vue: deduplicate scripts, generate BaseLayout, write .astro pages
        if (target === 'astro-vue') {
            // Count occurrences of each body inline script across all pages
            const inlineScriptCounts = new Map<string, number>();
            for (const scripts of pageScriptsMap.values()) {
                const seenInPage = new Set<string>();
                for (const content of scripts.bodyInline) {
                    if (!seenInPage.has(content)) {
                        inlineScriptCounts.set(content, (inlineScriptCounts.get(content) || 0) + 1);
                        seenInPage.add(content);
                    }
                }
            }

            const sharedBodyInlineSet = new Set(
                Array.from(inlineScriptCounts.entries())
                    .filter(([, count]) => count > 1)
                    .map(([content]) => content)
            );

            // Use scripts and CSS order from the first page (identical across all Webflow pages)
            const firstPageName = htmlFiles[0] ? htmlPathToPageId(htmlFiles[0]) : null;
            const firstScripts = firstPageName ? pageScriptsMap.get(firstPageName) : null;
            const firstParsed = firstPageName ? astroPageDataMap.get(firstPageName)?.parsed : null;

            // Preserve CSS link order from original HTML; main.css is always added last by generateBaseLayout
            const cssOrderFromHtml = (firstParsed?.cssFiles ?? []).map(f => path.basename(f));
            const cssFilesOrdered = [...assets.css].sort((a, b) => {
                const ai = cssOrderFromHtml.indexOf(path.basename(a));
                const bi = cssOrderFromHtml.indexOf(path.basename(b));
                if (ai === -1 && bi === -1) return 0;
                if (ai === -1) return 1;
                if (bi === -1) return -1;
                return ai - bi;
            });

            await generateBaseLayout(outputDir, {
                cssFiles: cssFilesOrdered,
                headCdnScripts: firstScripts?.headCdn ?? [],
                headInlineScripts: firstScripts?.headInline ?? [],
                bodyCdnScripts: firstScripts?.bodyCdn ?? [],
                sharedBodyInlineScripts: Array.from(sharedBodyInlineSet),
            });
            console.log(pc.green('  ✓ Generated src/layouts/BaseLayout.astro'));

            for (const { htmlFile, pageName, parsed } of astroPageDataMap.values()) {
                const scripts = pageScriptsMap.get(pageName);
                const uniqueScripts = scripts?.bodyInline.filter(s => !sharedBodyInlineSet.has(s)) ?? [];
                await writeAstroVuePage(outputDir, htmlFile, pageName, {
                    title: parsed.title,
                    wfPage: parsed.wfPage,
                    wfSite: parsed.wfSite,
                    bodyClass: parsed.bodyClass,
                    uniqueBodyInlineScripts: uniqueScripts,
                }, editorEnabled);
                console.log(pc.green(`  ✓ Created ${htmlFile.replace('.html', '.astro')}`));
            }
        }

        // Step 7: Format Vue files with Prettier (nuxt only)
        if (target !== 'astro-vue') await formatVueFiles(outputDir, target);

        // Step 8: Generate CMS manifest
        console.log(pc.blue('\n🔍 Analyzing pages for CMS fields...'));
        const pagesDir = target === 'astro-vue'
            ? path.join(outputDir, 'src', 'pages')
            : path.join(outputDir, 'pages');
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
            componentsDir: path.join(outputDir, 'components'),
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

        console.log(pc.blue('\n🔌 Generating content runtime...'));
        if (target === 'nuxt') {
            await createEditorContentComposable(outputDir);
            await createStrapiContentComposable(outputDir, manifest);
            await addStrapiUrlToConfig(outputDir);
        } else {
            await createAstroStrapiContentComposable(outputDir, manifest);
        }
        console.log(pc.green('  ✓ Content runtime generated'));

        // Step 8.5: Transform Vue files to use reactive content (nuxt only)
        if (target !== 'astro-vue') {
            console.log(pc.blue('\n⚡ Transforming Vue files to reactive templates...'));
            await transformAllVuePages(pagesDir, manifest, { target });
            await transformSharedComponentsToReactive(path.join(outputDir, 'components'), manifest, { target });
            console.log(pc.green(`  ✓ Transformed ${Object.keys(manifest.pages).length} pages to use Vue template syntax`));
        }

        // Step 9: Extract content from original HTML
        console.log(pc.blue('\n📝 Extracting content from HTML...'));
        console.log(pc.dim(`  HTML map has ${htmlContentMap.size} entries`));
        console.log(pc.dim(`  Manifest has ${Object.keys(manifest.pages).length} pages`));

        let seedData: Record<string, any> = {};
        if (shouldGenerateContent) {
            const extractedContent = extractAllContent(originalHtmlContentMap, manifest);
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
            console.log(pc.green(`  ✓ Generated .see-ms/seed/seed-data.json`));
        } else {
            console.log(pc.dim('  Skipped initial CMS content generation'));
        }

        // Step 10: Generate Strapi schemas
        console.log(pc.blue('\n📋 Generating Strapi schemas...'));
        await clearGeneratedSchemas(outputDir);
        const { contentTypes, componentSchemas } = manifestToSchemas(manifest);
        // Promote string fields to text where seed content would overflow
        // varchar(255), so Postgres can store long copy without a 500 on seed.
        const promoted = upgradeLongStringFieldsToText(contentTypes, seedData);
        if (promoted > 0) {
            console.log(pc.dim(`  ✓ Promoted ${promoted} long string field(s) to text`));
        }
        Object.keys(contentTypes).forEach((name) => {
            generatedFiles.add(toPosixPath(path.join('.see-ms', 'schemas', `${name}.json`)));
        });
        await writeAllSchemas(outputDir, contentTypes);
        await writeAllComponentSchemas(outputDir, componentSchemas);
        await createStrapiReadme(outputDir);

        // Write link component schema if any link fields exist
        const linkSchema = getLinkComponentSchema(manifest);
        if (linkSchema) {
            generatedFiles.add(toPosixPath(path.join('.see-ms', 'schemas', 'components', 'shared', 'link.json')));
            await writeLinkComponentSchema(outputDir);
            console.log(pc.dim('  ✓ Generated shared.link component schema'));
        }

        console.log(pc.green(`  ✓ Generated ${Object.keys(contentTypes).length} Strapi content types`));
        console.log(pc.dim('    View schemas in: .see-ms/schemas/'));

        if (provider === 'strapi') {
            await createStrapiBootstrap(outputDir);
            console.log(pc.green('  ✓ Strapi bootstrap file generated'));
        }

        // Step 11: Deduplicate and write embedded styles to main.css
        if (allEmbeddedStyles.trim()) {
            console.log(pc.blue('\n✨ Writing embedded styles...'));
            const dedupedStyles = deduplicateStyles(allEmbeddedStyles);
            await writeEmbeddedStyles(outputDir, dedupedStyles);
            console.log(pc.green('  ✓ Embedded styles added to main.css'));
        }

        // Step 12: Generate/overwrite webflow-assets.ts
        if (target === 'nuxt') {
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
        } else {
            console.log(pc.dim('\n🔧 Skipped Nuxt asset plugin; Astro pages import CSS directly'));
        }

        if (editorEnabled) {
            console.log(pc.blue('\n🎨 Setting up editor overlay...'));
            if (target === 'nuxt') {
                await createEditorPlugin(outputDir);
                await createSaveEndpoint(outputDir);
                await createPublishEndpoint(outputDir);
                console.log(pc.green('  ✓ Nuxt editor plugin created'));
                console.log(pc.green('  ✓ Nuxt save/publish endpoints created'));
            } else {
                await createAstroEditorClient(outputDir);
                await createAstroSaveEndpoint(outputDir);
                console.log(pc.green('  ✓ Astro editor client created'));
                console.log(pc.green('  ✓ Astro save/publish endpoints created'));
            }
            await addEditorDependency(outputDir);
            console.log(pc.green('  ✓ Editor dependency added'));
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
            schemas: Object.keys(contentTypes).length,
            seedPages: pagesWithContent,
            warnings: []
        });
        await writeConversionReport(outputDir, report);
        console.log(pc.green('  ✓ Generated .see-ms/report.md and .see-ms/report.json'));
        const removedStaleFiles = await removeStaleGeneratedFiles(outputDir, previousGeneratedState, generatedFiles);
        if (removedStaleFiles.length > 0) {
            console.log(pc.green(`  ✓ Removed ${removedStaleFiles.length} stale generated files`));
        }
        await writeGeneratedFileState(outputDir, target, generatedFiles);
        await writeConversionState(outputDir, {
            inputDir,
            target,
            extractComponents: config.components?.enabled !== false,
            collections: (config.collections || []).map(c => ({
                className: c.className,
                name: c.name || c.className,
            })),
            sources: await hashSourceFiles(inputDir),
        });

        // Success!
        console.log(pc.green('\n✅ Conversion completed successfully!'));
        console.log(pc.cyan('\n📋 Next steps:'));
        console.log(pc.dim(`  1. cd ${outputDir}`));
        console.log(pc.dim('  2. Review public/cms-manifest.json and .see-ms/seed/seed-data.json'));
        console.log(pc.dim('  3. Set up Strapi and install schemas from .see-ms/schemas/'));
        console.log(pc.dim('     (setup-strapi installs the generated bootstrap automatically)'));
        console.log(pc.dim('  4. Seed Strapi with data from .see-ms/seed/'));
        console.log(pc.dim('  5. pnpm install && pnpm dev'));
        console.log(pc.dim('  6. Visit http://localhost:3000?preview=true to edit inline!'));

    } catch (error) {
        console.error(pc.red('\n❌ Conversion failed:'));
        console.error(pc.red(error instanceof Error ? error.message : String(error)));
        throw error;
    }
}

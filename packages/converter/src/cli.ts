#!/usr/bin/env node

/**
 * CLI for @see-ms/converter
 * Usage: cms convert <input-dir> <output-dir> [options]
 */

import { Command } from "commander";
import pc from "picocolors";
import * as readline from "readline";
import fs from "fs-extra";
import path from "path";
import { convertWebflowExport } from "./converter";
import { completeSetup, scaffoldStrapiProject } from "./strapi-setup";
import { manifestToSchemas, getLinkComponentSchema } from "./transformer";
import { writeAllSchemas, createStrapiReadme, writeLinkComponentSchema } from "./schema-writer";
import { analyzeWebflowExport, renderReportMarkdown } from "./analyzer";
import { loadSeeMSConfig, mergeConfig, normalizeConfig } from "./config";
import type { CMSManifest, ConversionReport, SeeMSConfig } from "@see-ms/types";

const program = new Command();

/**
 * Collection class with its display name
 */
interface CollectionConfig {
  className: string;
  collectionName: string;
}

/**
 * Prompt user for input
 */
async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Ask yes/no question with default
 */
async function confirm(question: string, defaultYes: boolean = true): Promise<boolean> {
  const hint = defaultYes ? "(Y/n)" : "(y/N)";
  const answer = await prompt(`${question} ${hint}: `);
  if (answer === "") return defaultYes;
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

/**
 * Convert class name to a readable collection name
 * e.g. "c-blogpost" -> "blogposts", "team-member_card" -> "team_members"
 */
function classToCollectionName(className: string): string {
  // Remove common prefixes
  let name = className
    .replace(/^c[-_]/, '')
    .replace(/^cc[-_]/, '')
    .replace(/[-_]card$/, '')
    .replace(/[-_]item$/, '')
    .replace(/[-_]wrapper$/, '');

  // Convert to snake_case
  name = name.replace(/-/g, '_');

  // Make plural if not already
  if (!name.endsWith('s')) {
    name += 's';
  }

  return name;
}

function toPackageManager(value: string): "npm" | "pnpm" | "yarn" {
  if (value === "pnpm" || value === "yarn") return value;
  return "npm";
}

/**
 * Prompt for collection classes and their names
 */
async function promptForCollections(): Promise<CollectionConfig[]> {
  console.log("");
  console.log(pc.cyan("📋 Collection Types Configuration"));
  console.log(pc.dim("   Collections are repeating items like blog posts, team members, FAQs, etc."));
  console.log("");

  const classesInput = await prompt(
    pc.white("Enter collection element classes (comma-separated, or press enter to skip):\n") +
    pc.dim("   Example: c-blogpost, team-member_card, c-faq-item\n") +
    pc.cyan("   > ")
  );

  if (!classesInput) {
    return [];
  }

  const classes = classesInput.split(",").map(c => c.trim()).filter(Boolean);
  const collections: CollectionConfig[] = [];

  console.log("");
  console.log(pc.dim("   Now let's name each collection type:"));
  console.log("");

  for (const className of classes) {
    const suggestedName = classToCollectionName(className);
    const nameInput = await prompt(
      pc.white(`   "${className}" → Collection name `) +
      pc.dim(`(default: ${suggestedName}): `)
    );

    collections.push({
      className,
      collectionName: nameInput || suggestedName
    });
  }

  return collections;
}

program
  .name("cms")
  .description("SeeMS - Webflow to CMS converter")
  .version("0.1.3");

program
  .command("convert")
  .description("Convert Webflow export to Nuxt 3 project with CMS integration")
  .argument("<input>", "Path to Webflow export directory")
  .argument("<output>", "Path to output Nuxt project directory")
  .option(
    "-b, --boilerplate <source>",
    "Boilerplate source (GitHub URL or local path)"
  )
  .option("-o, --overrides <path>", "Path to overrides JSON file")
  .option("--config <path>", "Path to see-ms config file")
  .option(
    "--cms <type>",
    "CMS backend type (strapi|contentful|sanity)",
    "strapi"
  )
  .option("--skip-prompts", "Skip interactive prompts (for CI/CD)")
  .option("--collection-classes <classes>", "Comma-separated collection class patterns")
  .option("--no-content", "Skip generating initial CMS content")
  .option("--no-editor", "Skip installing and wiring the inline editor")
  .option("--scaffold-strapi <dir>", "Scaffold a new Strapi project after conversion")
  .option("--strapi-dir <dir>", "Existing Strapi project to set up after conversion")
  .option("--strapi-package-manager <manager>", "Package manager for new Strapi project (npm|pnpm|yarn)", "npm")
  .option("--no-strapi-install", "Scaffold Strapi without installing dependencies")
  .action(async (input, output, options) => {
    try {
      console.log("");
      console.log(pc.cyan(pc.bold("🚀 SeeMS Converter")));
      console.log(pc.dim(`   Converting: ${input} → ${output}`));
      console.log("");

      const skipPrompts = options.skipPrompts || false;
      const loadedConfig = options.config ? await loadSeeMSConfig(options.config) : {};
      let collections: CollectionConfig[] = (loadedConfig.collections || []).map(collection => ({
        className: collection.className,
        collectionName: collection.name || classToCollectionName(collection.className)
      }));
      let generateContent = true;
      let enableEditor = options.editor !== false && loadedConfig.editor?.enabled !== false;

      // Prompt for collections (unless skipped or provided via CLI)
      if (!skipPrompts) {
        if (options.collectionClasses) {
          // Parse CLI option
          const classes = options.collectionClasses.split(",").map((c: string) => c.trim());
          collections = classes.map((className: string) => ({
            className,
            collectionName: classToCollectionName(className)
          }));
        } else if (collections.length === 0) {
          collections = await promptForCollections();
        } else {
          console.log(pc.dim(`Using ${collections.length} collection hint(s) from config.`));
        }

        // Prompt for content generation
        console.log("");
        const previewConfig = normalizeConfig(mergeConfig(loadedConfig, {
          collections: collections.map(collection => ({
            className: collection.className,
            name: collection.collectionName
          }))
        }));
        const analysis = await analyzeWebflowExport(input, previewConfig);
        console.log(pc.cyan("🔎 Analysis Preview"));
        console.log(pc.dim(`  • Pages: ${analysis.pages.length}`));
        analysis.pages.slice(0, 8).forEach(page => {
          console.log(pc.dim(`    - ${page.sourcePath} → ${page.route}`));
        });
        if (analysis.pages.length > 8) {
          console.log(pc.dim(`    … ${analysis.pages.length - 8} more`));
        }
        console.log(pc.dim(`  • Component candidates: ${analysis.componentCandidates.length}`));
        analysis.componentCandidates.slice(0, 8).forEach(component => {
          console.log(pc.dim(`    - ${component.name} (${component.confidence}) on ${component.pages.length} pages`));
        });

        generateContent = await confirm(
          pc.white("Generate initial CMS content from HTML?")
        );
        enableEditor = await confirm(
          pc.white("Install and wire the inline editor overlay?"),
          true
        );
      } else if (options.collectionClasses) {
        const classes = options.collectionClasses.split(",").map((c: string) => c.trim());
        collections = classes.map((className: string) => ({
          className,
          collectionName: classToCollectionName(className)
        }));
      }

      // Show configuration
      console.log("");
      console.log(pc.green("✓ Configuration:"));
      if (collections.length > 0) {
        console.log(pc.dim(`  • Collections: ${collections.map(c => `${c.className} → ${c.collectionName}`).join(", ")}`));
      } else {
        console.log(pc.dim("  • Collections: none (auto-detect disabled)"));
      }
      console.log(pc.dim(`  • Generate content: ${generateContent}`));
      console.log(pc.dim(`  • Inline editor: ${enableEditor ? "enabled" : "disabled"}`));
      console.log("");

      // Run conversion
      console.log(pc.blue("📦 Running conversion..."));
      console.log("");

      const cliConfig: SeeMSConfig = {
        cms: { provider: options.cms },
        collections: collections.map(collection => ({
          className: collection.className,
          name: collection.collectionName
        })),
        editor: {
          enabled: enableEditor,
          previewParam: "preview"
        }
      };

      await convertWebflowExport({
        inputDir: input,
        outputDir: output,
        boilerplate: options.boilerplate,
        overridesPath: options.overrides,
        configPath: options.config,
        config: mergeConfig(loadedConfig, cliConfig),
        generateStrapi: true,
        cmsBackend: options.cms,
        collectionClasses: collections.map(c => c.className),
        collectionNames: Object.fromEntries(collections.map(c => [c.className, c.collectionName])),
        extractComponents: true,
        skipPrompts: true,
        generateContent: generateContent && !options.noContent,
        editor: enableEditor,
      });

      console.log(pc.green("\n🎉 Conversion complete!"));

      const configStrapi = loadedConfig.cms?.strapi;
      const requestedStrapiDir = options.scaffoldStrapi || options.strapiDir || configStrapi?.directory;
      const shouldScaffoldFromConfig = Boolean(configStrapi?.scaffold && requestedStrapiDir);
      if (options.cms === "strapi" && skipPrompts && requestedStrapiDir) {
        await completeSetup({
          projectDir: output,
          strapiDir: requestedStrapiDir,
          scaffold: Boolean(options.scaffoldStrapi) || shouldScaffoldFromConfig,
          scaffoldOptions: {
            strapiDir: requestedStrapiDir,
            packageManager: toPackageManager(options.strapiPackageManager || configStrapi?.packageManager || "npm"),
            install: options.strapiInstall !== false && configStrapi?.install !== false,
            run: false,
            gitInit: false,
            typescript: true
          }
        });
      }

      // Optional Strapi server setup
      if (options.cms === "strapi" && !skipPrompts) {
        console.log("");
        const shouldSetup = await confirm(
          pc.cyan("🎯 Would you like to set up Strapi now?"),
          false
        );

        if (shouldSetup) {
          const strapiDir = await prompt(
            pc.cyan("📁 Enter path to your Strapi directory: ")
          );

          if (strapiDir) {
            const strapiExists = await fs.pathExists(strapiDir);
            const shouldScaffold = !strapiExists
              ? await confirm(
                pc.cyan("That Strapi directory does not exist. Scaffold a new Strapi project there?"),
                true
              )
              : false;

            console.log(pc.cyan("\n🚀 Starting Strapi setup..."));

            try {
              await completeSetup({
                projectDir: output,
                strapiDir: strapiDir,
                scaffold: shouldScaffold,
                scaffoldOptions: {
                  strapiDir,
                  packageManager: toPackageManager(options.strapiPackageManager || configStrapi?.packageManager || "npm"),
                  install: options.strapiInstall !== false && configStrapi?.install !== false,
                  run: false,
                  gitInit: false,
                  typescript: true
                }
              });
            } catch (error) {
              console.error(pc.red("\n❌ Strapi setup failed"));
              console.error(pc.dim("You can run setup manually later with:"));
              console.error(pc.dim(`  cms setup-strapi ${output} ${strapiDir}`));
            }
          }
        } else {
          console.log(pc.dim("\n💡 You can setup Strapi later with:"));
          console.log(pc.dim(`   cms setup-strapi ${output} <strapi-directory>`));
        }
      }
    } catch (error) {
      console.error(pc.red("\nConversion failed:"));
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Analyze a Webflow export and preview pages, assets, and component candidates")
  .argument("<input>", "Path to Webflow export directory")
  .option("--config <path>", "Path to see-ms config file")
  .action(async (input, options) => {
    try {
      const config = options.config ? await loadSeeMSConfig(options.config) : {};
      const analysis = await analyzeWebflowExport(input, normalizeConfig(config));
      const report: ConversionReport = {
        generatedAt: new Date().toISOString(),
        stages: ["scan", "analyze", "plan"],
        pages: analysis.pages.map(page => ({
          source: page.sourcePath,
          pageId: page.pageId,
          route: page.route,
          output: page.outputPath
        })),
        assets: {
          css: analysis.assets.css.length,
          images: analysis.assets.images.length,
          fonts: analysis.assets.fonts.length,
          js: analysis.assets.js.length,
          preservedStructure: true
        },
        components: analysis.componentCandidates,
        cms: {
          provider: config.cms?.provider || "strapi",
          fields: 0,
          collections: 0,
          schemas: 0,
          seedPages: 0
        },
        warnings: analysis.warnings
      };
      console.log(renderReportMarkdown(report));
    } catch (error) {
      console.error(pc.red("\nAnalysis failed:"));
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program
  .command("scaffold-strapi")
  .description("Scaffold a new Strapi project for a converted SeeMS site")
  .argument("<strapi-dir>", "Path where the new Strapi project should be created")
  .option("--package-manager <manager>", "Package manager (npm|pnpm|yarn)", "npm")
  .option("--no-install", "Create project files without installing dependencies")
  .option("--run", "Start Strapi after scaffolding")
  .option("--git-init", "Initialize a git repository for the Strapi project")
  .option("--javascript", "Use JavaScript instead of TypeScript")
  .action(async (strapiDir, options) => {
    try {
      await scaffoldStrapiProject({
        strapiDir,
        packageManager: toPackageManager(options.packageManager),
        install: options.install !== false,
        run: Boolean(options.run),
        gitInit: Boolean(options.gitInit),
        typescript: !options.javascript
      });
    } catch (error) {
      console.error(pc.red("Strapi scaffold failed"));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command("setup-strapi")
  .description("Setup Strapi with schemas and seed data")
  .argument("<project-dir>", "Path to converted project directory")
  .argument("<strapi-dir>", "Path to Strapi directory")
  .option("--url <url>", "Strapi URL", "http://localhost:1337")
  .option("--token <token>", "Strapi API token (optional)")
  .option("--new-token", "Ignore saved token and prompt for a new one")
  .option("--scaffold", "Create the Strapi project if the target directory does not exist")
  .option("--package-manager <manager>", "Package manager for scaffolding (npm|pnpm|yarn)", "npm")
  .option("--no-install", "Scaffold without installing dependencies")
  .action(async (projectDir, strapiDir, options) => {
    try {
      await completeSetup({
        projectDir,
        strapiDir,
        strapiUrl: options.url,
        apiToken: options.token,
        ignoreSavedToken: options.newToken,
        scaffold: Boolean(options.scaffold),
        scaffoldOptions: {
          strapiDir,
          packageManager: toPackageManager(options.packageManager),
          install: options.install !== false,
          run: false,
          gitInit: false,
          typescript: true
        }
      });
    } catch (error) {
      console.error(pc.red("Strapi setup failed"));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command("generate")
  .description("Generate CMS schemas from manifest")
  .argument("<manifest>", "Path to cms-manifest.json")
  .option("-t, --type <cms>", "CMS type (strapi|contentful|sanity)", "strapi")
  .option("-o, --output <dir>", "Output directory for schemas")
  .action(async (manifestPath, options) => {
    try {
      console.log(pc.cyan("🗂️  SeeMS Schema Generator"));
      console.log(pc.dim(`Reading manifest from: ${manifestPath}`));

      const manifestExists = await fs.pathExists(manifestPath);
      if (!manifestExists) {
        throw new Error(`Manifest file not found: ${manifestPath}`);
      }

      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest: CMSManifest = JSON.parse(manifestContent);

      console.log(pc.green(`  ✓ Manifest loaded successfully`));

      const outputDir = options.output || path.dirname(manifestPath);

      if (options.type !== "strapi") {
        console.log(
          pc.yellow(
            `⚠️  Only Strapi is currently supported. Using Strapi schema format.`
          )
        );
      }

      console.log(pc.blue("\n📋 Generating Strapi schemas..."));
      const schemas = manifestToSchemas(manifest);
      await writeAllSchemas(outputDir, schemas);

      // Write link component if needed
      const linkSchema = getLinkComponentSchema(manifest);
      if (linkSchema) {
        await writeLinkComponentSchema(outputDir);
        console.log(pc.dim("  ✓ Generated shared.link component"));
      }

      await createStrapiReadme(outputDir);

      console.log(
        pc.green(
          `  ✓ Generated ${Object.keys(schemas).length} Strapi content types`
        )
      );
      console.log(pc.dim(`  ✓ Schemas written to: ${path.join(outputDir, "cms-schemas")}/`));

      console.log(pc.green("\n✅ Schema generation completed successfully!"));
    } catch (error) {
      console.error(pc.red("\n❌ Schema generation failed:"));
      console.error(
        pc.red(error instanceof Error ? error.message : String(error))
      );
      process.exit(1);
    }
  });

program.parse();

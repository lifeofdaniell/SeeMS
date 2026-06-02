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
import { fileURLToPath } from "url";
import { convertWebflowExport } from "./converter";
import { completeSetup, scaffoldStrapiProject } from "./strapi-setup";
import { manifestToSchemas, getLinkComponentSchema } from "./transformer";
import { writeAllSchemas, writeAllComponentSchemas, createStrapiReadme, writeLinkComponentSchema } from "./schema-writer";
import { analyzeWebflowExport, renderReportMarkdown } from "./analyzer";
import { loadSeeMSConfig, mergeConfig, normalizeConfig } from "./config";
import { loadConversionState } from "./conversion-state";
import { runExtractCollections, runExtractComponent } from "./extract";
import type { CMSManifest, ConversionReport, SeeMSConfig } from "@see-ms/types";
import type { ProjectTarget } from "./boilerplate";

const program = new Command();
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = fs.readJsonSync(path.join(packageDir, "package.json")).version;

/**
 * Collection class with its display name
 */
interface CollectionConfig {
  className: string;
  collectionName: string;
  children?: Array<{ fieldName: string; selector: string }>;
}

interface ComponentRuleConfig {
  name: string;
  selector: string;
  role?: "shared-section" | "collection-item";
  collectionName?: string;
  collectionStorage?: "collection-type" | "page-repeatable" | "global-repeatable";
  contentMode?: "shared-global" | "per-page" | "auto";
  minOccurrences?: number;
  minPages?: number;
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
  name = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();

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

async function select(question: string, choices: Array<{ label: string; value: string }>, defaultValue: string): Promise<string> {
  console.log(question);
  choices.forEach((choice, index) => {
    const marker = choice.value === defaultValue ? " default" : "";
    console.log(pc.dim(`  ${index + 1}. ${choice.label}${marker}`));
  });
  const answer = await prompt(pc.cyan("   > "));
  if (!answer) return defaultValue;
  const index = Number(answer) - 1;
  if (Number.isInteger(index) && choices[index]) return choices[index].value;
  const direct = choices.find(choice => choice.value === answer || choice.label.toLowerCase() === answer.toLowerCase());
  return direct?.value || defaultValue;
}

function toProjectTarget(value: string | undefined): ProjectTarget {
  return value === "astro-vue" || value === "astro" ? "astro-vue" : "nuxt";
}

/**
 * Prompt for collection classes and their names
 */
async function promptForCollections(skipConfirm = false): Promise<CollectionConfig[]> {
  if (!skipConfirm) {
    const hasCollections = await confirm(pc.cyan("Configure collection types (blog posts, team members, FAQs, etc.)?"), true);
    if (!hasCollections) return [];
  }

  console.log("");
  console.log(pc.dim("   Enter the CSS class names of repeating items that should become Strapi collections."));
  console.log("");

  const classesInput = await prompt(
    pc.white("Collection element classes (comma-separated):\n") +
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
    const collectionName = nameInput || suggestedName;

    // Ask whether this collection has nested repeating children
    const hasChildren = await confirm(
      pc.white(`   Does each "${collectionName}" item contain nested repeating items?`),
      false
    );

    let children: Array<{ fieldName: string; selector: string }> | undefined;
    if (hasChildren) {
      const fieldName = await prompt(
        pc.white(`     Child items field name `) + pc.dim(`(e.g. "items", "faqs"): `)
      );
      const selector = await prompt(
        pc.white(`     Child items CSS selector `) + pc.dim(`(e.g. ".faq-item", ".slide"): `)
      );
      if (fieldName && selector) {
        children = [{ fieldName: fieldName.trim(), selector: selector.trim() }];
        console.log(pc.dim(`     → ${collectionName}[].${fieldName} (selector: ${selector})`));
      }
    }

    collections.push({ className, collectionName, children });
  }

  return collections;
}

async function promptForComponentRules(existing: ComponentRuleConfig[] = []): Promise<ComponentRuleConfig[]> {
  console.log("");
  console.log(pc.cyan("🧩 Component Rules"));
  console.log(pc.dim("   Add named selectors for reusable blocks you definitely want componentized."));
  console.log(pc.dim("   Example: AnnouncementBar = .quantum-zenith-design-system--c-announcement"));
  console.log("");

  const rules = [...existing];
  if (rules.length > 0) {
    console.log(pc.dim(`Using ${rules.length} existing component rule(s) from config.`));
  }

  const addRules = await confirm(pc.white("Add a component rule by name and selector?"), false);
  if (!addRules) return rules;

  while (true) {
    const name = await prompt(pc.cyan("   Component name: "));
    if (!name) break;

    const selector = await prompt(pc.cyan("   CSS selector: "));
    if (!selector) break;

    const minPagesInput = await prompt(pc.cyan("   Minimum pages (2): "));
    const minPages = Number(minPagesInput) || 2;

    const role = await select(pc.cyan("   What kind of component is this?"), [
      { label: "Shared section/block", value: "shared-section" },
      { label: "Repeated item rendered with v-for", value: "collection-item" },
    ], "shared-section") as "shared-section" | "collection-item";

    let collectionName: string | undefined;
    let collectionStorage: "collection-type" | "page-repeatable" | "global-repeatable" | undefined;
    if (role === "collection-item") {
      const suggestedCollection = classToCollectionName(name);
      const collectionInput = await prompt(
        pc.cyan(`   Collection name (${suggestedCollection}): `)
      );
      collectionName = collectionInput || suggestedCollection;
      collectionStorage = await select(pc.cyan("   How should these repeated items be stored?"), [
        { label: "Strapi collection type", value: "collection-type" },
        { label: "Page repeatable field (coming next)", value: "page-repeatable" },
        { label: "Global repeatable field (coming next)", value: "global-repeatable" },
      ], "collection-type") as "collection-type" | "page-repeatable" | "global-repeatable";
      if (collectionStorage !== "collection-type") {
        console.log(pc.yellow("   Repeatable fields are not fully wired yet; using Strapi collection type for this run."));
        collectionStorage = "collection-type";
      }
    }

    const contentMode = await select(pc.cyan("   How should this component's editable content be stored?"), [
      { label: "Auto/default: shared global for now", value: "auto" },
      { label: "Shared global content, same everywhere", value: "shared-global" },
      { label: "Per-page instances, same structure with different content", value: "per-page" },
    ], "auto") as "shared-global" | "per-page" | "auto";

    rules.push({
      name,
      selector,
      role,
      collectionName,
      collectionStorage,
      contentMode,
      minOccurrences: minPages,
      minPages
    });

    const another = await confirm(pc.white("   Add another component rule?"), false);
    if (!another) break;
  }

  return rules;
}

program
  .name("cms")
  .description("SeeMS - Webflow to CMS converter")
  .version(packageVersion);

program
  .command("convert")
  .description("Convert Webflow export to a framework project with CMS integration")
  .argument("[input]", "Path to Webflow export directory")
  .argument("[output]", "Path to output project directory")
  .option("--target <target>", "Output target (nuxt|astro-vue)")
  .option(
    "-b, --boilerplate <source>",
    "Boilerplate source (GitHub URL or local path)"
  )
  .option("-o, --overrides <path>", "Path to overrides JSON file")
  .option("--config <path>", "Path to see-ms config file")
  .option(
    "--cms <type>",
    "CMS backend type (strapi|contentful|sanity)"
  )
  .option("--skip-prompts", "Skip interactive prompts (for CI/CD)")
  .option("--no-extract", "Skip component extraction — convert HTML as-is without detecting shared components")
  .option("--collection-classes <classes>", "Comma-separated collection class patterns")
  .option("--no-content", "Skip generating initial CMS content")
  .option("--no-editor", "Skip installing and wiring the inline editor")
  .option("--scaffold-strapi <dir>", "Scaffold a new Strapi project after conversion")
  .option("--strapi-dir <dir>", "Existing Strapi project to set up after conversion")
  .option("--strapi-package-manager <manager>", "Package manager for new Strapi project (npm|pnpm|yarn)", "npm")
  .option("--no-strapi-install", "Scaffold Strapi without installing dependencies")
  .action(async (input, output, options) => {
    try {
      const skipPrompts = options.skipPrompts || false;
      if (!input) {
        if (skipPrompts) throw new Error("Input path is required when --skip-prompts is used");
        input = await prompt(pc.cyan("📁 Webflow export directory: "));
      }
      if (!output) {
        if (skipPrompts) throw new Error("Output project directory is required when --skip-prompts is used");
        const defaultOutput = path.resolve(process.cwd(), `${path.basename(path.resolve(input))}-seems`);
        const answer = await prompt(pc.cyan(`📁 Output project directory (${defaultOutput}): `));
        output = answer || defaultOutput;
      }

      console.log("");
      console.log(pc.cyan(pc.bold("🚀 SeeMS Converter")));
      console.log(pc.dim(`   Converting: ${input} → ${output}`));
      console.log("");

      const loadedConfig = options.config ? await loadSeeMSConfig(options.config) : {};
      let collections: CollectionConfig[] = (loadedConfig.collections || []).map((collection: NonNullable<SeeMSConfig["collections"]>[number]) => ({
        className: collection.className,
        collectionName: collection.name || classToCollectionName(collection.className)
      }));
      let generateContent = true;
      let enableEditor = options.editor !== false && loadedConfig.editor?.enabled !== false;
      let target = toProjectTarget(options.target || loadedConfig.target);
      let cmsProvider = options.cms || loadedConfig.cms?.provider || "strapi";
      let detectComponents = options.extract !== false && loadedConfig.components?.enabled !== false;
      let componentMatch = loadedConfig.components?.match || "structure";
      let componentMinOccurrences = loadedConfig.components?.minOccurrences || 2;
      let componentMinPages = loadedConfig.components?.minPages || componentMinOccurrences;
      let componentRules: ComponentRuleConfig[] = loadedConfig.components?.rules || [];

      // Prompt for collections (unless skipped or provided via CLI)
      if (!skipPrompts) {
        target = toProjectTarget(await select(pc.cyan("🎯 What are you converting to?"), [
          { label: "Nuxt 3", value: "nuxt" },
          { label: "Astro + Vue", value: "astro-vue" }
        ], target));

        cmsProvider = await select(pc.cyan("🧠 Which CMS provider?"), [
          { label: "Strapi", value: "strapi" }
        ], cmsProvider);

        if (options.extract !== false) {
          detectComponents = await confirm(pc.cyan("Extract shared components from repeated sections?"), detectComponents);
          if (detectComponents) {
            componentMatch = await select(pc.cyan("🧩 How strict should component matching be?"), [
              { label: "Exact repeated HTML blocks", value: "exact" },
              { label: "Matching DOM structure", value: "structure" }
            ], componentMatch) as "exact" | "structure";
            componentMinOccurrences = Number(await prompt(pc.cyan(`Minimum total occurrences (${componentMinOccurrences}): `))) || componentMinOccurrences;
            componentMinPages = Number(await prompt(pc.cyan(`Minimum pages (${componentMinPages}): `))) || componentMinPages;
            componentRules = await promptForComponentRules(componentRules);
          }
        }

        if (options.collectionClasses) {
          // Parse CLI option
          const classes = options.collectionClasses.split(",").map((c: string) => c.trim());
          collections = classes.map((className: string) => ({
            className,
            collectionName: classToCollectionName(className)
          }));
        } else if (collections.length === 0 && options.extract !== false) {
          collections = await promptForCollections();
        } else if (collections.length > 0) {
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
          pc.white("Extract seed data now? (skip if you plan to run 'extract collections' next — it regenerates this)")
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
      console.log(pc.dim(`  • Target: ${target === "astro-vue" ? "Astro + Vue" : "Nuxt 3"}`));
      console.log(pc.dim(`  • CMS: ${cmsProvider}`));
      console.log(pc.dim(`  • Component matching: ${componentMatch}, ${componentMinOccurrences}+ occurrences on ${componentMinPages}+ pages`));
      if (componentRules.length > 0) {
        console.log(pc.dim(`  • Component rules: ${componentRules.map(rule => {
          const role = rule.role || "shared-section";
          const contentMode = rule.contentMode || "auto";
          const collection = rule.role === "collection-item" && rule.collectionName
            ? `, collection: ${rule.collectionName}`
            : "";
          return `${rule.name} (${rule.selector}, ${role}, ${contentMode}${collection})`;
        }).join(", ")}`));
      }
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
        target,
        cms: { provider: cmsProvider as "strapi" },
        collections: collections.map(collection => ({
          className: collection.className,
          name: collection.collectionName
        })),
        editor: {
          enabled: enableEditor,
          previewParam: "preview"
        },
        components: {
          ...loadedConfig.components,
          enabled: detectComponents,
          match: componentMatch as "exact" | "structure",
          minOccurrences: componentMinOccurrences,
          minPages: componentMinPages,
          rules: componentRules
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
        cmsBackend: cmsProvider as "strapi",
        target,
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
      if (cmsProvider === "strapi" && skipPrompts && requestedStrapiDir) {
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
      if (cmsProvider === "strapi" && !skipPrompts) {
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
  .argument("[input]", "Path to Webflow export directory")
  .option("--config <path>", "Path to see-ms config file")
  .action(async (input, options) => {
    try {
      if (!input) {
        input = await prompt(pc.cyan("📁 Webflow export directory to analyze: "));
      }
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
  .argument("[strapi-dir]", "Path where the new Strapi project should be created")
  .option("--package-manager <manager>", "Package manager (npm|pnpm|yarn)", "npm")
  .option("--no-install", "Create project files without installing dependencies")
  .option("--run", "Start Strapi after scaffolding")
  .option("--git-init", "Initialize a git repository for the Strapi project")
  .option("--javascript", "Use JavaScript instead of TypeScript")
  .action(async (strapiDir, options) => {
    try {
      if (!strapiDir) {
        strapiDir = await prompt(pc.cyan("📁 New Strapi project directory: "));
      }
      const install = options.install !== false && await confirm(
        pc.cyan("Install Strapi dependencies after scaffolding?"),
        true
      );
      await scaffoldStrapiProject({
        strapiDir,
        packageManager: toPackageManager(options.packageManager),
        install,
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
  .argument("[project-dir]", "Path to converted project directory")
  .argument("[strapi-dir]", "Path to Strapi directory")
  .option("--url <url>", "Strapi URL", "http://localhost:1337")
  .option("--token <token>", "Strapi API token (optional)")
  .option("--new-token", "Ignore saved token and prompt for a new one")
  .option("--scaffold", "Create the Strapi project if the target directory does not exist")
  .option("--package-manager <manager>", "Package manager for scaffolding (npm|pnpm|yarn)", "npm")
  .option("--no-install", "Scaffold without installing dependencies")
  .action(async (projectDir, strapiDir, options) => {
    try {
      if (!projectDir) {
        projectDir = await prompt(pc.cyan("📁 Converted project directory: "));
      }
      if (!strapiDir) {
        strapiDir = await prompt(pc.cyan("📁 Strapi directory: "));
      }
      const strapiExists = strapiDir ? await fs.pathExists(strapiDir) : false;
      const scaffold = Boolean(options.scaffold) || (!strapiExists && await confirm(
        pc.cyan("That Strapi directory does not exist. Scaffold it now?"),
        true
      ));
      const install = options.install !== false && (!scaffold || await confirm(
        pc.cyan("Install Strapi dependencies after scaffolding?"),
        true
      ));

      await completeSetup({
        projectDir,
        strapiDir,
        strapiUrl: options.url,
        apiToken: options.token,
        ignoreSavedToken: options.newToken,
        scaffold,
        scaffoldOptions: {
          strapiDir,
          packageManager: toPackageManager(options.packageManager),
          install,
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
  .argument("[manifest]", "Path to cms-manifest.json")
  .option("-t, --type <cms>", "CMS type (strapi|contentful|sanity)", "strapi")
  .option("-o, --output <dir>", "Output directory for schemas")
  .action(async (manifestPath, options) => {
    try {
      if (!manifestPath) {
        manifestPath = await prompt(pc.cyan("📄 Path to cms-manifest.json: "));
      }
      console.log(pc.cyan("🗂️  SeeMS Schema Generator"));
      console.log(pc.dim(`Reading manifest from: ${manifestPath}`));

      const manifestExists = await fs.pathExists(manifestPath);
      if (!manifestExists) {
        throw new Error(`Manifest file not found: ${manifestPath}`);
      }

      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest: CMSManifest = JSON.parse(manifestContent);

      console.log(pc.green(`  ✓ Manifest loaded successfully`));

      const type = options.type || await select(pc.cyan("🧠 Generate schemas for which CMS?"), [
        { label: "Strapi", value: "strapi" }
      ], "strapi");
      let outputDir = options.output;
      if (!outputDir) {
        const defaultOutput = path.dirname(manifestPath);
        const answer = await prompt(pc.cyan(`📁 Schema output directory (${defaultOutput}): `));
        outputDir = answer || defaultOutput;
      }

      if (type !== "strapi") {
        console.log(
          pc.yellow(
            `⚠️  Only Strapi is currently supported. Using Strapi schema format.`
          )
        );
      }

      console.log(pc.blue("\n📋 Generating Strapi schemas..."));
      const { contentTypes, componentSchemas } = manifestToSchemas(manifest);
      await writeAllSchemas(outputDir, contentTypes);
      await writeAllComponentSchemas(outputDir, componentSchemas);

      // Write link component if needed
      const linkSchema = getLinkComponentSchema(manifest);
      if (linkSchema) {
        await writeLinkComponentSchema(outputDir);
        console.log(pc.dim("  ✓ Generated shared.link component"));
      }

      await createStrapiReadme(outputDir);

      console.log(
        pc.green(
          `  ✓ Generated ${Object.keys(contentTypes).length} Strapi content types`
        )
      );
      console.log(pc.dim(`  ✓ Schemas written to: ${path.join(outputDir, ".see-ms", "schemas")}/`));

      console.log(pc.green("\n✅ Schema generation completed successfully!"));
    } catch (error) {
      console.error(pc.red("\n❌ Schema generation failed:"));
      console.error(
        pc.red(error instanceof Error ? error.message : String(error))
      );
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// extract namespace
// ---------------------------------------------------------------------------

const extract = program
  .command("extract")
  .description("Extract components or collections from an already-converted project");

extract
  .command("collections [project-dir]")
  .description("Add a collection type — prompts for CSS class and Strapi name, then regenerates manifest, schemas, seed and pages")
  .action(async (projectDir) => {
    try {
      if (!projectDir) {
        projectDir = await prompt(pc.cyan("📁 Converted project directory: "));
      }
      if (!projectDir) throw new Error("Project directory is required");

      const resolvedDir = path.resolve(projectDir);

      const state = await loadConversionState(resolvedDir);
      if (!state) {
        throw new Error(`No conversion state in "${resolvedDir}". Run 'cms convert' first.`);
      }

      console.log("");
      console.log(pc.cyan(pc.bold("📦 SeeMS — Extract Collections")));
      console.log(pc.dim(`   Project: ${resolvedDir}`));
      console.log(pc.dim(`   Source:  ${state.inputDir}`));
      console.log("");

      // Build map from existing state so we can merge new entries in
      const mergedMap = new Map<string, CollectionConfig>(
        state.collections.map(c => [c.className, { className: c.className, collectionName: c.name, children: c.children }])
      );

      // Show what's already been set up
      if (mergedMap.size > 0) {
        console.log(pc.dim("Already configured:"));
        for (const c of mergedMap.values()) {
          const childInfo = c.children?.length
            ? pc.dim(` [children: ${c.children.map(ch => `${ch.fieldName} (${ch.selector})`).join(', ')}]`)
            : '';
          console.log(pc.dim(`  • .${c.className} → ${c.collectionName}${childInfo}`));
        }
        console.log("");
      }

      // Add new collections one at a time
      console.log(pc.white("Add a new collection (press Enter with no class to finish):"));
      console.log(pc.dim("  This is the CSS class of the repeating element, e.g. 'c-blogpost', 'team-member_card'"));
      console.log("");

      while (true) {
        const className = await prompt(pc.cyan("  CSS class (or Enter to finish): "));
        if (!className.trim()) break;

        const suggestedName = classToCollectionName(className.trim());
        const nameInput = await prompt(
          pc.white(`  Collection name in Strapi `) + pc.dim(`(default: ${suggestedName}): `)
        );
        const collectionName = nameInput.trim() || suggestedName;

        const hasChildren = await confirm(
          pc.white(`  Does each "${collectionName}" item contain nested repeating items?`),
          false
        );

        let children: Array<{ fieldName: string; selector: string }> | undefined;
        if (hasChildren) {
          const fieldName = await prompt(pc.white(`    Child field name `) + pc.dim(`(e.g. "items", "faqs"): `));
          const selector = await prompt(pc.white(`    Child CSS selector `) + pc.dim(`(e.g. ".faq-item"): `));
          if (fieldName.trim() && selector.trim()) {
            children = [{ fieldName: fieldName.trim(), selector: selector.trim() }];
          }
        }

        mergedMap.set(className.trim(), { className: className.trim(), collectionName, children });
        console.log(pc.green(`  ✓ Added: .${className.trim()} → ${collectionName}${children ? ` (children: ${children[0].fieldName})` : ''}`));
        console.log("");
      }

      const collections = Array.from(mergedMap.values());

      if (collections.length === 0) {
        console.log(pc.yellow("No collections configured — nothing to do."));
        return;
      }

      console.log("");
      console.log(pc.cyan("Collections to apply:"));
      for (const c of collections) {
        const childInfo = c.children?.length ? pc.dim(` [+ ${c.children[0].fieldName} children]`) : '';
        console.log(pc.dim(`  • .${c.className} → ${c.collectionName}${childInfo}`));
      }
      console.log("");

      await runExtractCollections(resolvedDir, { collections });

      console.log(pc.green("\n✅ Done"));
    } catch (error) {
      console.error(pc.red("\n❌ Extract collections failed:"));
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

extract
  .command("components [project-dir]")
  .description("Extract a single component from the original HTML by CSS selector")
  .action(async (projectDir) => {
    try {
      if (!projectDir) {
        projectDir = await prompt(pc.cyan("📁 Converted project directory: "));
      }
      if (!projectDir) throw new Error("Project directory is required");

      const resolvedDir = path.resolve(projectDir);

      const state = await loadConversionState(resolvedDir);
      if (!state) {
        throw new Error(`No conversion state in "${resolvedDir}". Run 'cms convert' first.`);
      }

      console.log("");
      console.log(pc.cyan(pc.bold("🧩 SeeMS — Extract Component")));
      console.log(pc.dim(`   Project: ${resolvedDir}`));
      console.log(pc.dim(`   Source:  ${state.inputDir}`));
      console.log("");

      let name = await prompt(pc.cyan("Component name (e.g. tabs, hero-section): "));
      let selector = await prompt(pc.cyan("CSS selector for the root element (e.g. .w-tabs): "));
      const role = await select(pc.cyan("What kind of component?"), [
        { label: "Shared section — one instance per page (nav, footer, hero)", value: "shared-section" },
        { label: "Collection item — repeats within a page (cards, tabs)", value: "collection-item" },
      ], "shared-section") as "shared-section" | "collection-item";

      let collectionName: string | undefined;
      if (role === "collection-item") {
        const suggested = classToCollectionName(name);
        const ans = await prompt(pc.cyan(`Collection name (default: ${suggested}): `));
        collectionName = ans || suggested;
      }

      if (!name) throw new Error("Component name is required");
      if (!selector) throw new Error("CSS selector is required");

      console.log("");
      console.log(pc.green("✓ Extracting:"));
      console.log(pc.dim(`  • Name:     ${name}`));
      console.log(pc.dim(`  • Selector: ${selector}`));
      console.log(pc.dim(`  • Role:     ${role}`));
      if (collectionName) console.log(pc.dim(`  • Collection: ${collectionName}`));
      console.log("");
      console.log(pc.yellow("  ⚠  Page files will be overwritten with versions that use the component tag."));
      console.log("");

      await runExtractComponent(resolvedDir, {
        name,
        selector,
        role,
        collectionName,
      });

      console.log(pc.green("\n✅ Done"));
    } catch (error) {
      console.error(pc.red("\n❌ Extract component failed:"));
      console.error(pc.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();

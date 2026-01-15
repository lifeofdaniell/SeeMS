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
import { completeSetup } from "./strapi-setup";
import { manifestToSchemas, getLinkComponentSchema } from "./transformer";
import { writeAllSchemas, createStrapiReadme, writeLinkComponentSchema } from "./schema-writer";
import type { CMSManifest } from "@see-ms/types";

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
  .option(
    "--cms <type>",
    "CMS backend type (strapi|contentful|sanity)",
    "strapi"
  )
  .option("--skip-prompts", "Skip interactive prompts (for CI/CD)")
  .option("--collection-classes <classes>", "Comma-separated collection class patterns")
  .option("--no-content", "Skip generating initial CMS content")
  .action(async (input, output, options) => {
    try {
      console.log("");
      console.log(pc.cyan(pc.bold("🚀 SeeMS Converter")));
      console.log(pc.dim(`   Converting: ${input} → ${output}`));
      console.log("");

      const skipPrompts = options.skipPrompts || false;
      let collections: CollectionConfig[] = [];
      let generateContent = true;

      // Prompt for collections (unless skipped or provided via CLI)
      if (!skipPrompts) {
        if (options.collectionClasses) {
          // Parse CLI option
          const classes = options.collectionClasses.split(",").map((c: string) => c.trim());
          collections = classes.map((className: string) => ({
            className,
            collectionName: classToCollectionName(className)
          }));
        } else {
          collections = await promptForCollections();
        }

        // Prompt for content generation
        console.log("");
        generateContent = await confirm(
          pc.white("Generate initial CMS content from HTML?")
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
      console.log("");

      // Run conversion
      console.log(pc.blue("📦 Running conversion..."));
      console.log("");

      await convertWebflowExport({
        inputDir: input,
        outputDir: output,
        boilerplate: options.boilerplate,
        overridesPath: options.overrides,
        generateStrapi: true,
        cmsBackend: options.cms,
        collectionClasses: collections.map(c => c.className),
        collectionNames: Object.fromEntries(collections.map(c => [c.className, c.collectionName])),
        extractComponents: true,
        skipPrompts: true,
        generateContent: generateContent && !options.noContent,
      });

      console.log(pc.green("\n🎉 Conversion complete!"));

      // Optional Strapi server setup
      if (options.cms === "strapi" && !skipPrompts) {
        console.log("");
        const shouldSetup = await confirm(
          pc.cyan("🎯 Would you like to setup Strapi server now?"),
          false
        );

        if (shouldSetup) {
          const strapiDir = await prompt(
            pc.cyan("📁 Enter path to your Strapi directory: ")
          );

          if (strapiDir) {
            console.log(pc.cyan("\n🚀 Starting Strapi setup..."));

            try {
              await completeSetup({
                projectDir: output,
                strapiDir: strapiDir
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
  .command("setup-strapi")
  .description("Setup Strapi with schemas and seed data")
  .argument("<project-dir>", "Path to converted project directory")
  .argument("<strapi-dir>", "Path to Strapi directory")
  .option("--url <url>", "Strapi URL", "http://localhost:1337")
  .option("--token <token>", "Strapi API token (optional)")
  .option("--new-token", "Ignore saved token and prompt for a new one")
  .action(async (projectDir, strapiDir, options) => {
    try {
      await completeSetup({
        projectDir,
        strapiDir,
        strapiUrl: options.url,
        apiToken: options.token,
        ignoreSavedToken: options.newToken
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

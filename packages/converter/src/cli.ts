#!/usr/bin/env node

/**
 * CLI for @see-ms/converter
 * Usage: cms convert <input-dir> <output-dir> [options]
 */

import { Command } from "commander";
import pc from "picocolors";
import * as readline from "readline";
import { convertWebflowExport } from "./converter";
import { completeSetup } from "./strapi-setup";

const program = new Command();

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
 * Ask yes/no question
 */
async function confirm(question: string): Promise<boolean> {
  const answer = await prompt(`${question} (y/n): `);
  return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
}

program
  .name("cms")
  .description("SeeMS - Webflow to CMS converter")
  .version("0.1.2");

program
  .command("convert")
  .description("Convert Webflow export to Nuxt 3 project")
  .argument("<input>", "Path to Webflow export directory")
  .argument("<output>", "Path to output Nuxt project directory")
  .option(
    "-b, --boilerplate <source>",
    "Boilerplate source (GitHub URL or local path)"
  )
  .option("-o, --overrides <path>", "Path to overrides JSON file")
  .option("--generate-schemas", "Generate CMS schemas immediately")
  .option(
    "--cms <type>",
    "CMS backend type (strapi|contentful|sanity)",
    "strapi"
  )
  .option("--no-interactive", "Skip interactive prompts")
  .action(async (input, output, options) => {
    try {
      // Run conversion
      await convertWebflowExport({
        inputDir: input,
        outputDir: output,
        boilerplate: options.boilerplate,
        overridesPath: options.overrides,
        generateStrapi: options.generateSchemas,
        cmsBackend: options.cms
      });

      // Interactive Strapi setup (if not disabled)
      if (options.interactive && options.cms === "strapi") {
        console.log(""); // blank line
        const shouldSetup = await confirm(
          pc.cyan("🎯 Would you like to setup Strapi now?")
        );

        if (shouldSetup) {
          const strapiDir = await prompt(
            pc.cyan(
              "📁 Enter path to your Strapi directory (e.g., ./strapi-dev): "
            )
          );

          if (strapiDir) {
            console.log(""); // blank line
            console.log(pc.cyan("🚀 Starting Strapi setup..."));
            console.log(""); // blank line

            try {
              await completeSetup({
                projectDir: output,
                strapiDir: strapiDir
              });
            } catch (error) {
              console.error(pc.red("\n❌ Strapi setup failed"));
              console.error(pc.dim("You can run setup manually later with:"));
              console.error(
                pc.dim(`  cms setup-strapi ${output} ${strapiDir}`)
              );
            }
          }
        } else {
          console.log(""); // blank line
          console.log(pc.dim("💡 You can setup Strapi later with:"));
          console.log(
            pc.dim(`   cms setup-strapi ${output} <strapi-directory>`)
          );
        }
      }
    } catch (error) {
      console.error(pc.red("Conversion failed"));
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
  .action(async (manifest, _options) => {
    console.log(pc.cyan("🗂️  SeeMS Schema Generator"));
    console.log(pc.dim(`Generating schemas from: ${manifest}`));

    // TODO: Implementation in Sprint 3
    console.log(pc.yellow("⚠️  Schema generation logic to be implemented"));
  });

program.parse();

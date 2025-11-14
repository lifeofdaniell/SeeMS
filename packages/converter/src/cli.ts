#!/usr/bin/env node

/**
 * CLI for @see-ms/converter
 * Usage: cms convert <input-dir> <output-dir> [options]
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { convertWebflowExport } from './converter';

const program = new Command();

program
  .name('cms')
  .description('SeeMS - Webflow to CMS converter')
  .version('0.1.0');

program
  .command('convert')
  .description('Convert Webflow export to Nuxt 3 project')
  .argument('<input>', 'Path to Webflow export directory')
  .argument('<output>', 'Path to output Nuxt project directory')
  .option('-b, --boilerplate <source>', 'Boilerplate source (GitHub URL or local path)')
  .option('-o, --overrides <path>', 'Path to overrides JSON file')
  .option('--generate-schemas', 'Generate CMS schemas immediately')
  .option('--cms <type>', 'CMS backend type (strapi|contentful|sanity)', 'strapi')
  .action(async (input, output, options) => {
    try {
      await convertWebflowExport({
        inputDir: input,
        outputDir: output,
        boilerplate: options.boilerplate,
        overridesPath: options.overrides,
        generateStrapi: options.generateSchemas,
        cmsBackend: options.cms,
      });
    } catch (error) {
      console.error(pc.red('Conversion failed'));
      process.exit(1);
    }
  });

program
  .command('generate')
  .description('Generate CMS schemas from manifest')
  .argument('<manifest>', 'Path to cms-manifest.json')
  .option('-t, --type <cms>', 'CMS type (strapi|contentful|sanity)', 'strapi')
  .option('-o, --output <dir>', 'Output directory for schemas')
  .action(async (manifest, _options) => {
    console.log(pc.cyan('🏗️  SeeMS Schema Generator'));
    console.log(pc.dim(`Generating schemas from: ${manifest}`));
    
    // TODO: Implementation in Sprint 3
    console.log(pc.yellow('⚠️  Schema generation logic to be implemented'));
  });

program.parse();

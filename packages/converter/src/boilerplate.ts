/**
 * Boilerplate cloning and setup utilities
 */

import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import pc from 'picocolors';

/**
 * Check if a string is a GitHub URL
 */
function isGitHubURL(source: string): boolean {
  return source.startsWith('https://github.com/') || 
         source.startsWith('git@github.com:') ||
         source.includes('github.com');
}

/**
 * Clone a GitHub repository
 */
async function cloneFromGitHub(repoUrl: string, outputDir: string): Promise<void> {
  console.log(pc.blue('  Cloning from GitHub...'));
  
  try {
    // Clone the repo
    execSync(`git clone ${repoUrl} ${outputDir}`, { stdio: 'inherit' });
    
    // Remove .git directory to start fresh
    const gitDir = path.join(outputDir, '.git');
    await fs.remove(gitDir);
    
    console.log(pc.green('  ✓ Boilerplate cloned successfully'));
  } catch (error) {
    throw new Error(`Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Copy from local directory
 */
async function copyFromLocal(sourcePath: string, outputDir: string): Promise<void> {
  console.log(pc.blue('  Copying from local path...'));
  
  const sourceExists = await fs.pathExists(sourcePath);
  if (!sourceExists) {
    throw new Error(`Local boilerplate not found: ${sourcePath}`);
  }
  
  // Copy everything except node_modules, .nuxt, .output, .git
  await fs.copy(sourcePath, outputDir, {
    filter: (src) => {
      const name = path.basename(src);
      return !['node_modules', '.nuxt', '.output', '.git', 'dist'].includes(name);
    },
  });
  
  console.log(pc.green('  ✓ Boilerplate copied successfully'));
}

/**
 * Setup boilerplate in output directory
 */
export async function setupBoilerplate(
  boilerplateSource: string | undefined,
  outputDir: string
): Promise<void> {
  if (!boilerplateSource) {
    // No boilerplate specified - create minimal structure
    console.log(pc.blue('\n📦 Creating minimal Nuxt structure...'));
    await fs.ensureDir(outputDir);
    await fs.ensureDir(path.join(outputDir, 'pages'));
    await fs.ensureDir(path.join(outputDir, 'assets'));
    await fs.ensureDir(path.join(outputDir, 'public'));
    await fs.ensureDir(path.join(outputDir, 'utils'));
    
    // Create a basic nuxt.config.ts if it doesn't exist
    const configPath = path.join(outputDir, 'nuxt.config.ts');
    const configExists = await fs.pathExists(configPath);
    
    if (!configExists) {
      const basicConfig = `export default defineNuxtConfig({
  devtools: { enabled: true },
  css: [],
})
`;
      await fs.writeFile(configPath, basicConfig, 'utf-8');
    }
    
    console.log(pc.green('  ✓ Structure created'));
    return;
  }

  // Check if output directory already exists
  const outputExists = await fs.pathExists(outputDir);
  if (outputExists) {
    throw new Error(`Output directory already exists: ${outputDir}. Please choose a different path or remove it first.`);
  }

  console.log(pc.blue('\n📦 Setting up boilerplate...'));

  if (isGitHubURL(boilerplateSource)) {
    await cloneFromGitHub(boilerplateSource, outputDir);
  } else {
    await copyFromLocal(boilerplateSource, outputDir);
  }
}

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
export type ProjectTarget = 'nuxt' | 'astro-vue';

export async function setupBoilerplate(
  boilerplateSource: string | undefined,
  outputDir: string,
  target: ProjectTarget = 'nuxt'
): Promise<void> {
  if (!boilerplateSource) {
    // No boilerplate specified - create minimal structure
    console.log(pc.blue(`\n📦 Creating minimal ${target === 'astro-vue' ? 'Astro + Vue' : 'Nuxt'} structure...`));
    await fs.ensureDir(outputDir);
    await fs.ensureDir(target === 'astro-vue' ? path.join(outputDir, 'src', 'pages') : path.join(outputDir, 'pages'));
    await fs.ensureDir(path.join(outputDir, 'assets'));
    await fs.ensureDir(path.join(outputDir, 'public'));
    await fs.ensureDir(path.join(outputDir, 'utils'));

    const configPath = path.join(outputDir, target === 'astro-vue' ? 'astro.config.mjs' : 'nuxt.config.ts');
    const configExists = await fs.pathExists(configPath);
    
    if (!configExists) {
      const basicConfig = target === 'astro-vue'
        ? `import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  integrations: [vue()],
  vite: {
    resolve: {
      alias: {
        '~': path.dirname(fileURLToPath(import.meta.url)),
      },
    },
  },
});
`
        : `export default defineNuxtConfig({
  devtools: { enabled: true },
  css: [],
})
`;
      await fs.writeFile(configPath, basicConfig, 'utf-8');
    }

    const packageJsonPath = path.join(outputDir, 'package.json');
    const packageJsonExists = await fs.pathExists(packageJsonPath);

    if (!packageJsonExists) {
      const packageName = path.basename(outputDir) || (target === 'astro-vue' ? 'see-ms-astro-site' : 'see-ms-nuxt-site');
      await fs.writeJson(packageJsonPath, target === 'astro-vue' ? {
        name: packageName,
        private: true,
        type: 'module',
        scripts: {
          dev: 'astro dev',
          build: 'astro build',
          preview: 'astro preview'
        },
        dependencies: {
          '@astrojs/vue': '^5.0.0',
          astro: '^5.0.0',
          vue: '^3.5.14'
        },
        devDependencies: {
          typescript: '^5.8.3'
        }
      } : {
        name: packageName,
        private: true,
        type: 'module',
        scripts: {
          dev: 'nuxt dev',
          build: 'nuxt build',
          generate: 'nuxt generate',
          preview: 'nuxt preview',
          postinstall: 'nuxt prepare'
        },
        dependencies: {
          nuxt: '^3.17.4',
          vue: '^3.5.14',
          'vue-router': '^4.5.1'
        },
        devDependencies: {
          typescript: '^5.8.3'
        }
      }, { spaces: 2 });
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

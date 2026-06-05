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
 * Ensure an Astro project has the Node server adapter wired up.
 *
 * The inline editor generates `prerender = false` API routes (save/publish)
 * that need a server adapter to build. We can't rely on the create-from-scratch
 * templates below, because a cloned/copied boilerplate ships its own
 * `astro.config.*` and `package.json` — so the adapter never gets injected. This
 * merges it into whatever already exists (idempotently) instead.
 */
async function ensureAstroNodeAdapter(outputDir: string): Promise<void> {
  // package.json: add @astrojs/node to dependencies if absent.
  const packageJsonPath = path.join(outputDir, 'package.json');
  if (await fs.pathExists(packageJsonPath)) {
    const pkg = await fs.readJson(packageJsonPath);
    pkg.dependencies = pkg.dependencies || {};
    if (!pkg.dependencies['@astrojs/node']) {
      pkg.dependencies['@astrojs/node'] = '^9.0.0';
      await fs.writeJson(packageJsonPath, pkg, { spaces: 2 });
      console.log(pc.green('  ✓ Added @astrojs/node to package.json (editor API routes need a server adapter)'));
    }
  }

  // astro.config.{mjs,ts,js}: inject the import + adapter if absent.
  const configName = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js']
    .find((name) => fs.pathExistsSync(path.join(outputDir, name)));
  if (!configName) return;

  const configPath = path.join(outputDir, configName);
  let config = await fs.readFile(configPath, 'utf-8');

  if (config.includes('@astrojs/node')) return; // already wired up

  if (!/defineConfig\s*\(\s*\{/.test(config)) {
    console.log(pc.yellow(`  ⚠ Could not auto-add the Node adapter to ${configName} — add it manually:`));
    console.log(pc.dim("      import node from '@astrojs/node';  →  adapter: node({ mode: 'standalone' })"));
    return;
  }

  // Add the import after the vue integration import, or after the astro/config import.
  if (config.includes("from '@astrojs/vue'")) {
    config = config.replace(
      /(import\s+vue\s+from\s+['"]@astrojs\/vue['"];?)/,
      "$1\nimport node from '@astrojs/node';"
    );
  } else {
    config = config.replace(
      /(import\s+\{[^}]*\}\s+from\s+['"]astro\/config['"];?)/,
      "$1\nimport node from '@astrojs/node';"
    );
  }

  // Add the adapter inside defineConfig({ ... }) if one isn't already set.
  if (!/adapter\s*:/.test(config)) {
    config = config.replace(
      /defineConfig\s*\(\s*\{/,
      "defineConfig({\n  adapter: node({ mode: 'standalone' }),"
    );
  }

  await fs.writeFile(configPath, config, 'utf-8');
  console.log(pc.green(`  ✓ Added Node adapter to ${configName}`));
}

/**
 * Setup boilerplate in output directory
 */
export type ProjectTarget = 'nuxt' | 'astro-vue';

export async function setupBoilerplate(
  boilerplateSource: string | undefined,
  outputDir: string,
  target: ProjectTarget = 'nuxt',
  editorEnabled = false
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
      // The inline editor generates `prerender = false` API routes
      // (save/publish), which require a server adapter to build. The SSR'd
      // pages themselves stay static (build-time Strapi fetch), so the adapter
      // is only needed when the editor is enabled.
      const basicConfig = target === 'astro-vue'
        ? `import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';${editorEnabled ? `\nimport node from '@astrojs/node';` : ''}
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
${editorEnabled ? `  adapter: node({ mode: 'standalone' }),\n` : ''}  integrations: [vue()],
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
          vue: '^3.5.14',
          // Server adapter required to build the editor's prerender=false API routes.
          ...(editorEnabled ? { '@astrojs/node': '^9.0.0' } : {})
        },
        devDependencies: {
          '@see-ms/types': '^0.2.0',
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

    if (target === 'astro-vue' && editorEnabled) {
      await ensureAstroNodeAdapter(outputDir);
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

  // A cloned/copied boilerplate ships its own astro.config/package.json, so the
  // create-from-scratch templates above never run — merge the adapter in here.
  if (target === 'astro-vue' && editorEnabled) {
    await ensureAstroNodeAdapter(outputDir);
  }
}

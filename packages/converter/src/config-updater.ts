/**
 * Utilities to update Nuxt config and generate webflow-assets.ts
 */

import fs from 'fs-extra';
import path from 'path';

const CSS_BLOCK_START = '    // SeeMS generated CSS start';
const CSS_BLOCK_END = '    // SeeMS generated CSS end';
const EMBEDDED_STYLES_START = '/* SeeMS generated embedded styles start */';
const EMBEDDED_STYLES_END = '/* SeeMS generated embedded styles end */';

/**
 * Generate the webflow-assets.ts Vite plugin
 */
export function generateWebflowAssetPlugin(cssFiles: string[]): string {
  // Convert css/normalize.css to /css/normalize.css
  const webflowFiles = cssFiles.map(file => `/css/${path.basename(file)}`);

  return `import type { Plugin } from 'vite'

const webflowFiles = [${webflowFiles.map(f => `'${f}'`).join(', ')}]
const replacements = [
  ['../images/', '/images/'],
  ['../fonts/', '/fonts/']
]

const webflowURLReset = (): Plugin => ({
  name: 'webflowURLReset',
  config: () => ({
    build: {
      rollupOptions: {
        external: [/\\.\\.\\/fonts\\//, /\\.\\.\\/images\\//]
      }
    }
  }),
  transform: (code, id) => {
    if (webflowFiles.some((path) => id.includes(path))) {
      replacements.forEach(([search, replace]) => {
        code = code.replaceAll(search, replace)
      })
    }

    return { code, id, map: null }
  }
})

export default webflowURLReset
`;
}

/**
 * Write webflow-assets.ts to utils folder (overwrites existing)
 */
export async function writeWebflowAssetPlugin(
  outputDir: string,
  cssFiles: string[]
): Promise<void> {
  const utilsDir = path.join(outputDir, 'utils');
  await fs.ensureDir(utilsDir);

  const content = generateWebflowAssetPlugin(cssFiles);
  const targetPath = path.join(utilsDir, 'webflow-assets.ts');

  // This will overwrite if it exists
  await fs.writeFile(targetPath, content, 'utf-8');
}

/**
 * Update nuxt.config.ts to add CSS files
 */
export async function updateNuxtConfig(
  outputDir: string,
  cssFiles: string[]
): Promise<void> {
  const configPath = path.join(outputDir, 'nuxt.config.ts');

  // Check if config exists
  const configExists = await fs.pathExists(configPath);
  if (!configExists) {
    throw new Error('nuxt.config.ts not found in output directory');
  }

  // Read existing config
  let config = await fs.readFile(configPath, 'utf-8');

  const cssEntries = cssFiles.map(file => `    '~/assets/css/${path.basename(file)}',`);
  const cssBlock = `${CSS_BLOCK_START}\n${cssEntries.join('\n')}\n${CSS_BLOCK_END}`;

  config = removeManagedCssBlock(config);
  config = removeLegacyCssEntries(config, cssFiles);

  // Check if css array exists
  if (config.includes('css:')) {
    config = config.replace(
      /css:\s*\[/,
      `css: [\n${cssBlock},`
    );
  } else {
    config = config.replace(
      /export default defineNuxtConfig\(\{/,
      `export default defineNuxtConfig({\n  css: [\n${cssBlock}\n  ],`
    );
  }

  // Write updated config
  await fs.writeFile(configPath, config, 'utf-8');
}

/**
 * Write embedded styles to main.css
 */
export async function writeEmbeddedStyles(
  outputDir: string,
  styles: string,
  target: 'nuxt' | 'astro-vue' = 'nuxt'
): Promise<void> {
  if (!styles.trim()) return;

  const cssDir = target === 'astro-vue'
    ? path.join(outputDir, 'public', 'css')
    : path.join(outputDir, 'assets', 'css');
  await fs.ensureDir(cssDir);

  const mainCssPath = path.join(cssDir, 'main.css');

  // Check if main.css exists
  const exists = await fs.pathExists(mainCssPath);

  if (exists) {
    const existing = await fs.readFile(mainCssPath, 'utf-8');
    const withoutManagedBlock = removeManagedEmbeddedStyles(existing).trimEnd();
    await fs.writeFile(mainCssPath, `${withoutManagedBlock}\n\n${renderEmbeddedStyles(styles)}`, 'utf-8');
  } else {
    await fs.writeFile(mainCssPath, renderEmbeddedStyles(styles), 'utf-8');
  }
}

/**
 * Add strapiUrl to nuxt.config.ts runtimeConfig
 * Uses the existing STRAPI_URL env variable from strapi setup
 */
export async function addStrapiUrlToConfig(
  outputDir: string,
  strapiUrl: string = 'http://localhost:1337'
): Promise<void> {
  const configPath = path.join(outputDir, 'nuxt.config.ts');

  // Check if config exists
  const configExists = await fs.pathExists(configPath);
  if (!configExists) {
    throw new Error('nuxt.config.ts not found in output directory');
  }

  // Read existing config
  let config = await fs.readFile(configPath, 'utf-8');

  if (/strapiUrl\s*:/.test(config)) {
    return;
  }

  // Check if runtimeConfig already exists
  if (config.includes('runtimeConfig:')) {
    // Check if public key exists
    if (config.includes('public:')) {
      // Add strapiUrl to public section
      // Find the public: { and add strapiUrl after it
      config = config.replace(
        /public:\s*\{/,
        `public: {\n      strapiUrl: process.env.STRAPI_URL || '${strapiUrl}',`
      );
    } else {
      // Add public section with strapiUrl
      config = config.replace(
        /runtimeConfig:\s*\{/,
        `runtimeConfig: {\n    public: {\n      strapiUrl: process.env.STRAPI_URL || '${strapiUrl}'\n    },`
      );
    }
  } else {
    // Add entire runtimeConfig section
    config = config.replace(
      /export default defineNuxtConfig\(\{/,
      `export default defineNuxtConfig({\n  runtimeConfig: {\n    public: {\n      strapiUrl: process.env.STRAPI_URL || '${strapiUrl}'\n    }\n  },`
    );
  }

  // Write updated config
  await fs.writeFile(configPath, config, 'utf-8');
}

function removeManagedCssBlock(config: string): string {
  const blockPattern = new RegExp(
    `\\n?\\s*// SeeMS generated CSS start[\\s\\S]*?\\s*// SeeMS generated CSS end,?`,
    'g'
  );
  return config.replace(blockPattern, '');
}

function removeLegacyCssEntries(config: string, cssFiles: string[]): string {
  let updated = config;

  for (const file of cssFiles) {
    const escapedEntry = escapeRegExp(`~/assets/css/${path.basename(file)}`);
    updated = updated.replace(new RegExp(`\\n\\s*['"]${escapedEntry}['"],?`, 'g'), '');
  }

  return updated;
}

function removeManagedEmbeddedStyles(css: string): string {
  const blockPattern = new RegExp(
    `\\n?${escapeRegExp(EMBEDDED_STYLES_START)}[\\s\\S]*?${escapeRegExp(EMBEDDED_STYLES_END)}\\n?`,
    'g'
  );
  return css.replace(blockPattern, '\n');
}

function renderEmbeddedStyles(styles: string): string {
  return `${EMBEDDED_STYLES_START}\n${styles.trim()}\n${EMBEDDED_STYLES_END}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

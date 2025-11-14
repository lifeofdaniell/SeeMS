/**
 * Utilities to update Nuxt config and generate webflow-assets.ts
 */

import fs from 'fs-extra';
import path from 'path';

/**
 * Generate the webflow-assets.ts Vite plugin
 */
export function generateWebflowAssetPlugin(cssFiles: string[]): string {
  // Convert css/normalize.css to /assets/css/normalize.css
  const webflowFiles = cssFiles.map(file => `/assets/css/${path.basename(file)}`);

  return `import type { Plugin } from 'vite'

const webflowFiles = [${webflowFiles.map(f => `'${f}'`).join(', ')}]
const replacements = [
  ['../images/', '/assets/images/'],
  ['../fonts/', '/assets/fonts/']
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

  // Generate CSS array entries
  const cssEntries = cssFiles.map(file => `    '~/assets/css/${path.basename(file)}'`);

  // Check if css array exists
  if (config.includes('css:')) {
    // Find the css array and add our files
    // This is a simple approach - we'll add them at the end of the array
    config = config.replace(
      /css:\s*\[/,
      `css: [\n${cssEntries.join(',\n')},`
    );
  } else {
    // Add css array to the config
    // Find the export default defineNuxtConfig({
    config = config.replace(
      /export default defineNuxtConfig\(\{/,
      `export default defineNuxtConfig({\n  css: [\n${cssEntries.join(',\n')}\n  ],`
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
  styles: string
): Promise<void> {
  if (!styles.trim()) return;

  const cssDir = path.join(outputDir, 'assets', 'css');
  await fs.ensureDir(cssDir);

  const mainCssPath = path.join(cssDir, 'main.css');

  // Check if main.css exists
  const exists = await fs.pathExists(mainCssPath);

  if (exists) {
    // Append to existing main.css
    const existing = await fs.readFile(mainCssPath, 'utf-8');
    await fs.writeFile(mainCssPath, `${existing}\n\n/* Webflow Embedded Styles */\n${styles}`, 'utf-8');
  } else {
    // Create new main.css
    await fs.writeFile(mainCssPath, `/* Webflow Embedded Styles */\n${styles}`, 'utf-8');
  }
}

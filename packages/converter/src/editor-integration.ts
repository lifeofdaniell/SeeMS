/**
 * Integrate editor overlay into Nuxt projects
 */

import fs from 'fs-extra';
import path from 'path';

/**
 * Create a Nuxt plugin to load the editor overlay
 */
export async function createEditorPlugin(outputDir: string): Promise<void> {
  const pluginsDir = path.join(outputDir, 'plugins');
  await fs.ensureDir(pluginsDir);

  const pluginContent = `/**
 * CMS Editor Overlay Plugin
 * Loads the inline editor when ?preview=true
 */

export default defineNuxtPlugin(() => {
  // Only run on client side
  if (process.server) return;
  
  // Check for preview mode
  const params = new URLSearchParams(window.location.search);
  
  if (params.get('preview') === 'true') {
    // Dynamically import the editor
    import('@see-ms/editor-overlay').then(({ initEditor, createToolbar }) => {
      const editor = initEditor({
        apiEndpoint: '/api/cms/save',
        richText: true,
      });
      
      editor.enable();
      
      const toolbar = createToolbar(editor);
      document.body.appendChild(toolbar);
    });
  }
});
`;

  const pluginPath = path.join(pluginsDir, 'cms-editor.client.ts');
  await fs.writeFile(pluginPath, pluginContent, 'utf-8');
}

/**
 * Add editor overlay as a dependency
 */
export async function addEditorDependency(outputDir: string): Promise<void> {
  const packageJsonPath = path.join(outputDir, 'package.json');

  if (await fs.pathExists(packageJsonPath)) {
    const packageJson = await fs.readJson(packageJsonPath);

    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    packageJson.dependencies['@see-ms/editor-overlay'] = '^0.1.1';

    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
  }
}

/**
 * Create API endpoint for saving changes
 */
export async function createSaveEndpoint(outputDir: string): Promise<void> {
  const serverDir = path.join(outputDir, 'server', 'api', 'cms');
  await fs.ensureDir(serverDir);

  const endpointContent = `/**
 * API endpoint for saving CMS changes
 */

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  
  // TODO: Implement actual saving to Strapi
  // For now, just log the changes
  console.log('CMS changes:', body);
  
  // In production, this would:
  // 1. Validate the changes
  // 2. Send to Strapi API
  // 3. Return success/error
  
  return {
    success: true,
    message: 'Changes saved (demo mode)',
  };
});
`;

  const endpointPath = path.join(serverDir, 'save.post.ts');
  await fs.writeFile(endpointPath, endpointContent, 'utf-8');
}

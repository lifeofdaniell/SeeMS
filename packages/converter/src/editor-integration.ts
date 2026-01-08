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
 * Requires Strapi authentication
 */

export default defineNuxtPlugin(() => {
  // Only run on client side
  if (process.server) return;

  // Check for preview mode
  const params = new URLSearchParams(window.location.search);

  if (params.get('preview') === 'true') {
    // Dynamically import the editor
    import('@see-ms/editor-overlay').then(async ({
      initEditor,
      createToolbar,
      createAuthManager,
      showLoginModal
    }) => {
      // Get Strapi URL from runtime config or default to localhost
      const config = useRuntimeConfig();
      const strapiUrl = config.public.strapiUrl || 'http://localhost:1337';

      // Create auth manager
      const authManager = createAuthManager({
        strapiUrl,
        storageKey: 'cms_editor_token',
      });

      // Check if already authenticated
      let token = authManager.getToken();
      let isAuthenticated = token ? await authManager.verifyToken(token) : false;

      // If not authenticated, show login modal
      if (!isAuthenticated) {
        try {
          token = await showLoginModal(authManager);
          isAuthenticated = true;
        } catch (error) {
          console.log('Login cancelled or failed');
          return;
        }
      }

      // Initialize editor with auth token
      const editor = initEditor({
        apiEndpoint: '/api/cms/save',
        authToken: token!,
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
 * Requires Strapi JWT authentication
 */

export default defineEventHandler(async (event) => {
  // Get Strapi URL from runtime config
  const config = useRuntimeConfig();
  const strapiUrl = config.public.strapiUrl || 'http://localhost:1337';

  // Extract Authorization header
  const authHeader = getHeader(event, 'authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Missing or invalid authorization header',
    });
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // Verify token with Strapi
  try {
    const userResponse = await $fetch(\`\${strapiUrl}/api/users/me\`, {
      headers: {
        Authorization: \`Bearer \${token}\`,
      },
    });

    // If we got here, token is valid
    // Check if user has appropriate permissions (optional - depends on your setup)
    // You could check userResponse.role or specific permissions here

    // Get the request body
    const body = await readBody(event);

    // TODO: Implement actual saving to Strapi
    // For now, just log the changes
    console.log('CMS changes from user:', userResponse);
    console.log('Changes:', body);

    // In production, this would:
    // 1. Parse the body to identify which content type and entry
    // 2. Update the Strapi entry via the API
    // 3. Return success/error
    //
    // Example:
    // const result = await $fetch(\`\${strapiUrl}/api/[content-type]/[id]\`, {
    //   method: 'PUT',
    //   headers: {
    //     Authorization: \`Bearer \${token}\`,
    //   },
    //   body: body,
    // });

    return {
      success: true,
      message: 'Changes saved successfully',
      user: {
        id: userResponse.id,
        username: userResponse.username,
      },
    };
  } catch (error) {
    // Token verification failed
    console.error('Token verification failed:', error);

    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized: Invalid or expired token',
    });
  }
});
`;

  const endpointPath = path.join(serverDir, 'save.post.ts');
  await fs.writeFile(endpointPath, endpointContent, 'utf-8');
}

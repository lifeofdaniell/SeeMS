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
 * Loads the inline editor when ?preview=true with full state management
 */

export default defineNuxtPlugin(async (nuxtApp) => {
  // Only run on client side
  if (process.server) return;

  // Import editor overlay modules
  const {
    initEditor,
    createAuthManager,
    showLoginModal,
    createDraftStorage,
    createURLStateManager,
    createManifestLoader,
    createNavigationGuard,
    getCurrentPageFromRoute,
  } = await import('@see-ms/editor-overlay');

  // Initialize URL state manager
  const urlState = createURLStateManager();
  const state = urlState.getState();

  // Only proceed if in preview mode
  if (!state.preview) return;

  // Get Strapi URL from runtime config
  const config = useRuntimeConfig();
  const strapiUrl = config.public.strapiUrl || 'http://localhost:1337';

  // Initialize components
  const authManager = createAuthManager({
    strapiUrl,
    storageKey: 'cms_editor_token',
  });

  const draftStorage = createDraftStorage();
  const manifestLoader = createManifestLoader();

  // Load manifest
  try {
    await manifestLoader.load();
  } catch (error) {
    console.error('[CMS Editor] Failed to load manifest:', error);
    return;
  }

  // Get current page from route
  let currentPage = getCurrentPageFromRoute();
  if (!currentPage) {
    currentPage = manifestLoader.getPageFromRoute(window.location.pathname);
  }

  if (!currentPage) {
    console.error('[CMS Editor] Could not determine current page');
    return;
  }

  // Update URL state with current page
  urlState.setState({ preview: true, page: currentPage });

  // Auth flow
  let token = authManager.getToken();
  if (!token || !await authManager.verifyToken(token)) {
    try {
      token = await showLoginModal(authManager);
    } catch (error) {
      // Login cancelled - exit preview mode
      console.log('[CMS Editor] Login cancelled');
      urlState.clearPreviewMode();
      return;
    }
  }

  // Initialize navigation guard
  const navigationGuard = createNavigationGuard({
    showToast: true,
    toastMessage: 'Navigation disabled in edit mode',
  });
  navigationGuard.enable();

  // Initialize editor with full context
  const editor = initEditor({
    apiEndpoint: '/api/cms/save',
    authToken: token,
    richText: true,
    manifestLoader,
    draftStorage,
    currentPage,
  });

  // Enable editor (will auto-load drafts)
  await editor.enable();

  // Create toolbar with navigation
  const { createToolbar } = await import('@see-ms/editor-overlay');
  const toolbar = await createToolbar(editor, {
    draftStorage,
    urlState,
    navigationGuard,
    manifestLoader,
    currentPage,
  });
  document.body.appendChild(toolbar);

  // Watch for route changes
  const router = useRouter();
  router.afterEach(async (to) => {
    const newPage = manifestLoader.getPageFromRoute(to.path);
    if (newPage && newPage !== currentPage) {
      currentPage = newPage;
      urlState.setState({ page: newPage });
      await editor.setPage(newPage);

      // Update toolbar if it has an update method
      if (typeof (toolbar as any).updateCurrentPage === 'function') {
        await (toolbar as any).updateCurrentPage(newPage);
      }
    }
  });

  // Cleanup on navigation away from preview mode
  nuxtApp.hook('page:finish', () => {
    const currentState = urlState.getState();
    if (!currentState.preview) {
      navigationGuard.disable();
      editor.destroy();
    }
  });
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
 * Handles draft and final saving to Strapi
 */

import fs from 'fs';
import path from 'path';

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

    // Get the request body
    const body = await readBody(event);
    const { page, fields, isDraft = true } = body;

    if (!page || !fields) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request: Missing page or fields',
      });
    }

    // Load manifest to understand field mappings
    const manifestPath = path.join(process.cwd(), 'cms-manifest.json');
    let manifest;
    try {
      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(manifestContent);
    } catch (error) {
      console.error('Failed to load manifest:', error);
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to load CMS manifest',
      });
    }

    // Get page configuration from manifest
    const pageConfig = manifest.pages[page];
    if (!pageConfig) {
      throw createError({
        statusCode: 404,
        statusMessage: \`Page "\${page}" not found in manifest\`,
      });
    }

    // Transform fields to Strapi format
    const strapiData: Record<string, any> = {};
    for (const [fieldName, value] of Object.entries(fields)) {
      const fieldConfig = pageConfig.fields[fieldName];
      if (!fieldConfig) {
        console.warn(\`Field "\${fieldName}" not found in manifest for page "\${page}"\`);
        continue;
      }

      // Handle different field types
      if (fieldConfig.type === 'image') {
        // TODO: Handle image uploads - for now just store the value
        strapiData[fieldName] = value;
      } else {
        strapiData[fieldName] = value;
      }
    }

    // Update Strapi content
    // Use PUT for single types (pages are typically single types)
    const strapiEndpoint = \`\${strapiUrl}/api/\${page}\`;

    const result = await $fetch(strapiEndpoint, {
      method: 'PUT',
      headers: {
        'Authorization': \`Bearer \${token}\`,
        'Content-Type': 'application/json',
      },
      body: {
        data: strapiData,
        // Set publishedAt to null for drafts, or current time for published
        publishedAt: isDraft ? null : new Date().toISOString(),
      },
    });

    console.log(\`[CMS Save] Updated "\${page}" in Strapi (draft: \${isDraft})\`);

    return {
      success: true,
      message: 'Changes saved successfully',
      page,
      isDraft,
      user: {
        id: userResponse.id,
        username: userResponse.username,
      },
    };
  } catch (error: any) {
    console.error('[CMS Save] Error:', error);

    // Token verification failed
    if (error.statusCode === 401 || error.status === 401) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized: Invalid or expired token',
      });
    }

    // Strapi error
    if (error.statusCode || error.status) {
      throw createError({
        statusCode: error.statusCode || error.status,
        statusMessage: error.statusMessage || error.message || 'Failed to save to Strapi',
      });
    }

    // Generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error while saving changes',
    });
  }
});
`;

  const endpointPath = path.join(serverDir, 'save.post.ts');
  await fs.writeFile(endpointPath, endpointContent, 'utf-8');
}

/**
 * Create API endpoint for batch publishing
 */
export async function createPublishEndpoint(outputDir: string): Promise<void> {
  const serverDir = path.join(outputDir, 'server', 'api', 'cms');
  await fs.ensureDir(serverDir);

  const endpointContent = `/**
 * API endpoint for batch publishing CMS changes
 * Publishes all drafts at once
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

    // Get the request body
    const body = await readBody(event);
    const { pages } = body;

    if (!pages || !Array.isArray(pages)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request: Missing or invalid pages array',
      });
    }

    // Process all pages
    const results = await Promise.allSettled(
      pages.map(async ({ page, fields }) => {
        // Call the save endpoint logic for each page
        const saveEndpoint = \`/api/cms/save\`;

        try {
          const response = await $fetch(saveEndpoint, {
            method: 'POST',
            headers: {
              'Authorization': \`Bearer \${token}\`,
              'Content-Type': 'application/json',
            },
            body: {
              page,
              fields,
              isDraft: false, // Publish, not draft
            },
          });

          return { page, success: true };
        } catch (error: any) {
          console.error(\`[CMS Publish] Failed to publish "\${page}":\`, error);
          return {
            page,
            success: false,
            error: error.message || 'Unknown error',
          };
        }
      })
    );

    // Separate successful and failed publications
    const successful: string[] = [];
    const failed: Array<{ page: string; error: string }> = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful.push(result.value.page);
      } else if (result.status === 'fulfilled' && !result.value.success) {
        failed.push({
          page: result.value.page,
          error: result.value.error || 'Unknown error',
        });
      } else if (result.status === 'rejected') {
        failed.push({
          page: pages[index].page,
          error: result.reason?.message || 'Unknown error',
        });
      }
    });

    console.log(\`[CMS Publish] Published \${successful.length} pages, \${failed.length} failed\`);

    return {
      success: failed.length === 0,
      message: \`Published \${successful.length} of \${pages.length} pages\`,
      successful,
      failed,
      user: {
        id: userResponse.id,
        username: userResponse.username,
      },
    };
  } catch (error: any) {
    console.error('[CMS Publish] Error:', error);

    // Token verification failed
    if (error.statusCode === 401 || error.status === 401) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Unauthorized: Invalid or expired token',
      });
    }

    // Generic error
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal server error while publishing changes',
    });
  }
});
`;

  const endpointPath = path.join(serverDir, 'publish.post.ts');
  await fs.writeFile(endpointPath, endpointContent, 'utf-8');
}

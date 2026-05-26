/**
 * Integrate editor overlay into Nuxt projects
 */

import fs from "fs-extra";
import path from "path";
import type { CMSManifest } from "@see-ms/types";

function getPageCollections(manifest?: CMSManifest): Record<string, string[]> {
  if (!manifest) return {};

  return Object.fromEntries(
    Object.entries(manifest.pages).map(([pageName, page]) => [
      pageName,
      Object.entries(page.collections || {})
        .filter(([, collection]) => (collection as any).storage !== "page-repeatable")
        .map(([collectionName]) => collectionName)
    ])
  );
}

/**
 * Create global editor state composable
 */
export async function createEditorContentComposable(outputDir: string): Promise<void> {
  const composablesDir = path.join(outputDir, "composables");
  await fs.ensureDir(composablesDir);

  const composableContent = `/**
 * Global state for editor content in preview mode
 * This allows the editor overlay to update content reactively
 */

// Global reactive state
const editorState = reactive<{
  isPreviewMode: boolean;
  currentPage: string | null;
  content: Record<string, Record<string, any>>; // page -> field -> value
  hasChanges: Record<string, boolean>; // page -> hasChanges
}>({
  isPreviewMode: false,
  currentPage: null,
  content: {},
  hasChanges: {},
});

export function useEditorContent(pageName?: string) {
  const route = useRoute();

  // Check if we're in preview mode
  const isPreviewMode = computed(() => route.query.preview === 'true');

  // Update global state
  if (import.meta.client) {
    editorState.isPreviewMode = isPreviewMode.value;
    if (pageName) {
      editorState.currentPage = pageName;
    }
  }

  // Get content for specific page
  const getPageContent = (page: string) => {
    return editorState.content[page] || {};
  };

  // Update a field's value
  const updateField = (page: string, fieldName: string, value: any) => {
    if (!editorState.content[page]) {
      editorState.content[page] = {};
    }
    editorState.content[page][fieldName] = value;
    editorState.hasChanges[page] = true;
  };

  // Clear all changes for a page
  const clearPageChanges = (page: string) => {
    delete editorState.content[page];
    editorState.hasChanges[page] = false;
  };

  // Initialize page content from Strapi data
  const initializePageContent = (page: string, content: Record<string, any>) => {
    if (!editorState.content[page]) {
      editorState.content[page] = { ...content };
    }
  };

  // Get content for current page (reactive)
  const content = computed(() => {
    const page = pageName || editorState.currentPage;
    if (!page) return {};
    return editorState.content[page] || {};
  });

  // Check if page has unsaved changes
  const hasChanges = computed(() => {
    const page = pageName || editorState.currentPage;
    if (!page) return false;
    return editorState.hasChanges[page] || false;
  });

  // Get all pages with changes
  const pagesWithChanges = computed(() => {
    return Object.keys(editorState.hasChanges).filter(
      (page) => editorState.hasChanges[page]
    );
  });

  // Expose state for window object (for editor overlay to access)
  if (import.meta.client) {
    (window as any).__editorState = editorState;
  }

  return {
    isPreviewMode,
    content,
    hasChanges,
    pagesWithChanges,
    getPageContent,
    updateField,
    clearPageChanges,
    initializePageContent,
  };
}
`;

  const composablePath = path.join(composablesDir, "useEditorContent.ts");
  await fs.writeFile(composablePath, composableContent, "utf-8");
}

/**
 * Create composable for fetching Strapi content
 */
export async function createStrapiContentComposable(outputDir: string, manifest?: CMSManifest): Promise<void> {
  const composablesDir = path.join(outputDir, "composables");
  await fs.ensureDir(composablesDir);
  const pageCollections = JSON.stringify(getPageCollections(manifest), null, 2);

  const composableContent = `/**
 * Composable to fetch content from Strapi based on CMS manifest
 * Integrates with editor state for preview mode
 */

const PAGE_COLLECTIONS: Record<string, string[]> = ${pageCollections};

export function useStrapiContent(pageName: string) {
  const config = useRuntimeConfig();
  const strapiUrl = config.public.strapiUrl || 'http://localhost:1337';
  const editorContent = useEditorContent(pageName);
  const collectionNames = PAGE_COLLECTIONS[pageName] || [];

  // Helper to transform Strapi image objects to URL strings
  const transformStrapiImages = (data: any, baseUrl: string): any => {
    if (!data || typeof data !== 'object') return data;

    const transformed: any = {};

    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === 'object') {
        // Check if it's a Strapi media object
        if ('url' in value && ('mime' in value || 'formats' in value)) {
          // It's an image - extract the URL
          transformed[key] = value.url.startsWith('http')
            ? value.url
            : \`\${baseUrl}\${value.url}\`;
        } else if (Array.isArray(value)) {
          // Handle arrays (collections of images)
          transformed[key] = value.map((item) =>
            item && typeof item === 'object' && 'url' in item
              ? item.url.startsWith('http')
                ? item.url
                : \`\${baseUrl}\${item.url}\`
              : item
          );
        } else {
          // Recursively transform nested objects
          transformed[key] = transformStrapiImages(value, baseUrl);
        }
      } else {
        transformed[key] = value;
      }
    }

    return transformed;
  };

  // Fetch content from Strapi with populated media fields
  const { data: strapiData } = useFetch<any>(
    \`\${strapiUrl}/api/\${pageName}\`,
    {
      key: \`strapi-\${pageName}\`,
      query: {
        populate: '*', // Strapi v5: Populate all fields including images
      },
      transform: (response) => {
        // Strapi v5 returns data in response.data
        const data = response?.data || response;

        // Transform image fields from Strapi objects to URL strings
        if (data && typeof data === 'object') {
          return transformStrapiImages(data, strapiUrl);
        }

        return data;
      },
    }
  );

  const collectionFetches = collectionNames.map((collectionName) =>
    useFetch<any>(
      \`\${strapiUrl}/api/\${collectionName}\`,
      {
        key: \`strapi-\${pageName}-collection-\${collectionName}\`,
        query: {
          populate: '*',
        },
        transform: (response) => {
          const data = response?.data || response || [];
          if (Array.isArray(data)) {
            return data.map((item) => transformStrapiImages(item, strapiUrl));
          }
          return transformStrapiImages(data, strapiUrl);
        },
      }
    )
  );

  // Initialize editor state with Strapi data when fetched
  // This runs in both normal AND preview mode to ensure initial content is available
  watch(
    strapiData,
    (newData) => {
      if (newData) {
        // Always initialize from Strapi on first load
        // Drafts will override this when they load in the editor
        editorContent.initializePageContent(pageName, newData);
      }
    },
    { immediate: true }
  );

  // In preview mode: use editor state
  // In normal mode: use Strapi data (and sync to editor state)
  const content = computed(() => {
    const collections = Object.fromEntries(
      collectionNames.map((collectionName, index) => [
        collectionName,
        collectionFetches[index]?.data.value || []
      ])
    );

    if (editorContent.isPreviewMode.value) {
      // Use editor state in preview mode
      return {
        ...editorContent.getPageContent(pageName),
        ...collections,
      };
    } else {
      // Use Strapi data in normal mode
      return {
        ...(strapiData.value || editorContent.getPageContent(pageName)),
        ...collections,
      };
    }
  });

  return {
    content,
  };
}
`;

  const composablePath = path.join(composablesDir, "useStrapiContent.ts");
  await fs.writeFile(composablePath, composableContent, "utf-8");
}

/**
 * Create a Nuxt plugin to load the editor overlay
 */
export async function createEditorPlugin(outputDir: string): Promise<void> {
  const pluginsDir = path.join(outputDir, "plugins");
  await fs.ensureDir(pluginsDir);

  const pluginContent = `/**
 * CMS Editor Overlay Plugin
 * Loads the inline editor when ?preview=true with full state management
 */

/**
 * Disable Lenis smooth scroll to allow native scrolling in edit mode
 * Note: The primary approach is to conditionally render <VueLenis> in the layout.
 * This function serves as a fallback for existing projects that haven't been updated.
 */
function disableLenisInEditMode() {
  try {
    // Check for Lenis in common locations
    const lenisInstances = [
      (window as any).lenis,
      (window as any).__lenis,
      (window as any).Lenis,
    ];

    for (const lenis of lenisInstances) {
      if (lenis && typeof lenis.stop === 'function') {
        lenis.stop();
      }
      if (lenis && typeof lenis.destroy === 'function') {
        lenis.destroy();
        return;
      }
    }

    // Check for Vue Lenis component instances via refs
    // VueLenis stores the instance in the component's exposed properties
    const lenisElements = document.querySelectorAll('[data-lenis], .lenis, [data-lenis-prevent]');
    lenisElements.forEach((el: any) => {
      // Try various ways Vue Lenis might store the instance
      const possibleInstances = [
        el.__lenis,
        el._lenis,
        el.$lenis,
        el.__vue__?.exposed?.lenis,
        el.__vueParentComponent?.exposed?.lenis,
      ];

      for (const instance of possibleInstances) {
        if (instance && typeof instance.stop === 'function') {
          instance.stop();
        }
        if (instance && typeof instance.destroy === 'function') {
          instance.destroy();
          return;
        }
      }
    });

    // Also remove lenis-related classes from html/body that might affect scrolling
    document.documentElement.classList.remove('lenis', 'lenis-smooth');
    document.body.classList.remove('lenis', 'lenis-smooth');
  } catch (error) {
    // Silently fail - Lenis may not be present or already disabled via layout
  }
}

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

  // URL state only manages preview mode (page is derived from route)
  urlState.setState({ preview: true });

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

  // Disable Lenis smooth scroll in edit mode (allows native scrolling)
  disableLenisInEditMode();

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

  const pluginPath = path.join(pluginsDir, "cms-editor.client.ts");
  await fs.writeFile(pluginPath, pluginContent, "utf-8");
}

/**
 * Add editor overlay as a dependency
 */
export async function addEditorDependency(outputDir: string): Promise<void> {
  const packageJsonPath = path.join(outputDir, "package.json");

  if (await fs.pathExists(packageJsonPath)) {
    const packageJson = await fs.readJson(packageJsonPath);

    if (!packageJson.dependencies) {
      packageJson.dependencies = {};
    }

    packageJson.dependencies["@see-ms/editor-overlay"] = "^1.0.0";

    await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
  }
}

/**
 * Create API endpoint for saving changes
 */
export async function createSaveEndpoint(outputDir: string): Promise<void> {
  const serverDir = path.join(outputDir, "server", "api", "cms");
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

  // Verify token with Strapi and determine if it's an admin or user token
  let userResponse: any;
  let isAdminToken = false;

  try {
    // Try admin token verification first
    try {
      userResponse = await $fetch(\`\${strapiUrl}/admin/users/me\`, {
        headers: {
          Authorization: \`Bearer \${token}\`,
        },
      });
      isAdminToken = true;
    } catch (adminError) {
      // Fallback to regular user token verification
      userResponse = await $fetch(\`\${strapiUrl}/api/users/me\`, {
        headers: {
          Authorization: \`Bearer \${token}\`,
        },
      });
      isAdminToken = false;
    }

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
    const manifestPath = path.join(process.cwd(), 'public', 'cms-manifest.json');
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

    // Update Strapi v5 content - use different endpoints for admin vs user tokens
    if (isAdminToken) {
      // Admin tokens use the content-manager API (Strapi v5)
      const contentEndpoint = \`\${strapiUrl}/content-manager/single-types/api::\${page}.\${page}\`;

      // Step 1: Update the content
      await $fetch(contentEndpoint, {
        method: 'PUT',
        headers: {
          'Authorization': \`Bearer \${token}\`,
          'Content-Type': 'application/json',
        },
        body: strapiData,
      });

      // Step 2: Publish if not a draft (Strapi v5)
      if (!isDraft) {
        const publishEndpoint = \`\${strapiUrl}/content-manager/single-types/api::\${page}.\${page}/actions/publish\`;
        await $fetch(publishEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
            'Content-Type': 'application/json',
          },
          body: {},
        });
      }
    } else {
      // User tokens use the regular REST API
      const strapiEndpoint = \`\${strapiUrl}/api/\${page}\`;

      await $fetch(strapiEndpoint, {
        method: 'PUT',
        headers: {
          'Authorization': \`Bearer \${token}\`,
          'Content-Type': 'application/json',
        },
        body: {
          data: strapiData,
        },
      });

      // Publish if not a draft (Strapi v5)
      if (!isDraft) {
        const publishEndpoint = \`\${strapiUrl}/api/\${page}/publish\`;
        await $fetch(publishEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${token}\`,
            'Content-Type': 'application/json',
          },
          body: {},
        });
      }
    }

    console.log(\`[CMS Save] Updated "\${page}" in Strapi (draft: \${isDraft})\`);

    return {
      success: true,
      message: 'Changes saved successfully',
      page,
      isDraft,
      user: {
        id: userResponse.id,
        username: userResponse.username || userResponse.firstname || 'Unknown',
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

  const endpointPath = path.join(serverDir, "save.post.ts");
  await fs.writeFile(endpointPath, endpointContent, "utf-8");
}

/**
 * Create Strapi bootstrap file to auto-enable public permissions
 */
export async function createStrapiBootstrap(outputDir: string): Promise<void> {
  const strapiBootstrapDir = path.join(outputDir, ".see-ms", "strapi-bootstrap");
  await fs.ensureDir(strapiBootstrapDir);

  const bootstrapContent = `/**
 * Strapi Bootstrap File
 * Auto-enables public read permissions for all CMS content types
 * SeeMS public permissions bootstrap
 *
 * Installed automatically by cms setup-strapi.
 */

export default {
  /**
   * Bootstrap function runs when Strapi starts
   */
  async bootstrap({ strapi }: { strapi: any }) {
    try {
      console.log('[SeeMS Bootstrap] Configuring public permissions for CMS...');

      // Get the public role
      const publicRole = await strapi
        .query('plugin::users-permissions.role')
        .findOne({ where: { type: 'public' } });

      if (!publicRole) {
        console.error('[SeeMS Bootstrap] Public role not found');
        return;
      }

      // Get all content types
      const contentTypes = Object.keys(strapi.contentTypes).filter(
        (uid) => uid.startsWith('api::')
      );

      // Enable find and findOne for each content type
      const permissions = await strapi
        .query('plugin::users-permissions.permission')
        .findMany({
          where: {
            role: publicRole.id,
          },
        });

      let updatedCount = 0;

      for (const contentType of contentTypes) {
        const [, apiName] = contentType.split('::');
        const [controllerName] = apiName.split('.');

        // Find or create find permission
        const findPermission = permissions.find(
          (p: any) =>
            p.action === \`api::\${apiName}.find\` ||
            p.action === 'find' && p.controller === controllerName
        );

        const findOnePermission = permissions.find(
          (p: any) =>
            p.action === \`api::\${apiName}.findOne\` ||
            p.action === 'findOne' && p.controller === controllerName
        );

        // Enable find
        if (findPermission && !findPermission.enabled) {
          await strapi
            .query('plugin::users-permissions.permission')
            .update({
              where: { id: findPermission.id },
              data: { enabled: true },
            });
          updatedCount++;
        }

        // Enable findOne
        if (findOnePermission && !findOnePermission.enabled) {
          await strapi
            .query('plugin::users-permissions.permission')
            .update({
              where: { id: findOnePermission.id },
              data: { enabled: true },
            });
          updatedCount++;
        }

        // If permissions don't exist, create them
        if (!findPermission) {
          await strapi.query('plugin::users-permissions.permission').create({
            data: {
              action: \`api::\${apiName}.find\`,
              role: publicRole.id,
              enabled: true,
            },
          });
          updatedCount++;
        }

        if (!findOnePermission) {
          await strapi.query('plugin::users-permissions.permission').create({
            data: {
              action: \`api::\${apiName}.findOne\`,
              role: publicRole.id,
              enabled: true,
            },
          });
          updatedCount++;
        }
      }

      console.log(
        \`[SeeMS Bootstrap] Enabled \${updatedCount} public permissions for \${contentTypes.length} content types\`
      );
    } catch (error) {
      console.error('[SeeMS Bootstrap] Error enabling public permissions:', error);
    }
  },
};
`;

  const bootstrapPath = path.join(strapiBootstrapDir, "index.ts");
  await fs.writeFile(bootstrapPath, bootstrapContent, "utf-8");

  // Create README
  const readmeContent = `# Strapi Bootstrap File

This file automatically enables public read permissions for all CMS content types when Strapi starts.

## Installation

The \`cms setup-strapi\` command installs this bootstrap automatically:

   \`\`\`bash
   cms setup-strapi <converted-project> <your-strapi-project>
   \`\`\`

If your Strapi project does not already have \`src/index.ts\`, setup creates it.
If it already exists, setup backs it up and merges the SeeMS public-permissions bootstrap into the existing file when it can do so safely.

Restart Strapi after setup installs schemas and bootstrap:

   \`\`\`bash
   cd <your-strapi-project>
   npm run develop
   \`\`\`

Check the console logs - you should see:

   \`\`\`
   [SeeMS Bootstrap] Enabled X public permissions for Y content types
   \`\`\`

## What It Does

- Runs automatically when Strapi starts
- Finds the "Public" role
- Enables \`find\` and \`findOne\` permissions for all API content types
- Allows unauthenticated users to read published content
- Fixes 403 Forbidden errors from \`useStrapiContent\`

## Manual Alternative

If you prefer to set permissions manually:

1. Open Strapi admin: http://localhost:1337/admin
2. Go to: Settings → Users & Permissions Plugin → Roles → Public
3. For each content type, check:
   - ✅ find
   - ✅ findOne
4. Click Save

## Notes

- Only enables READ permissions (find, findOne)
- Does NOT enable write permissions (create, update, delete)
- Only affects the "Public" role (unauthenticated users)
- Safe to run multiple times (idempotent)
`;

  const readmePath = path.join(strapiBootstrapDir, "README.md");
  await fs.writeFile(readmePath, readmeContent, "utf-8");

  console.log("  ✓ Generated Strapi bootstrap file");
}

/**
 * Create API endpoint for batch publishing
 */
export async function createPublishEndpoint(outputDir: string): Promise<void> {
  const serverDir = path.join(outputDir, "server", "api", "cms");
  await fs.ensureDir(serverDir);

  const endpointContent = `/**
 * API endpoint for batch publishing CMS changes
 * Publishes all drafts at once
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

  // Verify token with Strapi and determine if it's an admin or user token
  let userResponse: any;
  let isAdminToken = false;

  try {
    // Try admin token verification first
    try {
      userResponse = await $fetch(\`\${strapiUrl}/admin/users/me\`, {
        headers: {
          Authorization: \`Bearer \${token}\`,
        },
      });
      isAdminToken = true;
    } catch (adminError) {
      // Fallback to regular user token verification
      userResponse = await $fetch(\`\${strapiUrl}/api/users/me\`, {
        headers: {
          Authorization: \`Bearer \${token}\`,
        },
      });
      isAdminToken = false;
    }

    // Get the request body
    const body = await readBody(event);
    const { pages } = body;

    if (!pages || !Array.isArray(pages)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Bad Request: Missing or invalid pages array',
      });
    }

    // Load manifest to understand field mappings
    const manifestPath = path.join(process.cwd(), 'public', 'cms-manifest.json');
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

    // Process all pages - call Strapi directly
    const results = await Promise.allSettled(
      pages.map(async ({ page, fields }) => {
        try {
          // Get page configuration from manifest
          const pageConfig = manifest.pages[page];
          if (!pageConfig) {
            throw new Error(\`Page "\${page}" not found in manifest\`);
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

          // Update Strapi v5 content - use different endpoints for admin vs user tokens
          if (isAdminToken) {
            // Admin tokens use the content-manager API (Strapi v5)
            const contentEndpoint = \`\${strapiUrl}/content-manager/single-types/api::\${page}.\${page}\`;

            // Step 1: Update the content
            await $fetch(contentEndpoint, {
              method: 'PUT',
              headers: {
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json',
              },
              body: strapiData,
            });

            // Step 2: Publish the content (Strapi v5)
            const publishEndpoint = \`\${strapiUrl}/content-manager/single-types/api::\${page}.\${page}/actions/publish\`;
            await $fetch(publishEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json',
              },
              body: {},
            });
          } else {
            // User tokens use the regular REST API
            const strapiEndpoint = \`\${strapiUrl}/api/\${page}\`;

            await $fetch(strapiEndpoint, {
              method: 'PUT',
              headers: {
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json',
              },
              body: {
                data: strapiData,
              },
            });

            // Publish using the publish endpoint (Strapi v5)
            const publishEndpoint = \`\${strapiUrl}/api/\${page}/publish\`;
            await $fetch(publishEndpoint, {
              method: 'POST',
              headers: {
                'Authorization': \`Bearer \${token}\`,
                'Content-Type': 'application/json',
              },
              body: {},
            });
          }

          console.log(\`[CMS Publish] Published "\${page}" to Strapi\`);
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
        username: userResponse.username || userResponse.firstname || 'Unknown',
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

  const endpointPath = path.join(serverDir, "publish.post.ts");
  await fs.writeFile(endpointPath, endpointContent, "utf-8");
}

export async function createAstroStrapiContentComposable(outputDir: string, manifest?: CMSManifest): Promise<void> {
  const composablesDir = path.join(outputDir, "src", "composables");
  await fs.ensureDir(composablesDir);
  const pageCollections = JSON.stringify(getPageCollections(manifest), null, 2);

  const content = `import { computed, reactive, ref, onMounted } from 'vue';

const PAGE_COLLECTIONS: Record<string, string[]> = ${pageCollections};

const editorState = reactive<{
  content: Record<string, Record<string, any>>;
  hasChanges: Record<string, boolean>;
}>({
  content: {},
  hasChanges: {},
});

function getStrapiUrl() {
  return import.meta.env.PUBLIC_STRAPI_URL || 'http://localhost:1337';
}

function transformStrapiImages(data: any, baseUrl: string): any {
  if (!data || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((item) => transformStrapiImages(item, baseUrl));
  if ('url' in data && ('mime' in data || 'formats' in data)) {
    return data.url.startsWith('http') ? data.url : \`\${baseUrl}\${data.url}\`;
  }

  const transformed: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    transformed[key] = transformStrapiImages(value, baseUrl);
  }
  return transformed;
}

export function useStrapiContent(pageName: string) {
  const strapiUrl = getStrapiUrl();
  const strapiData = ref<Record<string, any>>({});
  const isPreviewMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'true';
  const collectionNames = PAGE_COLLECTIONS[pageName] || [];

  function initializePageContent(page: string, content: Record<string, any>) {
    if (!editorState.content[page]) {
      editorState.content[page] = { ...content };
    }
  }

  function getPageContent(page: string) {
    return editorState.content[page] || {};
  }

  function updateField(page: string, fieldName: string, value: any) {
    if (!editorState.content[page]) editorState.content[page] = {};
    editorState.content[page][fieldName] = value;
    editorState.hasChanges[page] = true;
  }

  onMounted(async () => {
    try {
      const response = await fetch(\`\${strapiUrl}/api/\${pageName}?populate=*\`);
      if (!response.ok) return;
      const json = await response.json();
      const data = transformStrapiImages(json?.data || json, strapiUrl);
      const collections = Object.fromEntries(
        await Promise.all(collectionNames.map(async (collectionName) => {
          const collectionResponse = await fetch(\`\${strapiUrl}/api/\${collectionName}?populate=*\`);
          if (!collectionResponse.ok) return [collectionName, []];
          const collectionJson = await collectionResponse.json();
          const collectionData = collectionJson?.data || collectionJson || [];
          return [
            collectionName,
            Array.isArray(collectionData)
              ? collectionData.map((item) => transformStrapiImages(item, strapiUrl))
              : transformStrapiImages(collectionData, strapiUrl)
          ];
        }))
      );
      strapiData.value = { ...(data || {}), ...collections };
      initializePageContent(pageName, strapiData.value);
    } catch (error) {
      console.error('[SeeMS] Failed to fetch Strapi content', error);
    }

    (window as any).__editorState = {
      ...editorState,
      getPageContent,
      updateField,
      initializePageContent,
    };
  });

  const content = computed(() => {
    return isPreviewMode ? getPageContent(pageName) : (strapiData.value || getPageContent(pageName));
  });

  return { content };
}
`;

  await fs.writeFile(path.join(composablesDir, "useStrapiContent.ts"), content, "utf-8");
}

export async function createAstroEditorClient(outputDir: string): Promise<void> {
  const srcDir = path.join(outputDir, "src");
  await fs.ensureDir(srcDir);

  const content = `/**
 * Astro client entry for the SeeMS inline editor.
 */
async function initSeeMSEditor() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') !== 'true') return;

  const {
    initEditor,
    createAuthManager,
    showLoginModal,
    createDraftStorage,
    createURLStateManager,
    createManifestLoader,
    createNavigationGuard,
    getCurrentPageFromRoute,
    createToolbar,
  } = await import('@see-ms/editor-overlay');

  const strapiUrl = import.meta.env.PUBLIC_STRAPI_URL || 'http://localhost:1337';
  const urlState = createURLStateManager();
  urlState.setState({ preview: true });

  const authManager = createAuthManager({
    strapiUrl,
    storageKey: 'cms_editor_token',
  });
  const draftStorage = createDraftStorage();
  const manifestLoader = createManifestLoader();

  try {
    await manifestLoader.load();
  } catch (error) {
    console.error('[CMS Editor] Failed to load manifest:', error);
    return;
  }

  let currentPage = getCurrentPageFromRoute();
  if (!currentPage) {
    currentPage = manifestLoader.getPageFromRoute(window.location.pathname);
  }
  if (!currentPage) {
    console.error('[CMS Editor] Could not determine current page');
    return;
  }

  let token = authManager.getToken();
  if (!token || !await authManager.verifyToken(token)) {
    try {
      token = await showLoginModal(authManager);
    } catch {
      urlState.clearPreviewMode();
      return;
    }
  }

  const navigationGuard = createNavigationGuard({
    showToast: true,
    toastMessage: 'Navigation disabled in edit mode',
  });
  navigationGuard.enable();

  const editor = initEditor({
    apiEndpoint: '/api/cms/save',
    authToken: token,
    richText: true,
    manifestLoader,
    draftStorage,
    currentPage,
  });

  await editor.enable();

  const toolbar = await createToolbar(editor, {
    draftStorage,
    urlState,
    navigationGuard,
    manifestLoader,
    currentPage,
  });
  document.body.appendChild(toolbar);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSeeMSEditor, { once: true });
} else {
  initSeeMSEditor();
}
`;

  await fs.writeFile(path.join(srcDir, "cms-editor.ts"), content, "utf-8");
}

export async function createAstroSaveEndpoint(outputDir: string): Promise<void> {
  const endpointDir = path.join(outputDir, "src", "pages", "api", "cms");
  await fs.ensureDir(endpointDir);

  await fs.writeFile(path.join(endpointDir, "save.ts"), astroEndpointContent(false), "utf-8");
  await fs.writeFile(path.join(endpointDir, "publish.ts"), astroEndpointContent(true), "utf-8");
}

function astroEndpointContent(batchPublish: boolean): string {
  return `import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const prerender = false;

const strapiUrl = import.meta.env.PUBLIC_STRAPI_URL || 'http://localhost:1337';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function verifyToken(token: string) {
  const adminResponse = await fetch(\`\${strapiUrl}/admin/users/me\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (adminResponse.ok) return { user: await adminResponse.json(), isAdminToken: true };

  const userResponse = await fetch(\`\${strapiUrl}/api/users/me\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  if (userResponse.ok) return { user: await userResponse.json(), isAdminToken: false };

  throw new Error('Invalid or expired token');
}

function loadManifest() {
  const manifestPath = path.join(process.cwd(), 'public', 'cms-manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

function filterFields(pageConfig: any, fields: Record<string, any>) {
  const data: Record<string, any> = {};
  for (const [fieldName, value] of Object.entries(fields || {})) {
    if (pageConfig?.fields?.[fieldName]) data[fieldName] = value;
  }
  return data;
}

async function writePage(page: string, fields: Record<string, any>, token: string, isAdminToken: boolean, publish: boolean) {
  const manifest = loadManifest();
  const pageConfig = manifest.pages[page];
  if (!pageConfig) throw new Error(\`Page "\${page}" not found in manifest\`);
  const data = filterFields(pageConfig, fields);

  if (isAdminToken) {
    const endpoint = \`\${strapiUrl}/content-manager/single-types/api::\${page}.\${page}\`;
    const update = await fetch(endpoint, {
      method: 'PUT',
      headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!update.ok) throw new Error(await update.text());

    if (publish) {
      const publishResponse = await fetch(\`\${endpoint}/actions/publish\`, {
        method: 'POST',
        headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!publishResponse.ok) throw new Error(await publishResponse.text());
    }
    return;
  }

  const update = await fetch(\`\${strapiUrl}/api/\${page}\`, {
    method: 'PUT',
    headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });
  if (!update.ok) throw new Error(await update.text());

  if (publish) {
    const publishResponse = await fetch(\`\${strapiUrl}/api/\${page}/publish\`, {
      method: 'POST',
      headers: { Authorization: \`Bearer \${token}\`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!publishResponse.ok) throw new Error(await publishResponse.text());
  }
}

export const POST: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { success: false, message: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const { user, isAdminToken } = await verifyToken(token);
    const body = await request.json();
${batchPublish ? `    const pages = Array.isArray(body.pages) ? body.pages : [];
    const results = await Promise.allSettled(
      pages.map(({ page, fields }: any) => writePage(page, fields, token, isAdminToken, true))
    );
    const failed = results
      .map((result, index) => ({ result, page: pages[index]?.page }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, page }) => ({ page, error: result.status === 'rejected' ? result.reason?.message : 'Unknown error' }));
    return json(200, {
      success: failed.length === 0,
      message: \`Published \${pages.length - failed.length} of \${pages.length} pages\`,
      failed,
      user,
    });` : `    if (!body.page || !body.fields) {
      return json(400, { success: false, message: 'Missing page or fields' });
    }
    await writePage(body.page, body.fields, token, isAdminToken, body.isDraft === false);
    return json(200, { success: true, message: 'Changes saved successfully', page: body.page, isDraft: body.isDraft !== false, user });`}
  } catch (error: any) {
    return json(error.message === 'Invalid or expired token' ? 401 : 500, {
      success: false,
      message: error.message || 'Failed to save CMS changes',
    });
  }
};
`;
}

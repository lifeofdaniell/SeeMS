# @see-ms/editor-overlay

A powerful inline editor overlay for Nuxt 3 + Strapi CMS projects. Enables content editing directly on your website with real-time preview, draft management, and seamless Strapi integration.

## Features

- **Inline Editing**: Click-to-edit content directly on your pages
- **Real-time Preview**: See changes instantly without page refresh
- **Draft Management**: Auto-save drafts to IndexedDB, load/discard on demand
- **Rich Text Editing**: Built-in QuillJS editor for formatted content
- **Image Editing**: Click to change images with URL input
- **Strapi v5 Integration**: Seamless save and publish to Strapi CMS
- **Authentication**: Secure login with Strapi admin/user accounts
- **Navigation Protection**: Warns before leaving with unsaved changes
- **Toolbar UI**: Floating toolbar with save, publish, and navigation controls
- **Reactive State**: Integrates with Vue's reactivity for instant UI updates

## Installation

```bash
npm install @see-ms/editor-overlay
# or
pnpm add @see-ms/editor-overlay
# or
yarn add @see-ms/editor-overlay
```

## Quick Start

### 1. Setup in Nuxt Plugin

Create a plugin at `plugins/cms-editor.client.ts`:

```typescript
import {
  initEditor,
  createAuthManager,
  showLoginModal,
  createDraftStorage,
  createURLStateManager,
  createManifestLoader,
  createNavigationGuard,
  createToolbar,
} from '@see-ms/editor-overlay';

export default defineNuxtPlugin(async (nuxtApp) => {
  if (process.server) return;

  // Initialize URL state manager
  const urlState = createURLStateManager();
  const state = urlState.getState();

  // Only run in preview mode (?preview=true)
  if (!state.preview) return;

  const config = useRuntimeConfig();
  const strapiUrl = config.public.strapiUrl || 'http://localhost:1337';

  // Setup authentication
  const authManager = createAuthManager({
    strapiUrl,
    storageKey: 'cms_editor_token',
  });

  // Load CMS manifest
  const manifestLoader = createManifestLoader();
  await manifestLoader.load();

  // Get current page
  const currentPage = manifestLoader.getPageFromRoute(window.location.pathname);

  // Login flow
  let token = authManager.getToken();
  if (!token || !await authManager.verifyToken(token)) {
    token = await showLoginModal(authManager);
  }

  // Initialize editor
  const draftStorage = createDraftStorage();
  const navigationGuard = createNavigationGuard();

  const editor = initEditor({
    apiEndpoint: '/api/cms/save',
    authToken: token,
    richText: true,
    manifestLoader,
    draftStorage,
    currentPage,
  });

  await editor.enable();
  navigationGuard.enable();

  // Create toolbar
  const toolbar = await createToolbar(editor, {
    draftStorage,
    urlState,
    navigationGuard,
    manifestLoader,
    currentPage,
  });

  document.body.appendChild(toolbar);
});
```

### 2. Create CMS Manifest

Create `public/cms-manifest.json` describing your content structure:

```json
{
  "version": "1.0.0",
  "pages": {
    "index": {
      "path": "pages/index.vue",
      "fields": {
        "hero_heading": {
          "selector": ".hero-title",
          "type": "text"
        },
        "hero_subtext": {
          "selector": ".hero-subtitle",
          "type": "text"
        },
        "hero_image": {
          "selector": ".hero-image img",
          "type": "image"
        }
      },
      "meta": {
        "title": "Home",
        "route": "/"
      }
    }
  }
}
```

### 3. Mark Editable Elements

Add `data-editable` attributes to your Vue templates:

```vue
<template>
  <div>
    <h1 class="hero-title" data-editable="hero_heading">
      {{ content.hero_heading }}
    </h1>
    <p class="hero-subtitle" data-editable="hero_subtext">
      {{ content.hero_subtext }}
    </p>
    <img
      class="hero-image"
      :src="content.hero_image"
      data-editable="hero_image"
    >
  </div>
</template>

<script setup lang="ts">
const { content } = useStrapiContent('index');
</script>
```

### 4. Access Preview Mode

Visit your site with `?preview=true`:

```
http://localhost:3000?preview=true
```

Click any element with `data-editable` to start editing!

## API Reference

### `initEditor(config)`

Initialize the editor with configuration.

**Parameters:**
- `config.apiEndpoint` (string): API endpoint for saving (e.g., `/api/cms/save`)
- `config.authToken` (string): Strapi authentication token
- `config.richText` (boolean): Enable rich text editor (default: `true`)
- `config.manifestLoader` (ManifestLoader): CMS manifest loader instance
- `config.draftStorage` (DraftStorage): Draft storage instance
- `config.currentPage` (string): Current page name

**Returns:** `EditorInstance`

**Methods:**
- `editor.enable()` - Start the editor
- `editor.disable()` - Stop the editor
- `editor.destroy()` - Clean up and remove all listeners
- `editor.setPage(pageName)` - Switch to a different page

### `createAuthManager(config)`

Create authentication manager for Strapi.

**Parameters:**
- `config.strapiUrl` (string): Strapi base URL
- `config.storageKey` (string): localStorage key for token

**Methods:**
- `authManager.getToken()` - Get stored token
- `authManager.setToken(token)` - Store token
- `authManager.clearToken()` - Remove token
- `authManager.verifyToken(token)` - Verify token with Strapi
- `authManager.login(identifier, password)` - Login with credentials

### `showLoginModal(authManager)`

Display login modal and return token.

**Parameters:**
- `authManager` (AuthManager): Auth manager instance

**Returns:** `Promise<string>` - JWT token

**Throws:** Error if user cancels login

### `createDraftStorage()`

Create draft storage manager using IndexedDB.

**Methods:**
- `draftStorage.saveDraft(page, fields)` - Save draft
- `draftStorage.getDraft(page)` - Load draft
- `draftStorage.clearDraft(page)` - Delete draft
- `draftStorage.hasDraft(page)` - Check if draft exists

### `createURLStateManager()`

Manage preview mode state in URL.

**Methods:**
- `urlState.getState()` - Get current state
- `urlState.setState(state)` - Update state
- `urlState.clearPreviewMode()` - Exit preview mode

### `createManifestLoader()`

Load and parse CMS manifest.

**Methods:**
- `manifestLoader.load()` - Load manifest from `/cms-manifest.json`
- `manifestLoader.getManifest()` - Get parsed manifest
- `manifestLoader.getPageFromRoute(path)` - Get page name from route
- `manifestLoader.getPageConfig(pageName)` - Get page configuration

### `createNavigationGuard(config?)`

Protect against navigation with unsaved changes.

**Parameters:**
- `config.showToast` (boolean): Show toast on navigation attempt
- `config.toastMessage` (string): Custom toast message

**Methods:**
- `navigationGuard.enable()` - Enable protection
- `navigationGuard.disable()` - Disable protection

### `createToolbar(editor, config)`

Create floating toolbar UI.

**Parameters:**
- `editor` (EditorInstance): Editor instance
- `config.draftStorage` (DraftStorage): Draft storage
- `config.urlState` (URLStateManager): URL state manager
- `config.navigationGuard` (NavigationGuard): Navigation guard
- `config.manifestLoader` (ManifestLoader): Manifest loader
- `config.currentPage` (string): Current page name

**Returns:** `HTMLElement` - Toolbar element to append to DOM

## Content Structure

### Text Fields

```json
{
  "field_name": {
    "selector": ".css-selector",
    "type": "text"
  }
}
```

Text fields support plain text editing.

### Rich Text Fields

```json
{
  "field_name": {
    "selector": ".css-selector",
    "type": "richtext"
  }
}
```

Rich text fields support formatting (bold, italic, lists, links).

### Image Fields

```json
{
  "field_name": {
    "selector": ".css-selector img",
    "type": "image"
  }
}
```

Image fields allow URL input for images.

### Collections

```json
{
  "collection_name": {
    "selector": ".item-container",
    "itemSelector": ".item",
    "fields": {
      "title": {
        "selector": ".item-title",
        "type": "text"
      }
    }
  }
}
```

Collections support repeating items with fields.

## Integration with Vue Reactive System

The editor integrates with Vue's reactivity through a global state object:

```typescript
// In your composable
export function useEditorContent(pageName: string) {
  const editorState = reactive({
    isPreviewMode: false,
    content: {},
    hasChanges: {},
  });

  // Expose to editor overlay
  if (import.meta.client) {
    window.__editorState = editorState;
  }

  return { content, hasChanges };
}
```

When the editor updates a field, it modifies `window.__editorState.content`, triggering Vue's reactivity and re-rendering the UI instantly.

## Server API Requirements

The editor requires a server endpoint to handle saves:

```typescript
// server/api/cms/save.post.ts
export default defineEventHandler(async (event) => {
  const authHeader = getHeader(event, 'authorization');
  const token = authHeader?.substring(7); // Remove 'Bearer '

  // Verify token with Strapi
  await $fetch(`${strapiUrl}/admin/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const { page, fields, isDraft } = await readBody(event);

  // Save to Strapi
  await $fetch(`${strapiUrl}/api/${page}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: { data: fields },
  });

  if (!isDraft) {
    // Publish if not a draft
    await $fetch(`${strapiUrl}/api/${page}/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  return { success: true };
});
```

## Strapi v5 Configuration

### Enable Public Read Access

For content fetching to work, enable public permissions in Strapi:

1. Go to Settings → Users & Permissions → Roles → Public
2. For each content type, check:
   - ✅ `find`
   - ✅ `findOne`
3. Click Save

Or use the bootstrap file to auto-enable on startup (see converter package).

### Populate Media Fields

Images must be populated in API requests:

```typescript
useFetch(`${strapiUrl}/api/${pageName}`, {
  query: { populate: '*' }
});
```

The editor overlay handles this automatically.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires:
- ES2020 features
- IndexedDB for draft storage
- Fetch API for network requests

## TypeScript Support

Full TypeScript definitions included. Import types:

```typescript
import type {
  EditorConfig,
  EditorInstance,
  AuthManager,
  DraftStorage,
  ManifestLoader,
} from '@see-ms/editor-overlay';
```

## Contributing

This package is part of the [see-ms](https://github.com/your-org/see-ms) monorepo.

## License

MIT

## Related Packages

- **[@see-ms/converter](../converter)**: Convert Webflow exports to Nuxt + CMS setup
- **[@see-ms/types](../types)**: Shared TypeScript types

## Support

For issues, questions, or feature requests, please open an issue on the [GitHub repository](https://github.com/your-org/see-ms).

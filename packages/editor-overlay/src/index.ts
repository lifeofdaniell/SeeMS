/**
 * @see-ms/editor-overlay
 * Client-side inline editing overlay
 */

export { initEditor } from './editor';
export { createToolbar, Toolbar } from './toolbar';
export { Highlighter } from './highlighter';
export { createAuthManager, AuthManager } from './auth';
export { createLoginModal, showLoginModal } from './login-modal';
export { DraftStorageManager, createDraftStorage } from './draft-storage';
export { URLStateManager, createURLStateManager } from './url-state';
export { ManifestLoader, createManifestLoader, loadManifest, getCurrentPageFromRoute } from './manifest-loader';
export { NavigationGuard, createNavigationGuard } from './navigation-guard';
export { PageNavigator, createPageNavigator } from './page-navigator';
export { ChangesIndicator, createChangesIndicator } from './changes-indicator';

export type { EditorConfig, EditorInstance, EditableElement, ToolbarButton } from './types';
export type { ToolbarConfig } from './toolbar';
export type { AuthConfig, AuthCredentials, AuthResponse } from './auth';
export type { LoginModalConfig } from './login-modal';
export type { DraftData, DraftStorageConfig } from './draft-storage';
export type { URLState, URLStateCallback } from './url-state';
export type { CMSManifest, ManifestPage, ManifestField } from './manifest-loader';
export type { NavigationGuardConfig } from './navigation-guard';
export type { PageNavigatorConfig } from './page-navigator';
export type { ChangesIndicatorConfig } from './changes-indicator';

/**
 * Auto-initialize if ?preview=true is in URL
 * NOTE: This is disabled by default to prevent conflicts with framework plugins (Nuxt, etc.)
 * Uncomment this block only if using the editor-overlay as a standalone library
 */
// if (typeof window !== 'undefined') {
//   const params = new URLSearchParams(window.location.search);
//
//   if (params.get('preview') === 'true') {
//     // Wait for DOM to be ready
//     if (document.readyState === 'loading') {
//       document.addEventListener('DOMContentLoaded', initPreviewMode);
//     } else {
//       initPreviewMode();
//     }
//   }
// }

// Standalone initialization function (currently disabled)
// async function initPreviewMode() {
//   const { initEditor } = require('./editor');
//   const { createToolbar } = require('./toolbar');
//   const { createDraftStorage } = require('./draft-storage');
//   const { createURLStateManager } = require('./url-state');
//   const { createManifestLoader, getCurrentPageFromRoute } = require('./manifest-loader');
//   const { createNavigationGuard } = require('./navigation-guard');
//
//   // Initialize all dependencies
//   const draftStorage = createDraftStorage();
//   const urlState = createURLStateManager();
//   const manifestLoader = createManifestLoader();
//   const navigationGuard = createNavigationGuard();
//
//   // Load manifest
//   await manifestLoader.load();
//
//   // Get current page from route
//   const currentPage = getCurrentPageFromRoute();
//
//   const editor = initEditor({
//     apiEndpoint: '/api/cms/save',
//     richText: true,
//     draftStorage,
//     currentPage,
//     manifestLoader,
//   });
//
//   editor.enable();
//
//   // Create toolbar with all dependencies
//   const toolbar = await createToolbar(editor, {
//     draftStorage,
//     urlState,
//     navigationGuard,
//     manifestLoader,
//     currentPage,
//   });
//
//   document.body.appendChild(toolbar);
// }

/**
 * @see-ms/editor-overlay
 * Client-side inline editing overlay
 */

export { initEditor } from './editor';
export { createToolbar } from './toolbar';
export { Highlighter } from './highlighter';
export type { EditorConfig, EditorInstance, EditableElement, ToolbarButton } from './types';

/**
 * Auto-initialize if ?preview=true is in URL
 */
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  
  if (params.get('preview') === 'true') {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPreviewMode);
    } else {
      initPreviewMode();
    }
  }
}

function initPreviewMode() {
  const { initEditor } = require('./editor');
  const { createToolbar } = require('./toolbar');
  
  const editor = initEditor({
    apiEndpoint: '/api/cms/save',
    richText: true,
  });
  
  editor.enable();
  
  const toolbar = createToolbar(editor);
  document.body.appendChild(toolbar);
}

/**
 * Toolbar UI for editor controls
 */

import type { EditorInstance } from './types';

export function createToolbar(editor: EditorInstance): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.id = 'cms-editor-toolbar';
  toolbar.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    padding: 12px 16px;
    display: flex;
    gap: 12px;
    align-items: center;
    z-index: 9999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
  `;

  // Status indicator
  const status = document.createElement('span');
  status.textContent = '✏️ Edit Mode';
  status.style.cssText = `
    color: #3b82f6;
    font-weight: 600;
  `;
  toolbar.appendChild(status);

  // Save button
  const saveBtn = createButton('💾 Save', 'primary');
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Saving...';
    
    try {
      await editor.save();
      saveBtn.textContent = '✅ Saved!';
      setTimeout(() => {
        saveBtn.textContent = '💾 Save';
        saveBtn.disabled = false;
      }, 2000);
    } catch (error) {
      saveBtn.textContent = '❌ Failed';
      setTimeout(() => {
        saveBtn.textContent = '💾 Save';
        saveBtn.disabled = false;
      }, 2000);
    }
  };
  toolbar.appendChild(saveBtn);

  // Discard button
  const discardBtn = createButton('↺ Discard', 'secondary');
  discardBtn.onclick = () => {
    if (confirm('Discard all changes?')) {
      editor.discard();
    }
  };
  toolbar.appendChild(discardBtn);

  // Exit button
  const exitBtn = createButton('✕ Exit', 'secondary');
  exitBtn.onclick = () => {
    editor.disable();
    toolbar.remove();
    
    // Remove preview query param
    const url = new URL(window.location.href);
    url.searchParams.delete('preview');
    window.history.replaceState({}, '', url.toString());
  };
  toolbar.appendChild(exitBtn);

  return toolbar;
}

/**
 * Create a styled button
 */
function createButton(text: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = text;
  
  const baseStyles = `
    padding: 8px 16px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  `;
  
  const variantStyles = variant === 'primary' 
    ? `
      background: #3b82f6;
      color: white;
    `
    : `
      background: #f3f4f6;
      color: #374151;
    `;
  
  button.style.cssText = baseStyles + variantStyles;
  
  // Hover effect
  button.onmouseenter = () => {
    if (variant === 'primary') {
      button.style.background = '#2563eb';
    } else {
      button.style.background = '#e5e7eb';
    }
  };
  
  button.onmouseleave = () => {
    if (variant === 'primary') {
      button.style.background = '#3b82f6';
    } else {
      button.style.background = '#f3f4f6';
    }
  };
  
  return button;
}

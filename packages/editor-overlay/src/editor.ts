/**
 * Core editor logic
 */

import type { EditorConfig, EditorInstance, EditableElement } from './types';
import { Highlighter } from './highlighter';

export function initEditor(config: EditorConfig): EditorInstance {
  const highlighter = new Highlighter();
  const editableElements = new Map<HTMLElement, EditableElement>();
  let isEnabled = false;
  let activeEditor: HTMLElement | null = null;

  /**
   * Find all editable elements based on manifest
   */
  function findEditableElements(): void {
    // TODO: Load manifest and find elements
    // For now, we'll detect common editable patterns
    const selectors = [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p',
      'img',
      '[data-editable]'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        const element = el as HTMLElement;
        
        // Skip elements inside buttons or nav
        if (element.closest('button, nav, footer')) return;
        
        const fieldType = element.tagName === 'IMG' ? 'image' : 'text';
        const fieldName = element.className || element.tagName.toLowerCase();
        
        editableElements.set(element, {
          element,
          selector,
          fieldName,
          fieldType,
          originalValue: fieldType === 'image' 
            ? (element as HTMLImageElement).src 
            : element.textContent || '',
          currentValue: fieldType === 'image' 
            ? (element as HTMLImageElement).src 
            : element.textContent || '',
          isDirty: false,
        });
      });
    });
  }

  /**
   * Handle hover events
   */
  function handleMouseEnter(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    
    if (editableElements.has(target)) {
      highlighter.highlight(target);
      target.style.cursor = 'pointer';
    }
  }

  function handleMouseLeave(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    
    if (editableElements.has(target) && target !== activeEditor) {
      highlighter.unhighlight();
      target.style.cursor = '';
    }
  }

  /**
   * Handle click to edit
   */
  function handleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    
    if (!editableElements.has(target)) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const elementData = editableElements.get(target)!;
    
    if (elementData.fieldType === 'text') {
      startTextEdit(target, elementData);
    } else if (elementData.fieldType === 'image') {
      startImageEdit(target, elementData);
    }
  }

  /**
   * Start editing text
   */
  function startTextEdit(element: HTMLElement, data: EditableElement): void {
    activeEditor = element;
    element.contentEditable = 'true';
    element.focus();
    
    // Select all text
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    
    // Handle blur (save)
    const handleBlur = () => {
      element.contentEditable = 'false';
      data.currentValue = element.textContent || '';
      data.isDirty = data.currentValue !== data.originalValue;
      activeEditor = null;
      element.removeEventListener('blur', handleBlur);
    };
    
    element.addEventListener('blur', handleBlur);
  }

  /**
   * Start editing image
   */
  function startImageEdit(element: HTMLElement, data: EditableElement): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = element as HTMLImageElement;
        img.src = event.target?.result as string;
        data.currentValue = img.src;
        data.isDirty = true;
      };
      reader.readAsDataURL(file);
    };
    
    input.click();
  }

  /**
   * Enable editing mode
   */
  function enable(): void {
    if (isEnabled) return;
    
    isEnabled = true;
    findEditableElements();
    
    // Attach event listeners
    editableElements.forEach((_, element) => {
      element.addEventListener('mouseenter', handleMouseEnter);
      element.addEventListener('mouseleave', handleMouseLeave);
      element.addEventListener('click', handleClick);
    });
    
    // Handle scroll
    window.addEventListener('scroll', () => highlighter.updatePosition());
  }

  /**
   * Disable editing mode
   */
  function disable(): void {
    if (!isEnabled) return;
    
    isEnabled = false;
    highlighter.unhighlight();
    
    // Remove event listeners
    editableElements.forEach((_, element) => {
      element.removeEventListener('mouseenter', handleMouseEnter);
      element.removeEventListener('mouseleave', handleMouseLeave);
      element.removeEventListener('click', handleClick);
      element.style.cursor = '';
    });
  }

  /**
   * Save all changes
   */
  async function save(): Promise<void> {
    const changes: Record<string, any> = {};
    
    editableElements.forEach((data) => {
      if (data.isDirty) {
        changes[data.fieldName] = data.currentValue;
      }
    });
    
    if (Object.keys(changes).length === 0) {
      console.log('No changes to save');
      return;
    }
    
    // Send to API
    try {
      const response = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.authToken && { 'Authorization': `Bearer ${config.authToken}` }),
        },
        body: JSON.stringify(changes),
      });
      
      if (!response.ok) {
        throw new Error('Failed to save changes');
      }
      
      // Mark as saved
      editableElements.forEach((data) => {
        if (data.isDirty) {
          data.originalValue = data.currentValue;
          data.isDirty = false;
        }
      });
      
      console.log('Changes saved successfully');
    } catch (error) {
      console.error('Failed to save:', error);
      throw error;
    }
  }

  /**
   * Discard all changes
   */
  function discard(): void {
    editableElements.forEach((data) => {
      if (data.isDirty) {
        if (data.fieldType === 'image') {
          (data.element as HTMLImageElement).src = data.originalValue;
        } else {
          data.element.textContent = data.originalValue;
        }
        data.currentValue = data.originalValue;
        data.isDirty = false;
      }
    });
  }

  /**
   * Cleanup
   */
  function destroy(): void {
    disable();
    highlighter.destroy();
    editableElements.clear();
  }

  return {
    enable,
    disable,
    isEnabled: () => isEnabled,
    save,
    discard,
    destroy,
  };
}

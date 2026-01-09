/**
 * Core editor logic
 */

import type { EditorConfig, EditorInstance, EditableElement } from "./types";
import { Highlighter } from "./highlighter";
import type { ManifestLoader } from "./manifest-loader";
import type { DraftStorageManager } from "./draft-storage";

export interface EnhancedEditorConfig extends EditorConfig {
  manifestLoader?: ManifestLoader;
  draftStorage?: DraftStorageManager;
  currentPage?: string;
}

export function initEditor(config: EnhancedEditorConfig): EditorInstance {
  const highlighter = new Highlighter();
  const editableElements = new Map<HTMLElement, EditableElement>();
  let isEnabled = false;
  let activeEditor: HTMLElement | null = null;
  let currentPage: string | null = config.currentPage || null;
  let debouncers = new Map<string, NodeJS.Timeout>();

  /**
   * Find all editable elements based on manifest
   */
  function findEditableElements(): void {
    editableElements.clear();

    // If manifest loader is provided, use it
    if (config.manifestLoader && currentPage) {
      const fields = config.manifestLoader.getEditableFields(currentPage);

      Object.entries(fields).forEach(([fieldName, field]) => {
        const elements = document.querySelectorAll(field.selector);

        elements.forEach(el => {
          const element = el as HTMLElement;

          // Skip elements inside buttons or nav
          if (element.closest("button, nav, footer")) return;

          const fieldType = element.tagName === "IMG" ? "image" :
            field.type === "rich" ? "rich" : "plain";

          // Mark element as editable for navigation guard
          element.setAttribute('data-cms-editable', 'true');
          element.setAttribute('data-cms-field', fieldName);

          editableElements.set(element, {
            element,
            selector: field.selector,
            fieldName,
            fieldType,
            originalValue: fieldType === "image"
              ? (element as HTMLImageElement).src
              : element.textContent || "",
            currentValue: fieldType === "image"
              ? (element as HTMLImageElement).src
              : element.textContent || "",
            isDirty: false
          });
        });
      });
    } else {
      // Fallback to hardcoded selectors if no manifest
      const selectors = [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p",
        "img",
        "[data-editable]"
      ];

      selectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          const element = el as HTMLElement;

          // Skip elements inside buttons or nav
          if (element.closest("button, nav, footer")) return;

          const fieldType = element.tagName === "IMG" ? "image" : "text";
          const fieldName = element.className || element.tagName.toLowerCase();

          editableElements.set(element, {
            element,
            selector,
            fieldName,
            fieldType,
            originalValue: fieldType === "image"
              ? (element as HTMLImageElement).src
              : element.textContent || "",
            currentValue: fieldType === "image"
              ? (element as HTMLImageElement).src
              : element.textContent || "",
            isDirty: false
          });
        });
      });
    }
  }

  /**
   * Handle hover events
   */
  function handleMouseEnter(e: MouseEvent): void {
    const element = e.currentTarget as HTMLElement;

    if (editableElements.has(element)) {
      highlighter.highlight(element);
      element.style.cursor = "pointer";
    }
  }

  function handleMouseLeave(e: MouseEvent): void {
    const element = e.currentTarget as HTMLElement;

    if (editableElements.has(element) && element !== activeEditor) {
      highlighter.unhighlight();
      element.style.cursor = "";
    }
  }

  /**
   * Handle click to edit
   */
  function handleClick(e: MouseEvent): void {
    const element = e.currentTarget as HTMLElement;

    if (!editableElements.has(element)) return;

    e.preventDefault();
    e.stopPropagation();

    const elementData = editableElements.get(element)!;

    if (elementData.fieldType === "image") {
      startImageEdit(element, elementData);
    } else {
      // Handle text, plain, and rich field types
      startTextEdit(element, elementData);
    }
  }

  /**
   * Start editing text
   */
  function startTextEdit(element: HTMLElement, data: EditableElement): void {
    activeEditor = element;
    element.contentEditable = "true";
    element.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    // Handle blur (save)
    const handleBlur = () => {
      element.contentEditable = "false";
      data.currentValue = element.textContent || "";
      data.isDirty = data.currentValue !== data.originalValue;
      activeEditor = null;
      element.removeEventListener("blur", handleBlur);

      // Auto-save draft on blur (debounced)
      if (config.draftStorage && currentPage && data.isDirty) {
        saveToDraft(data.fieldName, data.currentValue);
      }
    };

    element.addEventListener("blur", handleBlur);
  }

  /**
   * Save field to draft (debounced 300ms)
   */
  function saveToDraft(fieldName: string, value: any): void {
    if (!config.draftStorage || !currentPage) return;

    // Clear existing debouncer
    const existing = debouncers.get(fieldName);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new debouncer
    const timeout = setTimeout(() => {
      config.draftStorage!.saveDraft(currentPage!, fieldName, value, 0);
      debouncers.delete(fieldName);
    }, 300);

    debouncers.set(fieldName, timeout);
  }

  /**
   * Start editing image
   */
  function startImageEdit(element: HTMLElement, data: EditableElement): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

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
  async function enable(): Promise<void> {
    if (isEnabled) return;

    isEnabled = true;
    findEditableElements();

    // Load drafts if available
    if (config.draftStorage && currentPage) {
      const draft = await config.draftStorage.loadDraft(currentPage);
      if (draft) {
        applyDraft(draft.fields);
      }
    }

    // Attach event listeners
    editableElements.forEach((_, element) => {
      element.addEventListener("mouseenter", handleMouseEnter);
      element.addEventListener("mouseleave", handleMouseLeave);
      element.addEventListener("click", handleClick);
    });

    // Handle scroll
    window.addEventListener("scroll", () => highlighter.updatePosition());
  }

  /**
   * Apply draft data to elements
   */
  function applyDraft(fields: Record<string, any>): void {
    editableElements.forEach((data) => {
      if (fields[data.fieldName] !== undefined) {
        const value = fields[data.fieldName];

        if (data.fieldType === "image") {
          (data.element as HTMLImageElement).src = value;
        } else {
          data.element.textContent = value;
        }

        data.currentValue = value;
        data.isDirty = value !== data.originalValue;
      }
    });
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
      element.removeEventListener("mouseenter", handleMouseEnter);
      element.removeEventListener("mouseleave", handleMouseLeave);
      element.removeEventListener("click", handleClick);
      element.style.cursor = "";
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
      console.log("No changes to save");
      return;
    }

    // Send to API with page context
    try {
      const response = await fetch(config.apiEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.authToken && { "Authorization": `Bearer ${config.authToken}` })
        },
        body: JSON.stringify({
          page: currentPage,
          fields: changes,
          isDraft: true
        })
      });

      if (!response.ok) {
        throw new Error("Failed to save changes");
      }

      // Mark as saved
      editableElements.forEach((data) => {
        if (data.isDirty) {
          data.originalValue = data.currentValue;
          data.isDirty = false;
        }
      });

      // Clear draft from storage after successful save
      if (config.draftStorage && currentPage) {
        await config.draftStorage.clearDraft(currentPage);
      }

      console.log("Changes saved successfully");
    } catch (error) {
      console.error("Failed to save:", error);
      throw error;
    }
  }

  /**
   * Discard all changes
   */
  function discard(): void {
    editableElements.forEach((data) => {
      if (data.isDirty) {
        if (data.fieldType === "image") {
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
   * Switch to a different page
   */
  async function setPage(pageName: string): Promise<void> {
    // Disable current page
    if (isEnabled) {
      disable();
    }

    // Update current page
    currentPage = pageName;

    // Re-enable with new page
    if (isEnabled) {
      await enable();
    }
  }

  /**
   * Load draft for a specific page
   */
  async function loadPageDraft(pageName: string): Promise<void> {
    if (!config.draftStorage) return;

    const draft = await config.draftStorage.loadDraft(pageName);
    if (draft) {
      applyDraft(draft.fields);
    }
  }

  /**
   * Get current page name
   */
  function getCurrentPage(): string | null {
    return currentPage;
  }

  /**
   * Cleanup
   */
  function destroy(): void {
    // Clear all debouncers
    debouncers.forEach((timeout) => clearTimeout(timeout));
    debouncers.clear();

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
    setPage,
    loadPageDraft,
    getCurrentPage,
    applyDraft: (fields: Record<string, any>) => applyDraft(fields)
  };
}

/**
 * Core editor logic
 */

import type { EditorConfig, EditorInstance, EditableElement, LinkFieldValue } from "./types";
import { Highlighter } from "./highlighter";
import type { ManifestLoader } from "./manifest-loader";
import type { DraftStorageManager } from "./draft-storage";

export interface EnhancedEditorConfig extends EditorConfig {
  manifestLoader?: ManifestLoader;
  draftStorage?: DraftStorageManager;
  currentPage?: string;
}

/**
 * The Nth non-empty direct text node of an element. Mirrors the manifest's
 * `textNodeIndex` convention so the overlay edits the exact text run a field
 * maps to (e.g. one line of a <br>-split heading) without touching siblings.
 */
function getNthTextNode(element: HTMLElement, index: number): Text | null {
  const runs: Text[] = [];
  element.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE && (n.nodeValue || "").trim()) runs.push(n as Text);
  });
  return runs[index] || null;
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
        let elements: NodeListOf<Element>;
        try {
          elements = document.querySelectorAll(field.selector);
        } catch (error) {
          console.warn(`[CMS Editor] Invalid selector for field "${fieldName}": ${field.selector}`, error);
          return;
        }

        elements.forEach(el => {
          const element = el as HTMLElement;

          // Skip button chrome unless it is explicitly mapped as editable.
          if (field.type !== 'link' && element.closest("button") && !element.hasAttribute("data-cms-editable")) return;

          // Determine field type
          let fieldType: string;
          if (element.tagName === "IMG" || field.type === "icon") {
            fieldType = "image";
          } else if (field.type === "link" || element.tagName === "A") {
            fieldType = "link";
          } else if (field.type === "rich") {
            fieldType = "rich";
          } else {
            fieldType = "plain";
          }

          // Mark element as editable for navigation guard
          element.setAttribute('data-cms-editable', 'true');
          element.setAttribute('data-cms-field', fieldName);

          // Get value based on field type
          let originalValue: string | LinkFieldValue;
          if (fieldType === "image") {
            originalValue = (element as HTMLImageElement).src;
          } else if (fieldType === "link") {
            const linkEl = element.tagName === "A" || element.tagName.toLowerCase() === "nuxt-link"
              ? element as HTMLAnchorElement
              : element.querySelector("a, nuxt-link");
            originalValue = {
              url: linkEl?.getAttribute("href") || linkEl?.getAttribute("to") || "",
              text: linkEl?.textContent?.trim() || "",
              newTab: linkEl?.getAttribute("target") === "_blank"
            };
          } else if (typeof field.textNodeIndex === "number") {
            // Field maps to one direct text run, not the whole element.
            originalValue = (getNthTextNode(element, field.textNodeIndex)?.nodeValue || "").trim();
          } else {
            originalValue = element.textContent || "";
          }

          editableElements.set(element, {
            element,
            selector: field.selector,
            fieldName,
            fieldType,
            originalValue,
            currentValue: fieldType === "link"
              ? { ...(originalValue as LinkFieldValue) }
              : originalValue as string,
            isDirty: false,
            textNodeIndex: field.textNodeIndex,
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
    } else if (elementData.fieldType === "link") {
      startLinkEdit(element, elementData);
    } else if (typeof elementData.textNodeIndex === "number") {
      // Field is one text run of a multi-part element (e.g. a <br>-split heading
      // or text beside a styled <span>). Edit just that run.
      startTextNodeEdit(elementData);
    } else {
      // Handle text, plain, and rich field types
      startTextEdit(element, elementData);
    }
  }

  /**
   * Edit a single direct text run of an element (textNodeIndex field).
   * Uses a prompt rather than contenteditable so editing one run can't disturb
   * sibling runs or inline markup in the same element.
   */
  function startTextNodeEdit(data: EditableElement): void {
    const node = getNthTextNode(data.element, data.textNodeIndex!);
    const currentValue = (node?.nodeValue || "").trim();
    const next = window.prompt("Edit text", currentValue);
    if (next == null || next === currentValue) return;

    if (node) {
      // Preserve the run's surrounding whitespace (the separator before/after a
      // sibling) so spacing/line breaks survive.
      const raw = node.nodeValue || "";
      const m = raw.match(/^(\s*)[\s\S]*?(\s*)$/);
      node.nodeValue = `${m ? m[1] : ""}${next}${m ? m[2] : ""}`;
    }

    data.currentValue = next;
    data.isDirty = true;
    updateReactiveState(data.fieldName, next);

    if (config.draftStorage && currentPage) {
      saveToDraft(data.fieldName, next);
    }
  }

  /**
   * Start editing text
   */
  function startTextEdit(element: HTMLElement, data: EditableElement): void {
    activeEditor = element;
    element.contentEditable = "true";
    element.style.outline = "2px solid #3b82f6";
    element.style.outlineOffset = "2px";
    if (data.fieldType === "rich") {
      showRichTextMiniToolbar(element);
    }
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
      element.style.outline = "";
      element.style.outlineOffset = "";
      data.currentValue = data.fieldType === "rich" ? element.innerHTML : element.textContent || "";
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
   * Start editing link (shows modal)
   */
  function startLinkEdit(element: HTMLElement, data: EditableElement): void {
    const currentValue = data.currentValue as LinkFieldValue;

    // Create modal overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100001;
    `;

    // Create modal
    const modal = document.createElement("div");
    modal.style.cssText = `
      background: white;
      border-radius: 8px;
      padding: 24px;
      width: 400px;
      max-width: 90vw;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      font-family: system-ui, -apple-system, sans-serif;
      color: #1f2937;
    `;

    modal.innerHTML = `
      <h3 style="margin: 0 0 16px; font-size: 18px; font-weight: 600; color: #1f2937;">Edit Link</h3>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500; color: #374151;">Link Text</label>
        <input type="text" id="cms-link-text" value="${escapeHtml(currentValue.text)}" style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
          color: #1f2937;
        " />
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 4px; font-size: 14px; font-weight: 500; color: #374151;">URL</label>
        <input type="text" id="cms-link-url" value="${escapeHtml(currentValue.url)}" style="
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          box-sizing: border-box;
          color: #1f2937;
        " />
      </div>
      <div style="margin-bottom: 20px;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 14px; color: #374151;">
          <input type="checkbox" id="cms-link-newtab" ${currentValue.newTab ? 'checked' : ''} style="
            width: 16px;
            height: 16px;
            accent-color: #3b82f6;
          " />
          Open in new tab
        </label>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="cms-link-cancel" style="
          padding: 8px 16px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: white;
          cursor: pointer;
          font-size: 14px;
          color: #374151;
        ">Cancel</button>
        <button id="cms-link-save" style="
          padding: 8px 16px;
          border: none;
          border-radius: 6px;
          background: #3b82f6;
          color: white;
          cursor: pointer;
          font-size: 14px;
        ">Save</button>
      </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Get form elements
    const textInput = modal.querySelector("#cms-link-text") as HTMLInputElement;
    const urlInput = modal.querySelector("#cms-link-url") as HTMLInputElement;
    const newTabCheckbox = modal.querySelector("#cms-link-newtab") as HTMLInputElement;
    const cancelBtn = modal.querySelector("#cms-link-cancel") as HTMLButtonElement;
    const saveBtn = modal.querySelector("#cms-link-save") as HTMLButtonElement;

    // Focus text input
    textInput.focus();
    textInput.select();

    // Handle cancel
    const handleCancel = () => {
      document.body.removeChild(overlay);
    };

    // Handle save
    const handleSave = () => {
      const newValue: LinkFieldValue = {
        url: urlInput.value,
        text: textInput.value,
        newTab: newTabCheckbox.checked || undefined
      };

      // Update element
      const linkEl = element.tagName === "A" || element.tagName.toLowerCase() === "nuxt-link"
        ? element as HTMLAnchorElement
        : element.querySelector("a, nuxt-link");

      if (linkEl) {
        if (linkEl.tagName.toLowerCase() === "nuxt-link") {
          linkEl.setAttribute("to", newValue.url);
        } else {
          (linkEl as HTMLAnchorElement).href = newValue.url;
        }
        linkEl.textContent = newValue.text;
        if (newValue.newTab) {
          (linkEl as HTMLElement).setAttribute("target", "_blank");
        } else {
          linkEl.removeAttribute("target");
        }
      }

      // Update data
      data.currentValue = newValue;
      data.isDirty = JSON.stringify(newValue) !== JSON.stringify(data.originalValue);

      // Save to draft
      if (config.draftStorage && currentPage && data.isDirty) {
        saveToDraft(data.fieldName, newValue);
      }

      document.body.removeChild(overlay);
    };

    // Handle escape key
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        handleSave();
      }
    };

    cancelBtn.addEventListener("click", handleCancel);
    saveBtn.addEventListener("click", handleSave);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) handleCancel();
    });
    document.addEventListener("keydown", handleKeydown);

    // Cleanup on close
    const cleanup = () => {
      document.removeEventListener("keydown", handleKeydown);
    };

    cancelBtn.addEventListener("click", cleanup);
    saveBtn.addEventListener("click", cleanup);
  }

  /**
   * Escape HTML special characters
   */
  function escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Update reactive Vue state
   */
  function updateReactiveState(fieldName: string, value: any): void {
    if (!currentPage) return;

    // Access global editor state exposed by useEditorContent
    const editorState = (window as any).__editorState;
    if (editorState) {
      // Ensure page content object exists
      if (!editorState.content[currentPage]) {
        editorState.content[currentPage] = {};
      }

      // Update the field value (Vue will reactively update UI)
      editorState.content[currentPage][fieldName] = value;
      editorState.hasChanges[currentPage] = true;
    }
  }

  /**
   * Save field to draft (debounced 300ms)
   */
  function saveToDraft(fieldName: string, value: any): void {
    if (!config.draftStorage || !currentPage) return;

    // Update reactive state immediately (for instant UI update)
    updateReactiveState(fieldName, value);

    // Clear existing debouncer
    const existing = debouncers.get(fieldName);
    if (existing) {
      clearTimeout(existing);
    }

    // Set new debouncer for persistent storage
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
    const currentValue = data.currentValue as string;
    const newSrc = window.prompt("Image or icon URL/path", currentValue);
    if (!newSrc || newSrc === currentValue) return;

    const img = element.tagName === "IMG"
      ? element as HTMLImageElement
      : element.querySelector("img") as HTMLImageElement | null;

    if (img) {
      img.src = newSrc;
    }

    data.currentValue = newSrc;
    data.isDirty = true;
    updateReactiveState(data.fieldName, newSrc);

    if (config.draftStorage && currentPage) {
      saveToDraft(data.fieldName, newSrc);
    }
  }

  function showRichTextMiniToolbar(element: HTMLElement): void {
    const existing = document.getElementById("cms-richtext-toolbar");
    existing?.remove();

    const toolbar = document.createElement("div");
    toolbar.id = "cms-richtext-toolbar";
    toolbar.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100002;
      display: flex;
      gap: 6px;
      padding: 8px;
      border-radius: 8px;
      background: #111827;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
      font-family: system-ui, -apple-system, sans-serif;
    `;

    const commands = [
      { label: "B", command: "bold" },
      { label: "I", command: "italic" },
      { label: "UL", command: "insertUnorderedList" },
      { label: "OL", command: "insertOrderedList" }
    ];

    commands.forEach(({ label, command }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.style.cssText = `
        min-width: 32px;
        height: 30px;
        border: 0;
        border-radius: 6px;
        background: #f9fafb;
        color: #111827;
        font-weight: 700;
        cursor: pointer;
      `;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        document.execCommand(command);
        element.focus();
      });
      toolbar.appendChild(button);
    });

    document.body.appendChild(toolbar);
    element.addEventListener("blur", () => toolbar.remove(), { once: true });
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
    // Update reactive state for all draft fields
    Object.entries(fields).forEach(([fieldName, value]) => {
      updateReactiveState(fieldName, value);
    });

    // Update element tracking
    editableElements.forEach((data) => {
      if (fields[data.fieldName] !== undefined) {
        const value = fields[data.fieldName];
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
          (data.element as HTMLImageElement).src = data.originalValue as string;
        } else if (data.fieldType === "link") {
          const originalLink = data.originalValue as LinkFieldValue;
          const linkEl = data.element.tagName === "A" || data.element.tagName.toLowerCase() === "nuxt-link"
            ? data.element as HTMLAnchorElement
            : data.element.querySelector("a, nuxt-link");
          if (linkEl) {
            if (linkEl.tagName.toLowerCase() === "nuxt-link") {
              linkEl.setAttribute("to", originalLink.url);
            } else {
              (linkEl as HTMLAnchorElement).href = originalLink.url;
            }
            linkEl.textContent = originalLink.text;
            if (originalLink.newTab) {
              (linkEl as HTMLElement).setAttribute("target", "_blank");
            } else {
              linkEl.removeAttribute("target");
            }
          }
        } else if (typeof data.textNodeIndex === "number") {
          const node = getNthTextNode(data.element, data.textNodeIndex);
          if (node) {
            const raw = node.nodeValue || "";
            const m = raw.match(/^(\s*)[\s\S]*?(\s*)$/);
            node.nodeValue = `${m ? m[1] : ""}${data.originalValue as string}${m ? m[2] : ""}`;
          }
        } else {
          data.element.textContent = data.originalValue as string;
        }
        data.currentValue = data.fieldType === "link"
          ? { ...(data.originalValue as LinkFieldValue) }
          : data.originalValue;
        data.isDirty = false;
      }
    });
  }

  /**
   * Switch to a different page
   */
  async function setPage(pageName: string): Promise<void> {
    const wasEnabled = isEnabled;
    // Disable current page
    if (wasEnabled) {
      disable();
    }

    // Update current page
    currentPage = pageName;

    // Re-enable with new page
    if (wasEnabled) {
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

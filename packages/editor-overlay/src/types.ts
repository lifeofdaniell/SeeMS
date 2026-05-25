/**
 * Editor overlay type definitions
 */

/**
 * Link field value structure (same as @see-ms/types)
 */
export interface LinkFieldValue {
  /** The link URL/href */
  url: string;
  /** The visible link text */
  text: string;
  /** Whether to open in new tab */
  newTab?: boolean;
}

export interface EditorConfig {
  /** API endpoint for saving changes */
  apiEndpoint: string;
  /** Authentication token */
  authToken?: string;
  /** Enable rich text editing */
  richText?: boolean;
  /** Custom toolbar buttons */
  customButtons?: ToolbarButton[];
  /** Draft storage manager */
  draftStorage?: any;
  /** Current page name */
  currentPage?: string;
  /** Manifest loader */
  manifestLoader?: any;
}

export interface EditorInstance {
  /** Enable editing mode */
  enable: () => Promise<void>;
  /** Disable editing mode */
  disable: () => void;
  /** Check if editing is enabled */
  isEnabled: () => boolean;
  /** Save all pending changes */
  save: () => Promise<void>;
  /** Discard all pending changes */
  discard: () => void;
  /** Destroy the editor instance */
  destroy: () => void;
  /** Switch to a different page */
  setPage: (pageName: string) => Promise<void>;
  /** Load draft for a specific page */
  loadPageDraft: (pageName: string) => Promise<void>;
  /** Get current page name */
  getCurrentPage: () => string | null;
  /** Apply draft data to elements */
  applyDraft: (fields: Record<string, any>) => void;
}

export interface ToolbarButton {
  icon: string;
  label: string;
  action: () => void;
}

export interface EditableElement {
  element: HTMLElement;
  selector: string;
  fieldName: string;
  fieldType: string;
  /** Original value - can be string or LinkFieldValue for link fields */
  originalValue: string | LinkFieldValue;
  /** Current value - can be string or LinkFieldValue for link fields */
  currentValue: string | LinkFieldValue;
  isDirty: boolean;
}

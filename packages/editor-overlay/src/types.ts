/**
 * Editor overlay type definitions
 */

export interface EditorConfig {
  /** API endpoint for saving changes */
  apiEndpoint: string;
  /** Authentication token */
  authToken?: string;
  /** Enable rich text editing */
  richText?: boolean;
  /** Custom toolbar buttons */
  customButtons?: ToolbarButton[];
}

export interface EditorInstance {
  /** Enable editing mode */
  enable: () => void;
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
  originalValue: string;
  currentValue: string;
  isDirty: boolean;
}

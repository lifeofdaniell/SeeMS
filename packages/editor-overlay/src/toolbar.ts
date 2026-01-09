/**
 * Toolbar UI for editor controls
 * Fixed bottom layout with page navigation, changes tracking, and publishing
 */

import type { EditorInstance } from './types';
import type { DraftStorageManager } from './draft-storage';
import type { URLStateManager } from './url-state';
import type { NavigationGuard } from './navigation-guard';
import type { ManifestLoader } from './manifest-loader';
import { PageNavigator } from './page-navigator';
import { ChangesIndicator } from './changes-indicator';

export interface ToolbarConfig {
  editor: EditorInstance;
  draftStorage: DraftStorageManager;
  urlState: URLStateManager;
  navigationGuard: NavigationGuard;
  manifestLoader: ManifestLoader;
  currentPage: string;
}

export class Toolbar {
  private config: ToolbarConfig;
  private element: HTMLElement | null = null;
  private pageNavigator: PageNavigator | null = null;
  private changesIndicator: ChangesIndicator | null = null;

  constructor(config: ToolbarConfig) {
    this.config = config;
  }

  /**
   * Create and return the toolbar element
   */
  public async create(): Promise<HTMLElement> {
    const toolbar = document.createElement('div');
    toolbar.id = 'cms-editor-toolbar';
    toolbar.className = 'cms-editor-toolbar';

    // Apply styles
    this.applyStyles(toolbar);

    // Create toolbar content container
    const content = document.createElement('div');
    content.className = 'cms-toolbar-content';
    content.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 20px;
    `;

    // Left section: Page Navigator + Exit button
    const leftSection = document.createElement('div');
    leftSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    // Page Navigator
    this.pageNavigator = new PageNavigator({
      manifestLoader: this.config.manifestLoader,
      draftStorage: this.config.draftStorage,
      navigationGuard: this.config.navigationGuard,
      currentPage: this.config.currentPage,
      onPageChange: async (pageName: string, route: string) => {
        await this.handlePageChange(pageName, route);
      },
    });
    const pageNavElement = await this.pageNavigator.create();
    leftSection.appendChild(pageNavElement);

    // Exit button
    const exitBtn = this.createExitButton();
    leftSection.appendChild(exitBtn);

    content.appendChild(leftSection);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flexGrow = '1';
    content.appendChild(spacer);

    // Right section: Changes Indicator + Publish button
    const rightSection = document.createElement('div');
    rightSection.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
    `;

    // Changes Indicator
    this.changesIndicator = new ChangesIndicator({
      draftStorage: this.config.draftStorage,
      onClick: async () => {
        await this.changesIndicator?.showDetailedTooltip();
      },
    });
    const indicatorElement = await this.changesIndicator.create();
    rightSection.appendChild(indicatorElement);

    // Publish button
    const publishBtn = this.createPublishButton();
    rightSection.appendChild(publishBtn);

    content.appendChild(rightSection);
    toolbar.appendChild(content);

    // Add mobile styles
    this.addMobileStyles();

    this.element = toolbar;
    return toolbar;
  }

  /**
   * Apply base toolbar styles
   */
  private applyStyles(toolbar: HTMLElement): void {
    toolbar.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 64px;
      background: white;
      border-top: 1px solid #e5e7eb;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
      z-index: 9999;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
    `;
  }

  /**
   * Add mobile responsive styles
   */
  private addMobileStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      @media (max-width: 768px) {
        .cms-editor-toolbar {
          height: auto;
          min-height: 64px;
          padding: 12px 0;
        }

        .cms-toolbar-content {
          flex-direction: column;
          align-items: stretch !important;
          gap: 8px !important;
        }

        .cms-toolbar-content > div {
          justify-content: center;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Create exit button
   */
  private createExitButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = '✕ Exit';
    button.style.cssText = `
      padding: 8px 16px;
      background: #f3f4f6;
      color: #374151;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.background = '#e5e7eb';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = '#f3f4f6';
    });

    button.addEventListener('click', () => {
      this.exitEditMode();
    });

    return button;
  }

  /**
   * Create publish button
   */
  private createPublishButton(): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = '🚀 Publish';
    button.style.cssText = `
      padding: 8px 24px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    `;

    button.addEventListener('mouseenter', () => {
      button.style.background = '#2563eb';
    });

    button.addEventListener('mouseleave', () => {
      button.style.background = '#3b82f6';
    });

    button.addEventListener('click', async () => {
      await this.publishAll(button);
    });

    return button;
  }

  /**
   * Handle page change from navigator
   */
  private async handlePageChange(_pageName: string, route: string): Promise<void> {
    // Navigate to the page with only preview=true (page is derived from route)
    window.location.href = `${route}?preview=true`;
  }

  /**
   * Exit edit mode
   */
  private exitEditMode(): void {
    // Disable navigation guard
    this.config.navigationGuard.disable();

    // Disable editor
    this.config.editor.disable();

    // Clear preview mode from URL
    this.config.urlState.clearPreviewMode();

    // Remove toolbar
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    // Destroy components
    this.destroy();

    // Reload page to restore Lenis and normal behavior
    window.location.reload();
  }

  /**
   * Publish all changes
   */
  private async publishAll(button: HTMLButtonElement): Promise<void> {
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '⏳ Publishing...';
    button.style.opacity = '0.7';

    try {
      // Get all drafts
      const drafts = await this.config.draftStorage.getAllDrafts();

      if (drafts.length === 0) {
        this.showToast('No changes to publish', 'info');
        return;
      }

      // Prepare pages array for batch publish
      const pages = drafts.map(draft => ({
        page: draft.pageName,
        fields: draft.fields,
      }));

      // Call publish endpoint
      const authToken = this.getAuthToken();
      const response = await fetch('/api/cms/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ pages }),
      });

      if (!response.ok) {
        throw new Error('Failed to publish changes');
      }

      const result = await response.json();

      // Clear drafts for successfully published pages
      if (result.successful && result.successful.length > 0) {
        for (const pageName of result.successful) {
          await this.config.draftStorage.clearDraft(pageName);
        }
      }

      // Always refresh changes indicator
      if (this.changesIndicator) {
        await this.changesIndicator.refresh();
      }

      // Show appropriate message
      if (result.success) {
        this.showToast(`✅ Published ${result.successful.length} page(s)`, 'success');
        button.textContent = '✅ Published!';
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
          button.style.opacity = '1';
        }, 2000);
      } else {
        // Partial success - some failed
        const successCount = result.successful?.length || 0;
        const failCount = result.failed?.length || 0;
        this.showToast(`⚠️ Published ${successCount} page(s), ${failCount} failed`, 'error');

        button.textContent = '⚠️ Partial';
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
          button.style.opacity = '1';
        }, 2000);
      }
    } catch (error) {
      console.error('[Toolbar] Publish error:', error);
      this.showToast('❌ Failed to publish changes', 'error');

      button.textContent = '❌ Failed';
      setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
        button.style.opacity = '1';
      }, 2000);
    }
  }

  /**
   * Get auth token from storage
   */
  private getAuthToken(): string {
    return localStorage.getItem('cms_editor_token') || '';
  }

  /**
   * Show toast notification
   */
  private showToast(message: string, type: 'success' | 'error' | 'info'): void {
    const toast = document.createElement('div');
    toast.textContent = message;

    const bgColors = {
      success: '#10b981',
      error: '#ef4444',
      info: '#3b82f6',
    };

    toast.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: ${bgColors[type]};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
    `;

    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
    });

    // Fade out and remove
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 200);
    }, 3000);
  }

  /**
   * Update current page (called when route changes)
   */
  public async updateCurrentPage(pageName: string): Promise<void> {
    this.config.currentPage = pageName;

    if (this.pageNavigator) {
      await this.pageNavigator.updateCurrentPage(pageName);
    }

    if (this.changesIndicator) {
      await this.changesIndicator.refresh();
    }
  }

  /**
   * Destroy toolbar and cleanup
   */
  public destroy(): void {
    if (this.pageNavigator) {
      this.pageNavigator.destroy();
    }

    if (this.changesIndicator) {
      this.changesIndicator.destroy();
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
  }
}

/**
 * Create a toolbar instance (backwards compatible function)
 */
export async function createToolbar(
  editor: EditorInstance,
  config: Omit<ToolbarConfig, 'editor'>
): Promise<HTMLElement> {
  const toolbar = new Toolbar({
    editor,
    ...config,
  });

  return await toolbar.create();
}
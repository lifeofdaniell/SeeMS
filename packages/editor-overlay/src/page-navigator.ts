/**
 * Page Navigator Component
 * Dropdown menu for navigating between pages with draft indicators
 */

import type { ManifestLoader } from './manifest-loader';
import type { DraftStorageManager } from './draft-storage';
import type { NavigationGuard } from './navigation-guard';

export interface PageNavigatorConfig {
  manifestLoader: ManifestLoader;
  draftStorage: DraftStorageManager;
  navigationGuard: NavigationGuard;
  currentPage: string;
  onPageChange: (pageName: string, route: string) => void;
}

export class PageNavigator {
  private config: PageNavigatorConfig;
  private element: HTMLElement | null = null;
  private dropdownOpen: boolean = false;

  constructor(config: PageNavigatorConfig) {
    this.config = config;
  }

  /**
   * Create and return the page navigator element
   */
  public async create(): Promise<HTMLElement> {
    const container = document.createElement('div');
    container.className = 'cms-page-navigator';
    container.style.cssText = `
      position: relative;
      display: inline-block;
    `;

    // Create button
    const button = document.createElement('button');
    button.className = 'cms-page-navigator-button';
    await this.updateButtonText(button);
    this.styleButton(button);

    // Create dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'cms-page-navigator-dropdown';
    dropdown.style.display = 'none';
    await this.populateDropdown(dropdown);
    this.styleDropdown(dropdown);

    // Toggle dropdown on button click
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown(dropdown);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      if (this.dropdownOpen) {
        this.closeDropdown(dropdown);
      }
    });

    container.appendChild(button);
    container.appendChild(dropdown);

    this.element = container;
    return container;
  }

  /**
   * Update button text with current page
   */
  private async updateButtonText(button: HTMLElement): Promise<void> {
    const pageName = this.config.currentPage;
    const formattedName = this.formatPageName(pageName);

    // Check if page has drafts
    const draft = await this.config.draftStorage.loadDraft(pageName);
    const hasChanges = draft?.metadata.hasChanges || false;

    button.innerHTML = `
      <span class="page-label">Page:</span>
      <span class="page-name">${formattedName}</span>
      ${hasChanges ? '<span class="draft-indicator">●</span>' : ''}
      <span class="dropdown-arrow">▼</span>
    `;
  }

  /**
   * Style the button
   */
  private styleButton(button: HTMLElement): void {
    Object.assign(button.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 16px',
      backgroundColor: '#f5f5f5',
      border: '1px solid #ddd',
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
    });

    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#ebebeb';
    });

    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#f5f5f5';
    });

    // Style draft indicator (yellow dot)
    const style = document.createElement('style');
    style.textContent = `
      .cms-page-navigator-button .draft-indicator {
        color: #fbbf24;
        font-size: 16px;
        line-height: 1;
      }
      .cms-page-navigator-button .dropdown-arrow {
        font-size: 10px;
        opacity: 0.6;
      }
      .cms-page-navigator-button .page-label {
        color: #666;
      }
      .cms-page-navigator-button .page-name {
        font-weight: 600;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Populate dropdown with pages
   */
  private async populateDropdown(dropdown: HTMLElement): Promise<void> {
    const pages = this.config.manifestLoader.getAllPages();
    const drafts = await this.config.draftStorage.getAllDrafts();
    const draftMap = new Map(drafts.map((d) => [d.pageName, d]));

    dropdown.innerHTML = '';

    for (const page of pages) {
      const item = document.createElement('div');
      item.className = 'cms-page-navigator-item';

      const draft = draftMap.get(page.name);
      const hasChanges = draft?.metadata.hasChanges || false;
      const changeCount = hasChanges ? Object.keys(draft!.fields).length : 0;

      const isCurrent = page.name === this.config.currentPage;

      item.innerHTML = `
        <span class="page-name">${this.formatPageName(page.name)}</span>
        ${hasChanges ? `<span class="change-count">(${changeCount} change${changeCount !== 1 ? 's' : ''})</span>` : ''}
        ${isCurrent ? '<span class="current-indicator">✓</span>' : ''}
      `;

      this.styleDropdownItem(item, isCurrent);

      // Handle click
      if (!isCurrent) {
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          await this.handlePageChange(page.name, page.route);
          this.closeDropdown(dropdown);
        });
      }

      dropdown.appendChild(item);
    }
  }

  /**
   * Style dropdown
   */
  private styleDropdown(dropdown: HTMLElement): void {
    Object.assign(dropdown.style, {
      position: 'absolute',
      bottom: 'calc(100% + 8px)',
      left: '0',
      minWidth: '200px',
      maxHeight: '300px',
      overflowY: 'auto',
      backgroundColor: 'white',
      border: '1px solid #ddd',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
      zIndex: '10001',
    });
  }

  /**
   * Style dropdown item
   */
  private styleDropdownItem(item: HTMLElement, isCurrent: boolean): void {
    Object.assign(item.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '10px 16px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      cursor: isCurrent ? 'default' : 'pointer',
      backgroundColor: isCurrent ? '#f0f9ff' : 'transparent',
      transition: 'background-color 0.15s ease',
    });

    if (!isCurrent) {
      item.addEventListener('mouseenter', () => {
        item.style.backgroundColor = '#f5f5f5';
      });

      item.addEventListener('mouseleave', () => {
        item.style.backgroundColor = 'transparent';
      });
    }

    // Add styles for change count and current indicator
    const style = document.createElement('style');
    style.textContent = `
      .cms-page-navigator-item .page-name {
        font-weight: 500;
      }
      .cms-page-navigator-item .change-count {
        color: #fbbf24;
        font-size: 12px;
      }
      .cms-page-navigator-item .current-indicator {
        margin-left: auto;
        color: #3b82f6;
        font-weight: bold;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Handle page change
   */
  private async handlePageChange(pageName: string, route: string): Promise<void> {
    // Auto-save current page before switching
    // (drafts are auto-saved on blur, but this ensures we don't lose anything)

    // Use navigation guard's allowNavigation to temporarily enable navigation
    await this.config.navigationGuard.allowNavigation(async () => {
      this.config.onPageChange(pageName, route);
    });
  }

  /**
   * Toggle dropdown
   */
  private async toggleDropdown(dropdown: HTMLElement): Promise<void> {
    if (this.dropdownOpen) {
      this.closeDropdown(dropdown);
    } else {
      await this.openDropdown(dropdown);
    }
  }

  /**
   * Open dropdown
   */
  private async openDropdown(dropdown: HTMLElement): Promise<void> {
    // Refresh dropdown content with latest draft status
    await this.populateDropdown(dropdown);
    dropdown.style.display = 'block';
    this.dropdownOpen = true;
  }

  /**
   * Close dropdown
   */
  private closeDropdown(dropdown: HTMLElement): void {
    dropdown.style.display = 'none';
    this.dropdownOpen = false;
  }

  /**
   * Format page name for display
   */
  private formatPageName(pageName: string): string {
    // Handle undefined or empty page name
    if (!pageName) {
      return 'Select Page';
    }

    // Convert 'index' to 'Home'
    if (pageName === 'index') {
      return 'Home';
    }

    // Convert 'about-us' to 'About Us'
    return pageName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Update current page (call when page changes)
   */
  public async updateCurrentPage(pageName: string): Promise<void> {
    this.config.currentPage = pageName;

    if (this.element) {
      const button = this.element.querySelector('.cms-page-navigator-button') as HTMLElement;
      if (button) {
        await this.updateButtonText(button);
      }
    }
  }

  /**
   * Destroy the page navigator
   */
  public destroy(): void {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}

/**
 * Create a page navigator instance
 */
export function createPageNavigator(config: PageNavigatorConfig): Promise<PageNavigator> {
  const navigator = new PageNavigator(config);
  return Promise.resolve(navigator);
}

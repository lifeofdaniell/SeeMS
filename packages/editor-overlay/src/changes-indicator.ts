/**
 * Changes Indicator Component
 * Shows real-time count of unpublished changes across all pages
 */

import type { DraftStorageManager } from './draft-storage';

export interface ChangesIndicatorConfig {
  draftStorage: DraftStorageManager;
  onClick?: () => void;
}

export class ChangesIndicator {
  private config: ChangesIndicatorConfig;
  private element: HTMLElement | null = null;
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(config: ChangesIndicatorConfig) {
    this.config = config;
  }

  /**
   * Create and return the changes indicator element
   */
  public async create(): Promise<HTMLElement> {
    const container = document.createElement('div');
    container.className = 'cms-changes-indicator';

    await this.updateIndicator(container);
    this.styleContainer(container);

    // Add click handler if provided
    if (this.config.onClick) {
      container.style.cursor = 'pointer';
      container.addEventListener('click', this.config.onClick);
    }

    // Auto-update every 2 seconds
    this.updateInterval = setInterval(() => {
      this.updateIndicator(container);
    }, 2000);

    this.element = container;
    return container;
  }

  /**
   * Update indicator content
   */
  private async updateIndicator(container: HTMLElement): Promise<void> {
    const changeCount = await this.config.draftStorage.getChangeCount();
    const hasChanges = changeCount > 0;

    const dotColor = hasChanges ? '#fbbf24' : '#9ca3af';
    const textColor = hasChanges ? '#000' : '#6b7280';

    container.innerHTML = `
      <span class="indicator-dot" style="color: ${dotColor};">●</span>
      <span class="indicator-text" style="color: ${textColor};">
        ${changeCount} change${changeCount !== 1 ? 's' : ''}
      </span>
    `;
  }

  /**
   * Style the container
   */
  private styleContainer(container: HTMLElement): void {
    Object.assign(container.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 16px',
      backgroundColor: '#f9fafb',
      border: '1px solid #e5e7eb',
      borderRadius: '6px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      transition: 'all 0.2s ease',
    });

    // Add hover effect if clickable
    if (this.config.onClick) {
      container.addEventListener('mouseenter', () => {
        container.style.backgroundColor = '#f3f4f6';
        container.style.borderColor = '#d1d5db';
      });

      container.addEventListener('mouseleave', () => {
        container.style.backgroundColor = '#f9fafb';
        container.style.borderColor = '#e5e7eb';
      });
    }

    // Add styles for dot and text
    const style = document.createElement('style');
    style.textContent = `
      .cms-changes-indicator .indicator-dot {
        font-size: 16px;
        line-height: 1;
        animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      }
      .cms-changes-indicator .indicator-text {
        font-weight: 500;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.5;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Force update the indicator
   */
  public async refresh(): Promise<void> {
    if (this.element) {
      await this.updateIndicator(this.element);
    }
  }

  /**
   * Get detailed breakdown of changes
   */
  public async getChangeDetails(): Promise<Array<{ page: string; changeCount: number }>> {
    const drafts = await this.config.draftStorage.getAllDrafts();
    return drafts
      .filter((draft) => draft.metadata.hasChanges)
      .map((draft) => ({
        page: draft.pageName,
        changeCount: Object.keys(draft.fields).length,
      }));
  }

  /**
   * Show detailed tooltip
   */
  public async showDetailedTooltip(): Promise<void> {
    const details = await this.getChangeDetails();

    if (details.length === 0) {
      this.showTooltip('No unpublished changes');
      return;
    }

    const message = details
      .map((d) => `${this.formatPageName(d.page)}: ${d.changeCount} change${d.changeCount !== 1 ? 's' : ''}`)
      .join('\n');

    this.showTooltip(message);
  }

  /**
   * Show tooltip
   */
  private showTooltip(message: string): void {
    // Check if there's already a tooltip
    const existingTooltip = document.querySelector('.cms-changes-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.className = 'cms-changes-tooltip';
    tooltip.textContent = message;

    // Apply styles
    Object.assign(tooltip.style, {
      position: 'fixed',
      bottom: '80px',
      right: '24px',
      maxWidth: '300px',
      padding: '12px 16px',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      color: 'white',
      borderRadius: '8px',
      fontSize: '13px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: '1.5',
      whiteSpace: 'pre-line',
      zIndex: '10000',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.2s ease-in-out',
    });

    document.body.appendChild(tooltip);

    // Fade in
    requestAnimationFrame(() => {
      tooltip.style.opacity = '1';
    });

    // Fade out and remove
    setTimeout(() => {
      tooltip.style.opacity = '0';
      setTimeout(() => {
        if (tooltip.parentNode) {
          tooltip.parentNode.removeChild(tooltip);
        }
      }, 200);
    }, 3000);
  }

  /**
   * Format page name for display
   */
  private formatPageName(pageName: string): string {
    if (pageName === 'index') {
      return 'Home';
    }
    return pageName
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Destroy the changes indicator
   */
  public destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }

    this.element = null;
  }
}

/**
 * Create a changes indicator instance
 */
export function createChangesIndicator(config: ChangesIndicatorConfig): Promise<ChangesIndicator> {
  const indicator = new ChangesIndicator(config);
  return Promise.resolve(indicator);
}

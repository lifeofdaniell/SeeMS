/**
 * Navigation Guard
 * Disables all link clicks in edit mode and provides visual feedback
 */

export interface NavigationGuardConfig {
  showToast?: boolean;
  toastMessage?: string;
  toastDuration?: number;
}

export class NavigationGuard {
  private enabled: boolean = false;
  private clickHandler: ((e: Event) => void) | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private config: NavigationGuardConfig;

  constructor(config: NavigationGuardConfig = {}) {
    this.config = {
      showToast: config.showToast !== false,
      toastMessage: config.toastMessage || 'Navigation disabled in edit mode',
      toastDuration: config.toastDuration || 3000,
    };
  }

  /**
   * Enable navigation guard
   */
  public enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Create click handler with capture phase
    this.clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;

      // Check if click is on a link or inside a link
      const link = target.closest('a, [href]');

      if (link) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (this.config.showToast) {
          this.showToast(this.config.toastMessage!);
        }
      }
    };

    // Add listener in capture phase to intercept before any other handlers
    document.addEventListener('click', this.clickHandler, true);

    // Add CSS for visual feedback
    this.addStyles();
  }

  /**
   * Disable navigation guard
   */
  public disable(): void {
    if (!this.enabled) return;

    this.enabled = false;

    // Remove click handler
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }

    // Remove styles
    this.removeStyles();
  }

  /**
   * Check if guard is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Temporarily allow navigation for a specific callback
   */
  public async allowNavigation<T>(callback: () => T | Promise<T>): Promise<T> {
    const wasEnabled = this.enabled;

    if (wasEnabled) {
      this.disable();
    }

    try {
      return await callback();
    } finally {
      if (wasEnabled) {
        this.enable();
      }
    }
  }

  /**
   * Add CSS styles for visual feedback
   */
  private addStyles(): void {
    if (this.styleElement) return;

    this.styleElement = document.createElement('style');
    this.styleElement.id = 'cms-navigation-guard-styles';
    this.styleElement.textContent = `
      /* Visual feedback for disabled links in edit mode */
      a, [href] {
        cursor: not-allowed !important;
        opacity: 0.7;
      }

      a:hover, [href]:hover {
        opacity: 0.5;
      }
    `;

    document.head.appendChild(this.styleElement);
  }

  /**
   * Remove CSS styles
   */
  private removeStyles(): void {
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }
  }

  /**
   * Show toast notification
   */
  private showToast(message: string): void {
    // Check if there's already a toast
    const existingToast = document.querySelector('.cms-navigation-toast');
    if (existingToast) {
      existingToast.remove();
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = 'cms-navigation-toast';
    toast.textContent = message;

    // Apply styles
    Object.assign(toast.style, {
      position: 'fixed',
      top: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '12px 24px',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      zIndex: '10000',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.2s ease-in-out',
    });

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
    }, this.config.toastDuration!);
  }

  /**
   * Destroy the navigation guard
   */
  public destroy(): void {
    this.disable();
  }
}

/**
 * Create a navigation guard instance
 */
export function createNavigationGuard(config?: NavigationGuardConfig): NavigationGuard {
  return new NavigationGuard(config);
}

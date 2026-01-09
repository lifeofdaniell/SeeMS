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

  constructor(_config: NavigationGuardConfig = {}) {
    // Config is preserved for backwards compatibility but not used
  }

  /**
   * Enable navigation guard
   * Persists ?preview=true in internal links, allows external links
   */
  public enable(): void {
    if (this.enabled) return;

    this.enabled = true;

    // Create click handler with capture phase
    this.clickHandler = (e: Event) => {
      const target = e.target as HTMLElement;

      // Check if click is on a link or inside a link
      const linkElement = target.closest('a, [href]') as HTMLAnchorElement;

      if (linkElement) {
        const href = linkElement.getAttribute('href');
        if (!href) return;

        // Check if it's an external link (different origin)
        const isExternal = this.isExternalLink(href);

        if (isExternal) {
          // Allow external links to work normally
          return;
        }

        // For internal links, add ?preview=true if not already present
        e.preventDefault();
        e.stopPropagation();

        const url = new URL(href, window.location.origin);

        // Add or update preview parameter
        url.searchParams.set('preview', 'true');

        // Navigate to the modified URL
        window.location.href = url.toString();
      }
    };

    // Add listener in capture phase to intercept before any other handlers
    document.addEventListener('click', this.clickHandler, true);
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
  }

  /**
   * Check if a URL is external (different origin)
   */
  private isExternalLink(href: string): boolean {
    try {
      // Handle relative URLs
      if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) {
        return false;
      }

      // Handle absolute URLs
      if (href.startsWith('http://') || href.startsWith('https://')) {
        const linkUrl = new URL(href);
        return linkUrl.origin !== window.location.origin;
      }

      // Relative paths are internal
      return false;
    } catch {
      // If URL parsing fails, treat as internal for safety
      return false;
    }
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

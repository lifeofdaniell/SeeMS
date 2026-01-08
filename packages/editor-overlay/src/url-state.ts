/**
 * URL State Manager
 * Manages ?preview=true&page={pageName} query parameters
 */

export interface URLState {
  preview: boolean;
  page?: string;
}

export type URLStateCallback = (state: URLState) => void;

export class URLStateManager {
  private subscribers: Set<URLStateCallback> = new Set();

  constructor() {
    // Listen for popstate events (browser back/forward)
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', () => {
        this.notifySubscribers();
      });
    }
  }

  /**
   * Get current URL state
   */
  public getState(): URLState {
    if (typeof window === 'undefined') {
      return { preview: false };
    }

    const params = new URLSearchParams(window.location.search);
    return {
      preview: params.get('preview') === 'true',
      page: params.get('page') || undefined,
    };
  }

  /**
   * Set URL state without navigation (using replaceState)
   */
  public setState(state: Partial<URLState>): void {
    if (typeof window === 'undefined') return;

    const currentState = this.getState();
    const newState = { ...currentState, ...state };

    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);

    // Update preview parameter
    if (newState.preview) {
      params.set('preview', 'true');
    } else {
      params.delete('preview');
    }

    // Update page parameter
    if (newState.page) {
      params.set('page', newState.page);
    } else {
      params.delete('page');
    }

    // Update URL without navigation
    url.search = params.toString();
    window.history.replaceState({}, '', url.toString());

    // Notify subscribers
    this.notifySubscribers();
  }

  /**
   * Clear preview mode (remove ?preview=true and ?page=...)
   */
  public clearPreviewMode(): void {
    if (typeof window === 'undefined') return;

    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);

    params.delete('preview');
    params.delete('page');

    url.search = params.toString();
    window.history.replaceState({}, '', url.toString());

    // Notify subscribers
    this.notifySubscribers();
  }

  /**
   * Subscribe to state changes
   */
  public subscribe(callback: URLStateCallback): () => void {
    this.subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(callback);
    };
  }

  /**
   * Notify all subscribers of state change
   */
  private notifySubscribers(): void {
    const state = this.getState();
    this.subscribers.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error('[URLStateManager] Subscriber error:', error);
      }
    });
  }

  /**
   * Check if currently in preview mode
   */
  public isPreviewMode(): boolean {
    return this.getState().preview;
  }

  /**
   * Get current page name
   */
  public getCurrentPage(): string | undefined {
    return this.getState().page;
  }

  /**
   * Set only the page parameter
   */
  public setPage(page: string): void {
    this.setState({ page });
  }

  /**
   * Enable preview mode with optional page
   */
  public enablePreviewMode(page?: string): void {
    this.setState({ preview: true, page });
  }
}

/**
 * Create a URL state manager instance
 */
export function createURLStateManager(): URLStateManager {
  return new URLStateManager();
}

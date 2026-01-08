/**
 * Manifest Loader
 * Loads and parses cms-manifest.json from the Nuxt app
 */

export interface ManifestField {
  selector: string;
  type: string;
  editable: boolean;
}

export interface ManifestPage {
  fields: Record<string, ManifestField>;
  collections: Record<string, any>;
  meta: {
    route: string;
    [key: string]: any;
  };
}

export interface CMSManifest {
  version: string;
  pages: Record<string, ManifestPage>;
}

export class ManifestLoader {
  private manifest: CMSManifest | null = null;
  private manifestUrl: string;

  constructor(manifestUrl: string = '/cms-manifest.json') {
    this.manifestUrl = manifestUrl;
  }

  /**
   * Load manifest from server
   */
  public async load(): Promise<CMSManifest> {
    if (this.manifest) {
      return this.manifest as CMSManifest;
    }

    try {
      const response = await fetch(this.manifestUrl);
      if (!response.ok) {
        throw new Error(`Failed to load manifest: ${response.statusText}`);
      }

      this.manifest = await response.json();
      return this.manifest as CMSManifest;
    } catch (error) {
      console.error('[ManifestLoader] Failed to load manifest:', error);
      throw error;
    }
  }

  /**
   * Get manifest (throws if not loaded)
   */
  public getManifest(): CMSManifest {
    if (!this.manifest) {
      throw new Error('Manifest not loaded. Call load() first.');
    }
    return this.manifest as CMSManifest;
  }

  /**
   * Get all page names
   */
  public getPageNames(): string[] {
    const manifest = this.getManifest();
    return Object.keys(manifest.pages);
  }

  /**
   * Get page fields by page name
   */
  public getPageFields(pageName: string): Record<string, ManifestField> | null {
    const manifest = this.getManifest();
    const page = manifest.pages[pageName];
    return page ? page.fields : null;
  }

  /**
   * Get page by name
   */
  public getPage(pageName: string): ManifestPage | null {
    const manifest = this.getManifest();
    return manifest.pages[pageName] || null;
  }

  /**
   * Get editable fields for a page
   */
  public getEditableFields(pageName: string): Record<string, ManifestField> {
    const fields = this.getPageFields(pageName);
    if (!fields) return {};

    return Object.entries(fields).reduce((acc, [key, field]) => {
      if (field.editable) {
        acc[key] = field;
      }
      return acc;
    }, {} as Record<string, ManifestField>);
  }

  /**
   * Get current page name from route path
   */
  public getPageFromRoute(routePath: string): string | null {
    const manifest = this.getManifest();

    // Normalize route path (remove trailing slash, make lowercase)
    const normalizedPath = routePath.toLowerCase().replace(/\/$/, '') || '/';

    // Find page by matching route
    for (const [pageName, page] of Object.entries(manifest.pages)) {
      const pageRoute = page.meta.route.toLowerCase().replace(/\/$/, '') || '/';
      if (pageRoute === normalizedPath) {
        return pageName;
      }
    }

    // Special case: root path matches 'index'
    if (normalizedPath === '/' || normalizedPath === '') {
      return 'index';
    }

    return null;
  }

  /**
   * Get route path for a page name
   */
  public getRouteForPage(pageName: string): string | null {
    const page = this.getPage(pageName);
    return page ? page.meta.route : null;
  }

  /**
   * Check if a page exists
   */
  public hasPage(pageName: string): boolean {
    const manifest = this.getManifest();
    return pageName in manifest.pages;
  }

  /**
   * Get all pages with their metadata
   */
  public getAllPages(): Array<{ name: string; route: string; fieldCount: number }> {
    const manifest = this.getManifest();
    return Object.entries(manifest.pages).map(([name, page]) => ({
      name,
      route: page.meta.route,
      fieldCount: Object.keys(page.fields).length,
    }));
  }

  /**
   * Clear cached manifest
   */
  public clearCache(): void {
    this.manifest = null;
  }

  /**
   * Reload manifest from server
   */
  public async reload(): Promise<CMSManifest> {
    this.clearCache();
    return this.load();
  }
}

/**
 * Global manifest loader instance
 */
let globalLoader: ManifestLoader | null = null;

/**
 * Create or get manifest loader instance
 */
export function createManifestLoader(manifestUrl?: string): ManifestLoader {
  if (!globalLoader) {
    globalLoader = new ManifestLoader(manifestUrl);
  }
  return globalLoader;
}

/**
 * Load manifest (convenience function)
 */
export async function loadManifest(manifestUrl?: string): Promise<CMSManifest> {
  const loader = createManifestLoader(manifestUrl);
  return loader.load();
}

/**
 * Get current page name from window location
 */
export function getCurrentPageFromRoute(): string | null {
  if (typeof window === 'undefined') return null;

  const loader = createManifestLoader();
  const path = window.location.pathname;
  return loader.getPageFromRoute(path);
}

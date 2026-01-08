/**
 * Draft Storage Manager
 * Persistent storage for CMS draft changes using IndexedDB with localStorage fallback
 */

export interface DraftData {
  pageName: string;
  fields: Record<string, any>;
  metadata: {
    lastModified: number;
    hasChanges: boolean;
  };
}

export interface DraftStorageConfig {
  dbName?: string;
  storeName?: string;
  storagePrefix?: string;
}

export class DraftStorageManager {
  private dbName: string;
  private storeName: string;
  private storagePrefix: string;
  private db: IDBDatabase | null = null;
  private useIndexedDB: boolean = true;
  private saveDebouncers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: DraftStorageConfig = {}) {
    this.dbName = config.dbName || 'cms_editor_drafts';
    this.storeName = config.storeName || 'drafts';
    this.storagePrefix = config.storagePrefix || 'cms_draft_';
    this.initDatabase();
  }

  /**
   * Initialize IndexedDB or fallback to localStorage
   */
  private async initDatabase(): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      // Check if IndexedDB is available
      if (!window.indexedDB) {
        console.warn('[DraftStorage] IndexedDB not available, using localStorage');
        this.useIndexedDB = false;
        return;
      }

      const request = indexedDB.open(this.dbName, 1);

      request.onerror = () => {
        console.warn('[DraftStorage] IndexedDB failed, falling back to localStorage');
        this.useIndexedDB = false;
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'pageName' });
        }
      };
    } catch (error) {
      console.warn('[DraftStorage] IndexedDB initialization failed:', error);
      this.useIndexedDB = false;
    }
  }

  /**
   * Save a field change to drafts (debounced)
   */
  public saveDraft(page: string, fieldName: string, value: any, debounceMs: number = 300): void {
    // Clear existing debouncer for this page
    const existingDebouncer = this.saveDebouncers.get(page);
    if (existingDebouncer) {
      clearTimeout(existingDebouncer);
    }

    // Set new debouncer
    const debouncer = setTimeout(async () => {
      try {
        // Load existing draft or create new one
        const existingDraft = await this.loadDraft(page);
        const fields = existingDraft?.fields || {};

        // Update field
        fields[fieldName] = value;

        // Save complete draft
        const draftData: DraftData = {
          pageName: page,
          fields,
          metadata: {
            lastModified: Date.now(),
            hasChanges: Object.keys(fields).length > 0,
          },
        };

        await this.saveDraftData(draftData);
        this.saveDebouncers.delete(page);
      } catch (error) {
        console.error('[DraftStorage] Failed to save draft:', error);
      }
    }, debounceMs);

    this.saveDebouncers.set(page, debouncer);
  }

  /**
   * Save complete draft data
   */
  private async saveDraftData(draftData: DraftData): Promise<void> {
    if (this.useIndexedDB && this.db) {
      return this.saveToIndexedDB(draftData);
    } else {
      return this.saveToLocalStorage(draftData);
    }
  }

  /**
   * Save to IndexedDB
   */
  private saveToIndexedDB(draftData: DraftData): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(draftData);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save to localStorage
   */
  private saveToLocalStorage(draftData: DraftData): Promise<void> {
    try {
      const key = this.storagePrefix + draftData.pageName;
      localStorage.setItem(key, JSON.stringify(draftData));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Load draft for a specific page
   */
  public async loadDraft(page: string): Promise<DraftData | null> {
    if (this.useIndexedDB && this.db) {
      return this.loadFromIndexedDB(page);
    } else {
      return this.loadFromLocalStorage(page);
    }
  }

  /**
   * Load from IndexedDB
   */
  private loadFromIndexedDB(page: string): Promise<DraftData | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(page);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Load from localStorage
   */
  private loadFromLocalStorage(page: string): Promise<DraftData | null> {
    try {
      const key = this.storagePrefix + page;
      const data = localStorage.getItem(key);
      return Promise.resolve(data ? JSON.parse(data) : null);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Clear draft for a specific page
   */
  public async clearDraft(page: string): Promise<void> {
    if (this.useIndexedDB && this.db) {
      return this.clearFromIndexedDB(page);
    } else {
      return this.clearFromLocalStorage(page);
    }
  }

  /**
   * Clear from IndexedDB
   */
  private clearFromIndexedDB(page: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(page);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear from localStorage
   */
  private clearFromLocalStorage(page: string): Promise<void> {
    try {
      const key = this.storagePrefix + page;
      localStorage.removeItem(key);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Get all pages with drafts
   */
  public async getAllDrafts(): Promise<DraftData[]> {
    if (this.useIndexedDB && this.db) {
      return this.getAllFromIndexedDB();
    } else {
      return this.getAllFromLocalStorage();
    }
  }

  /**
   * Get all from IndexedDB
   */
  private getAllFromIndexedDB(): Promise<DraftData[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all from localStorage
   */
  private getAllFromLocalStorage(): Promise<DraftData[]> {
    try {
      const drafts: DraftData[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.storagePrefix)) {
          const data = localStorage.getItem(key);
          if (data) {
            drafts.push(JSON.parse(data));
          }
        }
      }
      return Promise.resolve(drafts);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Check if there are any unpublished changes
   */
  public async hasUnpublishedChanges(): Promise<boolean> {
    const drafts = await this.getAllDrafts();
    return drafts.some((draft) => draft.metadata.hasChanges);
  }

  /**
   * Get count of pages with changes
   */
  public async getChangeCount(): Promise<number> {
    const drafts = await this.getAllDrafts();
    return drafts.filter((draft) => draft.metadata.hasChanges).length;
  }

  /**
   * Clear all drafts
   */
  public async clearAllDrafts(): Promise<void> {
    if (this.useIndexedDB && this.db) {
      return this.clearAllFromIndexedDB();
    } else {
      return this.clearAllFromLocalStorage();
    }
  }

  /**
   * Clear all from IndexedDB
   */
  private clearAllFromIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all from localStorage
   */
  private clearAllFromLocalStorage(): Promise<void> {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.storagePrefix)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

/**
 * Create a draft storage manager instance
 */
export function createDraftStorage(config?: DraftStorageConfig): DraftStorageManager {
  return new DraftStorageManager(config);
}

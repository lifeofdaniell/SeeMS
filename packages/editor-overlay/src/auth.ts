/**
 * Authentication module for CMS editor
 * Handles Strapi JWT authentication
 */

export interface AuthConfig {
  /** Strapi API URL */
  strapiUrl: string;
  /** Storage key for JWT token */
  storageKey?: string;
}

export interface AuthCredentials {
  identifier: string;
  password: string;
}

export interface AuthResponse {
  jwt: string;
  user: {
    id: number;
    username: string;
    email: string;
  };
}

/**
 * Authentication manager for Strapi
 */
export class AuthManager {
  private config: AuthConfig;
  private storageKey: string;

  constructor(config: AuthConfig) {
    this.config = config;
    this.storageKey = config.storageKey || 'cms_editor_token';
  }

  /**
   * Authenticate with Strapi
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    try {
      const response = await fetch(`${this.config.strapiUrl}/api/auth/local`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'Authentication failed');
      }

      const data: AuthResponse = await response.json();

      // Store the JWT token
      this.setToken(data.jwt);

      return data;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  }

  /**
   * Verify the current token with Strapi
   */
  async verifyToken(token?: string): Promise<boolean> {
    const jwt = token || this.getToken();
    if (!jwt) return false;

    try {
      const response = await fetch(`${this.config.strapiUrl}/api/users/me`, {
        headers: {
          'Authorization': `Bearer ${jwt}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Token verification failed:', error);
      return false;
    }
  }

  /**
   * Store JWT token
   */
  setToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(this.storageKey, token);
    }
  }

  /**
   * Retrieve JWT token
   */
  getToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(this.storageKey);
    }
    return null;
  }

  /**
   * Clear stored token
   */
  logout(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = this.getToken();
    if (!token) return false;

    return this.verifyToken(token);
  }
}

/**
 * Create an auth manager instance
 */
export function createAuthManager(config: AuthConfig): AuthManager {
  return new AuthManager(config);
}

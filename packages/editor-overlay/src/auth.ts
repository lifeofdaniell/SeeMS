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
    this.storageKey = config.storageKey || "cms_editor_token";
  }

  /**
   * Authenticate with Strapi (tries admin auth first, then regular user auth)
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    // Try admin authentication first
    try {
      const adminResult = await this.tryAdminLogin(credentials);
      if (adminResult) {
        console.log("[Auth] Logged in!");
        return adminResult;
      }
    } catch (error) {
      console.log("Invalid Credentials");
    }

    // Fallback to regular user authentication
    try {
      const userResult = await this.tryUserLogin(credentials);
      console.log("[Auth] Logged in!");
      return userResult;
    } catch (error) {
      console.log("Invalid Credentials");
      throw error;
    }
  }

  /**
   * Try admin authentication
   */
  private async tryAdminLogin(credentials: AuthCredentials): Promise<AuthResponse | null> {
    try {
      const response = await fetch(`${this.config.strapiUrl}/admin/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: credentials.identifier,
          password: credentials.password
        })
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      // Admin response format: { data: { token, user } }
      if (data.data?.token) {
        const authResponse: AuthResponse = {
          jwt: data.data.token,
          user: {
            id: data.data.user.id,
            username: data.data.user.username || data.data.user.firstname,
            email: data.data.user.email
          }
        };

        // Store the JWT token
        this.setToken(authResponse.jwt);

        return authResponse;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Try regular user authentication
   */
  private async tryUserLogin(credentials: AuthCredentials): Promise<AuthResponse> {
    const response = await fetch(`${this.config.strapiUrl}/api/auth/local`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(credentials)
    });

    if (!response.ok) {
      const errorData = await response.json();
      // Handle both Strapi v4 and v5 error formats
      const errorMessage = errorData.error?.message || errorData.message || "Authentication failed";
      throw new Error(errorMessage);
    }

    const data: AuthResponse = await response.json();

    // Store the JWT token
    this.setToken(data.jwt);

    return data;
  }

  /**
   * Verify the current token with Strapi (tries both admin and user endpoints)
   */
  async verifyToken(token?: string): Promise<boolean> {
    const jwt = token || this.getToken();
    if (!jwt) return false;

    // Try admin token verification first
    try {
      const adminResponse = await fetch(`${this.config.strapiUrl}/admin/users/me`, {
        headers: {
          "Authorization": `Bearer ${jwt}`
        }
      });

      if (adminResponse.ok) {
        return true;
      }
    } catch (error) {
      // Continue to try regular user verification
    }

    // Try regular user token verification
    try {
      const userResponse = await fetch(`${this.config.strapiUrl}/api/users/me`, {
        headers: {
          "Authorization": `Bearer ${jwt}`
        }
      });

      return userResponse.ok;
    } catch (error) {
      console.error("Token verification failed:", error);
      return false;
    }
  }

  /**
   * Store JWT token
   */
  setToken(token: string): void {
    if (typeof window !== "undefined") {
      localStorage.setItem(this.storageKey, token);
    }
  }

  /**
   * Retrieve JWT token
   */
  getToken(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem(this.storageKey);
    }
    return null;
  }

  /**
   * Clear stored token
   */
  logout(): void {
    if (typeof window !== "undefined") {
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

/**
 * Login modal for CMS authentication
 */

import type { AuthManager } from "./auth";

export interface LoginModalConfig {
  authManager: AuthManager;
  onSuccess: (token: string) => void;
  onCancel?: () => void;
}

/**
 * Create and show a login toolbar (fixed bottom)
 */
export function createLoginModal(config: LoginModalConfig): HTMLElement {
  const { authManager, onSuccess } = config;

  // Create dark overlay
  const overlay = document.createElement("div");
  overlay.id = "cms-login-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    z-index: 10000;
    backdrop-filter: blur(4px);
  `;

  // Create toolbar container (fixed bottom)
  const toolbar = document.createElement("div");
  toolbar.id = "cms-login-toolbar";
  toolbar.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 64px;
    background: white;
    border-top: 1px solid #e5e7eb;
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.1);
    z-index: 10001;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    display: flex;
    align-items: center;
  `;

  // Create form with horizontal layout
  const form = document.createElement("form");
  form.style.cssText = `
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 20px;
    flex: 1;
  `;

  form.innerHTML = `
    <style>
      .cms-login-label-text {
        font-size: 14px;
        font-weight: 500;
        color: #374151;
        white-space: nowrap;
        margin-right: 8px;
      }
      .cms-login-input {
        padding: 8px 12px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: 14px;
        transition: border-color 0.2s;
        min-width: 200px;
        flex: 1;
      }
      .cms-login-input:focus {
        outline: none;
        border-color: #3b82f6;
      }
      .cms-login-button {
        padding: 8px 24px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }
      .cms-login-button-primary {
        background: #3b82f6;
        color: white;
      }
      .cms-login-button-primary:hover {
        background: #2563eb;
      }
      .cms-login-button-primary:disabled {
        background: #93c5fd;
        cursor: not-allowed;
      }
      .cms-login-error-inline {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: #ef4444;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        opacity: 0;
        transition: opacity 0.2s ease-in-out;
        pointer-events: none;
      }
      .cms-login-error-inline.show {
        opacity: 1;
      }
      @media (max-width: 768px) {
        #cms-login-toolbar {
          height: auto;
          min-height: 64px;
          padding: 12px 0;
        }
        #cms-login-toolbar form {
          flex-wrap: wrap;
          justify-content: center;
        }
        .cms-login-input {
          min-width: 150px;
          flex: 1;
        }
      }
    </style>

    <span class="cms-login-label-text">🔒 CMS Editor Login:</span>
    <input
      type="text"
      id="cms-login-identifier"
      class="cms-login-input"
      placeholder="Email or username"
      required
      autocomplete="username"
    />
    <input
      type="password"
      id="cms-login-password"
      class="cms-login-input"
      placeholder="Password"
      required
      autocomplete="current-password"
    />
    <div style="flex: 1;"></div>
    <button type="submit" class="cms-login-button cms-login-button-primary" id="cms-login-submit">
      Sign In
    </button>
    <div class="cms-login-error-inline" id="cms-login-error"></div>
  `;

  // Get form elements
  const identifierInput = form.querySelector("#cms-login-identifier") as HTMLInputElement;
  const passwordInput = form.querySelector("#cms-login-password") as HTMLInputElement;
  const submitButton = form.querySelector("#cms-login-submit") as HTMLButtonElement;
  const errorDiv = form.querySelector("#cms-login-error") as HTMLDivElement;

  // Handle form submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const identifier = identifierInput.value.trim();
    const password = passwordInput.value;

    if (!identifier || !password) {
      showError("Please enter both email/username and password");
      return;
    }

    // Disable form
    submitButton.disabled = true;
    submitButton.textContent = "Signing in...";
    errorDiv.classList.remove("show");

    try {
      const response = await authManager.login({ identifier, password });

      // Success! Remove overlay and toolbar
      overlay.remove();
      toolbar.remove();

      // Call success handler
      onSuccess(response.jwt);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Login failed. Please try again.");
      submitButton.disabled = false;
      submitButton.textContent = "Sign In";
    }
  });

  function showError(message: string) {
    errorDiv.textContent = message;
    errorDiv.classList.add("show");

    // Auto-hide after 3 seconds
    setTimeout(() => {
      errorDiv.classList.remove("show");
    }, 3000);
  }

  // Assemble: Add form to toolbar, add both overlay and toolbar to body
  toolbar.appendChild(form);

  // Return a container that holds both
  const container = document.createElement("div");
  container.appendChild(overlay);
  container.appendChild(toolbar);

  return container;
}

/**
 * Show login toolbar and return a promise
 */
export function showLoginModal(authManager: AuthManager): Promise<string> {
  return new Promise((resolve) => {
    const container = createLoginModal({
      authManager,
      onSuccess: resolve,
      onCancel: undefined // No cancel option - must login to proceed
    });

    document.body.appendChild(container);

    // Focus the identifier input
    setTimeout(() => {
      const input = container.querySelector("#cms-login-identifier") as HTMLInputElement;
      input?.focus();
    }, 100);
  });
}

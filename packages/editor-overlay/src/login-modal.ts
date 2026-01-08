/**
 * Login modal for CMS authentication
 */

import type { AuthManager } from './auth';

export interface LoginModalConfig {
  authManager: AuthManager;
  onSuccess: (token: string) => void;
  onCancel?: () => void;
}

/**
 * Create and show a login modal
 */
export function createLoginModal(config: LoginModalConfig): HTMLElement {
  const { authManager, onSuccess, onCancel } = config;

  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
    backdrop-filter: blur(4px);
  `;

  // Create modal content
  const modal = document.createElement('div');
  modal.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 32px;
    width: 90%;
    max-width: 400px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  `;

  // Create form
  const form = document.createElement('form');
  form.innerHTML = `
    <style>
      .cms-login-title {
        margin: 0 0 8px 0;
        font-size: 24px;
        font-weight: 600;
        color: #1a1a1a;
      }
      .cms-login-subtitle {
        margin: 0 0 24px 0;
        font-size: 14px;
        color: #666;
      }
      .cms-login-field {
        margin-bottom: 16px;
      }
      .cms-login-label {
        display: block;
        margin-bottom: 6px;
        font-size: 14px;
        font-weight: 500;
        color: #333;
      }
      .cms-login-input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
        box-sizing: border-box;
        transition: border-color 0.2s;
      }
      .cms-login-input:focus {
        outline: none;
        border-color: #4f46e5;
      }
      .cms-login-error {
        margin-top: 12px;
        padding: 10px;
        background: #fee;
        border: 1px solid #fcc;
        border-radius: 6px;
        color: #c33;
        font-size: 13px;
        display: none;
      }
      .cms-login-error.show {
        display: block;
      }
      .cms-login-buttons {
        display: flex;
        gap: 12px;
        margin-top: 24px;
      }
      .cms-login-button {
        flex: 1;
        padding: 10px 16px;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .cms-login-button-primary {
        background: #4f46e5;
        color: white;
      }
      .cms-login-button-primary:hover {
        background: #4338ca;
      }
      .cms-login-button-primary:disabled {
        background: #a5b4fc;
        cursor: not-allowed;
      }
      .cms-login-button-secondary {
        background: #f3f4f6;
        color: #374151;
      }
      .cms-login-button-secondary:hover {
        background: #e5e7eb;
      }
    </style>

    <h2 class="cms-login-title">CMS Editor Login</h2>
    <p class="cms-login-subtitle">Sign in with your Strapi credentials</p>

    <div class="cms-login-field">
      <label class="cms-login-label" for="cms-login-identifier">Email or Username</label>
      <input
        type="text"
        id="cms-login-identifier"
        class="cms-login-input"
        placeholder="Enter your email or username"
        required
        autocomplete="username"
      />
    </div>

    <div class="cms-login-field">
      <label class="cms-login-label" for="cms-login-password">Password</label>
      <input
        type="password"
        id="cms-login-password"
        class="cms-login-input"
        placeholder="Enter your password"
        required
        autocomplete="current-password"
      />
    </div>

    <div class="cms-login-error" id="cms-login-error"></div>

    <div class="cms-login-buttons">
      <button type="button" class="cms-login-button cms-login-button-secondary" id="cms-login-cancel">
        Cancel
      </button>
      <button type="submit" class="cms-login-button cms-login-button-primary" id="cms-login-submit">
        Sign In
      </button>
    </div>
  `;

  // Get form elements
  const identifierInput = form.querySelector('#cms-login-identifier') as HTMLInputElement;
  const passwordInput = form.querySelector('#cms-login-password') as HTMLInputElement;
  const submitButton = form.querySelector('#cms-login-submit') as HTMLButtonElement;
  const cancelButton = form.querySelector('#cms-login-cancel') as HTMLButtonElement;
  const errorDiv = form.querySelector('#cms-login-error') as HTMLDivElement;

  // Handle form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const identifier = identifierInput.value.trim();
    const password = passwordInput.value;

    if (!identifier || !password) {
      showError('Please enter both email/username and password');
      return;
    }

    // Disable form
    submitButton.disabled = true;
    submitButton.textContent = 'Signing in...';
    errorDiv.classList.remove('show');

    try {
      const response = await authManager.login({ identifier, password });

      // Success!
      onSuccess(response.jwt);

      // Close modal
      overlay.remove();
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Login failed. Please try again.');
      submitButton.disabled = false;
      submitButton.textContent = 'Sign In';
    }
  });

  // Handle cancel
  cancelButton.addEventListener('click', () => {
    overlay.remove();
    onCancel?.();
  });

  // Handle ESC key
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      overlay.remove();
      onCancel?.();
      document.removeEventListener('keydown', handleEscape);
    }
  };
  document.addEventListener('keydown', handleEscape);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      onCancel?.();
    }
  });

  function showError(message: string) {
    errorDiv.textContent = message;
    errorDiv.classList.add('show');
  }

  // Assemble and return
  modal.appendChild(form);
  overlay.appendChild(modal);

  return overlay;
}

/**
 * Show login modal and return a promise
 */
export function showLoginModal(authManager: AuthManager): Promise<string> {
  return new Promise((resolve, reject) => {
    const modal = createLoginModal({
      authManager,
      onSuccess: resolve,
      onCancel: () => reject(new Error('Login cancelled')),
    });

    document.body.appendChild(modal);

    // Focus the identifier input
    setTimeout(() => {
      const input = modal.querySelector('#cms-login-identifier') as HTMLInputElement;
      input?.focus();
    }, 100);
  });
}
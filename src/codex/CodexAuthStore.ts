import type { CodexBridgeMode } from '../../shared/codex/CodexBridgeTypes';

export interface StoredCodexAuth {
  authToken: string;
  expiresAt: number;
}

const AUTH_STORAGE_KEY = 'linker.codex.auth';
const SESSION_STORAGE_KEY = 'linker.codex.session-id';
const BRIDGE_MODE_STORAGE_KEY = 'linker.codex.bridge-mode';

export class CodexAuthStore {
  public getSessionId() {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.length > 0) {
      return existing;
    }

    const next = crypto.randomUUID();
    sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  }

  public getAuth(): StoredCodexAuth | null {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as StoredCodexAuth;
      if (!parsed.authToken || !Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
        this.clearAuth();
        return null;
      }

      return parsed;
    } catch {
      this.clearAuth();
      return null;
    }
  }

  public setAuth(auth: StoredCodexAuth) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth));
  }

  public clearAuth() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  }

  public getBridgeMode(): CodexBridgeMode {
    const raw = localStorage.getItem(BRIDGE_MODE_STORAGE_KEY);
    if (raw === 'dev' || raw === 'bridge' || raw === 'auto') {
      return raw;
    }

    return 'auto';
  }

  public setBridgeMode(mode: CodexBridgeMode) {
    localStorage.setItem(BRIDGE_MODE_STORAGE_KEY, mode);
  }
}

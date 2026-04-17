const SESSION_STORAGE_KEY = 'linker.codex.session-id';

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
}

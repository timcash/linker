import {
  BROWSER_LOG_STORAGE_KEY,
  MAX_BROWSER_LOG_ENTRIES,
  resolveBrowserLogMessage,
  resolveBrowserLogSource,
  type BrowserLogEntry,
  type BrowserLogLevel,
} from './log-model';

export type BrowserLogStore = {
  clear: () => void;
  getEntries: () => BrowserLogEntry[];
  getRoute: () => string;
  getSessionId: () => string;
  record: (
    level: BrowserLogLevel,
    message: string,
    options?: {route?: string; stack?: string},
  ) => BrowserLogEntry;
  subscribe: (listener: (entries: BrowserLogEntry[]) => void) => () => void;
  updateRoute: (route: string) => void;
};

type BrowserLogStoreState = {
  entries: BrowserLogEntry[];
  listeners: Set<(entries: BrowserLogEntry[]) => void>;
  route: string;
  sessionId: string;
};

const GLOBAL_STORE_KEY = '__LINKER_BROWSER_LOG_STORE__';
const GLOBAL_CONSOLE_CAPTURE_KEY = '__LINKER_BROWSER_LOG_CAPTURE_INSTALLED__';
const SESSION_STORAGE_KEY = 'linker.logs.session-id';

export function installBrowserLogCapture(route: string): BrowserLogStore {
  const store = getBrowserLogStore();
  store.updateRoute(route);

  if (!window[GLOBAL_CONSOLE_CAPTURE_KEY]) {
    window[GLOBAL_CONSOLE_CAPTURE_KEY] = true;
    wireConsoleCapture(store);
    wireGlobalErrorCapture(store);
  }

  return store;
}

export function getBrowserLogStore(): BrowserLogStore {
  if (window[GLOBAL_STORE_KEY]) {
    return window[GLOBAL_STORE_KEY];
  }

  const state: BrowserLogStoreState = {
    entries: loadEntriesFromStorage(),
    listeners: new Set(),
    route: 'app',
    sessionId: loadOrCreateSessionId(),
  };

  const notify = (): void => {
    const snapshot = [...state.entries];
    for (const listener of state.listeners) {
      listener(snapshot);
    }
  };

  window.addEventListener('storage', (event) => {
    if (event.key !== BROWSER_LOG_STORAGE_KEY) {
      return;
    }

    state.entries = loadEntriesFromStorage();
    notify();
  });

  const store: BrowserLogStore = {
    clear: () => {
      state.entries = [];
      persistEntries(state.entries);
      notify();
    },
    getEntries: () => [...state.entries],
    getRoute: () => state.route,
    getSessionId: () => state.sessionId,
    record: (
      level: BrowserLogLevel,
      message: string,
      options?: {route?: string; stack?: string},
    ) => {
      const entry: BrowserLogEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        level,
        message,
        route: options?.route ?? state.route,
        sessionId: state.sessionId,
        source: resolveBrowserLogSource(options?.stack),
        timestamp: Date.now(),
      };

      state.entries = [...state.entries, entry].slice(-MAX_BROWSER_LOG_ENTRIES);
      persistEntries(state.entries);
      notify();
      return entry;
    },
    subscribe: (listener) => {
      state.listeners.add(listener);
      listener([...state.entries]);

      return () => {
        state.listeners.delete(listener);
      };
    },
    updateRoute: (route) => {
      state.route = route;
    },
  };

  window[GLOBAL_STORE_KEY] = store;
  return store;
}

export function recordBrowserLog(
  level: BrowserLogLevel,
  message: string,
): BrowserLogEntry {
  return getBrowserLogStore().record(level, message, {stack: new Error().stack});
}

function wireConsoleCapture(store: BrowserLogStore): void {
  const originalConsole = {
    debug: console.debug.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    log: console.log.bind(console),
    warn: console.warn.bind(console),
  };
  let recording = false;

  const wrapConsoleMethod = (
    method: keyof typeof originalConsole,
    level: BrowserLogLevel,
  ): void => {
    console[method] = (...args: unknown[]) => {
      originalConsole[method](...args);

      if (recording) {
        return;
      }

      recording = true;

      try {
        store.record(level, resolveBrowserLogMessage(args), {
          stack: new Error().stack,
        });
      } finally {
        recording = false;
      }
    };
  };

  wrapConsoleMethod('debug', 'debug');
  wrapConsoleMethod('log', 'info');
  wrapConsoleMethod('info', 'info');
  wrapConsoleMethod('warn', 'warn');
  wrapConsoleMethod('error', 'error');
}

function wireGlobalErrorCapture(store: BrowserLogStore): void {
  window.addEventListener('error', (event) => {
    store.record('error', event.message || 'Unhandled window error.', {
      stack:
        event.error instanceof Error
          ? event.error.stack
          : `${event.filename}:${event.lineno}:${event.colno}`,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason =
      event.reason instanceof Error
        ? event.reason.stack ?? event.reason.message
        : resolveBrowserLogMessage([event.reason]);
    store.record('error', reason || 'Unhandled promise rejection.', {
      stack: event.reason instanceof Error ? event.reason.stack : new Error().stack,
    });
  });
}

function loadEntriesFromStorage(): BrowserLogEntry[] {
  try {
    const raw = window.localStorage.getItem(BROWSER_LOG_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isBrowserLogEntry).slice(-MAX_BROWSER_LOG_ENTRIES);
  } catch {
    return [];
  }
}

function persistEntries(entries: BrowserLogEntry[]): void {
  try {
    window.localStorage.setItem(BROWSER_LOG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore quota or serialization failures.
  }
}

function loadOrCreateSessionId(): string {
  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);

  if (existing) {
    return existing;
  }

  const nextId = `session-${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, nextId);
  return nextId;
}

function isBrowserLogEntry(entry: unknown): entry is BrowserLogEntry {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }

  const candidate = entry as Record<string, unknown>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.level === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.route === 'string' &&
    typeof candidate.sessionId === 'string' &&
    typeof candidate.source === 'string' &&
    typeof candidate.timestamp === 'number'
  );
}

declare global {
  interface Window {
    __LINKER_BROWSER_LOG_CAPTURE_INSTALLED__?: boolean;
    __LINKER_BROWSER_LOG_STORE__?: BrowserLogStore;
  }
}

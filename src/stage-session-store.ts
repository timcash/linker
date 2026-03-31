import type {LayoutStrategy} from './data/labels';
import type {StageHistoryState} from './stage-history';
import type {LineStrategy} from './line/types';
import type {StageSystemState} from './plane-stack';
import type {StrategyPanelMode} from './stage-panels';
import type {LabelSetKind} from './stage-config';
import type {TextStrategy} from './text/types';

const STAGE_SESSION_DATABASE_NAME = 'linker-stage';
const STAGE_SESSION_DATABASE_VERSION = 2;
const STAGE_SESSION_STORE_NAME = 'stage-sessions';
const LAST_STAGE_SESSION_TOKEN_KEY = 'linker:last-session-token';
const MAX_PERSISTED_STAGE_SESSIONS = 8;

export type SessionToken = string;

export type PersistedStageSessionSnapshot = {
  version: 1;
  sessionToken: SessionToken;
  savedAt: string;
  config: {
    demoLayerCount: number;
    labelSetKind: LabelSetKind;
  };
  document: StageSystemState['document'];
  session: StageSystemState['session'];
  ui: {
    layoutStrategy: LayoutStrategy;
    lineStrategy: LineStrategy;
    strategyPanelMode: StrategyPanelMode;
    textStrategy: TextStrategy;
  };
};

export type PersistedStageHistorySession = {
  version: 2;
  sessionToken: SessionToken;
  savedAt: string;
  config: {
    demoLayerCount: number;
    labelSetKind: LabelSetKind;
  };
  history: StageHistoryState;
  ui: {
    layoutStrategy: LayoutStrategy;
    lineStrategy: LineStrategy;
    strategyPanelMode: StrategyPanelMode;
    textStrategy: TextStrategy;
  };
};

export type PersistedStageSessionRecord =
  | PersistedStageSessionSnapshot
  | PersistedStageHistorySession;

export function createSessionToken(): SessionToken {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `stk-${crypto.randomUUID()}`;
  }

  return `stk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadStageSessionSnapshot(
  sessionToken: SessionToken,
): Promise<PersistedStageSessionRecord | null> {
  if (!hasIndexedDb()) {
    return null;
  }

  const database = await openStageSessionDatabase();

  try {
    const snapshot = await readStageSessionSnapshot(database, sessionToken);
    return isPersistedStageSessionRecord(snapshot) ? snapshot : null;
  } finally {
    database.close();
  }
}

export async function saveStageSessionSnapshot(
  snapshot: PersistedStageSessionRecord,
): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }

  const database = await openStageSessionDatabase();

  try {
    await writeStageSessionSnapshot(database, snapshot);
    await pruneStageSessionSnapshots(database);
  } finally {
    database.close();
  }
}

export function readLastStageSessionToken(): SessionToken | null {
  try {
    const sessionToken = window.localStorage.getItem(LAST_STAGE_SESSION_TOKEN_KEY);
    return sessionToken && sessionToken.length > 0 ? sessionToken : null;
  } catch {
    return null;
  }
}

export function writeLastStageSessionToken(sessionToken: SessionToken | null): void {
  try {
    if (sessionToken) {
      window.localStorage.setItem(LAST_STAGE_SESSION_TOKEN_KEY, sessionToken);
    } else {
      window.localStorage.removeItem(LAST_STAGE_SESSION_TOKEN_KEY);
    }
  } catch {
    // Ignore local storage failures. IndexedDB remains the source of truth.
  }
}

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

async function openStageSessionDatabase(): Promise<IDBDatabase> {
  const database = await openStageSessionDatabaseWithVersion(
    STAGE_SESSION_DATABASE_VERSION,
    'Failed to open the stage session database.',
  );

  if (database.objectStoreNames.contains(STAGE_SESSION_STORE_NAME)) {
    return database;
  }

  database.close();
  await deleteStageSessionDatabase();

  return openStageSessionDatabaseWithVersion(
    STAGE_SESSION_DATABASE_VERSION,
    'Failed to recreate the stage session database.',
  );
}

function openStageSessionDatabaseWithVersion(
  version: number,
  errorMessage: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STAGE_SESSION_DATABASE_NAME, version);

    request.addEventListener('upgradeneeded', () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STAGE_SESSION_STORE_NAME)) {
        database.createObjectStore(STAGE_SESSION_STORE_NAME, {keyPath: 'sessionToken'});
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => {
      reject(request.error ?? new Error(errorMessage));
    });
  });
}

function deleteStageSessionDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(STAGE_SESSION_DATABASE_NAME);

    request.addEventListener('success', () => resolve());
    request.addEventListener('blocked', () => {
      reject(new Error('Failed to recreate the stage session database because deletion was blocked.'));
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to delete the stage session database.'));
    });
  });
}

function readStageSessionSnapshot(
  database: IDBDatabase,
  sessionToken: SessionToken,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const request = store.get(sessionToken);

    request.addEventListener('success', () => resolve(request.result ?? null));
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to read the stage session snapshot.'));
    });
  });
}

function writeStageSessionSnapshot(
  database: IDBDatabase,
  snapshot: PersistedStageSessionRecord,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);

    store.put(snapshot);
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('Failed to write the stage session snapshot.'));
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('Stage session snapshot write was aborted.'));
    });
  });
}

async function pruneStageSessionSnapshots(database: IDBDatabase): Promise<void> {
  const snapshots = await readAllStageSessionSnapshots(database);

  if (snapshots.length <= MAX_PERSISTED_STAGE_SESSIONS) {
    return;
  }

  const staleSessionTokens = snapshots
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(MAX_PERSISTED_STAGE_SESSIONS)
    .map((snapshot) => snapshot.sessionToken);

  await deleteStageSessionSnapshots(database, staleSessionTokens);
}

function readAllStageSessionSnapshots(
  database: IDBDatabase,
): Promise<PersistedStageSessionRecord[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const request = store.getAll();

    request.addEventListener('success', () => {
      const snapshots = Array.isArray(request.result)
        ? request.result.filter(isPersistedStageSessionRecord)
        : [];
      resolve(snapshots);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to read stage session snapshots.'));
    });
  });
}

function deleteStageSessionSnapshots(
  database: IDBDatabase,
  sessionTokens: SessionToken[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);

    sessionTokens.forEach((sessionToken) => {
      store.delete(sessionToken);
    });

    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('Failed to prune stale stage session snapshots.'));
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('Stage session pruning was aborted.'));
    });
  });
}

function isPersistedStageSessionRecord(
  value: unknown,
): value is PersistedStageSessionRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<PersistedStageSessionRecord>;

  if (
    typeof snapshot.sessionToken !== 'string' ||
    typeof snapshot.savedAt !== 'string' ||
    snapshot.ui === undefined ||
    snapshot.config === undefined
  ) {
    return false;
  }

  if (snapshot.version === 1) {
    return snapshot.document !== undefined && snapshot.session !== undefined;
  }

  return (
    snapshot.version === 2 &&
    snapshot.history !== undefined
  );
}

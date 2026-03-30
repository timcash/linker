import type {LayoutStrategy} from './data/labels';
import type {LineStrategy} from './line/types';
import type {StageSystemState} from './plane-stack';
import type {StrategyPanelMode} from './stage-panels';
import type {LabelSetKind} from './stage-config';
import type {TextStrategy} from './text/types';

const STAGE_SESSION_DATABASE_NAME = 'linker-stage';
const STAGE_SESSION_DATABASE_VERSION = 1;
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

export function createSessionToken(): SessionToken {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `stk-${crypto.randomUUID()}`;
  }

  return `stk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadStageSessionSnapshot(
  sessionToken: SessionToken,
): Promise<PersistedStageSessionSnapshot | null> {
  if (!hasIndexedDb()) {
    return null;
  }

  const database = await openStageSessionDatabase();

  try {
    const snapshot = await readStageSessionSnapshot(database, sessionToken);
    return isPersistedStageSessionSnapshot(snapshot) ? snapshot : null;
  } finally {
    database.close();
  }
}

export async function saveStageSessionSnapshot(
  snapshot: PersistedStageSessionSnapshot,
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

function openStageSessionDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      STAGE_SESSION_DATABASE_NAME,
      STAGE_SESSION_DATABASE_VERSION,
    );

    request.addEventListener('upgradeneeded', () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(STAGE_SESSION_STORE_NAME)) {
        database.createObjectStore(STAGE_SESSION_STORE_NAME, {keyPath: 'sessionToken'});
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to open the stage session database.'));
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
  snapshot: PersistedStageSessionSnapshot,
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
): Promise<PersistedStageSessionSnapshot[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const request = store.getAll();

    request.addEventListener('success', () => {
      const snapshots = Array.isArray(request.result)
        ? request.result.filter(isPersistedStageSessionSnapshot)
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

function isPersistedStageSessionSnapshot(
  value: unknown,
): value is PersistedStageSessionSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<PersistedStageSessionSnapshot>;
  return (
    snapshot.version === 1 &&
    typeof snapshot.sessionToken === 'string' &&
    typeof snapshot.savedAt === 'string' &&
    snapshot.document !== undefined &&
    snapshot.session !== undefined &&
    snapshot.ui !== undefined &&
    snapshot.config !== undefined
  );
}

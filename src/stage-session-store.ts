import type {LayoutStrategy} from './data/labels';
import type {
  StageHistoryEntry,
  StageHistorySnapshot,
  StageHistoryState,
} from './stage-history';
import type {LineStrategy} from './line/types';
import type {StageSystemState} from './plane-stack';
import type {StrategyPanelMode} from './stage-panels';
import type {LabelSetKind} from './stage-config';
import type {TextStrategy} from './text/types';

const STAGE_SESSION_DATABASE_NAME = 'linker-stage';
const STAGE_SESSION_DATABASE_VERSION = 3;
const STAGE_SESSION_STORE_NAME = 'stage-sessions';
const STAGE_HISTORY_ENTRY_STORE_NAME = 'stage-history-entries';
const STAGE_HISTORY_ENTRY_SESSION_INDEX_NAME = 'by-session-token';
const LAST_STAGE_SESSION_TOKEN_KEY = 'linker:last-session-token';
const MAX_PERSISTED_STAGE_SESSIONS = 8;
const MAX_HISTORY_STEP_KEY = Number.MAX_SAFE_INTEGER;

export type SessionToken = string;

export type PersistedStageSessionConfig = {
  demoLayerCount: number;
  labelSetKind: LabelSetKind;
};

export type PersistedStageSessionUi = {
  layoutStrategy: LayoutStrategy;
  lineStrategy: LineStrategy;
  strategyPanelMode: StrategyPanelMode;
  textStrategy: TextStrategy;
};

export type PersistedStageSessionSnapshot = {
  version: 1;
  sessionToken: SessionToken;
  savedAt: string;
  config: PersistedStageSessionConfig;
  document: StageSystemState['document'];
  session: StageSystemState['session'];
  ui: PersistedStageSessionUi;
};

export type PersistedStageHistorySession = {
  version: 2;
  sessionToken: SessionToken;
  savedAt: string;
  config: PersistedStageSessionConfig;
  history: StageHistoryState;
  ui: PersistedStageSessionUi;
};

export type PersistedIncrementalStageHistorySession = {
  version: 3;
  sessionToken: SessionToken;
  savedAt: string;
  config: PersistedStageSessionConfig;
  history: StageHistoryState;
  ui: PersistedStageSessionUi;
};

export type PersistedStageSessionRecord =
  | PersistedStageSessionSnapshot
  | PersistedStageHistorySession
  | PersistedIncrementalStageHistorySession;

type PersistedStageSessionMetadata = {
  version: 3;
  sessionToken: SessionToken;
  savedAt: string;
  config: PersistedStageSessionConfig;
  historyCursorStep: number;
  historyHeadStep: number;
  ui: PersistedStageSessionUi;
};

type PersistedStageHistoryEntryRecord = {
  entry: StageHistoryEntry;
  sessionToken: SessionToken;
  step: number;
};

export type PersistedStageSessionMetadataUpdate = {
  config: PersistedStageSessionConfig;
  sessionToken: SessionToken;
  snapshot: Pick<StageHistorySnapshot, 'cursorStep' | 'headStep'>;
  ui: PersistedStageSessionUi;
};

export type PersistedStageSessionHistoryAppend = PersistedStageSessionMetadataUpdate & {
  entry: StageHistoryEntry;
  previousHeadStep: number;
  step: number;
};

export type PersistedStageSessionIncrementalFlush = PersistedStageSessionMetadataUpdate & {
  appends: Array<Pick<PersistedStageSessionHistoryAppend, 'entry' | 'previousHeadStep' | 'step'>>;
};

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
    const storedRecord = await readStageSessionRecordValue(database, sessionToken);

    if (isPersistedStageSessionMetadata(storedRecord)) {
      return readIncrementalStageSessionRecord(database, storedRecord);
    }

    return isPersistedStageSessionRecord(storedRecord) ? storedRecord : null;
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

export async function saveStageSessionMetadata(
  update: PersistedStageSessionMetadataUpdate,
): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }

  const database = await openStageSessionDatabase();

  try {
    await writeStageSessionMetadata(database, createPersistedStageSessionMetadata(update));
    await pruneStageSessionSnapshots(database);
  } finally {
    database.close();
  }
}

export async function appendStageSessionHistoryEntry(
  update: PersistedStageSessionHistoryAppend,
): Promise<void> {
  await flushStageSessionIncrementalUpdates({
    appends: [
      {
        entry: update.entry,
        previousHeadStep: update.previousHeadStep,
        step: update.step,
      },
    ],
    config: update.config,
    sessionToken: update.sessionToken,
    snapshot: update.snapshot,
    ui: update.ui,
  });
}

export async function flushStageSessionIncrementalUpdates(
  update: PersistedStageSessionIncrementalFlush,
): Promise<void> {
  if (!hasIndexedDb()) {
    return;
  }

  const database = await openStageSessionDatabase();

  try {
    await writeStageSessionIncrementalUpdates(database, update);
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

  if (
    database.objectStoreNames.contains(STAGE_SESSION_STORE_NAME) &&
    database.objectStoreNames.contains(STAGE_HISTORY_ENTRY_STORE_NAME) &&
    database
      .transaction(STAGE_HISTORY_ENTRY_STORE_NAME, 'readonly')
      .objectStore(STAGE_HISTORY_ENTRY_STORE_NAME)
      .indexNames.contains(STAGE_HISTORY_ENTRY_SESSION_INDEX_NAME)
  ) {
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

      let historyEntryStore: IDBObjectStore;

      if (!database.objectStoreNames.contains(STAGE_HISTORY_ENTRY_STORE_NAME)) {
        historyEntryStore = database.createObjectStore(STAGE_HISTORY_ENTRY_STORE_NAME, {
          keyPath: ['sessionToken', 'step'],
        });
      } else {
        historyEntryStore = request.transaction.objectStore(STAGE_HISTORY_ENTRY_STORE_NAME);
      }

      if (!historyEntryStore.indexNames.contains(STAGE_HISTORY_ENTRY_SESSION_INDEX_NAME)) {
        historyEntryStore.createIndex(
          STAGE_HISTORY_ENTRY_SESSION_INDEX_NAME,
          'sessionToken',
          {unique: false},
        );
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

function readStageSessionRecordValue(
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

async function readIncrementalStageSessionRecord(
  database: IDBDatabase,
  metadata: PersistedStageSessionMetadata,
): Promise<PersistedIncrementalStageHistorySession | null> {
  const entryRecords = await readStageHistoryEntryRecords(database, metadata.sessionToken);
  const allEntries = entryRecords
    .sort((left, right) => left.step - right.step)
    .map((record) => record.entry);
  const availableHeadStep = allEntries.length - 1;

  if (availableHeadStep < 0) {
    return null;
  }

  const headStep = clampHistoryStep(metadata.historyHeadStep, availableHeadStep);
  const entries = allEntries.slice(0, headStep + 1);

  return {
    version: 3,
    sessionToken: metadata.sessionToken,
    savedAt: metadata.savedAt,
    config: metadata.config,
    history: {
      cursorStep: clampHistoryStep(metadata.historyCursorStep, headStep),
      entries,
      headStep,
    },
    ui: metadata.ui,
  };
}

function readStageHistoryEntryRecords(
  database: IDBDatabase,
  sessionToken: SessionToken,
): Promise<PersistedStageHistoryEntryRecord[]> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_HISTORY_ENTRY_STORE_NAME, 'readonly');
    const store = transaction.objectStore(STAGE_HISTORY_ENTRY_STORE_NAME);
    const index = store.index(STAGE_HISTORY_ENTRY_SESSION_INDEX_NAME);
    const request = index.getAll(IDBKeyRange.only(sessionToken));

    request.addEventListener('success', () => {
      resolve(
        Array.isArray(request.result)
          ? request.result.filter(isPersistedStageHistoryEntryRecord)
          : [],
      );
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to read the stage history entries.'));
    });
  });
}

function writeStageSessionSnapshot(
  database: IDBDatabase,
  snapshot: PersistedStageSessionRecord,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [STAGE_SESSION_STORE_NAME, STAGE_HISTORY_ENTRY_STORE_NAME],
      'readwrite',
    );
    const sessionStore = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const historyStore = transaction.objectStore(STAGE_HISTORY_ENTRY_STORE_NAME);

    deleteStageHistoryEntries(historyStore, snapshot.sessionToken);

    if (snapshot.version === 1) {
      sessionStore.put(snapshot);
    } else {
      sessionStore.put(createPersistedStageSessionMetadata({
        config: snapshot.config,
        savedAt: snapshot.savedAt,
        sessionToken: snapshot.sessionToken,
        snapshot: snapshot.history,
        ui: snapshot.ui,
      }));

      snapshot.history.entries.forEach((entry, step) => {
        historyStore.put({
          entry,
          sessionToken: snapshot.sessionToken,
          step,
        } satisfies PersistedStageHistoryEntryRecord);
      });
    }

    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('Failed to write the stage session snapshot.'));
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('Stage session snapshot write was aborted.'));
    });
  });
}

function writeStageSessionMetadata(
  database: IDBDatabase,
  metadata: PersistedStageSessionMetadata,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);

    store.put(metadata);
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('Failed to write the stage session metadata.'));
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('Stage session metadata write was aborted.'));
    });
  });
}

function writeStageSessionIncrementalUpdates(
  database: IDBDatabase,
  update: PersistedStageSessionIncrementalFlush,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(
      [STAGE_SESSION_STORE_NAME, STAGE_HISTORY_ENTRY_STORE_NAME],
      'readwrite',
    );
    const sessionStore = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const historyStore = transaction.objectStore(STAGE_HISTORY_ENTRY_STORE_NAME);

    for (const append of update.appends) {
      if (append.previousHeadStep >= append.step) {
        deleteStageHistoryEntryRange(
          historyStore,
          update.sessionToken,
          append.step,
          append.previousHeadStep,
        );
      }

      historyStore.put({
        entry: append.entry,
        sessionToken: update.sessionToken,
        step: append.step,
      } satisfies PersistedStageHistoryEntryRecord);
    }

    sessionStore.put(createPersistedStageSessionMetadata(update));

    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('Failed to flush the incremental stage session updates.'));
    });
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('Incremental stage session flush was aborted.'));
    });
  });
}

async function pruneStageSessionSnapshots(database: IDBDatabase): Promise<void> {
  const snapshots = await readAllStageSessionRecords(database);

  if (snapshots.length <= MAX_PERSISTED_STAGE_SESSIONS) {
    return;
  }

  const staleSessionTokens = snapshots
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(MAX_PERSISTED_STAGE_SESSIONS)
    .map((snapshot) => snapshot.sessionToken);

  await deleteStageSessionSnapshots(database, staleSessionTokens);
}

function readAllStageSessionRecords(
  database: IDBDatabase,
): Promise<Array<PersistedStageSessionRecord | PersistedStageSessionMetadata>> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STAGE_SESSION_STORE_NAME, 'readonly');
    const store = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const request = store.getAll();

    request.addEventListener('success', () => {
      const snapshots = Array.isArray(request.result)
        ? request.result.filter(
            (value): value is PersistedStageSessionRecord | PersistedStageSessionMetadata =>
              isPersistedStageSessionRecord(value) || isPersistedStageSessionMetadata(value),
          )
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
    const transaction = database.transaction(
      [STAGE_SESSION_STORE_NAME, STAGE_HISTORY_ENTRY_STORE_NAME],
      'readwrite',
    );
    const sessionStore = transaction.objectStore(STAGE_SESSION_STORE_NAME);
    const historyStore = transaction.objectStore(STAGE_HISTORY_ENTRY_STORE_NAME);

    sessionTokens.forEach((sessionToken) => {
      sessionStore.delete(sessionToken);
      deleteStageHistoryEntries(historyStore, sessionToken);
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

function deleteStageHistoryEntries(
  historyStore: IDBObjectStore,
  sessionToken: SessionToken,
): void {
  deleteStageHistoryEntryRange(historyStore, sessionToken, 0, MAX_HISTORY_STEP_KEY);
}

function deleteStageHistoryEntryRange(
  historyStore: IDBObjectStore,
  sessionToken: SessionToken,
  startStep: number,
  endStep: number,
): void {
  historyStore.delete(
    IDBKeyRange.bound(
      [sessionToken, Math.max(0, startStep)],
      [sessionToken, Math.max(Math.max(0, startStep), endStep)],
    ),
  );
}

function createPersistedStageSessionMetadata(
  update: PersistedStageSessionMetadataUpdate & {savedAt?: string},
): PersistedStageSessionMetadata {
  return {
    version: 3,
    sessionToken: update.sessionToken,
    savedAt: update.savedAt ?? new Date().toISOString(),
    config: update.config,
    historyCursorStep: Math.max(0, Math.trunc(update.snapshot.cursorStep)),
    historyHeadStep: Math.max(0, Math.trunc(update.snapshot.headStep)),
    ui: update.ui,
  };
}

function clampHistoryStep(step: number, headStep: number): number {
  return Math.min(headStep, Math.max(0, Math.trunc(step)));
}

function isPersistedStageHistoryEntryRecord(
  value: unknown,
): value is PersistedStageHistoryEntryRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Partial<PersistedStageHistoryEntryRecord>;

  return (
    typeof record.sessionToken === 'string' &&
    Number.isInteger(record.step) &&
    record.step! >= 0 &&
    record.entry !== undefined
  );
}

function isPersistedStageSessionMetadata(
  value: unknown,
): value is PersistedStageSessionMetadata {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<PersistedStageSessionMetadata>;

  return (
    snapshot.version === 3 &&
    typeof snapshot.sessionToken === 'string' &&
    typeof snapshot.savedAt === 'string' &&
    snapshot.config !== undefined &&
    snapshot.ui !== undefined &&
    Number.isInteger(snapshot.historyCursorStep) &&
    Number.isInteger(snapshot.historyHeadStep)
  );
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
    (snapshot.version === 2 || snapshot.version === 3) &&
    snapshot.history !== undefined
  );
}

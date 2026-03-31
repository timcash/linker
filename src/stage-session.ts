import {DEFAULT_LAYOUT_STRATEGY} from './data/labels';
import {DEFAULT_LINE_STRATEGY} from './line/types';
import {
  appendStageHistoryCheckpoint,
  createStageHistoryState,
  getStageHistoryCurrentState,
  moveStageHistoryCursor,
  type StageHistoryEntry,
  type StageHistoryState,
  type StageHistoryViewState,
} from './stage-history';
import {
  cloneStageSystemState,
  createStageSystemState,
  DEFAULT_STAGE_MODE,
  isStageMode,
  isWorkplaneId,
  type StageSystemState,
  type WorkplaneCameraView,
  type WorkplaneDocumentState,
  type WorkplaneId,
  type WorkplaneViewState,
} from './plane-stack';
import {cloneStageScene, createStageScene} from './scene-model';
import {type StrategyPanelMode} from './stage-panels';
import {type StageConfig} from './stage-config';
import {
  type PersistedIncrementalStageHistorySession,
  type PersistedStageHistorySession,
  type PersistedStageSessionRecord,
  type PersistedStageSessionSnapshot,
} from './stage-session-store';
import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
  normalizeStackCameraState,
  type StackCameraState,
} from './stack-camera';
import {DEFAULT_TEXT_STRATEGY} from './text/types';

export const DEFAULT_STRATEGY_PANEL_MODE: StrategyPanelMode = 'text';

export type HydratedStageBootState = {
  config: StageConfig;
  history: StageHistoryState;
  initialState: StageSystemState;
  strategyPanelMode: StrategyPanelMode;
};

export function hydrateStageBootState(
  config: StageConfig,
  snapshot: PersistedStageSessionRecord | null,
): HydratedStageBootState {
  const freshState = createDefaultStageSystemState(config);
  const freshHistory = createStageHistoryState(freshState);
  const restoredHistory =
    snapshot && isStageSessionRecordCompatible(config, snapshot)
      ? restoreStageHistoryState(snapshot)
      : null;
  const baseHistory = restoredHistory ?? freshHistory;
  const hydratedHistory = hydrateRequestedHistoryCursor(
    applyRequestedStageRouteOverridesToHistory(baseHistory, config),
    config,
  );

  if (!snapshot || !restoredHistory) {
    return {
      config,
      history: hydratedHistory,
      initialState: getStageHistoryCurrentState(hydratedHistory),
      strategyPanelMode: DEFAULT_STRATEGY_PANEL_MODE,
    };
  }

  return {
    config: {
      ...config,
      layoutStrategy:
        config.layoutStrategy !== DEFAULT_LAYOUT_STRATEGY
          ? config.layoutStrategy
          : snapshot.ui.layoutStrategy,
      lineStrategy:
        config.lineStrategy !== DEFAULT_LINE_STRATEGY
          ? config.lineStrategy
          : snapshot.ui.lineStrategy,
      textStrategy: DEFAULT_TEXT_STRATEGY,
    },
    history: hydratedHistory,
    initialState: getStageHistoryCurrentState(hydratedHistory),
    strategyPanelMode: normalizeStrategyPanelMode(
      snapshot.ui.strategyPanelMode,
      config.labelSetKind,
    ),
  };
}

function createDefaultStageSystemState(config: StageConfig): StageSystemState {
  return createStageSystemState(
    createStageScene({
      demoLayerCount: config.demoLayerCount,
      labelSetKind: config.labelSetKind,
      labelTargetCount: config.labelTargetCount,
      layoutStrategy: config.layoutStrategy,
    }),
    {
      activeWorkplaneId: config.requestedWorkplaneId,
      initialCamera: config.initialCamera,
      initialCameraLabel: config.initialCameraLabel,
      stageMode: config.stageMode,
    },
  );
}

function applyRequestedStageRouteOverrides(
  state: StageSystemState,
  config: StageConfig,
): StageSystemState {
  let nextState = cloneStageSystemState(state);

  if (config.requestedStageMode) {
    nextState = {
      ...nextState,
      session: {
        ...nextState.session,
        stageMode: config.requestedStageMode,
      },
    };
  }

  if (
    config.requestedWorkplaneId &&
    nextState.document.workplanesById[config.requestedWorkplaneId]
  ) {
    nextState = {
      ...nextState,
      session: {
        ...nextState.session,
        activeWorkplaneId: config.requestedWorkplaneId,
      },
    };
  }

  return nextState;
}

function applyRequestedStageRouteOverridesToHistory(
  history: StageHistoryState,
  config: StageConfig,
): StageHistoryState {
  if (config.requestedHistoryStep !== null) {
    return history;
  }

  const currentState = getStageHistoryCurrentState(history);
  const nextState = applyRequestedStageRouteOverrides(currentState, config);

  if (
    nextState.session.stageMode === currentState.session.stageMode &&
    nextState.session.activeWorkplaneId === currentState.session.activeWorkplaneId
  ) {
    return history;
  }

  return appendStageHistoryCheckpoint(history, nextState, 'Open route override');
}

function hydrateRequestedHistoryCursor(
  history: StageHistoryState,
  config: StageConfig,
): StageHistoryState {
  if (config.requestedHistoryStep === null) {
    return moveStageHistoryCursor(history, history.headStep);
  }

  return moveStageHistoryCursor(history, config.requestedHistoryStep);
}

function isStageSessionRecordCompatible(
  config: StageConfig,
  snapshot: PersistedStageSessionRecord,
): boolean {
  return (
    snapshot.config.labelSetKind === config.labelSetKind &&
    snapshot.config.demoLayerCount === config.demoLayerCount
  );
}

function restoreStageHistoryState(
  snapshot: PersistedStageSessionRecord,
): StageHistoryState | null {
  if (snapshot.version === 1) {
    const restoredState = restoreStageSystemStateFromParts(
      snapshot.document,
      snapshot.session,
    );

    return restoredState ? createStageHistoryState(restoredState) : null;
  }

  return restorePersistedHistorySession(snapshot);
}

function restorePersistedHistorySession(
  snapshot: PersistedStageHistorySession | PersistedIncrementalStageHistorySession,
): StageHistoryState | null {
  const rawEntries = Array.isArray(snapshot.history?.entries)
    ? snapshot.history.entries
    : [];
  const restoredEntries: StageHistoryEntry[] = [];

  for (const rawEntry of rawEntries) {
    if (rawEntry?.kind === 'checkpoint') {
      const restoredState = restoreStageSystemStateFromValue(rawEntry.state);

      if (!restoredState) {
        return null;
      }

      restoredEntries.push({
        kind: 'checkpoint',
        state: restoredState,
        summary:
          typeof rawEntry.summary === 'string' && rawEntry.summary.trim().length > 0
            ? rawEntry.summary
            : 'Checkpoint',
      });
      continue;
    }

    if (rawEntry?.kind === 'view') {
      const restoredView = restoreHistoryViewState(rawEntry.view);

      if (!restoredView) {
        return null;
      }

      restoredEntries.push({
        kind: 'view',
        summary:
          typeof rawEntry.summary === 'string' && rawEntry.summary.trim().length > 0
            ? rawEntry.summary
            : 'View',
        view: restoredView,
      });
      continue;
    }

    return null;
  }

  if (restoredEntries.length === 0 || restoredEntries[0]?.kind !== 'checkpoint') {
    return null;
  }

  const headStep = restoredEntries.length - 1;
  const rawCursorStep = Number.isInteger(snapshot.history?.cursorStep)
    ? snapshot.history.cursorStep
    : headStep;

  return {
    cursorStep: Math.min(headStep, Math.max(0, rawCursorStep)),
    entries: restoredEntries,
    headStep,
  };
}

function restoreStageSystemStateFromValue(
  value: unknown,
): StageSystemState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as Partial<PersistedStageSessionSnapshot>;

  return restoreStageSystemStateFromParts(snapshot.document, snapshot.session);
}

function restoreStageSystemStateFromParts(
  document: PersistedStageSessionSnapshot['document'] | undefined,
  session: PersistedStageSessionSnapshot['session'] | undefined,
): StageSystemState | null {
  const workplaneOrder = normalizeWorkplaneOrder(document?.workplaneOrder ?? []);

  if (workplaneOrder.length === 0) {
    return null;
  }

  const workplanesById = restoreWorkplaneDocuments(
    document?.workplanesById,
    workplaneOrder,
  );
  const workplaneViewsById = restoreWorkplaneViews(
    session?.workplaneViewsById,
    workplaneOrder,
  );

  if (!workplanesById || !workplaneViewsById) {
    return null;
  }

  const highestWorkplaneNumber = workplaneOrder.reduce<number>((highest, workplaneId) => {
    const workplaneNumber = Number.parseInt(workplaneId.slice(3), 10);
    return Number.isFinite(workplaneNumber) ? Math.max(highest, workplaneNumber) : highest;
  }, 1);
  const nextWorkplaneNumber =
    Number.isInteger(document?.nextWorkplaneNumber) &&
    (document?.nextWorkplaneNumber ?? 0) > highestWorkplaneNumber
      ? (document?.nextWorkplaneNumber ?? 0)
      : highestWorkplaneNumber + 1;
  const activeWorkplaneId = workplaneOrder.includes(session?.activeWorkplaneId ?? '')
    ? (session?.activeWorkplaneId as WorkplaneId)
    : workplaneOrder[0];

  return {
    document: {
      nextWorkplaneNumber,
      workplaneOrder,
      workplanesById,
    },
    session: {
      activeWorkplaneId,
      stackCamera: restoreStackCamera(session?.stackCamera),
      stageMode: isStageMode(session?.stageMode)
        ? session.stageMode
        : DEFAULT_STAGE_MODE,
      workplaneViewsById,
    },
  };
}

function restoreHistoryViewState(
  value: unknown,
): StageHistoryViewState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const view = value as Partial<StageHistoryViewState>;
  const workplaneViewCamera = restoreWorkplaneCamera(view.workplaneView?.camera);

  if (
    !isWorkplaneId(view.activeWorkplaneId) ||
    !isStageMode(view.stageMode) ||
    !workplaneViewCamera
  ) {
    return null;
  }

  return {
    activeWorkplaneId: view.activeWorkplaneId,
    stageMode: view.stageMode,
    stackCamera: restoreStackCamera(view.stackCamera),
    workplaneView: {
      selectedLabelKey:
        typeof view.workplaneView?.selectedLabelKey === 'string' ||
        view.workplaneView?.selectedLabelKey === null
          ? view.workplaneView.selectedLabelKey
          : null,
      camera: workplaneViewCamera,
    },
  };
}

function normalizeWorkplaneOrder(workplaneOrder: WorkplaneId[]): WorkplaneId[] {
  if (!Array.isArray(workplaneOrder)) {
    return [];
  }

  const seenWorkplaneIds = new Set<WorkplaneId>();
  const normalizedWorkplaneOrder: WorkplaneId[] = [];

  for (const workplaneId of workplaneOrder) {
    if (!isWorkplaneId(workplaneId) || seenWorkplaneIds.has(workplaneId)) {
      continue;
    }

    seenWorkplaneIds.add(workplaneId);
    normalizedWorkplaneOrder.push(workplaneId);
  }

  return normalizedWorkplaneOrder;
}

function restoreWorkplaneDocuments(
  workplanesById: Record<WorkplaneId, WorkplaneDocumentState> | null | undefined,
  workplaneOrder: WorkplaneId[],
): Record<WorkplaneId, WorkplaneDocumentState> | null {
  if (!workplanesById || typeof workplanesById !== 'object') {
    return null;
  }

  const restoredEntries: Array<[WorkplaneId, WorkplaneDocumentState]> = [];

  for (const workplaneId of workplaneOrder) {
    const workplane = workplanesById[workplaneId];

    if (!workplane || !workplane.scene) {
      return null;
    }

    restoredEntries.push([
      workplaneId,
      {
        labelTextOverrides: normalizeLabelTextOverrides(workplane.labelTextOverrides),
        scene: cloneStageScene(workplane.scene),
        workplaneId,
      },
    ]);
  }

  return Object.fromEntries(restoredEntries) as Record<WorkplaneId, WorkplaneDocumentState>;
}

function restoreWorkplaneViews(
  workplaneViewsById: Record<WorkplaneId, WorkplaneViewState> | null | undefined,
  workplaneOrder: WorkplaneId[],
): Record<WorkplaneId, WorkplaneViewState> | null {
  if (!workplaneViewsById || typeof workplaneViewsById !== 'object') {
    return null;
  }

  const restoredEntries: Array<[WorkplaneId, WorkplaneViewState]> = [];

  for (const workplaneId of workplaneOrder) {
    const view = workplaneViewsById[workplaneId];
    const restoredCamera = restoreWorkplaneCamera(view?.camera);

    if (!view || !restoredCamera) {
      return null;
    }

    restoredEntries.push([
      workplaneId,
      {
        selectedLabelKey:
          typeof view.selectedLabelKey === 'string' || view.selectedLabelKey === null
            ? view.selectedLabelKey
            : null,
        camera: restoredCamera,
      },
    ]);
  }

  return Object.fromEntries(restoredEntries) as Record<WorkplaneId, WorkplaneViewState>;
}

function restoreWorkplaneCamera(
  camera: WorkplaneCameraView | undefined,
): WorkplaneCameraView | null {
  if (
    !camera ||
    !Number.isFinite(camera.centerX) ||
    !Number.isFinite(camera.centerY) ||
    !Number.isFinite(camera.zoom)
  ) {
    return null;
  }

  return {
    centerX: camera.centerX,
    centerY: camera.centerY,
    zoom: camera.zoom,
  };
}

function restoreStackCamera(
  stackCamera: StackCameraState | null | undefined,
): StackCameraState {
  if (
    !stackCamera ||
    !Number.isFinite(stackCamera.azimuthRadians) ||
    !Number.isFinite(stackCamera.distanceScale) ||
    !Number.isFinite(stackCamera.elevationRadians)
  ) {
    return cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE);
  }

  return normalizeStackCameraState(stackCamera);
}

function normalizeLabelTextOverrides(
  labelTextOverrides: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!labelTextOverrides || typeof labelTextOverrides !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(labelTextOverrides).filter((entry): entry is [string, string] => {
      const [labelKey, text] = entry;
      return typeof labelKey === 'string' && typeof text === 'string';
    }),
  );
}

function normalizeStrategyPanelMode(
  strategyPanelMode: string | null | undefined,
  labelSetKind: StageConfig['labelSetKind'],
): StrategyPanelMode {
  if (
    strategyPanelMode === 'text' ||
    (labelSetKind === 'demo' &&
      (strategyPanelMode === 'label-edit' ||
        strategyPanelMode === 'layout' ||
        strategyPanelMode === 'line'))
  ) {
    return strategyPanelMode;
  }

  return DEFAULT_STRATEGY_PANEL_MODE;
}

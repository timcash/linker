import {DEFAULT_LAYOUT_STRATEGY} from './data/labels';
import {DEFAULT_LINE_STRATEGY} from './line/types';
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
import {type PersistedStageSessionSnapshot} from './stage-session-store';
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
  initialState: StageSystemState;
  strategyPanelMode: StrategyPanelMode;
};

export function hydrateStageBootState(
  config: StageConfig,
  snapshot: PersistedStageSessionSnapshot | null,
): HydratedStageBootState {
  const restoredState =
    snapshot && isStageSessionSnapshotCompatible(config, snapshot)
      ? restoreStageSystemState(snapshot)
      : null;

  if (!restoredState) {
    return {
      config,
      initialState: createDefaultStageSystemState(config),
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
    initialState: applyRequestedStageRouteOverrides(restoredState, config),
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

function isStageSessionSnapshotCompatible(
  config: StageConfig,
  snapshot: PersistedStageSessionSnapshot,
): boolean {
  return (
    snapshot.config.labelSetKind === config.labelSetKind &&
    snapshot.config.demoLayerCount === config.demoLayerCount
  );
}

function restoreStageSystemState(
  snapshot: PersistedStageSessionSnapshot,
): StageSystemState | null {
  const workplaneOrder = normalizeWorkplaneOrder(snapshot.document.workplaneOrder);

  if (workplaneOrder.length === 0) {
    return null;
  }

  const workplanesById = restoreWorkplaneDocuments(
    snapshot.document.workplanesById,
    workplaneOrder,
  );
  const workplaneViewsById = restoreWorkplaneViews(
    snapshot.session.workplaneViewsById,
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
    Number.isInteger(snapshot.document.nextWorkplaneNumber) &&
    snapshot.document.nextWorkplaneNumber > highestWorkplaneNumber
      ? snapshot.document.nextWorkplaneNumber
      : highestWorkplaneNumber + 1;
  const activeWorkplaneId = workplaneOrder.includes(snapshot.session.activeWorkplaneId)
    ? snapshot.session.activeWorkplaneId
    : workplaneOrder[0];

  return {
    document: {
      nextWorkplaneNumber,
      workplaneOrder,
      workplanesById,
    },
    session: {
      activeWorkplaneId,
      stackCamera: restoreStackCamera(snapshot.session.stackCamera),
      stageMode: isStageMode(snapshot.session.stageMode)
        ? snapshot.session.stageMode
        : DEFAULT_STAGE_MODE,
      workplaneViewsById,
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

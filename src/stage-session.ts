import {
  cloneStageSystemState,
  createStageSystemState,
  replaceWorkplaneView,
  type StageSystemState,
} from './plane-stack';
import {createStageScene} from './scene-model';
import {type StageConfig} from './stage-config';
import {type StrategyPanelMode} from './stage-panels';
import {createDefaultEditorLabState} from './data/editor-lab';
import {createDefaultWorkplaneShowcaseState} from './data/workplane-showcase';

export const DEFAULT_STRATEGY_PANEL_MODE: StrategyPanelMode = 'label-edit';

export type HydratedStageBootState = {
  config: StageConfig;
  initialState: StageSystemState;
  strategyPanelMode: StrategyPanelMode;
};

export function hydrateStageBootState(
  config: StageConfig,
  initialStateOverride?: StageSystemState | null,
): HydratedStageBootState {
  const initialState = applyRequestedStageRouteOverrides(
    initialStateOverride
      ? cloneStageSystemState(initialStateOverride)
      : createDefaultStageSystemState(config),
    config,
  );

  return {
    config,
    initialState,
    strategyPanelMode: DEFAULT_STRATEGY_PANEL_MODE,
  };
}

function createDefaultStageSystemState(config: StageConfig): StageSystemState {
  if (shouldUseEditorLab(config)) {
    return createDefaultEditorLabState();
  }

  if (shouldUseDefaultWorkplaneShowcase(config)) {
    return createDefaultWorkplaneShowcaseState();
  }

  return createStageSystemState(
    createStageScene({
      demoLayerCount: config.demoLayerCount,
      labelSetKind: config.labelSetKind,
      labelTargetCount: config.labelTargetCount,
      layoutStrategy: config.layoutStrategy,
    }),
    {
      activeWorkplaneId: config.requestedWorkplaneId,
      initialCameraLabel: config.initialCameraLabel,
      stageMode: config.stageMode,
    },
  );
}

function shouldUseDefaultWorkplaneShowcase(config: StageConfig): boolean {
  return !config.benchmarkEnabled && config.labelSetKind === 'demo' && config.demoPreset === 'workplane-showcase';
}

function shouldUseEditorLab(config: StageConfig): boolean {
  return !config.benchmarkEnabled && config.labelSetKind === 'demo' && config.demoPreset === 'editor-lab';
}

function applyRequestedStageRouteOverrides(
  state: StageSystemState,
  config: StageConfig,
): StageSystemState {
  let nextState = state;

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

  if (config.initialCameraLabel) {
    const activeWorkplaneId = nextState.session.activeWorkplaneId;
    const activeWorkplane = nextState.document.workplanesById[activeWorkplaneId];
    const currentView = nextState.session.workplaneViewsById[activeWorkplaneId];
    const requestedLabel = activeWorkplane?.scene.labels.find(
      (label) => label.navigation?.key === config.initialCameraLabel,
    );

    if (requestedLabel && currentView) {
      nextState = replaceWorkplaneView(nextState, activeWorkplaneId, {
        ...currentView,
        camera: {
          centerX: requestedLabel.location.x,
          centerY: requestedLabel.location.y,
          zoom: requestedLabel.zoomLevel,
        },
        selectedLabelKey: requestedLabel.navigation?.key ?? null,
      });
    }
  }

  return nextState;
}

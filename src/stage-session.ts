import {
  cloneStageSystemState,
  createStageSystemState,
  type StageSystemState,
} from './plane-stack';
import {createStageScene} from './scene-model';
import {type StageConfig} from './stage-config';
import {type StrategyPanelMode} from './stage-panels';

export const DEFAULT_STRATEGY_PANEL_MODE: StrategyPanelMode = 'text';

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

  return nextState;
}

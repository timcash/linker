import {
  appendStageHistoryCheckpoint,
  createStageHistoryState,
} from '../../src/stage-history';
import {
  INITIAL_WORKPLANE_ID,
  createStageSystemState,
  replaceWorkplaneLabelTextOverride,
  replaceWorkplaneView,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneId,
} from '../../src/plane-stack';
import {createStageScene} from '../../src/scene-model';
import type {PersistedStageHistorySession} from '../../src/stage-session-store';

import {DEMO_LABEL_COUNT} from './types';

const DEMO_LAYOUT_STRATEGY = 'flow-columns';
const DEMO_LINE_STRATEGY = 'rounded-step-links';
const SAVED_AT = '2026-03-31T00:00:00.000Z';

export function createPreparedSingleWorkplaneSessionRecord(
  sessionToken: string,
): PersistedStageHistorySession {
  const scene = createDemoScene();
  let state = createStageSystemState(scene, {
    initialCameraLabel: '2:2:1',
    stageMode: '2d-mode',
  });

  state = setWorkplaneLabelText(state, INITIAL_WORKPLANE_ID, '2:2:1', 'Alpha');
  state = replaceWorkplaneView(state, INITIAL_WORKPLANE_ID, {
    selectedLabelKey: '2:2:1',
    camera: {centerX: 22, centerY: 18, zoom: 2},
  });

  return {
    version: 2,
    sessionToken,
    savedAt: SAVED_AT,
    config: {
      demoLayerCount: 12,
      labelSetKind: 'demo',
    },
    history: createStageHistoryState(state, 'Prepared single-workplane state'),
    ui: {
      layoutStrategy: DEMO_LAYOUT_STRATEGY,
      lineStrategy: DEMO_LINE_STRATEGY,
      strategyPanelMode: 'label-edit',
      textStrategy: 'sdf-instanced',
    },
  };
}

export function createPreparedTwoWorkplaneSessionRecord(
  sessionToken: string,
): PersistedStageHistorySession {
  const initialState = createStageSystemState(createDemoScene(), {
    initialCameraLabel: '1:1:1',
    stageMode: '2d-mode',
  });
  let state = setWorkplaneLabelText(initialState, INITIAL_WORKPLANE_ID, '2:2:1', 'Alpha');

  state = replaceWorkplaneView(state, INITIAL_WORKPLANE_ID, {
    selectedLabelKey: '2:2:1',
    camera: {centerX: 22, centerY: 18, zoom: 2},
  });
  state = spawnWorkplaneAfterActive(state);
  state = setWorkplaneLabelText(state, 'wp-2', '3:3:1', 'Vector');
  state = replaceWorkplaneView(state, 'wp-2', {
    selectedLabelKey: '3:3:1',
    camera: {centerX: 44, centerY: 39, zoom: 4},
  });

  let history = createStageHistoryState(initialState);
  history = appendStageHistoryCheckpoint(history, state, 'Prepared two-workplane state');

  return {
    version: 2,
    sessionToken,
    savedAt: SAVED_AT,
    config: {
      demoLayerCount: 12,
      labelSetKind: 'demo',
    },
    history,
    ui: {
      layoutStrategy: DEMO_LAYOUT_STRATEGY,
      lineStrategy: DEMO_LINE_STRATEGY,
      strategyPanelMode: 'label-edit',
      textStrategy: 'sdf-instanced',
    },
  };
}

export function createPreparedHighZoomPlaneFocusSessionRecord(
  sessionToken: string,
): PersistedStageHistorySession {
  const state = createStageSystemState(createDemoScene(), {
    initialCameraLabel: '1:9:3',
    stageMode: '2d-mode',
  });

  return {
    version: 2,
    sessionToken,
    savedAt: SAVED_AT,
    config: {
      demoLayerCount: 12,
      labelSetKind: 'demo',
    },
    history: createStageHistoryState(state, 'Prepared high-zoom plane-focus state'),
    ui: {
      layoutStrategy: DEMO_LAYOUT_STRATEGY,
      lineStrategy: DEMO_LINE_STRATEGY,
      strategyPanelMode: 'label-edit',
      textStrategy: 'sdf-instanced',
    },
  };
}

function createDemoScene() {
  return createStageScene({
    demoLayerCount: 12,
    labelSetKind: 'demo',
    labelTargetCount: DEMO_LABEL_COUNT,
    layoutStrategy: DEMO_LAYOUT_STRATEGY,
  });
}

function setWorkplaneLabelText(
  state: StageSystemState,
  workplaneId: WorkplaneId,
  labelKey: string,
  text: string,
): StageSystemState {
  const nextState = replaceWorkplaneLabelTextOverride(state, workplaneId, labelKey, text);
  const workplane = nextState.document.workplanesById[workplaneId];
  const label = workplane?.scene.labels.find(
    (candidateLabel) => candidateLabel.navigation?.key === labelKey,
  );

  if (label) {
    label.text = text;
  }

  return nextState;
}

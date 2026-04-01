import {
  INITIAL_WORKPLANE_ID,
  cloneStageSystemState,
  createStageSystemState,
  replaceWorkplaneLabelTextOverride,
  replaceWorkplaneScene,
  replaceWorkplaneView,
  selectPreviousWorkplane,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneId,
} from '../../src/plane-stack';
import {createStageScene} from '../../src/scene-model';

import {DEMO_LABEL_COUNT} from './types';

const DEMO_LAYOUT_STRATEGY = 'flow-columns';

export function createPreparedSingleWorkplaneState(): StageSystemState {
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

  return state;
}

export function createPreparedTwoWorkplaneState(
  options?: {activeWorkplaneId?: WorkplaneId},
): StageSystemState {
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
  state = replaceWorkplaneScene(state, 'wp-2', createDemoScene());
  state = setWorkplaneLabelText(state, 'wp-2', '3:3:1', 'Vector');
  state = replaceWorkplaneView(state, 'wp-2', {
    selectedLabelKey: '3:3:1',
    camera: {centerX: 44, centerY: 39, zoom: 4},
  });

  if (options?.activeWorkplaneId === INITIAL_WORKPLANE_ID) {
    state = selectPreviousWorkplane(state);
  }

  return state;
}

export function createPreparedFiveWorkplaneState(): StageSystemState {
  let state = createPreparedSingleWorkplaneState();

  for (let index = 0; index < 4; index += 1) {
    state = spawnWorkplaneAfterActive(state);
    const activeWorkplaneId = state.session.activeWorkplaneId;
    state = replaceWorkplaneScene(state, activeWorkplaneId, createDemoScene());
    state = replaceWorkplaneView(state, activeWorkplaneId, {
      selectedLabelKey: `${Math.min(6, index + 2)}:${Math.min(6, index + 2)}:1`,
      camera: {
        centerX: 12 + (index + 1) * 8,
        centerY: 10 + (index + 1) * 7,
        zoom: 1 + (index % 3),
      },
    });
  }

  return cloneStageSystemState(state);
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

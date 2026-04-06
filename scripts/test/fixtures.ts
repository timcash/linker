import {
  INITIAL_WORKPLANE_ID,
  createStageSystemState,
  replaceWorkplaneLabelTextOverride,
  replaceWorkplaneScene,
  replaceWorkplaneView,
  selectPreviousWorkplane,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneId,
} from '../../src/plane-stack';
import {buildLabelKey} from '../../src/label-key';
import {createStageScene} from '../../src/scene-model';

import {DEMO_LABEL_COUNT} from './types';

const DEMO_LAYOUT_STRATEGY = 'flow-columns';

export function createPreparedSingleWorkplaneState(): StageSystemState {
  const scene = createDemoScene();
  let state = createStageSystemState(scene, {
    initialCameraLabel: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    stageMode: '2d-mode',
  });

  state = setWorkplaneLabelText(
    state,
    INITIAL_WORKPLANE_ID,
    buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    'Alpha',
  );
  state = replaceWorkplaneView(state, INITIAL_WORKPLANE_ID, {
    selectedLabelKey: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    camera: {centerX: 22, centerY: 18, zoom: 2},
  });

  return state;
}

export function createPreparedTwoWorkplaneState(
  options?: {activeWorkplaneId?: WorkplaneId},
): StageSystemState {
  const initialState = createStageSystemState(createDemoScene(), {
    initialCameraLabel: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 1, 1),
    stageMode: '2d-mode',
  });
  let state = setWorkplaneLabelText(
    initialState,
    INITIAL_WORKPLANE_ID,
    buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    'Alpha',
  );

  state = replaceWorkplaneView(state, INITIAL_WORKPLANE_ID, {
    selectedLabelKey: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    camera: {centerX: 22, centerY: 18, zoom: 2},
  });
  state = spawnWorkplaneAfterActive(state);
  state = replaceWorkplaneScene(state, 'wp-2', createDemoScene('wp-2'));
  state = setWorkplaneLabelText(state, 'wp-2', buildLabelKey('wp-2', 1, 3, 3), 'Vector');
  state = replaceWorkplaneView(state, 'wp-2', {
    selectedLabelKey: buildLabelKey('wp-2', 1, 3, 3),
    camera: {centerX: 44, centerY: 39, zoom: 4},
  });

  if (options?.activeWorkplaneId === INITIAL_WORKPLANE_ID) {
    state = selectPreviousWorkplane(state);
  }

  return state;
}

function createDemoScene(workplaneId: WorkplaneId = INITIAL_WORKPLANE_ID) {
  return createStageScene({
    demoLayerCount: 12,
    labelSetKind: 'demo',
    labelTargetCount: DEMO_LABEL_COUNT,
    layoutStrategy: DEMO_LAYOUT_STRATEGY,
    workplaneId,
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

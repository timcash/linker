import {
  INITIAL_WORKPLANE_ID,
  createStageSystemState,
  type PlaneStackDagState,
  replaceWorkplaneLabelTextOverride,
  replaceWorkplaneScene,
  replaceWorkplaneView,
  selectPreviousWorkplane,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneId,
} from '../../src/plane-stack';
import {buildLabelKey} from '../../src/label-key';
import {DEMO_LABEL_SET_ID} from '../../src/data/demo-meta';
import {
  createCanonicalFiveWorkplaneNetworkDagDocument,
} from '../../src/data/network-dag';
import {createFiveWorkplaneGridState} from '../../src/data/workplane-grid-stack';
import {createEmptyStageScene, createStageScene} from '../../src/scene-model';
import {cloneStackCameraState, DEFAULT_STACK_CAMERA_STATE} from '../../src/stack-camera';

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

export function createEmptySingleWorkplaneState(): StageSystemState {
  return createStageSystemState(
    createEmptyStageScene(DEMO_LABEL_SET_ID, INITIAL_WORKPLANE_ID),
    {
      stageMode: '2d-mode',
    },
  );
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

export function createBridgeLinkedFiveWorkplaneState(): StageSystemState {
  let state = createFiveWorkplaneGridState({
    activeWorkplaneId: 'wp-3',
    stageMode: '2d-mode',
  });

  state = setWorkplaneFocus(state, 'wp-1', buildLabelKey('wp-1', 1, 3, 3), 2);
  state = setWorkplaneFocus(state, 'wp-2', buildLabelKey('wp-2', 1, 10, 3), 3);
  state = setWorkplaneFocus(state, 'wp-3', buildLabelKey('wp-3', 1, 6, 6), 2);
  state = setWorkplaneFocus(state, 'wp-4', buildLabelKey('wp-4', 1, 3, 10), 3);
  state = setWorkplaneFocus(state, 'wp-5', buildLabelKey('wp-5', 1, 11, 2), 3);

  state = setWorkplaneLabelText(state, 'wp-1', buildLabelKey('wp-1', 1, 3, 3), 'North');
  state = setWorkplaneLabelText(state, 'wp-2', buildLabelKey('wp-2', 1, 10, 3), 'Relay');
  state = setWorkplaneLabelText(state, 'wp-3', buildLabelKey('wp-3', 1, 6, 6), 'Pivot');
  state = setWorkplaneLabelText(state, 'wp-4', buildLabelKey('wp-4', 1, 3, 10), 'Spoke');
  state = setWorkplaneLabelText(state, 'wp-5', buildLabelKey('wp-5', 1, 11, 2), 'Return');

  return state;
}

export function createCanonicalNetworkDagDocument() {
  return createCanonicalFiveWorkplaneNetworkDagDocument();
}

export function createCanonicalNetworkDagStageState(): StageSystemState {
  const dagDocument = createCanonicalFiveWorkplaneNetworkDagDocument();
  const workplaneOrder = Object.keys(dagDocument.nodesById) as WorkplaneId[];
  const positionsById = Object.fromEntries(
    workplaneOrder.map((workplaneId) => [
      workplaneId,
      {...dagDocument.nodesById[workplaneId].position},
    ]),
  ) as PlaneStackDagState['positionsById'];

  return {
    document: {
      dag: {
        edges: dagDocument.edges.map((edge) => ({...edge})),
        positionsById,
        rootWorkplaneId: dagDocument.rootWorkplaneId,
      },
      nextWorkplaneNumber: dagDocument.nextWorkplaneNumber,
      workplaneBridgeLinks: [],
      workplaneOrder,
      workplanesById: Object.fromEntries(
        workplaneOrder.map((workplaneId) => {
          const node = dagDocument.nodesById[workplaneId];

          return [
            workplaneId,
            {
              labelTextOverrides: {...node.labelTextOverrides},
              scene: node.scene,
              workplaneId,
            },
          ];
        }),
      ) as StageSystemState['document']['workplanesById'],
    },
    session: {
      activeWorkplaneId: dagDocument.rootWorkplaneId,
      stackCamera: cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE),
      stageMode: '2d-mode',
      workplaneViewsById: Object.fromEntries(
        workplaneOrder.map((workplaneId) => [
          workplaneId,
          {
            camera: {centerX: 0, centerY: 0, zoom: 0},
            selectedLabelKey: null,
          },
        ]),
      ) as StageSystemState['session']['workplaneViewsById'],
    },
  };
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

function setWorkplaneFocus(
  state: StageSystemState,
  workplaneId: WorkplaneId,
  labelKey: string,
  zoom: number,
): StageSystemState {
  const label = state.document.workplanesById[workplaneId]?.scene.labels.find(
    (candidateLabel) => candidateLabel.navigation?.key === labelKey,
  );

  if (!label) {
    return state;
  }

  return replaceWorkplaneView(state, workplaneId, {
    selectedLabelKey: labelKey,
    camera: {
      centerX: label.location.x,
      centerY: label.location.y,
      zoom,
    },
  });
}

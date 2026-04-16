import {cloneStageScene, createEmptyStageScene, type StageScene} from './scene-model';
import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
  type StackCameraState,
} from './stack-camera';
import {
  validateDagDocument,
  type DagDocumentState,
  type WorkplaneDagEdgeState,
  type WorkplaneDagPosition,
} from './dag-document';
import type {LinkDefinition} from './line/types';

export const STAGE_MODES = ['2d-mode', '3d-mode'] as const;

export type StageMode = (typeof STAGE_MODES)[number];
export type WorkplaneId = `wp-${number}`;
export type WorkplaneCameraView = {
  centerX: number;
  centerY: number;
  zoom: number;
};

export const DEFAULT_STAGE_MODE: StageMode = '2d-mode';
export const INITIAL_WORKPLANE_ID: WorkplaneId = 'wp-1';
export const INITIAL_NEXT_WORKPLANE_NUMBER = 2;
export const MAX_WORKPLANE_COUNT = 12;
const DAG_AUTOGRID_DEPTH_SLOTS_PER_RANK = 2;

export type WorkplaneDocumentState = {
  labelTextOverrides: Record<string, string>;
  workplaneId: WorkplaneId;
  scene: StageScene;
};

export type WorkplaneBridgeLinkDefinition = Pick<
  LinkDefinition,
  'bendDirection' | 'color' | 'curveBias' | 'curveDepth' | 'curveLift' | 'lineWidth' | 'zoomLevel' | 'zoomRange'
> & {
  inputLabelKey: string;
  inputWorkplaneId: WorkplaneId;
  linkKey: string;
  outputLabelKey: string;
  outputWorkplaneId: WorkplaneId;
};

export type PlaneStackDagState = {
  edges: WorkplaneDagEdgeState[];
  positionsById: Record<WorkplaneId, WorkplaneDagPosition>;
  rootWorkplaneId: WorkplaneId;
};

export type PlaneStackDocumentState = {
  dag?: PlaneStackDagState | null;
  nextWorkplaneNumber: number;
  workplaneBridgeLinks: WorkplaneBridgeLinkDefinition[];
  workplaneOrder: WorkplaneId[];
  workplanesById: Record<WorkplaneId, WorkplaneDocumentState>;
};

export type StageSessionState = {
  activeWorkplaneId: WorkplaneId;
  stackCamera: StackCameraState;
  stageMode: StageMode;
  workplaneViewsById: Record<WorkplaneId, WorkplaneViewState>;
};

export type StageSystemState = {
  document: PlaneStackDocumentState;
  session: StageSessionState;
};

export type DagControlAvailability = {
  canFocusRoot: boolean;
  canInsertParent: boolean;
  canMoveDepthIn: boolean;
  canMoveDepthOut: boolean;
  canMoveLaneDown: boolean;
  canMoveLaneUp: boolean;
  canMoveRankBackward: boolean;
  canMoveRankForward: boolean;
  canSpawnChild: boolean;
};

export type WorkplaneViewState = {
  selectedLabelKey: string | null;
  camera: WorkplaneCameraView;
};

export function createStageSystemState(
  scene: StageScene,
  options?: {
    activeWorkplaneId?: WorkplaneId | null;
    initialCamera?: WorkplaneCameraView;
    initialCameraLabel?: string | null;
    stageMode?: StageMode;
  },
): StageSystemState {
  const workplane = createInitialWorkplane(scene);
  const initialView = createInitialWorkplaneView(
    scene,
    options?.initialCamera ?? {centerX: 0, centerY: 0, zoom: 0},
    options?.initialCameraLabel,
  );
  const activeWorkplaneId =
    options?.activeWorkplaneId === workplane.workplaneId
      ? options.activeWorkplaneId
      : workplane.workplaneId;

  return {
    document: {
      dag: null,
      nextWorkplaneNumber: INITIAL_NEXT_WORKPLANE_NUMBER,
      workplaneBridgeLinks: [],
      workplaneOrder: [workplane.workplaneId],
      workplanesById: {
        [workplane.workplaneId]: workplane,
      } as Record<WorkplaneId, WorkplaneDocumentState>,
    },
    session: {
      activeWorkplaneId,
      stackCamera: cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE),
      stageMode: options?.stageMode ?? DEFAULT_STAGE_MODE,
      workplaneViewsById: {
        [workplane.workplaneId]: initialView,
      } as Record<WorkplaneId, WorkplaneViewState>,
    },
  };
}

export function createStageSystemStateWithDagRoot(
  scene: StageScene,
  options?: {
    activeWorkplaneId?: WorkplaneId | null;
    initialCamera?: WorkplaneCameraView;
    initialCameraLabel?: string | null;
    stageMode?: StageMode;
  },
): StageSystemState {
  const state = createStageSystemState(scene, options);
  const rootWorkplaneId = state.session.activeWorkplaneId;

  return {
    ...state,
    document: {
      ...state.document,
      dag: {
        edges: [],
        positionsById: {
          [rootWorkplaneId]: {column: 0, row: 0, layer: 0},
        } as Record<WorkplaneId, WorkplaneDagPosition>,
        rootWorkplaneId,
      },
    },
  };
}

export function cloneStageSystemState(
  state: StageSystemState,
): StageSystemState {
  const workplanesById = Object.fromEntries(
    state.document.workplaneOrder.map((workplaneId) => {
      const workplane = state.document.workplanesById[workplaneId];

      return [
        workplaneId,
        {
          labelTextOverrides: {...workplane.labelTextOverrides},
          scene: cloneStageScene(workplane.scene),
          workplaneId,
        },
      ];
    }),
  ) as Record<WorkplaneId, WorkplaneDocumentState>;
  const workplaneViewsById = Object.fromEntries(
    state.document.workplaneOrder.map((workplaneId) => {
      const view = state.session.workplaneViewsById[workplaneId];

      return [workplaneId, cloneWorkplaneView(view)];
    }),
  ) as Record<WorkplaneId, WorkplaneViewState>;

  return {
    document: {
      dag: state.document.dag ? clonePlaneStackDagState(state.document.dag) : null,
      nextWorkplaneNumber: state.document.nextWorkplaneNumber,
      workplaneBridgeLinks: state.document.workplaneBridgeLinks.map(cloneWorkplaneBridgeLink),
      workplaneOrder: [...state.document.workplaneOrder],
      workplanesById,
    },
    session: {
      activeWorkplaneId: state.session.activeWorkplaneId,
      stackCamera: cloneStackCameraState(state.session.stackCamera),
      stageMode: state.session.stageMode,
      workplaneViewsById,
    },
  };
}

export function getActiveWorkplaneDocument(
  state: StageSystemState,
): WorkplaneDocumentState {
  return state.document.workplanesById[state.session.activeWorkplaneId];
}

export function getActiveWorkplaneView(
  state: StageSystemState,
): WorkplaneViewState {
  return state.session.workplaneViewsById[state.session.activeWorkplaneId];
}

export function getPlaneCount(state: StageSystemState): number {
  return state.document.workplaneOrder.length;
}

export function getWorkplaneIndex(
  state: StageSystemState,
  workplaneId: WorkplaneId,
): number {
  return state.document.workplaneOrder.findIndex(
    (candidateWorkplaneId) => candidateWorkplaneId === workplaneId,
  );
}

export function canDeleteActiveWorkplane(state: StageSystemState): boolean {
  if (state.document.dag) {
    return canDeleteActiveDagWorkplane(state);
  }

  return getPlaneCount(state) > 1;
}

export function canSpawnWorkplane(state: StageSystemState): boolean {
  return getPlaneCount(state) < MAX_WORKPLANE_COUNT;
}

export function getDagControlAvailability(
  state: StageSystemState,
): DagControlAvailability | null {
  const dag = state.document.dag;
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const activePosition = dag?.positionsById[activeWorkplaneId];

  if (!dag || !activePosition) {
    return null;
  }

  return {
    canFocusRoot: activeWorkplaneId !== dag.rootWorkplaneId,
    canInsertParent: canSpawnWorkplane(state),
    canMoveDepthIn: true,
    canMoveDepthOut: activePosition.layer > 0,
    canMoveLaneDown: true,
    canMoveLaneUp: activePosition.row > 0,
    canMoveRankBackward: canMoveActiveDagWorkplaneColumn(state, -1),
    canMoveRankForward: canMoveActiveDagWorkplaneColumn(state, 1),
    canSpawnChild: canSpawnWorkplane(state),
  };
}

export function selectPreviousWorkplane(state: StageSystemState): StageSystemState {
  return selectWorkplaneAtOffset(state, -1);
}

export function selectNextWorkplane(state: StageSystemState): StageSystemState {
  return selectWorkplaneAtOffset(state, 1);
}

export function focusDagRootWorkplane(state: StageSystemState): StageSystemState {
  const dag = state.document.dag;

  if (!dag || state.session.activeWorkplaneId === dag.rootWorkplaneId) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      activeWorkplaneId: dag.rootWorkplaneId,
    },
  };
}

export function spawnDagChildWorkplane(state: StageSystemState): StageSystemState {
  const dag = state.document.dag;
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const activePosition = dag?.positionsById[activeWorkplaneId];

  if (!dag || !activePosition || !canSpawnWorkplane(state)) {
    return state;
  }

  const activeDocument = getActiveWorkplaneDocument(state);
  const activeView = getActiveWorkplaneView(state);
  const workplaneId: WorkplaneId = `wp-${state.document.nextWorkplaneNumber}`;
  const nextAutogridPosition = getNextAvailableDagRankSlicePosition(
    dag.positionsById,
    activePosition.column + 1,
  );
  const nextDag: PlaneStackDagState = {
    edges: [
      ...dag.edges,
      {
        edgeKey: `dag:${activeWorkplaneId}->${workplaneId}`,
        fromWorkplaneId: activeWorkplaneId,
        toWorkplaneId: workplaneId,
      },
    ],
    positionsById: {
      ...dag.positionsById,
      [workplaneId]: {
        column: activePosition.column + 1,
        row: nextAutogridPosition.row,
        layer: nextAutogridPosition.layer,
      },
    },
    rootWorkplaneId: dag.rootWorkplaneId,
  };

  return applyDagStageMutation(state, {
    activeWorkplaneId: workplaneId,
    dag: nextDag,
    nextWorkplaneNumber: state.document.nextWorkplaneNumber + 1,
    workplaneViewsById: {
      ...state.session.workplaneViewsById,
      [workplaneId]: {
        camera: {...activeView.camera},
        selectedLabelKey: null,
      },
    },
    workplanesById: {
      ...state.document.workplanesById,
      [workplaneId]: {
        labelTextOverrides: {},
        scene: createEmptyStageScene(activeDocument.scene.labelSetPreset, workplaneId),
        workplaneId,
      },
    },
  });
}

export function insertDagParentWorkplane(state: StageSystemState): StageSystemState {
  const dag = state.document.dag;
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const activePosition = dag?.positionsById[activeWorkplaneId];

  if (!dag || !activePosition || !canSpawnWorkplane(state)) {
    return state;
  }

  const activeDocument = getActiveWorkplaneDocument(state);
  const activeView = getActiveWorkplaneView(state);
  const workplaneId: WorkplaneId = `wp-${state.document.nextWorkplaneNumber}`;
  const nextPositionsById = Object.fromEntries(
    Object.entries(dag.positionsById).map(([workplaneId, position]) => [
      workplaneId,
      {...position},
    ]),
  ) as Record<WorkplaneId, WorkplaneDagPosition>;
  let nextEdges = dag.edges.map((edge) => ({...edge}));
  let rootWorkplaneId = dag.rootWorkplaneId;

  if (activeWorkplaneId === dag.rootWorkplaneId) {
    for (const position of Object.values(nextPositionsById)) {
      position.column += 1;
    }

    nextPositionsById[workplaneId] = {column: 0, row: 0, layer: 0};
    nextEdges.push({
      edgeKey: `dag:${workplaneId}->${activeWorkplaneId}`,
      fromWorkplaneId: workplaneId,
      toWorkplaneId: activeWorkplaneId,
    });
    rootWorkplaneId = workplaneId;
  } else {
    const incomingEdges = dag.edges
      .filter((edge) => edge.toWorkplaneId === activeWorkplaneId)
      .sort((left, right) => compareWorkplaneIds(left.fromWorkplaneId, right.fromWorkplaneId));
    const replacedEdge = incomingEdges[0];

    if (!replacedEdge) {
      return state;
    }

    for (const descendantWorkplaneId of collectDagDescendantIds(dag, activeWorkplaneId)) {
      nextPositionsById[descendantWorkplaneId] = {
        ...nextPositionsById[descendantWorkplaneId],
        column: nextPositionsById[descendantWorkplaneId].column + 1,
      };
    }

    nextPositionsById[workplaneId] = {...activePosition};
    nextEdges = nextEdges.filter((edge) => edge.edgeKey !== replacedEdge.edgeKey);
    nextEdges.push(
      {
        edgeKey: `dag:${replacedEdge.fromWorkplaneId}->${workplaneId}`,
        fromWorkplaneId: replacedEdge.fromWorkplaneId,
        toWorkplaneId: workplaneId,
      },
      {
        edgeKey: `dag:${workplaneId}->${activeWorkplaneId}`,
        fromWorkplaneId: workplaneId,
        toWorkplaneId: activeWorkplaneId,
      },
    );
  }

  return applyDagStageMutation(state, {
    activeWorkplaneId: workplaneId,
    dag: {
      edges: nextEdges,
      positionsById: nextPositionsById,
      rootWorkplaneId,
    },
    nextWorkplaneNumber: state.document.nextWorkplaneNumber + 1,
    workplaneViewsById: {
      ...state.session.workplaneViewsById,
      [workplaneId]: {
        camera: {...activeView.camera},
        selectedLabelKey: null,
      },
    },
    workplanesById: {
      ...state.document.workplanesById,
      [workplaneId]: {
        labelTextOverrides: {},
        scene: createEmptyStageScene(activeDocument.scene.labelSetPreset, workplaneId),
        workplaneId,
      },
    },
  });
}

export function moveActiveDagWorkplaneByRank(
  state: StageSystemState,
  delta: -1 | 1,
): StageSystemState {
  if (!canMoveActiveDagWorkplaneColumn(state, delta)) {
    return state;
  }

  return updateActiveDagWorkplanePosition(state, (position) => ({
    ...position,
    column: position.column + delta,
  }));
}

export function moveActiveDagWorkplaneByLane(
  state: StageSystemState,
  delta: -1 | 1,
): StageSystemState {
  return updateActiveDagWorkplanePosition(state, (position) => {
    const nextRow = position.row + delta;

    if (nextRow < 0) {
      return null;
    }

    return {
      ...position,
      row: nextRow,
    };
  });
}

export function moveActiveDagWorkplaneByDepth(
  state: StageSystemState,
  delta: -1 | 1,
): StageSystemState {
  return updateActiveDagWorkplanePosition(state, (position) => {
    const nextLayer = position.layer + delta;

    if (nextLayer < 0) {
      return null;
    }

    return {
      ...position,
      layer: nextLayer,
    };
  });
}

export function spawnWorkplaneAfterActive(state: StageSystemState): StageSystemState {
  if (!canSpawnWorkplane(state)) {
    return state;
  }

  const activeIndex = getActiveWorkplaneIndex(state);
  const activeDocument = getActiveWorkplaneDocument(state);
  const activeView = getActiveWorkplaneView(state);
  const workplaneId: WorkplaneId = `wp-${state.document.nextWorkplaneNumber}`;
  const workplaneOrder = [...state.document.workplaneOrder];

  workplaneOrder.splice(activeIndex + 1, 0, workplaneId);

  return {
    document: {
      ...state.document,
      nextWorkplaneNumber: state.document.nextWorkplaneNumber + 1,
      workplaneOrder,
      workplanesById: {
        ...state.document.workplanesById,
        [workplaneId]: {
          labelTextOverrides: {},
          scene: createEmptyStageScene(activeDocument.scene.labelSetPreset, workplaneId),
          workplaneId,
        },
      },
    },
    session: {
      ...state.session,
      activeWorkplaneId: workplaneId,
      workplaneViewsById: {
        ...state.session.workplaneViewsById,
        [workplaneId]: {
          camera: cloneWorkplaneView(activeView).camera,
          selectedLabelKey: null,
        },
      },
    },
  };
}

export function deleteActiveWorkplane(state: StageSystemState): StageSystemState {
  if (state.document.dag) {
    return deleteActiveDagWorkplane(state);
  }

  if (!canDeleteActiveWorkplane(state)) {
    return state;
  }

  const activeIndex = getActiveWorkplaneIndex(state);
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const workplaneOrder = state.document.workplaneOrder.filter(
    (workplaneId) => workplaneId !== activeWorkplaneId,
  );
  const nextIndex = Math.min(activeIndex, workplaneOrder.length - 1);
  const nextActiveWorkplaneId = workplaneOrder[nextIndex];
  const nextWorkplanesById = Object.fromEntries(
    Object.entries(state.document.workplanesById).filter(
      ([workplaneId]) => workplaneId !== activeWorkplaneId,
    ),
  ) as Record<WorkplaneId, WorkplaneDocumentState>;

  return {
    document: {
      ...state.document,
      nextWorkplaneNumber: deriveNextWorkplaneNumber(nextWorkplanesById),
      workplaneOrder,
      workplanesById: nextWorkplanesById,
    },
    session: {
      ...state.session,
      activeWorkplaneId: nextActiveWorkplaneId,
      workplaneViewsById: Object.fromEntries(
        Object.entries(state.session.workplaneViewsById).filter(
          ([workplaneId]) => workplaneId !== activeWorkplaneId,
        ),
      ) as Record<WorkplaneId, WorkplaneViewState>,
    },
  };
}

export function replaceWorkplaneScene(
  state: StageSystemState,
  workplaneId: WorkplaneId,
  scene: StageScene,
): StageSystemState {
  const workplane = state.document.workplanesById[workplaneId];

  if (!workplane) {
    return state;
  }

  return {
    ...state,
    document: {
      ...state.document,
      workplanesById: {
        ...state.document.workplanesById,
        [workplaneId]: {
          ...workplane,
          scene,
        },
      },
    },
  };
}

export function replaceWorkplaneView(
  state: StageSystemState,
  workplaneId: WorkplaneId,
  view: WorkplaneViewState,
): StageSystemState {
  if (!state.session.workplaneViewsById[workplaneId]) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      workplaneViewsById: {
        ...state.session.workplaneViewsById,
        [workplaneId]: cloneWorkplaneView(view),
      },
    },
  };
}

export function replaceWorkplaneLabelTextOverride(
  state: StageSystemState,
  workplaneId: WorkplaneId,
  labelKey: string,
  text: string | null,
): StageSystemState {
  const workplane = state.document.workplanesById[workplaneId];

  if (!workplane) {
    return state;
  }

  const labelTextOverrides = {...workplane.labelTextOverrides};

  if (text === null) {
    delete labelTextOverrides[labelKey];
  } else {
    labelTextOverrides[labelKey] = text;
  }

  return {
    ...state,
    document: {
      ...state.document,
      workplanesById: {
        ...state.document.workplanesById,
        [workplaneId]: {
          ...workplane,
          labelTextOverrides,
        },
      },
    },
  };
}

export function replaceStackCamera(
  state: StageSystemState,
  stackCamera: StackCameraState,
): StageSystemState {
  return {
    ...state,
    session: {
      ...state.session,
      stackCamera: cloneStackCameraState(stackCamera),
    },
  };
}

export function isStageMode(value: string | null | undefined): value is StageMode {
  return value !== null && value !== undefined && STAGE_MODES.includes(value as StageMode);
}

export function isWorkplaneId(value: string | null | undefined): value is WorkplaneId {
  return value !== null && value !== undefined && /^wp-[1-9]\d*$/u.test(value);
}

function createInitialWorkplane(scene: StageScene): WorkplaneDocumentState {
  return {
    labelTextOverrides: {},
    workplaneId: INITIAL_WORKPLANE_ID,
    scene,
  };
}

function createInitialWorkplaneView(
  scene: StageScene,
  initialCamera: WorkplaneCameraView,
  requestedLabelKey: string | null | undefined,
): WorkplaneViewState {
  const activeLabel = resolveSceneLabel(scene, requestedLabelKey);

  return {
    selectedLabelKey: activeLabel?.navigation?.key ?? null,
    camera: activeLabel
      ? {
          centerX: activeLabel.location.x,
          centerY: activeLabel.location.y,
          zoom: activeLabel.zoomLevel,
        }
      : {...initialCamera},
  };
}

function cloneWorkplaneView(view: WorkplaneViewState): WorkplaneViewState {
  return {
    selectedLabelKey: view.selectedLabelKey,
    camera: {
      centerX: view.camera.centerX,
      centerY: view.camera.centerY,
      zoom: view.camera.zoom,
    },
  };
}

function cloneWorkplaneBridgeLink(
  link: WorkplaneBridgeLinkDefinition,
): WorkplaneBridgeLinkDefinition {
  return {
    ...link,
    color: [...link.color],
  };
}

function clonePlaneStackDagState(
  dag: PlaneStackDagState,
): PlaneStackDagState {
  return {
    edges: dag.edges.map((edge) => ({...edge})),
    positionsById: Object.fromEntries(
      Object.entries(dag.positionsById).map(([workplaneId, position]) => [
        workplaneId,
        {...position},
      ]),
    ) as Record<WorkplaneId, WorkplaneDagPosition>,
    rootWorkplaneId: dag.rootWorkplaneId,
  };
}

function resolveSceneLabel(
  scene: StageScene,
  requestedLabelKey: string | null | undefined,
): StageScene['labels'][number] | null {
  if (requestedLabelKey) {
    const requestedLabel = scene.labels.find(
      (label) => label.navigation?.key === requestedLabelKey,
    );

    if (requestedLabel) {
      return requestedLabel;
    }
  }

  return scene.labels.find((label) => label.navigation?.key) ?? null;
}

function selectWorkplaneAtOffset(
  state: StageSystemState,
  offset: -1 | 1,
): StageSystemState {
  const activeIndex = getActiveWorkplaneIndex(state);
  const nextIndex = activeIndex + offset;

  if (nextIndex < 0 || nextIndex >= state.document.workplaneOrder.length) {
    return state;
  }

  return {
    ...state,
    session: {
      ...state.session,
      activeWorkplaneId: state.document.workplaneOrder[nextIndex],
    },
  };
}

function getActiveWorkplaneIndex(state: StageSystemState): number {
  return getWorkplaneIndex(state, state.session.activeWorkplaneId);
}

function applyDagStageMutation(
  state: StageSystemState,
  input: {
    activeWorkplaneId?: WorkplaneId;
    dag: PlaneStackDagState;
    nextWorkplaneNumber?: number;
    workplaneViewsById?: Record<WorkplaneId, WorkplaneViewState>;
    workplanesById?: Record<WorkplaneId, WorkplaneDocumentState>;
  },
): StageSystemState {
  const nextWorkplanesById = input.workplanesById ?? state.document.workplanesById;
  const nextWorkplaneViewsById = input.workplaneViewsById ?? state.session.workplaneViewsById;
  const nextWorkplaneNumber = input.nextWorkplaneNumber ?? state.document.nextWorkplaneNumber;

  return {
    document: {
      ...state.document,
      dag: clonePlaneStackDagState(input.dag),
      nextWorkplaneNumber,
      workplaneOrder: deriveDagWorkplaneOrder(input.dag, nextWorkplanesById, nextWorkplaneNumber),
      workplanesById: nextWorkplanesById,
    },
    session: {
      ...state.session,
      activeWorkplaneId: input.activeWorkplaneId ?? state.session.activeWorkplaneId,
      workplaneViewsById: nextWorkplaneViewsById,
    },
  };
}

function updateActiveDagWorkplanePosition(
  state: StageSystemState,
  update: (position: WorkplaneDagPosition) => WorkplaneDagPosition | null,
): StageSystemState {
  const dag = state.document.dag;
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const activePosition = dag?.positionsById[activeWorkplaneId];

  if (!dag || !activePosition) {
    return state;
  }

  const nextPosition = update(activePosition);

  if (!nextPosition) {
    return state;
  }

  return applyDagStageMutation(state, {
    dag: {
      ...dag,
      positionsById: {
        ...dag.positionsById,
        [activeWorkplaneId]: nextPosition,
      },
    },
  });
}

function canDeleteActiveDagWorkplane(state: StageSystemState): boolean {
  const dag = state.document.dag;
  const activeWorkplaneId = state.session.activeWorkplaneId;

  if (!dag) {
    return false;
  }

  if (activeWorkplaneId === dag.rootWorkplaneId) {
    return false;
  }

  return !dag.edges.some((edge) => edge.fromWorkplaneId === activeWorkplaneId);
}

function deleteActiveDagWorkplane(state: StageSystemState): StageSystemState {
  const dag = state.document.dag;

  if (!dag || !canDeleteActiveDagWorkplane(state)) {
    return state;
  }

  const activeIndex = getActiveWorkplaneIndex(state);
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const workplaneOrder = state.document.workplaneOrder.filter(
    (workplaneId) => workplaneId !== activeWorkplaneId,
  );
  const nextIndex = Math.min(activeIndex, workplaneOrder.length - 1);
  const nextActiveWorkplaneId = workplaneOrder[nextIndex];
  const nextWorkplanesById = Object.fromEntries(
    Object.entries(state.document.workplanesById).filter(
      ([workplaneId]) => workplaneId !== activeWorkplaneId,
    ),
  ) as Record<WorkplaneId, WorkplaneDocumentState>;
  const nextWorkplaneViewsById = Object.fromEntries(
    Object.entries(state.session.workplaneViewsById).filter(
      ([workplaneId]) => workplaneId !== activeWorkplaneId,
    ),
  ) as Record<WorkplaneId, WorkplaneViewState>;
  const nextWorkplaneNumber = deriveNextWorkplaneNumber(nextWorkplanesById);

  return applyDagStageMutation(
    {
      document: {
        ...state.document,
        nextWorkplaneNumber,
        workplaneOrder,
        workplanesById: nextWorkplanesById,
      },
      session: {
        ...state.session,
        activeWorkplaneId: nextActiveWorkplaneId,
        workplaneViewsById: nextWorkplaneViewsById,
      },
    },
    {
      activeWorkplaneId: nextActiveWorkplaneId,
      dag: {
        edges: dag.edges.filter(
          (edge) =>
            edge.fromWorkplaneId !== activeWorkplaneId &&
            edge.toWorkplaneId !== activeWorkplaneId,
        ),
        positionsById: Object.fromEntries(
          Object.entries(dag.positionsById).filter(
            ([workplaneId]) => workplaneId !== activeWorkplaneId,
          ),
        ) as Record<WorkplaneId, WorkplaneDagPosition>,
        rootWorkplaneId: dag.rootWorkplaneId,
      },
      nextWorkplaneNumber,
      workplaneViewsById: nextWorkplaneViewsById,
      workplanesById: nextWorkplanesById,
    },
  );
}

function canMoveActiveDagWorkplaneColumn(
  state: StageSystemState,
  delta: -1 | 1,
): boolean {
  const dag = state.document.dag;
  const activeWorkplaneId = state.session.activeWorkplaneId;
  const activePosition = dag?.positionsById[activeWorkplaneId];

  if (!dag || !activePosition) {
    return false;
  }

  const nextColumn = activePosition.column + delta;

  if (nextColumn < 0) {
    return false;
  }

  for (const edge of dag.edges) {
    if (edge.toWorkplaneId === activeWorkplaneId) {
      const parentColumn = dag.positionsById[edge.fromWorkplaneId]?.column;

      if (parentColumn === undefined || parentColumn >= nextColumn) {
        return false;
      }
    }

    if (edge.fromWorkplaneId === activeWorkplaneId) {
      const childColumn = dag.positionsById[edge.toWorkplaneId]?.column;

      if (childColumn === undefined || childColumn <= nextColumn) {
        return false;
      }
    }
  }

  return true;
}

function collectDagDescendantIds(
  dag: PlaneStackDagState,
  workplaneId: WorkplaneId,
): WorkplaneId[] {
  const pendingWorkplaneIds: WorkplaneId[] = [workplaneId];
  const visitedWorkplaneIds = new Set<WorkplaneId>();

  while (pendingWorkplaneIds.length > 0) {
    const currentWorkplaneId = pendingWorkplaneIds.shift();

    if (!currentWorkplaneId || visitedWorkplaneIds.has(currentWorkplaneId)) {
      continue;
    }

    visitedWorkplaneIds.add(currentWorkplaneId);

    for (const edge of dag.edges) {
      if (edge.fromWorkplaneId === currentWorkplaneId) {
        pendingWorkplaneIds.push(edge.toWorkplaneId);
      }
    }
  }

  return [...visitedWorkplaneIds];
}

function deriveDagWorkplaneOrder(
  dag: PlaneStackDagState,
  workplanesById: Record<WorkplaneId, WorkplaneDocumentState>,
  nextWorkplaneNumber: number,
): WorkplaneId[] {
  const dagDocument: DagDocumentState = {
    edges: dag.edges.map((edge) => ({...edge})),
    nextWorkplaneNumber,
    nodesById: Object.fromEntries(
      Object.keys(dag.positionsById).map((workplaneId) => {
        const typedWorkplaneId = workplaneId as WorkplaneId;

        return [
          typedWorkplaneId,
          {
            labelTextOverrides: {...(workplanesById[typedWorkplaneId]?.labelTextOverrides ?? {})},
            position: {...dag.positionsById[typedWorkplaneId]},
            scene:
              workplanesById[typedWorkplaneId]?.scene ??
              createEmptyStageScene('dag-missing', typedWorkplaneId),
            workplaneId: typedWorkplaneId,
          },
        ];
      }),
    ) as DagDocumentState['nodesById'],
    rootWorkplaneId: dag.rootWorkplaneId,
  };
  const topologicalOrder = validateDagDocument(dagDocument).topologicalOrder;

  if (topologicalOrder.length > 0) {
    return topologicalOrder;
  }

  return Object.keys(dag.positionsById).sort(compareWorkplaneIds) as WorkplaneId[];
}

function getNextAvailableDagRankSlicePosition(
  positionsById: Record<WorkplaneId, WorkplaneDagPosition>,
  column: number,
): Pick<WorkplaneDagPosition, 'layer' | 'row'> {
  let occupantCount = 0;

  for (const position of Object.values(positionsById)) {
    if (position.column === column) {
      occupantCount += 1;
    }
  }

  return {
    layer: occupantCount % DAG_AUTOGRID_DEPTH_SLOTS_PER_RANK,
    row: Math.floor(occupantCount / DAG_AUTOGRID_DEPTH_SLOTS_PER_RANK),
  };
}

function deriveNextWorkplaneNumber(
  workplanesById: Record<WorkplaneId, WorkplaneDocumentState>,
): number {
  let maxWorkplaneNumber = 0;

  for (const workplaneId of Object.keys(workplanesById)) {
    const parsedNumber = Number.parseInt(workplaneId.slice(3), 10);

    if (Number.isFinite(parsedNumber)) {
      maxWorkplaneNumber = Math.max(maxWorkplaneNumber, parsedNumber);
    }
  }

  return maxWorkplaneNumber + 1;
}

function compareWorkplaneIds(left: string, right: string): number {
  const leftNumber = Number.parseInt(left.slice(3), 10);
  const rightNumber = Number.parseInt(right.slice(3), 10);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right);
}

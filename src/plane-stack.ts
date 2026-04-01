import {cloneStageScene, createEmptyStageScene, type StageScene} from './scene-model';
import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
  type StackCameraState,
} from './stack-camera';

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
export const MAX_WORKPLANE_COUNT = 8;

export type WorkplaneDocumentState = {
  labelTextOverrides: Record<string, string>;
  workplaneId: WorkplaneId;
  scene: StageScene;
};

export type PlaneStackDocumentState = {
  nextWorkplaneNumber: number;
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
      nextWorkplaneNumber: INITIAL_NEXT_WORKPLANE_NUMBER,
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
      nextWorkplaneNumber: state.document.nextWorkplaneNumber,
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
  return getPlaneCount(state) > 1;
}

export function canSpawnWorkplane(state: StageSystemState): boolean {
  return getPlaneCount(state) < MAX_WORKPLANE_COUNT;
}

export function selectPreviousWorkplane(state: StageSystemState): StageSystemState {
  return selectWorkplaneAtOffset(state, -1);
}

export function selectNextWorkplane(state: StageSystemState): StageSystemState {
  return selectWorkplaneAtOffset(state, 1);
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
      nextWorkplaneNumber: state.document.nextWorkplaneNumber + 1,
      workplaneOrder,
      workplanesById: {
        ...state.document.workplanesById,
        [workplaneId]: {
          labelTextOverrides: {},
          scene: createEmptyStageScene(activeDocument.scene.labelSetPreset),
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

  return {
    document: {
      ...state.document,
      workplaneOrder,
      workplanesById: Object.fromEntries(
        Object.entries(state.document.workplanesById).filter(
          ([workplaneId]) => workplaneId !== activeWorkplaneId,
        ),
      ) as Record<WorkplaneId, WorkplaneDocumentState>,
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

import {
  cloneStageSystemState,
  replaceStackCamera,
  replaceWorkplaneView,
  type StageMode,
  type StageSystemState,
  type WorkplaneId,
  type WorkplaneViewState,
} from './plane-stack';
import {cloneStackCameraState, type StackCameraState} from './stack-camera';

export type StageHistoryViewState = {
  activeWorkplaneId: WorkplaneId;
  stageMode: StageMode;
  stackCamera: StackCameraState;
  workplaneView: WorkplaneViewState;
};

export type StageHistoryEntry =
  | {
      kind: 'checkpoint';
      state: StageSystemState;
      summary: string;
    }
  | {
      kind: 'view';
      summary: string;
      view: StageHistoryViewState;
    };

export type StageHistoryState = {
  cursorStep: number;
  entries: StageHistoryEntry[];
  headStep: number;
};

export type StageHistorySnapshot = {
  canGoBack: boolean;
  canGoForward: boolean;
  cursorStep: number;
  headStep: number;
};

export function createStageHistoryState(
  initialState: StageSystemState,
  summary = 'Open stage session',
): StageHistoryState {
  return {
    cursorStep: 0,
    entries: [createCheckpointEntry(initialState, summary)],
    headStep: 0,
  };
}

export function appendStageHistoryCheckpoint(
  history: StageHistoryState,
  state: StageSystemState,
  summary: string,
): StageHistoryState {
  return appendEntry(history, createCheckpointEntry(state, summary));
}

export function appendStageHistoryView(
  history: StageHistoryState,
  state: StageSystemState,
  summary: string,
): StageHistoryState {
  return appendStageHistoryViewState(history, createStageHistoryViewState(state), summary);
}

export function appendStageHistoryViewState(
  history: StageHistoryState,
  view: StageHistoryViewState,
  summary: string,
): StageHistoryState {
  const nextEntry: StageHistoryEntry = {
    kind: 'view',
    summary,
    view,
  };
  const lastEntry = history.entries[history.cursorStep];

  if (lastEntry?.kind === 'view' && areStageHistoryViewsEqual(lastEntry.view, nextEntry.view)) {
    return history;
  }

  return appendEntry(history, nextEntry);
}

export function canStageHistoryGoBack(history: StageHistoryState): boolean {
  return history.cursorStep > 0;
}

export function canStageHistoryGoForward(history: StageHistoryState): boolean {
  return history.cursorStep < history.headStep;
}

export function getStageHistorySnapshot(
  history: StageHistoryState,
): StageHistorySnapshot {
  return {
    canGoBack: canStageHistoryGoBack(history),
    canGoForward: canStageHistoryGoForward(history),
    cursorStep: history.cursorStep,
    headStep: history.headStep,
  };
}

export function moveStageHistoryCursor(
  history: StageHistoryState,
  step: number,
): StageHistoryState {
  const clampedStep = clampStep(step, history.entries.length);

  if (clampedStep === history.cursorStep) {
    return history;
  }

  return {
    ...history,
    cursorStep: clampedStep,
  };
}

export function replayStageHistoryToStep(
  history: StageHistoryState,
  step: number,
): StageSystemState {
  const clampedStep = clampStep(step, history.entries.length);
  const checkpointIndex = findCheckpointIndex(history.entries, clampedStep);
  const checkpointEntry = history.entries[checkpointIndex];

  if (!checkpointEntry || checkpointEntry.kind !== 'checkpoint') {
    throw new Error('Stage history is missing an initial checkpoint entry.');
  }

  let state = cloneStageSystemState(checkpointEntry.state);

  for (let index = checkpointIndex + 1; index <= clampedStep; index += 1) {
    const entry = history.entries[index];

    if (!entry) {
      continue;
    }

    if (entry.kind === 'checkpoint') {
      state = cloneStageSystemState(entry.state);
      continue;
    }

    state = applyHistoryView(state, entry.view);
  }

  return state;
}

export function getStageHistoryCurrentState(
  history: StageHistoryState,
): StageSystemState {
  return replayStageHistoryToStep(history, history.cursorStep);
}

function appendEntry(
  history: StageHistoryState,
  entry: StageHistoryEntry,
): StageHistoryState {
  const entries = history.entries.slice(0, history.cursorStep + 1);

  entries.push(entry);

  return {
    cursorStep: entries.length - 1,
    entries,
    headStep: entries.length - 1,
  };
}

function createCheckpointEntry(
  state: StageSystemState,
  summary: string,
): StageHistoryEntry {
  return {
    kind: 'checkpoint',
    state: cloneStageSystemState(state),
    summary,
  };
}

export function createStageHistoryViewState(
  state: StageSystemState,
): StageHistoryViewState {
  const workplaneView = state.session.workplaneViewsById[state.session.activeWorkplaneId];

  return {
    activeWorkplaneId: state.session.activeWorkplaneId,
    stageMode: state.session.stageMode,
    stackCamera: cloneStackCameraState(state.session.stackCamera),
    workplaneView: cloneWorkplaneView(workplaneView),
  };
}

function applyHistoryView(
  state: StageSystemState,
  view: StageHistoryViewState,
): StageSystemState {
  const nextState = replaceWorkplaneView(state, view.activeWorkplaneId, view.workplaneView);

  return replaceStackCamera(
    {
      ...nextState,
      session: {
        ...nextState.session,
        activeWorkplaneId: view.activeWorkplaneId,
        stageMode: view.stageMode,
      },
    },
    view.stackCamera,
  );
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

export function areStageHistoryViewsEqual(
  left: StageHistoryViewState,
  right: StageHistoryViewState,
): boolean {
  return (
    left.activeWorkplaneId === right.activeWorkplaneId &&
    left.stageMode === right.stageMode &&
    left.stackCamera.azimuthRadians === right.stackCamera.azimuthRadians &&
    left.stackCamera.elevationRadians === right.stackCamera.elevationRadians &&
    left.stackCamera.distanceScale === right.stackCamera.distanceScale &&
    left.workplaneView.selectedLabelKey === right.workplaneView.selectedLabelKey &&
    left.workplaneView.camera.centerX === right.workplaneView.camera.centerX &&
    left.workplaneView.camera.centerY === right.workplaneView.camera.centerY &&
    left.workplaneView.camera.zoom === right.workplaneView.camera.zoom
  );
}

function findCheckpointIndex(entries: StageHistoryEntry[], step: number): number {
  for (let index = step; index >= 0; index -= 1) {
    if (entries[index]?.kind === 'checkpoint') {
      return index;
    }
  }

  return 0;
}

function clampStep(step: number, entryCount: number): number {
  if (entryCount <= 0) {
    return 0;
  }

  return Math.min(entryCount - 1, Math.max(0, Math.trunc(step)));
}

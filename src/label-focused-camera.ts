import {
  createLabelNavigationIndex,
  getLabelNavigationNode,
  getLabelNavigationTarget,
  hasLabelNavigationTarget,
  resolveLabelNavigationKey,
  type LabelNavigationIndex,
  type LabelNavigationNode,
} from './label-navigation';
import type {LabelDefinition} from './text/types';

export type LabelFocusedCameraAction =
  | 'pan-up'
  | 'pan-down'
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-camera';

export type LabelFocusedCameraState = {
  activeLabelKey: string;
  navigationIndex: LabelNavigationIndex;
};

export type LabelFocusedCameraAvailability = {
  canMoveDown: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canMoveUp: boolean;
  canReset: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
};

export function createLabelFocusedCameraState(
  labels: LabelDefinition[],
  requestedLabelKey: string | null | undefined,
): LabelFocusedCameraState {
  return buildLabelFocusedCameraState(labels, requestedLabelKey);
}

export function relayoutLabelFocusedCameraState(
  previousState: LabelFocusedCameraState | null,
  labels: LabelDefinition[],
  requestedLabelKey?: string | null,
): LabelFocusedCameraState {
  return buildLabelFocusedCameraState(
    labels,
    requestedLabelKey ?? previousState?.activeLabelKey,
  );
}

export function getActiveLabelFocusedCameraNode(
  state: LabelFocusedCameraState | null,
): LabelNavigationNode | null {
  if (!state) {
    return null;
  }

  return getLabelNavigationNode(state.navigationIndex, state.activeLabelKey);
}

export function getLabelFocusedCameraTarget(
  state: LabelFocusedCameraState | null,
  action: LabelFocusedCameraAction,
): LabelNavigationNode | null {
  if (!state) {
    return null;
  }

  return getLabelNavigationTarget(state.navigationIndex, state.activeLabelKey, action);
}

export function hasLabelFocusedCameraTarget(
  state: LabelFocusedCameraState | null,
  action: LabelFocusedCameraAction,
): boolean {
  if (!state) {
    return false;
  }

  return hasLabelNavigationTarget(state.navigationIndex, state.activeLabelKey, action);
}

export function getLabelFocusedCameraAvailability(
  state: LabelFocusedCameraState | null,
): LabelFocusedCameraAvailability {
  return {
    canMoveDown: hasLabelFocusedCameraTarget(state, 'pan-down'),
    canMoveLeft: hasLabelFocusedCameraTarget(state, 'pan-left'),
    canMoveRight: hasLabelFocusedCameraTarget(state, 'pan-right'),
    canMoveUp: hasLabelFocusedCameraTarget(state, 'pan-up'),
    canReset: hasLabelFocusedCameraTarget(state, 'reset-camera'),
    canZoomIn: hasLabelFocusedCameraTarget(state, 'zoom-in'),
    canZoomOut: hasLabelFocusedCameraTarget(state, 'zoom-out'),
  };
}

export function withActiveLabelFocusedCameraKey(
  state: LabelFocusedCameraState | null,
  labelKey: string,
): LabelFocusedCameraState | null {
  if (!state || !getLabelNavigationNode(state.navigationIndex, labelKey)) {
    return null;
  }

  return {
    ...state,
    activeLabelKey: labelKey,
  };
}

function buildLabelFocusedCameraState(
  labels: LabelDefinition[],
  requestedLabelKey: string | null | undefined,
): LabelFocusedCameraState {
  const navigationIndex = createLabelNavigationIndex(labels);

  if (!navigationIndex) {
    throw new Error('Demo label set is missing label navigation metadata.');
  }

  return {
    activeLabelKey: resolveLabelNavigationKey(navigationIndex, requestedLabelKey),
    navigationIndex,
  };
}

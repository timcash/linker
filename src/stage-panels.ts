import type {
  LabelFocusedCameraAction,
  LabelFocusedCameraAvailability,
} from './label-focused-camera';
import type {DagControlAvailability, StageMode} from './plane-stack';
import type {LabelSetKind} from './stage-config';
import type {LineStrategy} from './line/types';
import type {TextStrategy} from './text/types';

export type StrategyPanelMode = 'text' | 'line' | 'layout' | 'label-edit';
export type ControlPadPage = 'dag' | 'edit' | 'menu' | 'navigate' | 'stage';

export function syncStageStrategyPanels(input: {
  activeWorkplaneIndex: number;
  canDeleteWorkplane: boolean;
  dagAvailable: boolean;
  dagControlAvailability: DagControlAvailability | null;
  canSpawnWorkplane: boolean;
  controlPadPage: ControlPadPage;
  labelSetKind: LabelSetKind;
  lineStrategy: LineStrategy;
  planeCount: number;
  renderPanel: HTMLElement;
  stageMode: StageMode;
  strategyModePanel: HTMLElement;
  strategyPanelMode: StrategyPanelMode;
  textStrategy: TextStrategy;
}): void {
  const {
    activeWorkplaneIndex,
    canDeleteWorkplane,
    dagAvailable,
    dagControlAvailability,
    canSpawnWorkplane,
    controlPadPage,
    labelSetKind,
    lineStrategy,
    planeCount,
    renderPanel,
    stageMode,
    strategyModePanel,
    textStrategy,
  } = input;

  for (const page of strategyModePanel.querySelectorAll<HTMLElement>('[data-control-pad-page]')) {
    const pageKey = page.dataset.controlPadPage as ControlPadPage | undefined;
    page.hidden =
      pageKey !== controlPadPage ||
      (pageKey === 'dag' && !dagAvailable);
  }

  for (const button of strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-control-pad-target]')) {
    const target = button.dataset.controlPadTarget as ControlPadPage | undefined;

    switch (target) {
      case 'dag':
        button.disabled = !dagAvailable;
        break;
      default:
        button.disabled = false;
        break;
    }
  }

  const isSingleWorkplane = planeCount <= 1;
  const isFirstWorkplane = activeWorkplaneIndex <= 1;
  const isLastWorkplane = activeWorkplaneIndex >= planeCount;

  for (const button of strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-stage-mode-action]')) {
    const action = button.dataset.stageModeAction;
    const isActive =
      (action === 'set-2d-mode' && stageMode === '2d-mode') ||
      (action === 'set-3d-mode' && stageMode === '3d-mode');

    setButtonPressed(button, isActive);
  }

  for (const button of strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-workplane-action]')) {
    switch (button.dataset.workplaneAction) {
      case 'select-previous-workplane':
        button.disabled = isSingleWorkplane || isFirstWorkplane;
        break;
      case 'select-next-workplane':
        button.disabled = isSingleWorkplane || isLastWorkplane;
        break;
      case 'spawn-workplane':
        button.disabled = dagAvailable || !canSpawnWorkplane;
        break;
      case 'delete-active-workplane':
        button.disabled = !canDeleteWorkplane;
        break;
      default:
        button.disabled = false;
    }
  }

  for (const button of strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-dag-action]')) {
    const action = button.dataset.dagAction;

    if (!dagAvailable || !dagControlAvailability) {
      button.disabled = true;
      continue;
    }

    switch (action) {
      case 'focus-root':
        button.disabled = !dagControlAvailability.canFocusRoot;
        break;
      case 'insert-parent-workplane':
        button.disabled = !dagControlAvailability.canInsertParent;
        break;
      case 'move-depth-in':
        button.disabled = !dagControlAvailability.canMoveDepthIn;
        break;
      case 'move-depth-out':
        button.disabled = !dagControlAvailability.canMoveDepthOut;
        break;
      case 'move-lane-down':
        button.disabled = !dagControlAvailability.canMoveLaneDown;
        break;
      case 'move-lane-up':
        button.disabled = !dagControlAvailability.canMoveLaneUp;
        break;
      case 'move-rank-backward':
        button.disabled = !dagControlAvailability.canMoveRankBackward;
        break;
      case 'move-rank-forward':
        button.disabled = !dagControlAvailability.canMoveRankForward;
        break;
      case 'spawn-child-workplane':
        button.disabled = !dagControlAvailability.canSpawnChild;
        break;
      default:
        button.disabled = false;
    }
  }

  for (const button of renderPanel.querySelectorAll<HTMLButtonElement>('[data-text-strategy]')) {
    setButtonPressed(button, button.dataset.textStrategy === textStrategy);
  }

  for (const button of renderPanel.querySelectorAll<HTMLButtonElement>('[data-line-strategy]')) {
    setButtonPressed(button, button.dataset.lineStrategy === lineStrategy);
    button.disabled = labelSetKind !== 'demo';
  }

  const navigateModeChip =
    strategyModePanel.querySelector<HTMLButtonElement>('[data-testid="navigate-mode-chip"]');
  const stageModeChip =
    strategyModePanel.querySelector<HTMLButtonElement>('[data-testid="stage-mode-chip"]');
  const stageWorkplaneChip =
    strategyModePanel.querySelector<HTMLButtonElement>('[data-testid="stage-workplane-chip"]');
  const labelEditPanel = renderPanel.querySelector<HTMLElement>('[data-testid="label-edit-panel"]');

  if (navigateModeChip) {
    navigateModeChip.textContent = stageMode === '3d-mode' ? 'Orbit' : 'Grid';
  }

  if (stageModeChip) {
    stageModeChip.textContent = dagAvailable ? 'Root' : stageMode === '3d-mode' ? 'Stack' : 'Grid';
    stageModeChip.disabled = !dagAvailable || !dagControlAvailability?.canFocusRoot;
    stageModeChip.setAttribute('aria-disabled', String(stageModeChip.disabled));
  }

  if (stageWorkplaneChip) {
    stageWorkplaneChip.textContent = planeCount <= 0 ? 'WP 0/0' : `WP ${activeWorkplaneIndex}/${planeCount}`;
  }

  if (labelEditPanel) {
    labelEditPanel.hidden = false;
  }
}

export function syncStageCameraPanel(input: {
  buttons: HTMLButtonElement[];
  cameraAvailability: LabelFocusedCameraAvailability;
  cameraEnabled: boolean;
}): void {
  const {buttons, cameraAvailability, cameraEnabled} = input;

  if (!cameraEnabled) {
    for (const button of buttons) {
      button.disabled = false;
    }

    return;
  }

  for (const button of buttons) {
    const action = button.dataset.control;

    if (!isCameraControlAction(action)) {
      button.disabled = false;
      continue;
    }

    button.disabled = isCameraActionBlocked(action, cameraAvailability);
  }
}

function setButtonPressed(button: HTMLButtonElement, isActive: boolean): void {
  button.dataset.active = String(isActive);
  button.setAttribute('aria-pressed', String(isActive));
}

function isCameraActionBlocked(
  action: LabelFocusedCameraAction,
  availability: LabelFocusedCameraAvailability,
): boolean {
  switch (action) {
    case 'pan-left':
      return !availability.canMoveLeft;
    case 'pan-right':
      return !availability.canMoveRight;
    case 'pan-up':
      return !availability.canMoveUp;
    case 'pan-down':
      return !availability.canMoveDown;
    case 'zoom-in':
      return !availability.canZoomIn;
    case 'zoom-out':
      return !availability.canZoomOut;
    case 'reset-camera':
      return !availability.canReset;
  }
}

function isCameraControlAction(value: string | null | undefined): value is LabelFocusedCameraAction {
  return (
    value === 'pan-up' ||
    value === 'pan-down' ||
    value === 'pan-left' ||
    value === 'pan-right' ||
    value === 'zoom-in' ||
    value === 'zoom-out' ||
    value === 'reset-camera'
  );
}

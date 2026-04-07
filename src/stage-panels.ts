import type {
  LabelFocusedCameraAction,
  LabelFocusedCameraAvailability,
} from './label-focused-camera';
import type {StageMode} from './plane-stack';
import type {LabelSetKind} from './stage-config';

export type StrategyPanelMode = 'text' | 'line' | 'layout' | 'label-edit';
export type ControlPadPage = 'edit' | 'navigate' | 'stage';

export function syncStageStrategyPanels(input: {
  activeWorkplaneIndex: number;
  canDeleteWorkplane: boolean;
  canSpawnWorkplane: boolean;
  controlPadPage: ControlPadPage;
  labelSetKind: LabelSetKind;
  planeCount: number;
  renderPanel: HTMLElement;
  stageMode: StageMode;
  strategyModePanel: HTMLElement;
  strategyPanelMode: StrategyPanelMode;
}): void {
  const {
    activeWorkplaneIndex,
    canDeleteWorkplane,
    canSpawnWorkplane,
    controlPadPage,
    planeCount,
    renderPanel,
    stageMode,
    strategyModePanel,
  } = input;

  for (const page of strategyModePanel.querySelectorAll<HTMLElement>('[data-control-pad-page]')) {
    page.hidden = page.dataset.controlPadPage !== controlPadPage;
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
        button.disabled = !canSpawnWorkplane;
        break;
      case 'delete-active-workplane':
        button.disabled = !canDeleteWorkplane;
        break;
      default:
        button.disabled = false;
    }
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
    stageModeChip.textContent = stageMode === '3d-mode' ? 'Stack' : 'Grid';
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

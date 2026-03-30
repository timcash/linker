import type {LayoutStrategy} from './data/labels';
import type {
  LabelFocusedCameraAction,
  LabelFocusedCameraAvailability,
} from './label-focused-camera';
import type {LineStrategy} from './line/types';
import type {LabelSetKind} from './stage-config';
import type {TextStrategy} from './text/types';

export type StrategyPanelMode = 'text' | 'line' | 'layout' | 'label-edit';

export function syncStageStrategyPanels(input: {
  labelSetKind: LabelSetKind;
  layoutStrategy: LayoutStrategy;
  lineStrategy: LineStrategy;
  renderPanel: HTMLElement;
  strategyModePanel: HTMLElement;
  strategyPanelMode: StrategyPanelMode;
  textStrategy: TextStrategy;
}): void {
  const {
    labelSetKind,
    layoutStrategy,
    lineStrategy,
    renderPanel,
    strategyModePanel,
    strategyPanelMode,
    textStrategy,
  } = input;

  for (const button of renderPanel.querySelectorAll<HTMLButtonElement>('[data-text-strategy]')) {
    setButtonPressed(button, button.dataset.textStrategy === textStrategy);
  }

  for (const button of renderPanel.querySelectorAll<HTMLButtonElement>('[data-line-strategy]')) {
    setButtonPressed(button, button.dataset.lineStrategy === lineStrategy);
  }

  for (const button of renderPanel.querySelectorAll<HTMLButtonElement>('[data-layout-strategy]')) {
    setButtonPressed(button, button.dataset.layoutStrategy === layoutStrategy);
  }

  for (const button of strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-strategy-panel-mode]')) {
    const mode = button.dataset.strategyPanelMode;
    const requiresDemoLabelSet = mode === 'layout' || mode === 'line' || mode === 'label-edit';

    button.disabled = requiresDemoLabelSet && labelSetKind !== 'demo';
    setButtonPressed(button, mode === strategyPanelMode);
  }

  const panelLabel = renderPanel.querySelector<HTMLElement>('[data-testid="strategy-panel-label"]');

  if (panelLabel) {
    panelLabel.textContent = getStrategyPanelLabel(strategyPanelMode);
  }

  const textStrategyPanel = renderPanel.querySelector<HTMLElement>('[data-testid="text-strategy-panel"]');
  const lineStrategyPanel = renderPanel.querySelector<HTMLElement>('[data-testid="line-strategy-panel"]');
  const layoutStrategyPanel = renderPanel.querySelector<HTMLElement>('[data-testid="layout-strategy-panel"]');
  const labelEditPanel = renderPanel.querySelector<HTMLElement>('[data-testid="label-edit-panel"]');

  if (textStrategyPanel) {
    textStrategyPanel.hidden = strategyPanelMode !== 'text';
  }

  if (lineStrategyPanel) {
    lineStrategyPanel.hidden = strategyPanelMode !== 'line' || labelSetKind !== 'demo';
  }

  if (layoutStrategyPanel) {
    layoutStrategyPanel.hidden = strategyPanelMode !== 'layout' || labelSetKind !== 'demo';
  }

  if (labelEditPanel) {
    labelEditPanel.hidden = strategyPanelMode !== 'label-edit' || labelSetKind !== 'demo';
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

function getStrategyPanelLabel(mode: StrategyPanelMode): string {
  switch (mode) {
    case 'label-edit':
      return 'Label Edit';
    case 'layout':
      return 'Layout Strategy';
    case 'line':
      return 'Line Strategy';
    case 'text':
    default:
      return 'Text Strategy';
  }
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

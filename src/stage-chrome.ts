import {LINE_STRATEGY_OPTIONS} from './line/types';
import {TEXT_STRATEGY_OPTIONS} from './text/types';

export type StageChromeElements = {
  cameraPanel: HTMLElement;
  canvas: HTMLCanvasElement;
  editPanel: HTMLElement;
  editorGhostLayer: HTMLDivElement;
  editorSelectionLayer: HTMLDivElement;
  editorSelectionSummary: HTMLParagraphElement;
  labelInputField: HTMLInputElement;
  labelInputForm: HTMLFormElement;
  labelInputHint: HTMLParagraphElement;
  labelInputSubmitButton: HTMLButtonElement;
  launchBanner: HTMLDivElement;
  onboardBody: HTMLParagraphElement;
  onboardDetail: HTMLParagraphElement;
  onboardDismissButton: HTMLButtonElement;
  onboardPanel: HTMLElement;
  onboardProgress: HTMLParagraphElement;
  onboardReplayButton: HTMLButtonElement;
  onboardSkipButton: HTMLButtonElement;
  onboardTitle: HTMLHeadingElement;
  selectionBox: HTMLDivElement;
  stage: HTMLDivElement;
  statusPanel: HTMLElement;
  stats: HTMLDivElement;
  strategyModePanel: HTMLElement;
};

export function createStageChrome(root: HTMLElement): StageChromeElements {
  const stage = document.createElement('div');
  stage.className = 'luma-stage';

  const canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  canvas.dataset.testid = 'gpu-canvas';
  canvas.setAttribute('aria-label', 'luma.gl WebGPU canvas');
  canvas.hidden = true;

  const selectionBox = document.createElement('div');
  selectionBox.className = 'selection-box';
  selectionBox.dataset.testid = 'selection-box';
  selectionBox.setAttribute('aria-hidden', 'true');
  selectionBox.hidden = true;

  const editorSelectionLayer = document.createElement('div');
  editorSelectionLayer.className = 'editor-selection-layer';
  editorSelectionLayer.dataset.testid = 'editor-selection-layer';
  editorSelectionLayer.setAttribute('aria-hidden', 'true');

  const editorGhostLayer = document.createElement('div');
  editorGhostLayer.className = 'editor-ghost-layer';
  editorGhostLayer.dataset.testid = 'editor-ghost-layer';
  editorGhostLayer.setAttribute('aria-label', 'Editor ghost slots');

  const statusPanel = document.createElement('aside');
  statusPanel.className = 'status-panel';
  statusPanel.dataset.testid = 'status-panel';
  statusPanel.innerHTML = `
    <section class="onboard-panel" data-testid="onboard-panel" hidden>
      <div class="onboard-meta">
        <p class="onboard-kicker">Onboard</p>
        <p class="onboard-progress" data-testid="onboard-progress">Step 1 of 1</p>
      </div>
      <div class="onboard-copy">
        <h2 class="onboard-title" data-testid="onboard-title">Linker walkthrough</h2>
        <p class="onboard-body" data-testid="onboard-body"></p>
        <p class="onboard-detail" data-testid="onboard-detail"></p>
      </div>
      <div class="onboard-actions">
        <button type="button" class="control-button control-button--wide" data-onboard-action="skip" data-testid="onboard-skip">
          Skip
        </button>
        <button type="button" class="control-button control-button--wide" data-onboard-action="replay" data-testid="onboard-replay" hidden>
          Replay
        </button>
        <button type="button" class="control-button control-button--wide" data-onboard-action="dismiss" data-testid="onboard-dismiss" hidden>
          Stats
        </button>
      </div>
    </section>
    <div class="status-live-table" data-testid="status-stats"></div>
  `;
  const onboardPanel = statusPanel.querySelector<HTMLElement>('[data-testid="onboard-panel"]');
  const onboardProgress =
    statusPanel.querySelector<HTMLParagraphElement>('[data-testid="onboard-progress"]');
  const onboardTitle =
    statusPanel.querySelector<HTMLHeadingElement>('[data-testid="onboard-title"]');
  const onboardBody =
    statusPanel.querySelector<HTMLParagraphElement>('[data-testid="onboard-body"]');
  const onboardDetail =
    statusPanel.querySelector<HTMLParagraphElement>('[data-testid="onboard-detail"]');
  const onboardSkipButton =
    statusPanel.querySelector<HTMLButtonElement>('[data-testid="onboard-skip"]');
  const onboardReplayButton =
    statusPanel.querySelector<HTMLButtonElement>('[data-testid="onboard-replay"]');
  const onboardDismissButton =
    statusPanel.querySelector<HTMLButtonElement>('[data-testid="onboard-dismiss"]');
  const stats = statusPanel.querySelector<HTMLDivElement>('[data-testid="status-stats"]');

  const launchBanner = document.createElement('div');
  launchBanner.className = 'launch-banner';
  launchBanner.dataset.testid = 'app-message';
  launchBanner.innerHTML = `
    <strong>Preparing WebGPU</strong>
    <p>Initializing a luma-stage and fullscreen WebGPU canvas.</p>
  `;

  const strategyModePanel = document.createElement('aside');
  strategyModePanel.className = 'strategy-mode-panel';
  strategyModePanel.dataset.testid = 'strategy-mode-panel';
  strategyModePanel.setAttribute('aria-label', 'Control pad');
  strategyModePanel.innerHTML = `
    <div class="control-page-grid control-page-grid--menu" data-control-pad-page="menu" data-testid="control-pad-page-menu">
      <button type="button" class="control-button control-button--tile" data-control-pad-target="navigate">
        Map
      </button>
      <button type="button" class="control-button control-button--tile" data-control-pad-target="stage">
        Stage
      </button>
      <button type="button" class="control-button control-button--tile" data-control-pad-target="dag">
        DAG
      </button>
      <button type="button" class="control-button control-button--tile" data-control-pad-target="edit">
        CRUD
      </button>
      <button type="button" class="control-button control-button--tile" data-control-pad-target="view">
        View
      </button>
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        Local Links
      </button>
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        DAG Links
      </button>
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        2D <-> 3D
      </button>
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        Pan + Zoom
      </button>
    </div>
    <div class="control-page-grid" data-control-pad-page="navigate" data-testid="control-pad-page-navigate">
      <button type="button" class="control-button control-button--tile" data-control="zoom-in">Zoom +</button>
      <button type="button" class="control-button control-button--tile" data-control="pan-up">Up</button>
      <button type="button" class="control-button control-button--tile" data-control="zoom-out">Zoom -</button>
      <button type="button" class="control-button control-button--tile" data-control="pan-left">Left</button>
      <button type="button" class="control-button control-button--tile" data-control="reset-camera">Reset</button>
      <button type="button" class="control-button control-button--tile" data-control="pan-right">Right</button>
      <button
        type="button"
        class="control-button control-button--chip"
        data-testid="navigate-mode-chip"
        disabled
        aria-disabled="true"
      >
        Grid
      </button>
      <button type="button" class="control-button control-button--tile" data-control="pan-down">Down</button>
      <button type="button" class="control-button control-button--menu" data-control-pad-action="open-menu">
        Menu
      </button>
    </div>
    <div class="control-page-grid" data-control-pad-page="stage" data-testid="control-pad-page-stage" hidden>
      <button type="button" class="control-button control-button--tile" data-stage-mode-action="set-2d-mode" aria-pressed="false">
        2D
      </button>
      <button
        type="button"
        class="control-button control-button--chip"
        data-testid="stage-mode-chip"
        data-dag-action="focus-root"
        aria-disabled="true"
      >
        Grid
      </button>
      <button type="button" class="control-button control-button--tile" data-stage-mode-action="set-3d-mode" aria-pressed="false">
        3D
      </button>
      <button type="button" class="control-button control-button--tile" data-workplane-action="select-previous-workplane">
        Prev
      </button>
      <button
        type="button"
        class="control-button control-button--chip"
        data-testid="stage-workplane-chip"
        disabled
        aria-disabled="true"
      >
        WP 1/1
      </button>
      <button type="button" class="control-button control-button--tile" data-workplane-action="select-next-workplane">
        Next
      </button>
      <button type="button" class="control-button control-button--tile" data-workplane-action="spawn-workplane">
        New
      </button>
      <button type="button" class="control-button control-button--tile" data-workplane-action="delete-active-workplane">
        Delete
      </button>
      <button type="button" class="control-button control-button--menu" data-control-pad-action="open-menu">
        Menu
      </button>
    </div>
    <div class="control-page-grid" data-control-pad-page="dag" data-testid="control-pad-page-dag" hidden>
      <button type="button" class="control-button control-button--tile" data-dag-action="move-rank-backward">
        Rank -
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="move-lane-up">
        Lane Up
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="move-depth-out">
        Depth Out
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="move-rank-forward">
        Rank +
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="move-lane-down">
        Lane Down
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="move-depth-in">
        Depth In
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="spawn-child-workplane">
        Child Link
      </button>
      <button type="button" class="control-button control-button--tile" data-dag-action="insert-parent-workplane">
        Parent Link
      </button>
      <button type="button" class="control-button control-button--menu" data-control-pad-action="open-menu">
        Menu
      </button>
    </div>
    <section class="edit-page" data-control-pad-page="edit" data-testid="edit-panel" hidden>
      <div class="edit-page-meta" data-testid="label-edit-panel">
        <p class="panel-meta" data-testid="label-input-hint">Label wp-1:1:1:1</p>
        <p class="panel-meta" data-testid="editor-selection-summary">0 selected</p>
      </div>
      <form class="control-page-grid control-page-grid--edit" data-testid="label-input-form">
        <input
          type="text"
          class="label-input-field label-input-field--grid"
          data-testid="label-input-field"
          aria-label="Label text"
          autocomplete="off"
          spellcheck="false"
        />
        <button type="submit" class="control-button control-button--tile" data-testid="label-input-submit">
          Save
        </button>
        <button type="button" class="control-button control-button--tile" data-editor-shortcut="toggle-selection-or-create">
          Select/Create
        </button>
        <button type="button" class="control-button control-button--tile" data-editor-action="link-selection">
          Local Link
        </button>
        <button type="button" class="control-button control-button--tile" data-editor-action="remove-links">
          Unlink
        </button>
        <button type="button" class="control-button control-button--tile" data-editor-action="remove-label">
          Remove
        </button>
        <button type="button" class="control-button control-button--tile" data-editor-action="clear-selection">
          Clear
        </button>
        <button type="button" class="control-button control-button--menu" data-control-pad-action="open-menu">
          Menu
        </button>
      </form>
    </section>
    <div class="control-page-grid" data-control-pad-page="view" data-testid="control-pad-page-view" hidden>
      ${renderStrategyButton(TEXT_STRATEGY_OPTIONS[0], 'textStrategy')}
      ${renderStrategyButton(TEXT_STRATEGY_OPTIONS[1], 'textStrategy')}
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        Shift+T
      </button>
      ${renderStrategyButton(LINE_STRATEGY_OPTIONS[0], 'lineStrategy')}
      ${renderStrategyButton(LINE_STRATEGY_OPTIONS[1], 'lineStrategy')}
      ${renderStrategyButton(LINE_STRATEGY_OPTIONS[2], 'lineStrategy')}
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        Text
      </button>
      <button type="button" class="control-button control-button--chip" disabled aria-disabled="true">
        Links
      </button>
      <button type="button" class="control-button control-button--menu" data-control-pad-action="open-menu">
        Menu
      </button>
    </div>
  `;

  const editPanel = strategyModePanel.querySelector<HTMLElement>('[data-testid="edit-panel"]');
  const labelInputField = strategyModePanel.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
  const labelInputForm = strategyModePanel.querySelector<HTMLFormElement>('[data-testid="label-input-form"]');
  const labelInputHint =
    strategyModePanel.querySelector<HTMLParagraphElement>('[data-testid="label-input-hint"]');
  const editorSelectionSummary =
    strategyModePanel.querySelector<HTMLParagraphElement>('[data-testid="editor-selection-summary"]');
  const labelInputSubmitButton =
    strategyModePanel.querySelector<HTMLButtonElement>('[data-testid="label-input-submit"]');

  if (
    !editPanel ||
    !labelInputField ||
    !labelInputForm ||
    !labelInputHint ||
    !editorSelectionSummary ||
    !labelInputSubmitButton ||
    !onboardBody ||
    !onboardDetail ||
    !onboardDismissButton ||
    !onboardPanel ||
    !onboardProgress ||
    !onboardReplayButton ||
    !onboardSkipButton ||
    !onboardTitle ||
    !stats
  ) {
    throw new Error('Failed to build the stage chrome controls.');
  }

  const controlDock = document.createElement('div');
  controlDock.className = 'control-dock';
  controlDock.append(strategyModePanel);

  const uiShell = document.createElement('div');
  uiShell.className = 'stage-ui-shell';
  uiShell.append(statusPanel, controlDock);

  stage.append(
    canvas,
    editorSelectionLayer,
    editorGhostLayer,
    selectionBox,
    uiShell,
    launchBanner,
  );
  root.replaceChildren(stage);

  return {
    cameraPanel: strategyModePanel,
    canvas,
    editPanel,
    editorGhostLayer,
    editorSelectionLayer,
    editorSelectionSummary,
    labelInputField,
    labelInputForm,
    labelInputHint,
    labelInputSubmitButton,
    launchBanner,
    onboardBody,
    onboardDetail,
    onboardDismissButton,
    onboardPanel,
    onboardProgress,
    onboardReplayButton,
    onboardSkipButton,
    onboardTitle,
    selectionBox,
    stage,
    statusPanel,
    stats,
    strategyModePanel,
  };
}

function renderStrategyButton(
  option: {label: string; mode: string} | undefined,
  datasetKey: 'lineStrategy' | 'textStrategy',
): string {
  if (!option) {
    return '';
  }

  const attributeName = datasetKey === 'lineStrategy' ? 'line-strategy' : 'text-strategy';

  return `
    <button
      type="button"
      class="control-button control-button--tile"
      data-${attributeName}="${option.mode}"
      aria-pressed="false"
    >
      ${option.label}
    </button>
  `;
}

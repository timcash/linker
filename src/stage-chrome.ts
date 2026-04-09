import {LINE_STRATEGY_OPTIONS} from './line/types';
import {TEXT_STRATEGY_OPTIONS} from './text/types';

export type StageChromeElements = {
  cameraPanel: HTMLElement;
  canvas: HTMLCanvasElement;
  editorGhostLayer: HTMLDivElement;
  editorSelectionLayer: HTMLDivElement;
  editorSelectionSummary: HTMLParagraphElement;
  labelInputField: HTMLInputElement;
  labelInputForm: HTMLFormElement;
  labelInputHint: HTMLParagraphElement;
  labelInputSubmitButton: HTMLButtonElement;
  launchBanner: HTMLDivElement;
  renderPanel: HTMLElement;
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
    <div class="status-live-table" data-testid="status-stats"></div>
  `;
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
      <button type="button" class="control-button control-button--toggle" data-control-pad-action="toggle-page">
        Toggle
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
        disabled
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
      <button type="button" class="control-button control-button--toggle" data-control-pad-action="toggle-page">
        Toggle
      </button>
    </div>
    <section class="edit-page" data-control-pad-page="edit" data-testid="render-panel" hidden>
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
          Link
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
        <button type="button" class="control-button control-button--toggle" data-control-pad-action="toggle-page">
          Toggle
        </button>
      </form>
      <div class="strategy-group-stack" data-testid="strategy-group-stack">
        <section class="strategy-group" data-testid="text-strategy-group" aria-label="Text strategy">
          <div class="strategy-group-meta">
            <p class="panel-meta">Text</p>
            <p class="panel-meta">Shift+T</p>
          </div>
          <div class="strategy-button-row" data-testid="text-strategy-row">
            ${renderStrategyButtons(TEXT_STRATEGY_OPTIONS, 'textStrategy')}
          </div>
        </section>
        <section class="strategy-group" data-testid="line-strategy-group" aria-label="Line strategy">
          <div class="strategy-group-meta">
            <p class="panel-meta">Links</p>
            <p class="panel-meta">Shift+L</p>
          </div>
          <div class="strategy-button-row" data-testid="line-strategy-row">
            ${renderStrategyButtons(LINE_STRATEGY_OPTIONS, 'lineStrategy')}
          </div>
        </section>
      </div>
    </section>
  `;

  const renderPanel = strategyModePanel.querySelector<HTMLElement>('[data-testid="render-panel"]');
  const labelInputField = strategyModePanel.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
  const labelInputForm = strategyModePanel.querySelector<HTMLFormElement>('[data-testid="label-input-form"]');
  const labelInputHint =
    strategyModePanel.querySelector<HTMLParagraphElement>('[data-testid="label-input-hint"]');
  const editorSelectionSummary =
    strategyModePanel.querySelector<HTMLParagraphElement>('[data-testid="editor-selection-summary"]');
  const labelInputSubmitButton =
    strategyModePanel.querySelector<HTMLButtonElement>('[data-testid="label-input-submit"]');

  if (
    !renderPanel ||
    !labelInputField ||
    !labelInputForm ||
    !labelInputHint ||
    !editorSelectionSummary ||
    !labelInputSubmitButton ||
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
    editorGhostLayer,
    editorSelectionLayer,
    editorSelectionSummary,
    labelInputField,
    labelInputForm,
    labelInputHint,
    labelInputSubmitButton,
    launchBanner,
    renderPanel,
    selectionBox,
    stage,
    statusPanel,
    stats,
    strategyModePanel,
  };
}

function renderStrategyButtons(
  options: ReadonlyArray<{label: string; mode: string}>,
  datasetKey: 'lineStrategy' | 'textStrategy',
): string {
  const attributeName = datasetKey === 'lineStrategy' ? 'line-strategy' : 'text-strategy';

  return options
    .map(
      (option) => `
        <button
          type="button"
          class="control-button control-button--wide"
          data-${attributeName}="${option.mode}"
          aria-pressed="false"
        >
          ${option.label}
        </button>
      `,
    )
    .join('');
}

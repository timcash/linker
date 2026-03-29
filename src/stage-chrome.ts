import {LAYOUT_STRATEGY_OPTIONS} from './data/labels';
import {LINE_STRATEGY_OPTIONS} from './line/types';
import {TEXT_STRATEGY_OPTIONS} from './text/types';

export type StageChromeElements = {
  cameraPanel: HTMLElement;
  canvas: HTMLCanvasElement;
  launchBanner: HTMLDivElement;
  renderPanel: HTMLElement;
  selectionBox: HTMLDivElement;
  stage: HTMLDivElement;
  statusPanel: HTMLElement;
  stats: HTMLParagraphElement;
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

  const statusPanel = document.createElement('aside');
  statusPanel.className = 'status-panel';
  statusPanel.dataset.testid = 'status-panel';
  statusPanel.innerHTML = `
    <div class="status-eyebrow">Linker / Luma</div>
    <h1>Network Mapping Lab</h1>
  `;

  const stats = document.createElement('p');
  stats.className = 'status-stats';
  stats.textContent =
    'center 0.00, 0.00  |  zoom 0.00  |  glyphs 0 visible / 0 total  |  vertices 0  |  cpu 0.00 ms frame / 0.00 ms text / gpu pending';
  statusPanel.append(stats);

  const textStrategyButtonsMarkup = TEXT_STRATEGY_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-text-strategy="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  const lineStrategyButtonsMarkup = LINE_STRATEGY_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-line-strategy="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  const layoutStrategyButtonsMarkup = LAYOUT_STRATEGY_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-layout-strategy="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  const strategyModeButtonsMarkup = `
    <button type="button" class="control-button" data-strategy-panel-mode="text" aria-pressed="false">Text Strategy</button>
    <button type="button" class="control-button" data-strategy-panel-mode="line" aria-pressed="false">Line Strategy</button>
    <button type="button" class="control-button" data-strategy-panel-mode="layout" aria-pressed="false">Layout Strategy</button>
  `;

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
  strategyModePanel.innerHTML = `
    <div class="panel-label">Strategy View</div>
    <div class="control-row" data-testid="strategy-panel-mode">
      ${strategyModeButtonsMarkup}
    </div>
  `;

  const renderPanel = document.createElement('aside');
  renderPanel.className = 'render-panel';
  renderPanel.dataset.testid = 'render-panel';
  renderPanel.setAttribute('aria-label', 'Render panel');
  renderPanel.innerHTML = `
    <div class="panel-label" data-testid="strategy-panel-label">Text Strategy</div>
    <div class="control-row" data-testid="text-strategy-panel">
      ${textStrategyButtonsMarkup}
    </div>
    <div class="control-row" data-testid="line-strategy-panel" hidden>
      ${lineStrategyButtonsMarkup}
    </div>
    <div class="control-row" data-testid="layout-strategy-panel" hidden>
      ${layoutStrategyButtonsMarkup}
    </div>
  `;

  const cameraPanel = document.createElement('aside');
  cameraPanel.className = 'camera-panel';
  cameraPanel.dataset.testid = 'camera-panel';
  cameraPanel.setAttribute('aria-label', 'Camera panel');
  cameraPanel.innerHTML = `
    <div class="panel-label">Camera</div>
    <div class="camera-grid" aria-label="Camera controls">
      <button type="button" class="control-button" data-control="zoom-in">Zoom In</button>
      <button type="button" class="control-button" data-control="zoom-out">Zoom Out</button>
      <button type="button" class="control-button" data-control="reset-camera">Reset</button>
      <button type="button" class="control-button" data-control="pan-up">Up</button>
      <button type="button" class="control-button" data-control="pan-left">Left</button>
      <button type="button" class="control-button" data-control="pan-down">Down</button>
      <button type="button" class="control-button" data-control="pan-right">Right</button>
    </div>
  `;

  stage.append(canvas, selectionBox, statusPanel, strategyModePanel, renderPanel, cameraPanel, launchBanner);
  root.replaceChildren(stage);

  return {
    cameraPanel,
    canvas,
    launchBanner,
    renderPanel,
    selectionBox,
    stage,
    statusPanel,
    stats,
    strategyModePanel,
  };
}

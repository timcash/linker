import assert from 'node:assert/strict';

import {
  getLineStrategies,
  TEXT_STRATEGIES,
  type BrowserTestContext,
  getLayoutStrategies,
} from './shared';

type ReadyUiState = {
  cameraBottomGap: number;
  cameraPanelVisible: boolean;
  cameraRightGap: number;
  layoutStrategyButtonModes: string[];
  layoutStrategyPanelVisible: boolean;
  lineStrategyButtonModes: string[];
  lineStrategyPanelVisible: boolean;
  messageDisplay: string;
  messageHiddenProperty: boolean;
  renderBottomGap: number;
  renderLeftGap: number;
  renderPanelVisible: boolean;
  statusLeftGap: number;
  statusTopGap: number;
  strategyModeButtonModes: string[];
  strategyModePanelVisible: boolean;
  strategyModeRightGap: number;
  strategyModeTopGap: number;
  strategyPanelLabelText: string;
  textStrategyButtonModes: string[];
  textStrategyPanelVisible: boolean;
};

export async function runPanelsStep(context: BrowserTestContext): Promise<void> {
  const readyUiState = await context.page.evaluate((): ReadyUiState => {
    const message = document.querySelector('[data-testid="app-message"]');
    const cameraPanel = document.querySelector('[data-testid="camera-panel"]');
    const renderPanel = document.querySelector('[data-testid="render-panel"]');
    const layoutStrategyPanel = document.querySelector('[data-testid="layout-strategy-panel"]');
    const lineStrategyPanel = document.querySelector('[data-testid="line-strategy-panel"]');
    const strategyModePanel = document.querySelector('[data-testid="strategy-mode-panel"]');
    const strategyPanelLabel = document.querySelector('[data-testid="strategy-panel-label"]');
    const textStrategyPanel = document.querySelector('[data-testid="text-strategy-panel"]');
    const statusPanel = document.querySelector('[data-testid="status-panel"]');
    const layoutStrategyButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-layout-strategy]'),
    ];
    const lineStrategyButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-line-strategy]'),
    ];
    const strategyButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-text-strategy]'),
    ];
    const strategyModeButtons = [
      ...document.querySelectorAll<HTMLButtonElement>('button[data-strategy-panel-mode]'),
    ];
    const cameraRect = cameraPanel instanceof HTMLElement ? cameraPanel.getBoundingClientRect() : null;
    const renderRect = renderPanel instanceof HTMLElement ? renderPanel.getBoundingClientRect() : null;
    const statusRect = statusPanel instanceof HTMLElement ? statusPanel.getBoundingClientRect() : null;
    const strategyModeRect =
      strategyModePanel instanceof HTMLElement ? strategyModePanel.getBoundingClientRect() : null;

    return {
      messageHiddenProperty: message instanceof HTMLElement ? message.hidden : false,
      messageDisplay: message instanceof HTMLElement ? window.getComputedStyle(message).display : '',
      cameraPanelVisible:
        cameraPanel instanceof HTMLElement &&
        window.getComputedStyle(cameraPanel).display !== 'none',
      strategyModePanelVisible:
        strategyModePanel instanceof HTMLElement &&
        window.getComputedStyle(strategyModePanel).display !== 'none',
      renderPanelVisible:
        renderPanel instanceof HTMLElement && window.getComputedStyle(renderPanel).display !== 'none',
      layoutStrategyPanelVisible:
        layoutStrategyPanel instanceof HTMLElement &&
        !layoutStrategyPanel.hidden &&
        window.getComputedStyle(layoutStrategyPanel).display !== 'none',
      lineStrategyPanelVisible:
        lineStrategyPanel instanceof HTMLElement &&
        !lineStrategyPanel.hidden &&
        window.getComputedStyle(lineStrategyPanel).display !== 'none',
      textStrategyPanelVisible:
        textStrategyPanel instanceof HTMLElement &&
        !textStrategyPanel.hidden &&
        window.getComputedStyle(textStrategyPanel).display !== 'none',
      cameraRightGap: cameraRect ? Math.round(window.innerWidth - cameraRect.right) : -1,
      cameraBottomGap: cameraRect ? Math.round(window.innerHeight - cameraRect.bottom) : -1,
      layoutStrategyButtonModes: layoutStrategyButtons.map((button) => button.dataset.layoutStrategy ?? ''),
      lineStrategyButtonModes: lineStrategyButtons.map((button) => button.dataset.lineStrategy ?? ''),
      strategyModeButtonModes: strategyModeButtons.map((button) => button.dataset.strategyPanelMode ?? ''),
      strategyModeRightGap: strategyModeRect ? Math.round(window.innerWidth - strategyModeRect.right) : -1,
      strategyModeTopGap: strategyModeRect ? Math.round(strategyModeRect.top) : -1,
      strategyPanelLabelText: strategyPanelLabel instanceof HTMLElement ? strategyPanelLabel.textContent ?? '' : '',
      textStrategyButtonModes: strategyButtons.map((button) => button.dataset.textStrategy ?? ''),
      renderLeftGap: renderRect ? Math.round(renderRect.left) : -1,
      renderBottomGap: renderRect ? Math.round(window.innerHeight - renderRect.bottom) : -1,
      statusLeftGap: statusRect ? Math.round(statusRect.left) : -1,
      statusTopGap: statusRect ? Math.round(statusRect.top) : -1,
    };
  });

  assert.equal(
    readyUiState.messageHiddenProperty,
    true,
    'Ready state should hide the startup message.',
  );
  assert.equal(
    readyUiState.messageDisplay,
    'none',
    'Ready state should remove the startup message from layout.',
  );
  assert.equal(readyUiState.cameraPanelVisible, true, 'Camera panel should be visible.');
  assert.equal(readyUiState.strategyModePanelVisible, true, 'Strategy view panel should be visible.');
  assert.equal(readyUiState.renderPanelVisible, true, 'Render panel should be visible.');
  assert.equal(readyUiState.textStrategyPanelVisible, true, 'Text strategy panel should be visible.');
  assert.equal(readyUiState.lineStrategyPanelVisible, false, 'Line strategy panel should be hidden by default.');
  assert.equal(readyUiState.layoutStrategyPanelVisible, false, 'Layout strategy panel should be hidden by default.');
  assert.equal(readyUiState.strategyPanelLabelText, 'Text Strategy', 'Render panel should default to the text strategy label.');
  assert.deepEqual(
    readyUiState.textStrategyButtonModes,
    [...TEXT_STRATEGIES],
    'Text strategy panel should expose a button for every text strategy.',
  );
  assert.deepEqual(
    readyUiState.lineStrategyButtonModes,
    [...getLineStrategies()],
    'Line strategy panel should expose a button for every line strategy.',
  );
  assert.deepEqual(
    readyUiState.layoutStrategyButtonModes,
    [...getLayoutStrategies()],
    'Layout strategy panel should expose a button for every layout strategy.',
  );
  assert.deepEqual(
    readyUiState.strategyModeButtonModes,
    ['text', 'line', 'layout'],
    'Strategy view panel should expose text, line, and layout toggles.',
  );
  assert.ok(
    readyUiState.statusLeftGap >= 0 && readyUiState.statusLeftGap <= 32,
    'Status panel should sit near the left edge.',
  );
  assert.ok(
    readyUiState.statusTopGap >= 0 && readyUiState.statusTopGap <= 32,
    'Status panel should sit near the top edge.',
  );
  assert.ok(
    readyUiState.strategyModeRightGap >= 0 && readyUiState.strategyModeRightGap <= 32,
    'Strategy view panel should sit near the right edge.',
  );
  assert.ok(
    readyUiState.strategyModeTopGap >= 0 && readyUiState.strategyModeTopGap <= 32,
    'Strategy view panel should sit near the top edge.',
  );
  assert.ok(
    readyUiState.renderLeftGap >= 0 && readyUiState.renderLeftGap <= 32,
    'Render panel should sit near the left edge.',
  );
  assert.ok(
    readyUiState.renderBottomGap >= 0 && readyUiState.renderBottomGap <= 32,
    'Render panel should sit near the bottom edge.',
  );
  assert.ok(
    readyUiState.cameraRightGap >= 0 && readyUiState.cameraRightGap <= 32,
    'Camera panel should sit near the right edge.',
  );
  assert.ok(
    readyUiState.cameraBottomGap >= 0 && readyUiState.cameraBottomGap <= 32,
    'Camera panel should sit near the bottom edge.',
  );
}

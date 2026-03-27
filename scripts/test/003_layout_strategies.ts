import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_STRATEGY,
  type BrowserTestContext,
  assertDemoRootLayerVisible,
  getLayoutStrategies,
  getTextState,
  showStrategyPanelMode,
} from './shared';

type LayoutPanelUiState = {
  layoutStrategyPanelVisible: boolean;
  lineStrategyPanelVisible: boolean;
  strategyPanelLabelText: string;
  textStrategyPanelVisible: boolean;
};

export async function runLayoutStrategiesStep(
  context: BrowserTestContext,
): Promise<void> {
  const baselineLayoutFingerprint = (await getTextState(context.page)).layoutFingerprint;

  await showStrategyPanelMode(context.page, 'layout');

  const layoutPanelUiState = await context.page.evaluate((): LayoutPanelUiState => {
    const layoutStrategyPanel = document.querySelector('[data-testid="layout-strategy-panel"]');
    const lineStrategyPanel = document.querySelector('[data-testid="line-strategy-panel"]');
    const strategyPanelLabel = document.querySelector('[data-testid="strategy-panel-label"]');
    const textStrategyPanel = document.querySelector('[data-testid="text-strategy-panel"]');

    return {
      layoutStrategyPanelVisible:
        layoutStrategyPanel instanceof HTMLElement &&
        !layoutStrategyPanel.hidden &&
        window.getComputedStyle(layoutStrategyPanel).display !== 'none',
      lineStrategyPanelVisible:
        lineStrategyPanel instanceof HTMLElement &&
        !lineStrategyPanel.hidden &&
        window.getComputedStyle(lineStrategyPanel).display !== 'none',
      strategyPanelLabelText:
        strategyPanelLabel instanceof HTMLElement ? strategyPanelLabel.textContent ?? '' : '',
      textStrategyPanelVisible:
        textStrategyPanel instanceof HTMLElement &&
        !textStrategyPanel.hidden &&
        window.getComputedStyle(textStrategyPanel).display !== 'none',
    };
  });

  assert.equal(layoutPanelUiState.layoutStrategyPanelVisible, true, 'Layout strategy panel should appear when selected.');
  assert.equal(layoutPanelUiState.lineStrategyPanelVisible, false, 'Line strategy panel should hide while layout strategy view is active.');
  assert.equal(layoutPanelUiState.textStrategyPanelVisible, false, 'Text strategy panel should hide while layout strategy view is active.');
  assert.equal(layoutPanelUiState.strategyPanelLabelText, 'Layout Strategy', 'Render panel should rename itself for layout strategies.');
  assert.deepEqual(
    getLayoutStrategies(),
    [DEFAULT_LAYOUT_STRATEGY],
    'Only Flow Columns should remain available as a layout strategy.',
  );

  const layoutTextState = await getTextState(context.page);
  assert.equal(
    layoutTextState.layoutStrategy,
    DEFAULT_LAYOUT_STRATEGY,
    'The demo should continue using Flow Columns as the active layout strategy.',
  );
  assert.equal(
    layoutTextState.strategyPanelMode,
    'layout',
    'Layout strategy view should remain active after opening the layout panel.',
  );
  assertDemoRootLayerVisible(
    layoutTextState,
    'The remaining layout strategy should preserve root-layer visibility at the current camera focus.',
  );
  assert.equal(
    layoutTextState.layoutFingerprint,
    baselineLayoutFingerprint,
    'Opening the layout panel should not relayout the scene when only Flow Columns is available.',
  );

  await showStrategyPanelMode(context.page, 'text');

  const restoredTextState = await getTextState(context.page);
  assert.equal(
    restoredTextState.layoutStrategy,
    DEFAULT_LAYOUT_STRATEGY,
    'Returning to the text strategy view should keep the default layout strategy active.',
  );
  assert.equal(
    restoredTextState.strategyPanelMode,
    'text',
    'Text strategy view should become active again after switching back.',
  );
  assert.equal(
    restoredTextState.layoutFingerprint,
    baselineLayoutFingerprint,
    'Returning to text strategy view should preserve the original label locations.',
  );
}

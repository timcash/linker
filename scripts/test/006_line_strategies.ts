import assert from 'node:assert/strict';

import {
  DEFAULT_LINE_STRATEGY,
  type BrowserTestContext,
  getLineState,
  getLineStrategies,
  showStrategyPanelMode,
  switchLineStrategy,
} from './shared';

type LinePanelUiState = {
  layoutStrategyPanelVisible: boolean;
  lineStrategyPanelVisible: boolean;
  strategyPanelLabelText: string;
  textStrategyPanelVisible: boolean;
};

export async function runLineStrategiesStep(
  context: BrowserTestContext,
): Promise<void> {
  await showStrategyPanelMode(context.page, 'line');

  const linePanelUiState = await context.page.evaluate((): LinePanelUiState => {
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

  assert.equal(linePanelUiState.lineStrategyPanelVisible, true, 'Line strategy panel should appear when selected.');
  assert.equal(linePanelUiState.textStrategyPanelVisible, false, 'Text strategy panel should hide while line strategy view is active.');
  assert.equal(linePanelUiState.layoutStrategyPanelVisible, false, 'Layout strategy panel should hide while line strategy view is active.');
  assert.equal(linePanelUiState.strategyPanelLabelText, 'Line Strategy', 'Render panel should rename itself for line strategies.');

  const defaultLineState = await getLineState(context.page);
  assert.equal(
    defaultLineState.lineStrategy,
    DEFAULT_LINE_STRATEGY,
    'The demo should start on the default line strategy.',
  );
  assert.equal(
    defaultLineState.strategyPanelMode,
    'line',
    'Line strategy view should remain active after opening the line panel.',
  );
  assert.ok(defaultLineState.lineLinkCount > 0, 'The demo should expose a deterministic link-set.');
  assert.ok(
    defaultLineState.lineVisibleLinkCount > 0,
    'The default line strategy should draw visible network links at zoom 0.',
  );
  assert.ok(
    defaultLineState.submittedVertexCount > 0,
    'The default line strategy should submit visible line vertices.',
  );

  const fingerprints = new Map<string, string>();

  for (const lineStrategy of getLineStrategies()) {
    await switchLineStrategy(context.page, lineStrategy);

    const lineState = await getLineState(context.page);
    assert.equal(
      lineState.lineStrategy,
      lineStrategy,
      `${lineStrategy} should become the active line strategy.`,
    );
    assert.equal(
      lineState.strategyPanelMode,
      'line',
      'Line strategy view should remain active after switching line strategies.',
    );
    assert.ok(
      lineState.lineVisibleLinkCount > 0,
      `${lineStrategy} should continue drawing visible links at zoom 0.`,
    );
    assert.ok(
      lineState.submittedVertexCount > 0,
      `${lineStrategy} should continue submitting line vertices.`,
    );
    fingerprints.set(lineStrategy, lineState.curveFingerprint);
  }

  assert.equal(
    new Set(fingerprints.values()).size,
    getLineStrategies().length,
    'Each line strategy should produce a distinct curve fingerprint.',
  );

  await showStrategyPanelMode(context.page, 'text');
}

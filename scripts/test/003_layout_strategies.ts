import assert from 'node:assert/strict';

import {
  DEFAULT_LAYOUT_STRATEGY,
  DEMO_ROOT_LABEL_COUNT,
  type BrowserTestContext,
  getLayoutStrategies,
  getTextState,
  showStrategyPanelMode,
  switchLayoutStrategy,
} from './shared';

type LayoutPanelUiState = {
  layoutStrategyPanelVisible: boolean;
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
    const strategyPanelLabel = document.querySelector('[data-testid="strategy-panel-label"]');
    const textStrategyPanel = document.querySelector('[data-testid="text-strategy-panel"]');

    return {
      layoutStrategyPanelVisible:
        layoutStrategyPanel instanceof HTMLElement &&
        !layoutStrategyPanel.hidden &&
        window.getComputedStyle(layoutStrategyPanel).display !== 'none',
      strategyPanelLabelText:
        strategyPanelLabel instanceof HTMLElement ? strategyPanelLabel.textContent ?? '' : '',
      textStrategyPanelVisible:
        textStrategyPanel instanceof HTMLElement &&
        !textStrategyPanel.hidden &&
        window.getComputedStyle(textStrategyPanel).display !== 'none',
    };
  });

  assert.equal(layoutPanelUiState.layoutStrategyPanelVisible, true, 'Layout strategy panel should appear when selected.');
  assert.equal(layoutPanelUiState.textStrategyPanelVisible, false, 'Text strategy panel should hide while layout strategy view is active.');
  assert.equal(layoutPanelUiState.strategyPanelLabelText, 'Layout Strategy', 'Render panel should rename itself for layout strategies.');

  const layoutFingerprints = new Map<string, string>([
    [DEFAULT_LAYOUT_STRATEGY, baselineLayoutFingerprint],
  ]);

  for (const layoutStrategy of getLayoutStrategies()) {
    if (layoutStrategy === DEFAULT_LAYOUT_STRATEGY) {
      continue;
    }

    await switchLayoutStrategy(context.page, layoutStrategy);

    const relaidTextState = await getTextState(context.page);
    assert.equal(
      relaidTextState.layoutStrategy,
      layoutStrategy,
      `${layoutStrategy} should become the active layout strategy.`,
    );
    assert.equal(
      relaidTextState.strategyPanelMode,
      'layout',
      'Layout strategy view should remain active after switching layouts.',
    );
    assert.equal(
      relaidTextState.visibleLabelCount,
      DEMO_ROOT_LABEL_COUNT,
      'Relayout should keep the full 12x12 root grid visible at zoom 0.',
    );
    if (layoutStrategy === 'scan-grid') {
      assert.notEqual(
        relaidTextState.layoutFingerprint,
        baselineLayoutFingerprint,
        'Scan Grid should rewrite the generated label locations.',
      );
    }
    layoutFingerprints.set(layoutStrategy, relaidTextState.layoutFingerprint);
  }

  assert.ok(
    new Set(layoutFingerprints.values()).size >= 2,
    'The layout strategy picker should still expose a distinct alternate layout.',
  );

  await switchLayoutStrategy(context.page, DEFAULT_LAYOUT_STRATEGY);
  await showStrategyPanelMode(context.page, 'text');

  const restoredTextState = await getTextState(context.page);
  assert.equal(
    restoredTextState.layoutStrategy,
    DEFAULT_LAYOUT_STRATEGY,
    'Switching back should restore the default layout strategy.',
  );
  assert.equal(
    restoredTextState.strategyPanelMode,
    'text',
    'Text strategy view should become active again after switching back.',
  );
  assert.equal(
    restoredTextState.layoutFingerprint,
    baselineLayoutFingerprint,
    'Restoring the default layout strategy should restore the original label locations.',
  );
}

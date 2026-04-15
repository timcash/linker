import assert from 'node:assert/strict';

import {
  captureInteractionScreenshot,
  getEditorState,
  getStageState,
  openRoute,
  type BrowserTestContext,
} from './shared';

export async function runOnboardingWalkthroughFlow(
  context: BrowserTestContext,
): Promise<void> {
  const route = buildOnboardingUrl(context.url);

  await openRoute(context.page, route);
  await context.page.waitForFunction(
    () => document.body.dataset.onboardingState === 'running',
    {timeout: 20_000},
  );

  const introStage = await getStageState(context.page);
  assert.equal(introStage.onboardingPanelVisible, true, 'The onboarding flow should replace the stats panel with the onboard panel.');
  assert.equal(introStage.onboardingState, 'running', 'The onboarding flow should report that the guided run is active.');
  assert.equal(introStage.planeCount, 1, 'The onboarding flow should still start from one empty root workplane.');
  assert.equal(introStage.dagNodeCount, 1, 'The onboarding flow should start from the empty-root DAG state.');
  assert.equal(introStage.stageMode, '2d-mode', 'The onboarding flow should begin in the 2D workplane editor.');
  assert.equal(
    await isStatsPanelHidden(context),
    true,
    'The onboarding panel should hide the live stats table while the walkthrough is active.',
  );
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-start');

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingState === 'complete' &&
      document.body.dataset.onboardingStepId === 'complete' &&
      document.body.dataset.stageMode === '3d-mode' &&
      Number(document.body.dataset.planeCount ?? '0') === 12 &&
      Number(document.body.dataset.dagNodeCount ?? '0') === 12 &&
      Number(document.body.dataset.dagEdgeCount ?? '0') === 11 &&
      document.body.dataset.activeWorkplaneId === 'wp-1',
    {timeout: 120_000},
  );

  const finalStage = await getStageState(context.page);
  const finalEditor = await getEditorState(context.page);
  assert.equal(finalStage.onboardingPanelVisible, true, 'The onboarding summary should stay visible until the user dismisses it.');
  assert.equal(finalStage.onboardingState, 'complete', 'The onboarding flow should end in the completed state.');
  assert.equal(finalStage.onboardingStepId, 'complete', 'The onboarding flow should finish on the completion step.');
  assert.equal(finalStage.stageMode, '3d-mode', 'The onboarding flow should end in the DAG overview.');
  assert.equal(finalStage.activeWorkplaneId, 'wp-1', 'The onboarding flow should refocus the root before finishing.');
  assert.equal(finalStage.planeCount, 12, 'The onboarding flow should end with a full twelve-workplane DAG.');
  assert.equal(finalStage.dagNodeCount, 12, 'The onboarding flow should export all twelve DAG nodes.');
  assert.equal(finalStage.dagEdgeCount, 11, 'The onboarding flow should restore the canonical 1-4-4-3 dependency count after the temporary CRUD demo.');
  assert.equal(finalStage.renderBridgeLinkCount, 11, 'The onboarding flow should render all eleven DAG links at the end.');
  assert.ok(
    finalEditor.documentLabelCount >= 5,
    'The onboarding flow should leave behind at least the authored root label stack.',
  );
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-complete');
}

function buildOnboardingUrl(baseUrl: string): string {
  const url = new URL(baseUrl);

  url.search = '';
  url.searchParams.set('onboarding', '1');
  return url.toString();
}

async function isStatsPanelHidden(
  context: BrowserTestContext,
): Promise<boolean> {
  return context.page.evaluate(() => {
    const stats = document.querySelector<HTMLElement>('[data-testid="status-stats"]');

    return (
      stats instanceof HTMLElement &&
      (stats.hidden || window.getComputedStyle(stats).display === 'none')
    );
  });
}

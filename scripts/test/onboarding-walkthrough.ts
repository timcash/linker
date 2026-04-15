import assert from 'node:assert/strict';

import {
  captureInteractionScreenshot,
  getEditorState,
  getLineState,
  getStageState,
  getTextState,
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
  assert.equal(introStage.controlPadPage, 'menu', 'The onboarding flow should now begin from the menu hub.');
  assert.equal(
    await isStatsPanelHidden(context),
    true,
    'The onboarding panel should hide the live stats table while the walkthrough is active.',
  );
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-start');

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'graph-overview' &&
      Number(document.body.dataset.dagGraphPointWorkplaneCount ?? '0') ===
        Number(document.body.dataset.planeCount ?? '0'),
    {timeout: 180_000},
  );
  const graphStage = await getStageState(context.page);
  assert.equal(graphStage.dagGraphPointWorkplaneCount, graphStage.planeCount, 'The onboarding walkthrough should zoom all the way out to the graph-point overview.');
  assert.equal(graphStage.dagTitleOnlyWorkplaneCount, 0, 'The graph-point onboarding step should hide title-only workplanes.');
  assert.equal(graphStage.dagLabelPointWorkplaneCount, 0, 'The graph-point onboarding step should hide label-point workplanes.');
  assert.equal(graphStage.dagFullWorkplaneCount, 0, 'The graph-point onboarding step should hide full workplanes.');
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-graph-overview');

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'title-only' &&
      Number(document.body.dataset.dagTitleOnlyWorkplaneCount ?? '0') > 0 &&
      Number(document.body.dataset.dagLabelPointWorkplaneCount ?? '0') === 0 &&
      Number(document.body.dataset.dagFullWorkplaneCount ?? '0') === 0,
    {timeout: 180_000},
  );
  const titleStage = await getStageState(context.page);
  const titleText = await getTextState(context.page);
  assert.ok(titleStage.dagTitleOnlyWorkplaneCount > 0, 'The title-only onboarding step should show title-card workplanes around the focus region.');
  assert.ok(titleStage.dagGraphPointWorkplaneCount < titleStage.planeCount, 'The title-only onboarding step should be closer than the graph overview.');
  assert.equal(titleStage.dagLabelPointWorkplaneCount, 0, 'The title-only onboarding step should not yet reveal label markers.');
  assert.equal(titleStage.dagFullWorkplaneCount, 0, 'The title-only onboarding step should not yet reveal full workplanes.');
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-title-only');

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'label-point' &&
      Number(document.body.dataset.dagLabelPointWorkplaneCount ?? '0') > 0 &&
      Number(document.body.dataset.dagFullWorkplaneCount ?? '0') === 0,
    {timeout: 180_000},
  );
  const labelPointStage = await getStageState(context.page);
  const labelPointText = await getTextState(context.page);
  assert.ok(labelPointStage.dagLabelPointWorkplaneCount > 0, 'The label-point onboarding step should reveal local label markers around the selected workplane.');
  assert.equal(labelPointStage.dagFullWorkplaneCount, 0, 'The label-point onboarding step should still stop short of full workplane detail.');
  assert.ok(
    labelPointText.visibleLabelCount > titleText.visibleLabelCount,
    'The label-point onboarding step should reveal more labels than the title-only band.',
  );
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-label-point');

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'full-workplane' &&
      document.body.dataset.stageMode === '2d-mode' &&
      Number(document.body.dataset.lineVisibleLinkCount ?? '0') > 0,
    {timeout: 180_000},
  );
  const fullStage = await getStageState(context.page);
  const fullText = await getTextState(context.page);
  const fullLine = await getLineState(context.page);
  assert.equal(fullStage.stageMode, '2d-mode', 'The deepest onboarding detail step should hand off into the 2D workplane editor.');
  assert.ok(
    fullLine.lineVisibleLinkCount > 0,
    'The full-workplane onboarding step should reveal local workplane lines.',
  );
  assert.ok(
    fullText.visibleLabelCount > 0,
    'The full-workplane onboarding step should reveal readable local labels in the focused workplane.',
  );
  await captureInteractionScreenshot(context, 'onboarding-walkthrough-full-workplane');

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingState === 'complete' &&
      document.body.dataset.onboardingStepId === 'complete' &&
      document.body.dataset.stageMode === '3d-mode' &&
      Number(document.body.dataset.planeCount ?? '0') === 12 &&
      Number(document.body.dataset.dagNodeCount ?? '0') === 12 &&
      Number(document.body.dataset.dagEdgeCount ?? '0') === 11 &&
      document.body.dataset.activeWorkplaneId === 'wp-1',
    {timeout: 180_000},
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
  assert.equal(finalStage.controlPadPage, 'menu', 'The onboarding flow should end by reopening the menu for manual exploration.');
  assert.ok(finalStage.dagTitleOnlyWorkplaneCount > 0, 'The onboarding flow should settle on the title-only overview band.');
  assert.equal(finalStage.dagFullWorkplaneCount, 0, 'The onboarding flow should end back out of the full-workplane band.');
  assert.ok(
    finalEditor.documentLabelCount >= 7,
    'The onboarding flow should leave behind authored labels on several workplanes, not just the root.',
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

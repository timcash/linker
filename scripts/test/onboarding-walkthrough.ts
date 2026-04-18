import assert from 'node:assert/strict';
import {readdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';

import {
  assertVisibleLabels,
  captureInteractionScreenshot,
  getEditorState,
  getLineState,
  getStageState,
  getTextState,
  openRoute,
  type BrowserTestContext,
} from './shared';

const EXPECTED_ONBOARDING_STEP_IDS = [
  'intro',
  'menu-intro',
  'root-title',
  'first-rank',
  'second-rank',
  'graph-overview',
  'title-only',
  'label-point',
  'full-workplane',
  'plane-focus',
  'local-fill',
  'stitched-dag',
  'complete',
] as const;

const EXPECTED_DAG_TITLES = [
  'Root Router',
  'Ingress',
  'Policy',
  'Audit',
  'Relay',
] as const;

export async function runOnboardingWalkthroughFlow(
  context: BrowserTestContext,
): Promise<void> {
  const route = buildOnboardingUrl(context.url);

  clearPriorOnboardingArtifacts(context);
  await openRoute(context.page, route);
  const onboardingArtifactsPromise = captureOnboardingStepArtifacts(
    context,
    EXPECTED_ONBOARDING_STEP_IDS,
  );
  await context.page.waitForFunction(
    () => document.body.dataset.onboardingState === 'running',
    {timeout: 20_000},
  );

  const introStage = await getStageState(context.page);
  assert.equal(introStage.onboardingPanelVisible, true, 'The onboarding flow should replace the stats panel with the onboard panel.');
  assert.equal(introStage.onboardingState, 'running', 'The onboarding flow should report that the guided run is active.');
  assert.equal(introStage.onboardingStepId, 'intro', 'The onboarding flow should begin on the intro step before it starts clicking through the pads.');
  assert.equal(introStage.planeCount, 1, 'The onboarding flow should still start from one empty root workplane.');
  assert.equal(introStage.dagNodeCount, 1, 'The onboarding flow should start from the empty-root DAG state.');
  assert.equal(introStage.stageMode, '3d-mode', 'The onboarding flow should begin in the 3D DAG view.');
  assert.equal(introStage.controlPadPage, 'menu', 'The onboarding flow should now begin from the menu hub.');
  assert.equal(
    await isStatsPanelHidden(context),
    true,
    'The onboarding panel should hide the live stats table while the walkthrough is active.',
  );
  await assertEmbeddedSiteMenuInOnboardingPanel(context);

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'graph-overview' &&
      Number(document.body.dataset.planeCount ?? '0') === 5 &&
      Number(document.body.dataset.dagNodeCount ?? '0') === 5 &&
      Number(document.body.dataset.dagEdgeCount ?? '0') === 4 &&
      Number(document.body.dataset.dagGraphPointWorkplaneCount ?? '0') === 5,
    {timeout: 180_000},
  );
  const graphStage = await getStageState(context.page);
  const graphLine = await getLineState(context.page);
  assert.equal(graphStage.stageMode, '3d-mode', 'The graph overview step should stay in the 3D DAG.');
  assert.equal(graphStage.planeCount, 5, 'The onboarding walkthrough should build a five-workplane DAG before the LOD tour begins.');
  assert.equal(graphStage.dagNodeCount, 5, 'The onboarding walkthrough should export five DAG nodes.');
  assert.equal(graphStage.dagEdgeCount, 4, 'The onboarding walkthrough should export four DAG links.');
  assert.equal(graphStage.dagGraphPointWorkplaneCount, 5, 'The graph overview should reduce every workplane to a graph marker.');
  assert.equal(graphStage.dagTitleOnlyWorkplaneCount, 0, 'The graph overview should not yet reveal title cards.');
  assert.equal(graphStage.dagLabelPointWorkplaneCount, 0, 'The graph overview should not yet reveal label markers.');
  assert.equal(graphStage.dagFullWorkplaneCount, 0, 'The graph overview should not yet reveal full workplanes.');
  assert.ok(
    graphLine.lineVisibleLinkCount >= graphStage.renderBridgeLinkCount,
    'The graph overview should keep the global DAG links visible.',
  );

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'title-only' &&
      document.body.dataset.activeWorkplaneId === 'wp-4' &&
      Number(document.body.dataset.dagTitleOnlyWorkplaneCount ?? '0') > 0 &&
      Number(document.body.dataset.dagLabelPointWorkplaneCount ?? '0') === 0 &&
      Number(document.body.dataset.dagFullWorkplaneCount ?? '0') === 0,
    {timeout: 180_000},
  );
  const titleStage = await getStageState(context.page);
  const titleText = await getTextState(context.page);
  const titleLine = await getLineState(context.page);
  assert.equal(titleStage.stageMode, '3d-mode', 'The title-only onboarding step should stay in the 3D DAG view.');
  assert.equal(titleStage.activeWorkplaneId, 'wp-4', 'The title-only onboarding step should center the first leaf workplane.');
  assert.ok(titleStage.dagTitleOnlyWorkplaneCount > 0, 'The title-only onboarding step should show title-card workplanes around the focus region.');
  assert.equal(titleStage.dagLabelPointWorkplaneCount, 0, 'The title-only onboarding step should not yet reveal label markers.');
  assert.equal(titleStage.dagFullWorkplaneCount, 0, 'The title-only onboarding step should not yet reveal full workplanes.');
  assertVisibleLabels(
    titleText.visibleLabels,
    {present: [...EXPECTED_DAG_TITLES]},
    'The title-only onboarding step',
  );
  assert.ok(
    titleLine.lineVisibleLinkCount >= titleStage.renderBridgeLinkCount,
    'The title-only onboarding step should keep the DAG edges readable while the camera centers the selected workplane.',
  );

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'label-point' &&
      Number(document.body.dataset.dagLabelPointWorkplaneCount ?? '0') > 0 &&
      Number(document.body.dataset.dagFullWorkplaneCount ?? '0') === 0,
    {timeout: 180_000},
  );
  const labelPointStage = await getStageState(context.page);
  const labelPointText = await getTextState(context.page);
  const labelPointLine = await getLineState(context.page);
  assert.ok(labelPointStage.dagLabelPointWorkplaneCount > 0, 'The label-point onboarding step should reveal local label markers around the selected workplane.');
  assert.equal(labelPointStage.dagFullWorkplaneCount, 0, 'The label-point onboarding step should still stop short of full workplane detail.');
  assert.ok(
    labelPointText.visibleLabelCount > titleText.visibleLabelCount,
    'The label-point onboarding step should reveal more labels than the title-only band.',
  );
  assert.ok(
    labelPointLine.lineVisibleLinkCount >= titleLine.lineVisibleLinkCount,
    'The label-point onboarding step should preserve the DAG edges while adding local detail.',
  );

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'full-workplane' &&
      document.body.dataset.stageMode === '3d-mode' &&
      Number(document.body.dataset.dagFullWorkplaneCount ?? '0') > 0,
    {timeout: 180_000},
  );
  const fullStage = await getStageState(context.page);
  const fullText = await getTextState(context.page);
  const fullLine = await getLineState(context.page);
  assert.equal(fullStage.stageMode, '3d-mode', 'The full-workplane onboarding step should still be in the 3D DAG view.');
  assert.ok(
    fullStage.dagFullWorkplaneCount > 0,
    'The full-workplane onboarding step should reveal at least one readable workplane inside the 3D DAG.',
  );
  assert.ok(
    fullLine.lineVisibleLinkCount >= fullStage.renderBridgeLinkCount,
    'The full-workplane onboarding step should keep the DAG edges visible while local workplane lines appear.',
  );
  assert.ok(
    fullText.visibleLabelCount > labelPointText.visibleLabelCount,
    'The full-workplane onboarding step should reveal more readable text than the label-point band.',
  );

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'plane-focus' &&
      document.body.dataset.stageMode === '2d-mode' &&
      document.body.dataset.activeWorkplaneId === 'wp-4',
    {timeout: 180_000},
  );
  const planeFocusStage = await getStageState(context.page);
  const planeFocusText = await getTextState(context.page);
  assert.equal(planeFocusStage.stageMode, '2d-mode', 'The plane-focus onboarding step should hand off into the 2D workplane editor.');
  assert.equal(planeFocusStage.activeWorkplaneId, 'wp-4', 'The plane-focus onboarding step should stay on the selected leaf workplane.');
  assert.ok(
    planeFocusText.visibleLabelCount > 0,
    'The plane-focus onboarding step should reveal readable local labels in the focused workplane.',
  );

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingStepId === 'local-fill' &&
      document.body.dataset.stageMode === '2d-mode' &&
      document.body.dataset.activeWorkplaneId === 'wp-4' &&
      Number(document.body.dataset.documentLinkCount ?? '0') >= 1,
    {timeout: 180_000},
  );
  const localFillStage = await getStageState(context.page);
  const localFillEditor = await getEditorState(context.page);
  const localFillText = await getTextState(context.page);
  const localFillLine = await getLineState(context.page);
  assert.equal(localFillStage.stageMode, '2d-mode', 'The local-fill onboarding step should still be in plane-focus.');
  assert.equal(localFillStage.activeWorkplaneId, 'wp-4', 'The local-fill onboarding step should edit the same focused workplane.');
  assert.equal(localFillEditor.selectedLabelCount, 0, 'The local-fill onboarding step should clear the temporary ranked selection before the screenshot.');
  assert.ok(localFillEditor.documentLabelCount >= 6, 'The local-fill onboarding step should leave behind the five titles plus one new local label.');
  assert.ok(localFillEditor.documentLinkCount >= 1, 'The local-fill onboarding step should create a local workplane link.');
  assertVisibleLabels(
    localFillText.visibleLabels,
    {present: ['Audit', 'Cache']},
    'The local-fill onboarding step',
  );
  assert.ok(
    localFillLine.lineVisibleLinkCount > 0,
    'The local-fill onboarding step should render the new local workplane link clearly in 2D.',
  );

  await context.page.waitForFunction(
    () =>
      document.body.dataset.onboardingState === 'complete' &&
      document.body.dataset.onboardingStepId === 'complete' &&
      document.body.dataset.stageMode === '3d-mode' &&
      Number(document.body.dataset.planeCount ?? '0') === 5 &&
      Number(document.body.dataset.dagNodeCount ?? '0') === 5 &&
      Number(document.body.dataset.dagEdgeCount ?? '0') === 4 &&
      document.body.dataset.activeWorkplaneId === 'wp-1',
    {timeout: 180_000},
  );

  const finalStage = await getStageState(context.page);
  const finalEditor = await getEditorState(context.page);
  const finalText = await getTextState(context.page);
  assert.equal(finalStage.onboardingPanelVisible, true, 'The onboarding summary should stay visible until the user dismisses it.');
  assert.equal(finalStage.onboardingState, 'complete', 'The onboarding flow should end in the completed state.');
  assert.equal(finalStage.onboardingStepId, 'complete', 'The onboarding flow should finish on the completion step.');
  assert.equal(finalStage.stageMode, '3d-mode', 'The onboarding flow should end in the DAG overview.');
  assert.equal(finalStage.activeWorkplaneId, 'wp-1', 'The onboarding flow should refocus the root before finishing.');
  assert.equal(finalStage.planeCount, 5, 'The onboarding flow should end with a five-workplane DAG.');
  assert.equal(finalStage.dagNodeCount, 5, 'The onboarding flow should export all five DAG nodes.');
  assert.equal(finalStage.dagEdgeCount, 4, 'The onboarding flow should export the final four DAG links.');
  assert.equal(finalStage.renderBridgeLinkCount, 4, 'The onboarding flow should render the four DAG links at the end.');
  assert.equal(finalStage.controlPadPage, 'menu', 'The onboarding flow should end by reopening the menu for manual exploration.');
  assert.ok(finalStage.dagTitleOnlyWorkplaneCount > 0, 'The onboarding flow should settle on the title-only overview band.');
  assert.equal(finalStage.dagFullWorkplaneCount, 0, 'The onboarding flow should end back out of the full-workplane band.');
  assert.ok(finalEditor.documentLabelCount >= 6, 'The onboarding flow should leave behind the five DAG titles plus one local workplane label.');
  assert.ok(finalEditor.documentLinkCount >= 1, 'The onboarding flow should preserve the authored local link after returning to 3D.');
  assertVisibleLabels(
    finalText.visibleLabels,
    {present: [...EXPECTED_DAG_TITLES]},
    'The completed onboarding overview',
  );
  const capturedStepIds = await onboardingArtifactsPromise;
  assert.deepEqual(
    capturedStepIds,
    EXPECTED_ONBOARDING_STEP_IDS,
    'The onboarding browser proof should leave behind one screenshot artifact for every onboarding step.',
  );
}

function buildOnboardingUrl(baseUrl: string): string {
  const url = new URL(baseUrl);

  url.search = '';
  url.searchParams.set('onboarding', '1');
  return url.toString();
}

function clearPriorOnboardingArtifacts(context: BrowserTestContext): void {
  for (const entry of readdirSync(context.interactionScreenshotDir)) {
    if (/^\d+-onboarding-step-/.test(entry)) {
      rmSync(join(context.interactionScreenshotDir, entry), {force: true});
    }
  }

  context.interactionScreenshotCounter = 0;
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

async function assertEmbeddedSiteMenuInOnboardingPanel(
  context: BrowserTestContext,
): Promise<void> {
  const placement = await context.page.evaluate(() => {
    const statusPanel = document.querySelector<HTMLElement>('[data-testid="status-panel"]');
    const statusLabel = document.querySelector<HTMLElement>('[data-testid="status-panel-label"]');
    const menuSlot = document.querySelector<HTMLElement>('[data-testid="status-panel-menu-slot"]');
    const toggle = menuSlot?.querySelector<HTMLElement>('[data-site-menu-toggle]');
    const onboardPanel = document.querySelector<HTMLElement>('[data-testid="onboard-panel"]');
    const statusRect = statusPanel?.getBoundingClientRect();
    const menuSlotRect = menuSlot?.getBoundingClientRect();
    const toggleRect = toggle?.getBoundingClientRect();
    const onboardRect = onboardPanel?.getBoundingClientRect();

    return {
      onboardVisible:
        onboardPanel instanceof HTMLElement &&
        !onboardPanel.hidden &&
        onboardPanel.getClientRects().length > 0 &&
        window.getComputedStyle(onboardPanel).display !== 'none' &&
        window.getComputedStyle(onboardPanel).visibility !== 'hidden',
      panelLabel: statusLabel?.textContent?.trim() ?? '',
      slotContainsToggle: menuSlot?.contains(toggle ?? null) ?? false,
      toggleRightGap: Math.round((statusRect?.right ?? 0) - (toggleRect?.right ?? 0)),
      toggleTopGap: Math.round((toggleRect?.top ?? 0) - (statusRect?.top ?? 0)),
      toggleWithinSlot:
        !!toggleRect &&
        !!menuSlotRect &&
        toggleRect.left >= menuSlotRect.left - 1 &&
        toggleRect.right <= menuSlotRect.right + 1 &&
        toggleRect.top >= menuSlotRect.top - 1 &&
        toggleRect.bottom <= menuSlotRect.bottom + 1,
      toggleWithinPanelBounds:
        !!toggleRect &&
        !!onboardRect &&
        toggleRect.right <= onboardRect.right + 1 &&
        toggleRect.top <= onboardRect.top + 40,
    };
  });

  assert.equal(
    placement.panelLabel,
    'Onboard',
    'The onboarding shell should relabel the top panel as Onboard.',
  );
  assert.equal(
    placement.onboardVisible,
    true,
    'The onboarding panel should stay visible while the walkthrough is active.',
  );
  assert.equal(
    placement.slotContainsToggle,
    true,
    'The site menu toggle should stay mounted inside the shared status-panel menu slot during onboarding.',
  );
  assert.equal(
    placement.toggleWithinSlot,
    true,
    'The site menu toggle should stay contained by the top-right onboarding menu slot.',
  );
  assert.equal(
    placement.toggleWithinPanelBounds,
    true,
    'The site menu toggle should stay visually attached to the onboarding panel.',
  );
  assert.ok(
    placement.toggleRightGap >= 0 && placement.toggleRightGap <= 20,
    `The onboarding menu toggle should stay aligned to the right edge of the panel. placement=${JSON.stringify(placement)}`,
  );
  assert.ok(
    placement.toggleTopGap >= 0 && placement.toggleTopGap <= 20,
    `The onboarding menu toggle should stay aligned to the top edge of the panel. placement=${JSON.stringify(placement)}`,
  );
}

async function captureOnboardingStepArtifacts(
  context: BrowserTestContext,
  expectedStepIds: readonly string[],
): Promise<string[]> {
  const capturedStepIds: string[] = [];

  for (const [stepIndex, stepId] of expectedStepIds.entries()) {
    await context.page.waitForFunction(
      (expectedStepId) => document.body.dataset.onboardingStepId === expectedStepId,
      {timeout: 180_000},
      stepId,
    );
    await captureInteractionScreenshot(
      context,
      `onboarding-step-${String(stepIndex).padStart(2, '0')}-${stepId}`,
    );
    capturedStepIds.push(stepId);
  }

  return capturedStepIds;
}

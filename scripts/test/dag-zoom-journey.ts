import assert from 'node:assert/strict';

import {
  assertOverlayShellPinned,
  captureInteractionScreenshot,
  clickControl,
  clickControlRepeatedly,
  clickStageModeButton,
  clickWorkplaneButton,
  getCameraState,
  getLineState,
  getStageRouteState,
  getStageState,
  getTextState,
  openRouteWithBootState,
  waitForCameraSettled,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createBridgeLinkedFiveWorkplaneDagState} from './fixtures';

export async function runDagZoomJourneyFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRouteWithBootState(context.page, context.url, {
    initialState: createBridgeLinkedFiveWorkplaneDagState(),
    strategyPanelMode: 'label-edit',
  });

  await clickStageModeButton(context.page, '3d-mode');

  const initial3dStage = await getStageState(context.page);
  assert.equal(initial3dStage.stageMode, '3d-mode', 'The DAG zoom journey should enter 3d mode.');
  assert.equal(initial3dStage.activeWorkplaneId, 'wp-1', 'The DAG zoom journey should begin from the root workplane.');

  let overviewStage = await getStageState(context.page);
  let overviewZoomOutCount = 0;

  while (overviewStage.dagGraphPointWorkplaneCount !== overviewStage.planeCount) {
    if (overviewZoomOutCount >= 16) {
      throw new Error('Timed out waiting for the DAG graph-overview zoom state.');
    }

    await clickControl(context.page, 'zoom-out');
    await waitForCameraSettled(context.page);
    overviewStage = await getStageState(context.page);
    overviewZoomOutCount += 1;
  }

  const overviewText = await getTextState(context.page);
  const overviewLine = await getLineState(context.page);
  assert.equal(overviewStage.dagGraphPointWorkplaneCount, 5, 'The far DAG overview should collapse all workplanes into graph-point nodes.');
  assert.equal(overviewStage.dagTitleOnlyWorkplaneCount, 0, 'The far DAG overview should not leave any title-only workplanes behind.');
  assert.equal(overviewStage.dagLabelPointWorkplaneCount, 0, 'The far DAG overview should not leave any label-point workplanes behind.');
  assert.equal(overviewStage.dagFullWorkplaneCount, 0, 'The far DAG overview should not leave any full workplanes behind.');
  assert.equal(overviewLine.lineVisibleLinkCount, overviewStage.dagVisibleEdgeCount, 'The far DAG overview should keep only DAG dependency lines visible.');
  assert.equal(overviewText.visibleLabelCount, overviewStage.planeCount, 'The far DAG overview should show one graph marker label per workplane.');
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'dag zoom overview',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-graph-overview');

  await clickControl(context.page, 'reset-camera');
  await context.page.waitForFunction(
    () => document.body.dataset.cameraAnimating === 'true',
  );
  await waitForCameraSettled(context.page);

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 5});
  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 5});

  const titleStage = await getStageState(context.page);
  const titleText = await getTextState(context.page);
  const titleLine = await getLineState(context.page);
  assert.equal(titleStage.dagTitleOnlyWorkplaneCount, 5, 'Selecting the middle workplane should begin in the title-only DAG bucket.');
  assert.equal(titleStage.dagGraphPointWorkplaneCount, 0, 'The title-only view should be closer than the graph overview.');
  assert.equal(titleStage.dagLabelPointWorkplaneCount, 0, 'The title-only view should not yet show local label points.');
  assert.equal(titleStage.dagFullWorkplaneCount, 0, 'The title-only view should not yet show full workplanes.');
  assert.equal(titleLine.lineVisibleLinkCount, titleStage.dagVisibleEdgeCount, 'The title-only view should still keep only DAG dependency lines visible.');
  assert.equal(titleText.visibleLabelCount, titleStage.planeCount, 'The title-only view should show one title label per workplane.');
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'dag zoom titles',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-title-only');

  await clickControl(context.page, 'zoom-in');
  await context.page.waitForFunction(
    () => document.body.dataset.cameraAnimating === 'true',
  );
  await waitForCameraSettled(context.page);

  let labelPointStage = await getStageState(context.page);
  let labelPointText = await getTextState(context.page);
  let labelPointLine = await getLineState(context.page);
  let labelPointStepCount = 0;

  while (labelPointStage.dagLabelPointWorkplaneCount !== labelPointStage.planeCount) {
    if (labelPointStepCount >= 8) {
      throw new Error('Timed out waiting for the DAG label-point zoom state.');
    }

    await clickControlRepeatedly(context.page, 'zoom-in', 1);
    await waitForCameraSettled(context.page);
    labelPointStage = await getStageState(context.page);
    labelPointText = await getTextState(context.page);
    labelPointLine = await getLineState(context.page);
    labelPointStepCount += 1;
  }

  assert.ok(
    labelPointStage.dagLabelPointWorkplaneCount === labelPointStage.planeCount,
    'Zooming toward the selected workplane should reveal local label markers across the whole visible DAG.',
  );
  assert.ok(
    labelPointText.visibleLabelCount > titleText.visibleLabelCount,
    'The closer DAG view should reveal more local label markers than the title-only view.',
  );
  assert.ok(
    labelPointText.visibleGlyphCount > titleText.visibleGlyphCount,
    'The label-point DAG view should expose more text glyphs than the title-only view.',
  );
  assert.equal(
    labelPointLine.lineVisibleLinkCount,
    labelPointStage.dagVisibleEdgeCount,
    'The label-point DAG view should still keep local links hidden while dependency lines remain visible.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'dag zoom label points',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-label-points');

  let fullStage = labelPointStage;
  let fullText = labelPointText;
  let fullLine = labelPointLine;
  let fullStepCount = 0;

  while (
    fullStage.dagFullWorkplaneCount === 0 ||
    fullLine.lineVisibleLinkCount <= fullStage.dagVisibleEdgeCount ||
    fullText.visibleGlyphCount <= labelPointText.visibleGlyphCount
  ) {
    if (fullStepCount >= 8) {
      throw new Error('Timed out waiting for the readable DAG full-workplane zoom state.');
    }

    await clickControlRepeatedly(context.page, 'zoom-in', 1);
    await waitForCameraSettled(context.page);
    fullStage = await getStageState(context.page);
    fullText = await getTextState(context.page);
    fullLine = await getLineState(context.page);
    fullStepCount += 1;
  }

  assert.ok(fullStage.dagFullWorkplaneCount > 0, 'The closest DAG zoom should reveal at least one full workplane.');
  assert.ok(
    fullLine.lineVisibleLinkCount > fullStage.dagVisibleEdgeCount,
    'The closest DAG zoom should reveal local workplane links in addition to DAG dependency lines.',
  );
  assert.ok(
    fullText.visibleGlyphCount > labelPointText.visibleGlyphCount,
    'The closest DAG zoom should reveal more readable label text than the label-point view.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'dag zoom full workplane',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-full-workplane');

  await clickStageModeButton(context.page, '2d-mode');
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '3d-mode') === '2d-mode',
  );

  const planeFocusStage = await getStageState(context.page);
  const planeFocusRoute = await getStageRouteState(context.page);
  const planeFocusText = await getTextState(context.page);
  const planeFocusLine = await getLineState(context.page);
  const planeFocusCamera = await getCameraState(context.page);
  assert.equal(planeFocusStage.stageMode, '2d-mode', 'The zoom journey should finish by returning to 2d mode.');
  assert.equal(planeFocusStage.activeWorkplaneId, 'wp-3', 'Returning to 2d mode should keep the selected workplane active.');
  assert.equal(planeFocusRoute.stageMode, '2d-mode', 'Returning to 2d mode should keep the route synchronized.');
  assert.equal(planeFocusRoute.workplaneId, 'wp-3', 'Returning to 2d mode should keep the selected workplane in the route.');
  assert.ok(planeFocusText.visibleLabelCount > 0, 'The final 2d workplane view should show readable local label text.');
  assert.ok(planeFocusLine.lineVisibleLinkCount > 0, 'The final 2d workplane view should show local workplane lines.');
  assert.equal(planeFocusCamera.label, 'wp-3:1:6:6', 'The final 2d workplane view should restore the focused workplane memory.');
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'dag zoom plane focus',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-plane-focus');
}

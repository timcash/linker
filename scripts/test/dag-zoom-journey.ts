import assert from 'node:assert/strict';

import {
  assertOverlayShellPinned,
  captureInteractionScreenshot,
  clickControl,
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
  const overviewCamera = await getCameraState(context.page);
  assert.equal(overviewStage.dagGraphPointWorkplaneCount, 5, 'The far DAG overview should collapse all workplanes into graph-point nodes.');
  assert.equal(overviewStage.dagTitleOnlyWorkplaneCount, 0, 'The far DAG overview should not leave any title-only workplanes behind.');
  assert.equal(overviewStage.dagLabelPointWorkplaneCount, 0, 'The far DAG overview should not leave any label-point workplanes behind.');
  assert.equal(overviewStage.dagFullWorkplaneCount, 0, 'The far DAG overview should not leave any full workplanes behind.');
  assert.equal(overviewLine.lineVisibleLinkCount, overviewStage.dagVisibleEdgeCount, 'The far DAG overview should keep only DAG dependency lines visible.');
  assert.equal(overviewText.visibleLabelCount, overviewStage.planeCount, 'The far DAG overview should show one graph marker label per workplane.');
  assert.equal(overviewCamera.canZoomOut, false, 'The far DAG overview should stop the discrete zoom-out button at the graph-point band.');
  assert.equal(overviewCamera.canZoomIn, true, 'The far DAG overview should still allow a single-step zoom into the next DAG band.');
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
  const titleCamera = await getCameraState(context.page);
  assert.equal(titleStage.dagTitleOnlyWorkplaneCount, 5, 'Selecting the middle workplane should begin in the title-only DAG bucket.');
  assert.equal(titleStage.dagGraphPointWorkplaneCount, 0, 'The title-only view should be closer than the graph overview.');
  assert.equal(titleStage.dagLabelPointWorkplaneCount, 0, 'The title-only view should not yet show local label points.');
  assert.equal(titleStage.dagFullWorkplaneCount, 0, 'The title-only view should not yet show full workplanes.');
  assert.equal(titleLine.lineVisibleLinkCount, titleStage.dagVisibleEdgeCount, 'The title-only view should still keep only DAG dependency lines visible.');
  assert.equal(titleText.visibleLabelCount, titleStage.planeCount, 'The title-only view should show one title label per workplane.');
  assert.equal(titleCamera.canZoomIn, true, 'The title-only band should allow one discrete zoom into the label-point band.');
  assert.equal(titleCamera.canZoomOut, true, 'The title-only band should allow one discrete zoom back to the graph overview.');
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

  const labelPointStage = await getStageState(context.page);
  const labelPointText = await getTextState(context.page);
  const labelPointLine = await getLineState(context.page);
  const labelPointCamera = await getCameraState(context.page);
  assert.ok(
    labelPointStage.dagLabelPointWorkplaneCount > 0,
    'One discrete zoom-in press from the title-only band should reveal local label markers.',
  );
  assert.equal(
    labelPointStage.dagGraphPointWorkplaneCount,
    0,
    'The label-point band should stay closer than the graph overview.',
  );
  assert.equal(
    labelPointStage.dagFullWorkplaneCount,
    0,
    'The label-point band should stop short of full local workplane detail.',
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
  assert.equal(
    labelPointCamera.canZoomIn,
    true,
    'The label-point band should allow one more discrete zoom-in press into readable workplane detail.',
  );
  assert.equal(
    labelPointCamera.canZoomOut,
    true,
    'The label-point band should allow one discrete zoom-out press back to title-only.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'dag zoom label points',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-label-points');

  await clickControl(context.page, 'zoom-in');
  await context.page.waitForFunction(
    () => document.body.dataset.cameraAnimating === 'true',
  );
  await waitForCameraSettled(context.page);

  const fullStage = await getStageState(context.page);
  const fullText = await getTextState(context.page);
  const fullLine = await getLineState(context.page);
  const fullCamera = await getCameraState(context.page);
  assert.ok(fullStage.dagFullWorkplaneCount > 0, 'The closest DAG zoom should reveal at least one full workplane.');
  assert.ok(
    fullLine.lineVisibleLinkCount > fullStage.dagVisibleEdgeCount,
    'The closest DAG zoom should reveal local workplane links in addition to DAG dependency lines.',
  );
  assert.ok(
    fullText.visibleGlyphCount > labelPointText.visibleGlyphCount,
    'The closest DAG zoom should reveal more readable label text than the label-point view.',
  );
  assert.equal(
    fullCamera.canZoomIn,
    false,
    'The full-workplane band should stop the discrete zoom-in button at the readable local-detail state.',
  );
  assert.equal(
    fullCamera.canZoomOut,
    true,
    'The full-workplane band should still allow a single-step zoom back out.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'dag zoom full workplane',
  });
  await captureInteractionScreenshot(context, 'dag-zoom-full-workplane');

  await clickControl(context.page, 'zoom-out');
  await context.page.waitForFunction(
    () => document.body.dataset.cameraAnimating === 'true',
  );
  await waitForCameraSettled(context.page);

  const labelPointReturnStage = await getStageState(context.page);
  assert.ok(
    labelPointReturnStage.dagLabelPointWorkplaneCount > 0,
    'One discrete zoom-out press from readable workplane detail should return to the label-point band.',
  );
  assert.equal(
    labelPointReturnStage.dagFullWorkplaneCount,
    0,
    'Returning from readable workplane detail should leave the full-workplane band in one step.',
  );

  await clickControl(context.page, 'zoom-out');
  await context.page.waitForFunction(
    () => document.body.dataset.cameraAnimating === 'true',
  );
  await waitForCameraSettled(context.page);

  const titleReturnStage = await getStageState(context.page);
  assert.ok(
    titleReturnStage.dagTitleOnlyWorkplaneCount > 0,
    'One more discrete zoom-out press should return to the title-only band.',
  );
  assert.equal(
    titleReturnStage.dagLabelPointWorkplaneCount,
    0,
    'Returning to the title-only band should hide label markers again.',
  );

  await clickControl(context.page, 'zoom-out');
  await context.page.waitForFunction(
    () => document.body.dataset.cameraAnimating === 'true',
  );
  await waitForCameraSettled(context.page);

  const graphReturnStage = await getStageState(context.page);
  const graphReturnCamera = await getCameraState(context.page);
  assert.equal(
    graphReturnStage.dagGraphPointWorkplaneCount,
    graphReturnStage.planeCount,
    'One final discrete zoom-out press should return to the graph-point overview.',
  );
  assert.equal(
    graphReturnStage.dagTitleOnlyWorkplaneCount,
    0,
    'Returning to the graph overview should leave the title-only band in one step.',
  );
  assert.equal(
    graphReturnCamera.canZoomOut,
    false,
    'The graph overview should disable further zoom-out once the far DAG band is reached again.',
  );

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

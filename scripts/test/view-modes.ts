import assert from 'node:assert/strict';

import {
  clickControl,
  dragStackCameraOrbit,
  getCameraState,
  getStageRouteState,
  getStageState,
  getTextState,
  navigateBrowserHistory,
  openRoute,
  pressHistoryKey,
  pressNavigationKey,
  pressPlaneStackKey,
  pressStageModeKey,
  showStrategyPanelMode,
  submitFocusedLabelInput,
  waitForCameraLabel,
  waitForRouteHistoryStep,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';

type LabelEditPanelState = {
  disabled: boolean;
  visible: boolean;
};

type SelectionBoxState = {
  label: string;
  visible: boolean;
};

export async function runViewModesFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, context.url);

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, '2:1:1');
  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '2:2:1');
  await pressHistoryKey(context.page, 'history-back');
  await waitForCameraLabel(context.page, '2:1:1');
  await pressHistoryKey(context.page, 'history-forward');
  await waitForCameraLabel(context.page, '2:2:1');

  await showStrategyPanelMode(context.page, 'label-edit');
  await pressPlaneStackKey(context.page, 'spawn-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, '3:2:1');
  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '3:3:1');

  const planeFocusStage = await getStageState(context.page);
  const planeFocusText = await getTextState(context.page);

  assert.equal(planeFocusStage.stageMode, '2d-mode', 'View mode flow should begin in plane-focus view.');
  assert.equal(
    (await readSelectionBoxState(context)).visible,
    true,
    'Plane-focus view should show the selection box.',
  );
  assert.equal(
    (await readLabelEditPanelState(context)).disabled,
    false,
    'Plane-focus view should keep label editing enabled.',
  );

  await pressStageModeKey(context.page);
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );

  const stackStage = await getStageState(context.page);
  const stackRoute = await getStageRouteState(context.page);
  const stackCamera = await getCameraState(context.page);
  const stackText = await getTextState(context.page);

  assert.equal(stackStage.stageMode, '3d-mode', 'Slash should enter stack view.');
  assert.equal(stackStage.activeWorkplaneId, 'wp-2', 'Entering stack view should keep the active workplane stable.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'Stack view should mirror its mode into the route.');
  assert.equal(stackRoute.workplaneId, 'wp-2', 'Stack view should mirror the active workplane into the route.');
  assert.ok(
    stackText.labelCount > planeFocusText.labelCount,
    'Stack view should render more label content than the single-plane view.',
  );
  assert.ok(
    stackText.submittedGlyphCount > planeFocusText.submittedGlyphCount,
    'Stack view should submit more glyph geometry than the single-plane view.',
  );
  assert.equal(
    (await readSelectionBoxState(context)).visible,
    false,
    'Stack view should hide the plane-focus selection box.',
  );
  assert.equal(
    (await readLabelEditPanelState(context)).disabled,
    true,
    'Stack view should disable label editing.',
  );
  assert.equal(stackCamera.canMoveLeft, true, 'Stack view should allow orbiting left.');
  assert.equal(stackCamera.canMoveRight, true, 'Stack view should allow orbiting right.');
  assert.equal(stackCamera.canMoveUp, true, 'Stack view should allow orbiting upward.');
  assert.equal(stackCamera.canMoveDown, true, 'Stack view should allow orbiting downward.');
  assert.equal(stackCamera.canZoomIn, true, 'Stack view should allow stack-camera zoom in.');
  assert.equal(stackCamera.canZoomOut, true, 'Stack view should allow stack-camera zoom out.');
  assert.equal(stackCamera.canReset, false, 'Fresh stack view should begin at the default stack-camera orbit.');

  const stackCameraLabel = stackCamera.label;
  await dragStackCameraOrbit(context.page, {x: 120, y: -48});
  const draggedStackCamera = await getCameraState(context.page);

  assert.notEqual(
    draggedStackCamera.stackCameraAzimuth,
    stackCamera.stackCameraAzimuth,
    'Dragging the canvas in stack view should orbit the stack-camera azimuth.',
  );
  assert.notEqual(
    draggedStackCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'Dragging the canvas in stack view should orbit the stack-camera elevation.',
  );
  assert.equal(
    draggedStackCamera.label,
    stackCameraLabel,
    'Dragging the stack-camera should not retarget the active workplane label state.',
  );
  assert.equal(
    draggedStackCamera.canReset,
    true,
    'Orbiting away from the default stack-camera should enable reset.',
  );

  await pressHistoryKey(context.page, 'history-back');
  const rewoundStackStage = await getStageState(context.page);
  const rewoundStackCamera = await getCameraState(context.page);
  const rewoundStackRoute = await getStageRouteState(context.page);

  assert.equal(
    rewoundStackStage.stageMode,
    '3d-mode',
    'History back should keep the stack-view mode when rewinding a stack-camera view sample.',
  );
  assert.equal(
    rewoundStackStage.activeWorkplaneId,
    'wp-2',
    'History back should keep the active workplane when rewinding a stack-camera view sample.',
  );
  assert.equal(
    rewoundStackCamera.stackCameraAzimuth,
    stackCamera.stackCameraAzimuth,
    'History back should restore the pre-drag stack-camera azimuth.',
  );
  assert.equal(
    rewoundStackCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'History back should restore the pre-drag stack-camera elevation.',
  );

  await pressHistoryKey(context.page, 'history-forward');
  const replayedStackCamera = await getCameraState(context.page);
  const replayedStackRoute = await getStageRouteState(context.page);

  assert.equal(
    replayedStackCamera.stackCameraAzimuth,
    draggedStackCamera.stackCameraAzimuth,
    'History forward should restore the dragged stack-camera azimuth.',
  );
  assert.equal(
    replayedStackCamera.stackCameraElevation,
    draggedStackCamera.stackCameraElevation,
    'History forward should restore the dragged stack-camera elevation.',
  );

  await navigateBrowserHistory(context.page, 'back', {
    expectedHistoryStep: rewoundStackRoute.historyStep,
  });
  const browserRewoundCamera = await getCameraState(context.page);

  assert.equal(
    browserRewoundCamera.stackCameraAzimuth,
    stackCamera.stackCameraAzimuth,
    'Browser back should replay the previous stage history step.',
  );
  assert.equal(
    browserRewoundCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'Browser back should restore the previous stack-camera elevation.',
  );

  await navigateBrowserHistory(context.page, 'forward', {
    expectedHistoryStep: replayedStackRoute.historyStep,
  });
  await waitForRouteHistoryStep(context.page, replayedStackRoute.historyStep);
  const browserReplayedCamera = await getCameraState(context.page);

  assert.equal(
    browserReplayedCamera.stackCameraAzimuth,
    draggedStackCamera.stackCameraAzimuth,
    'Browser forward should replay the next stage history step.',
  );
  assert.equal(
    browserReplayedCamera.stackCameraElevation,
    draggedStackCamera.stackCameraElevation,
    'Browser forward should restore the next stack-camera elevation.',
  );

  await pressNavigationKey(context.page, 'ArrowRight');
  const keyboardOrbitedCamera = await getCameraState(context.page);

  assert.equal(
    keyboardOrbitedCamera.label,
    stackCameraLabel,
    'Keyboard orbit in stack view should not retarget labels.',
  );
  assert.notEqual(
    keyboardOrbitedCamera.stackCameraAzimuth,
    draggedStackCamera.stackCameraAzimuth,
    'Arrow-right should continue orbiting the stack-camera in stack view.',
  );

  await pressPlaneStackKey(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 2});
  const selectedPreviousWorkplaneCamera = await getCameraState(context.page);
  assert.equal(
    selectedPreviousWorkplaneCamera.label,
    '2:2:1',
    'Selecting the previous workplane in stack view should restore that workplane camera memory.',
  );
  assert.equal(
    selectedPreviousWorkplaneCamera.stackCameraAzimuth,
    keyboardOrbitedCamera.stackCameraAzimuth,
    'Changing the active workplane should preserve the shared stack-camera orbit.',
  );
  assert.equal(
    selectedPreviousWorkplaneCamera.stackCameraElevation,
    keyboardOrbitedCamera.stackCameraElevation,
    'Changing the active workplane should preserve the shared stack-camera elevation.',
  );

  await pressStageModeKey(context.page);
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '2d-mode',
  );

  const returnedPlaneFocusStage = await getStageState(context.page);
  const returnedPlaneFocusRoute = await getStageRouteState(context.page);

  assert.equal(returnedPlaneFocusStage.stageMode, '2d-mode', 'Slash should return from stack view to plane-focus view.');
  assert.equal(returnedPlaneFocusStage.activeWorkplaneId, 'wp-1', 'Returning to plane-focus view should keep the selected workplane active.');
  assert.equal(returnedPlaneFocusRoute.stageMode, null, 'Returning to the default plane-focus route should clear the stageMode query param.');
  assert.equal(returnedPlaneFocusRoute.workplaneId, null, 'Returning to wp-1 should clear the default workplane query param.');
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'Returning to plane-focus view should restore the selected workplane camera target.',
  );
  assert.equal(
    (await readSelectionBoxState(context)).visible,
    true,
    'Returning to plane-focus view should restore the selection box.',
  );
  assert.equal(
    (await readLabelEditPanelState(context)).disabled,
    false,
    'Returning to plane-focus view should re-enable label editing.',
  );

  await submitFocusedLabelInput(context.page, 'Alpha replay');
  assert.equal(
    await readLabelEditInputValue(context),
    'Alpha replay',
    'Editing the focused label should update the label-edit input.',
  );

  await pressHistoryKey(context.page, 'history-back');
  assert.equal(
    await readLabelEditInputValue(context),
    '2:2:1',
    'History back should restore the previous label text.',
  );

  await pressHistoryKey(context.page, 'history-forward');
  assert.equal(
    await readLabelEditInputValue(context),
    'Alpha replay',
    'History forward should restore the edited label text.',
  );
}

async function readLabelEditPanelState(
  context: BrowserTestContext,
): Promise<LabelEditPanelState> {
  return context.page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="label-edit-panel"]');
    const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
    const submitButton = document.querySelector<HTMLButtonElement>('[data-testid="label-input-submit"]');

    return {
      disabled:
        !(input instanceof HTMLInputElement) ||
        !(submitButton instanceof HTMLButtonElement) ||
        input.disabled ||
        submitButton.disabled,
      visible:
        panel instanceof HTMLElement &&
        !panel.hidden &&
        window.getComputedStyle(panel).display !== 'none',
    };
  });
}

async function readLabelEditInputValue(
  context: BrowserTestContext,
): Promise<string> {
  return context.page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
    return input?.value ?? '';
  });
}

async function readSelectionBoxState(
  context: BrowserTestContext,
): Promise<SelectionBoxState> {
  return context.page.evaluate(() => {
    const selectionBox = document.querySelector<HTMLElement>('[data-testid="selection-box"]');

    return {
      label: selectionBox?.dataset.label ?? '',
      visible:
        selectionBox instanceof HTMLElement &&
        !selectionBox.hidden &&
        window.getComputedStyle(selectionBox).display !== 'none',
    };
  });
}

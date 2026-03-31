import assert from 'node:assert/strict';

import {
  getCameraState,
  getStageRouteState,
  getStageState,
  getTextState,
  openPersistedSessionRoute,
  pressHistoryKey,
  pressPlaneStackKey,
  pressStageModeKey,
  submitFocusedLabelInput,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createPreparedTwoWorkplaneSessionRecord} from './fixtures';

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
  const seededSession = createPreparedTwoWorkplaneSessionRecord('stk-view-modes');
  await openPersistedSessionRoute(context.page, context.url, seededSession, {
    historyTrackingEnabled: true,
    workplaneId: 'wp-1',
  });

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
  assert.equal(stackStage.activeWorkplaneId, 'wp-1', 'Entering stack view should keep the active workplane stable.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'Stack view should mirror its mode into the route.');
  assert.equal(stackRoute.workplaneId, null, 'Stack view should omit the default workplane from the route.');
  assert.equal(
    stackText.labelCount,
    planeFocusText.labelCount * 2,
    'Plane-focus view should keep rendering limited to the active workplane, while stack view should combine both workplanes.',
  );
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

  await pressPlaneStackKey(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});
  const selectedNextWorkplaneCamera = await getCameraState(context.page);
  assert.equal(
    selectedNextWorkplaneCamera.label,
    '3:3:1',
    'Selecting the next workplane in stack view should restore that workplane camera memory.',
  );
  assert.equal(
    selectedNextWorkplaneCamera.stackCameraAzimuth,
    stackCamera.stackCameraAzimuth,
    'Changing the active workplane should preserve the shared default stack-camera orbit.',
  );
  assert.equal(
    selectedNextWorkplaneCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'Changing the active workplane should preserve the shared default stack-camera elevation.',
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
    stackCamera.stackCameraAzimuth,
    'Changing the active workplane should preserve the shared default stack-camera orbit.',
  );
  assert.equal(
    selectedPreviousWorkplaneCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'Changing the active workplane should preserve the shared default stack-camera elevation.',
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
  await waitForLabelEditInputValue(context, 'Alpha');
  assert.equal(
    await readLabelEditInputValue(context),
    'Alpha',
    'History back should restore the previous label text.',
  );

  await pressHistoryKey(context.page, 'history-forward');
  await waitForLabelEditInputValue(context, 'Alpha replay');
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

async function waitForLabelEditInputValue(
  context: BrowserTestContext,
  expectedValue: string,
): Promise<void> {
  await context.page.waitForFunction(
    (value) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
      return input instanceof HTMLInputElement && input.value === value;
    },
    {},
    expectedValue,
  );
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

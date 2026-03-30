import assert from 'node:assert/strict';

import {
  type BrowserTestContext,
  FIRST_CHILD_LABEL,
  FIRST_ROOT_LABEL,
  assertCameraQueryClose,
  assertDemoChildLayerVisible,
  assertDemoRootLayerVisible,
  clickControl,
  getCameraQueryState,
  getCameraState,
  getLineState,
  getTextState,
  openRoute,
  pressNavigationKey,
  resetCamera,
  waitForBrowserUpdate,
  waitForCameraLabel,
} from './shared';

export async function runCameraControlsStep(
  context: BrowserTestContext,
): Promise<void> {
  const initialCamera = await getCameraState(context.page);
  const initialSelectionBox = await context.page.evaluate(() => {
    const selectionBox = document.querySelector<HTMLElement>('[data-testid="selection-box"]');
    const rect = selectionBox?.getBoundingClientRect();

    return {
      height: rect?.height ?? 0,
      label: selectionBox?.dataset.label ?? '',
      visible:
        selectionBox instanceof HTMLElement &&
        !selectionBox.hidden &&
        window.getComputedStyle(selectionBox).display !== 'none',
      width: rect?.width ?? 0,
    };
  });

  assert.equal(initialCamera.label, FIRST_ROOT_LABEL, 'Demo mode should start focused on 1:1:1.');
  assert.equal(initialCamera.layer, 1, 'Initial focus should start at the root layer.');
  assert.equal(initialCamera.canMoveLeft, false, 'Initial focus should not move left past column 1.');
  assert.equal(initialCamera.canMoveUp, false, 'Initial focus should not move up past row 1.');
  assert.equal(initialCamera.canZoomOut, false, 'Initial focus should not zoom out above layer 1.');
  assert.equal(initialCamera.canZoomIn, true, 'Initial focus should be able to zoom into layer 2.');
  assert.equal(initialSelectionBox.visible, true, 'The selected label should render a visible selection box.');
  assert.equal(initialSelectionBox.label, FIRST_ROOT_LABEL, 'The selection box should track the focused label.');
  assert.ok(initialSelectionBox.width > 0, 'The selection box should have a measurable width.');
  assert.ok(initialSelectionBox.height > 0, 'The selection box should have a measurable height.');

  await clickControl(context.page, 'zoom-in');
  await waitForCameraLabel(context.page, FIRST_CHILD_LABEL);

  const afterZoomIn = await getCameraState(context.page);
  assert.equal(afterZoomIn.label, FIRST_CHILD_LABEL, 'Zoom In should focus the child layer.');
  assert.equal(afterZoomIn.layer, 2, 'Zoom In should advance to layer 2.');
  assert.ok(afterZoomIn.zoom > initialCamera.zoom, 'Zoom In button should increase zoom.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: FIRST_CHILD_LABEL, centerX: null, centerY: null, zoom: null},
    'Zoom In should write the focused label into the URL.',
  );

  const textAfterZoomIn = await getTextState(context.page);
  assertDemoChildLayerVisible(
    textAfterZoomIn,
    'Zoom In should reveal the hidden child layer',
  );

  await clickControl(context.page, 'zoom-out');
  await waitForCameraLabel(context.page, FIRST_ROOT_LABEL);

  const afterZoomOut = await getCameraState(context.page);
  assert.equal(afterZoomOut.label, FIRST_ROOT_LABEL, 'Zoom Out should return to the root layer.');
  assert.equal(afterZoomOut.layer, 1, 'Zoom Out should return to layer 1.');
  assert.ok(afterZoomOut.zoom < afterZoomIn.zoom, 'Zoom Out button should decrease zoom.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: null, centerX: null, centerY: null, zoom: null},
    'Zoom Out should clear the label query param when it returns to the default label.',
  );

  const textAfterZoomOut = await getTextState(context.page);
  assertDemoRootLayerVisible(
    textAfterZoomOut,
    'Zoom Out should restore the root layer',
  );

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, '2:1:1');

  const afterPanRight = await getCameraState(context.page);
  assert.equal(afterPanRight.label, '2:1:1', 'Right should move to the next column on the same row.');
  assert.equal(afterPanRight.column, 2, 'Right should advance the column.');
  assert.equal(afterPanRight.row, 1, 'Right should stay on the same row.');
  assert.ok(
    afterPanRight.centerX > afterZoomOut.centerX,
    'Right pan control should move the camera center to the right.',
  );
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: '2:1:1', centerX: null, centerY: null, zoom: null},
    'Right should write the focused label into the URL.',
  );

  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '2:2:1');

  const afterPanDown = await getCameraState(context.page);
  assert.equal(afterPanDown.label, '2:2:1', 'Down should move to the next row on the same column.');
  assert.equal(afterPanDown.column, 2, 'Down should stay on the same column.');
  assert.equal(afterPanDown.row, 2, 'Down should advance the row.');
  assert.ok(afterPanDown.centerY < afterPanRight.centerY, 'Down should move the camera center lower.');
  const lineAfterPanDown = await getLineState(context.page);
  assert.ok(
    lineAfterPanDown.lineHighlightedInputLinkCount > 0,
    'Selecting 2:2:1 should brighten visible input links for that label.',
  );
  assert.ok(
    lineAfterPanDown.lineHighlightedOutputLinkCount > 0,
    'Selecting 2:2:1 should brighten visible output links for that label.',
  );
  assert.ok(
    lineAfterPanDown.lineDimmedLinkCount > 0,
    'Selecting 2:2:1 should continue dimming unrelated visible links.',
  );
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: '2:2:1', centerX: null, centerY: null, zoom: null},
    'Down should keep the focused label synchronized in the URL.',
  );

  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '2:3:1');
  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '2:4:1');

  const afterNoLinkSelection = await getCameraState(context.page);
  assert.equal(afterNoLinkSelection.label, '2:4:1', 'Down should continue moving through labels in the same column.');
  assert.equal(afterNoLinkSelection.column, 2, 'Selecting a no-link label should stay on column 2.');
  assert.equal(afterNoLinkSelection.row, 4, 'Selecting a no-link label should reach row 4.');
  const lineAfterNoLinkSelection = await getLineState(context.page);
  assert.ok(
    lineAfterNoLinkSelection.lineVisibleLinkCount > 0,
    'Selecting 2:4:1 should still keep the network visible in the viewport.',
  );
  assert.equal(
    lineAfterNoLinkSelection.lineHighlightedInputLinkCount,
    0,
    'Selecting 2:4:1 should not highlight any input links when that label has none.',
  );
  assert.equal(
    lineAfterNoLinkSelection.lineHighlightedOutputLinkCount,
    0,
    'Selecting 2:4:1 should not highlight any output links when that label has none.',
  );
  assert.equal(
    lineAfterNoLinkSelection.lineDimmedLinkCount,
    lineAfterNoLinkSelection.lineVisibleLinkCount,
    'Selecting 2:4:1 should dim every visible link when the label has no input or output links.',
  );

  await clickControl(context.page, 'pan-up');
  await waitForCameraLabel(context.page, '2:3:1');
  await clickControl(context.page, 'pan-up');
  await waitForCameraLabel(context.page, '2:2:1');
  await clickControl(context.page, 'pan-up');
  await waitForCameraLabel(context.page, '2:1:1');

  const afterPanUp = await getCameraState(context.page);
  assert.equal(afterPanUp.label, '2:1:1', 'Up should move to the previous row on the same column.');
  assert.equal(afterPanUp.column, 2, 'Up should stay on the same column.');
  assert.equal(afterPanUp.row, 1, 'Up should return to the prior row.');
  assert.ok(afterPanUp.centerY > afterPanDown.centerY, 'Up should move the camera center higher.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: '2:1:1', centerX: null, centerY: null, zoom: null},
    'Up should keep the focused label synchronized in the URL.',
  );

  await clickControl(context.page, 'pan-left');
  await waitForCameraLabel(context.page, FIRST_ROOT_LABEL);

  const afterPanLeft = await getCameraState(context.page);
  assert.equal(afterPanLeft.label, FIRST_ROOT_LABEL, 'Left should move to the previous column on the same row.');
  assert.equal(afterPanLeft.column, 1, 'Left should return to column 1.');
  assert.equal(afterPanLeft.row, 1, 'Left should stay on the same row.');
  assert.ok(afterPanLeft.centerX < afterPanUp.centerX, 'Left should move the camera center to the left.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: null, centerX: null, centerY: null, zoom: null},
    'Left should clear the label query param when it returns to the default label.',
  );

  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForCameraLabel(context.page, '2:1:1');

  const afterKeyboardRight = await getCameraState(context.page);
  assert.equal(afterKeyboardRight.label, '2:1:1', 'ArrowRight should move to the next column on the same row.');
  assert.equal(afterKeyboardRight.column, 2, 'ArrowRight should advance the column.');
  assert.equal(afterKeyboardRight.row, 1, 'ArrowRight should stay on the same row.');

  await pressNavigationKey(context.page, 'ArrowDown');
  await waitForCameraLabel(context.page, '2:2:1');

  const afterKeyboardDown = await getCameraState(context.page);
  assert.equal(afterKeyboardDown.label, '2:2:1', 'ArrowDown should move to the next row on the same column.');
  assert.equal(afterKeyboardDown.column, 2, 'ArrowDown should stay on the same column.');
  assert.equal(afterKeyboardDown.row, 2, 'ArrowDown should advance the row.');

  await pressNavigationKey(context.page, 'ArrowUp', {shift: true});
  await waitForCameraLabel(context.page, '2:2:2');

  const afterShiftArrowUp = await getCameraState(context.page);
  assert.equal(afterShiftArrowUp.label, '2:2:2', 'Shift+ArrowUp should zoom into the next layer.');
  assert.equal(afterShiftArrowUp.layer, 2, 'Shift+ArrowUp should advance the layer.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: '2:2:2', centerX: null, centerY: null, zoom: null},
    'Shift+ArrowUp should synchronize the focused label in the URL.',
  );

  await pressNavigationKey(context.page, 'ArrowDown', {shift: true});
  await waitForCameraLabel(context.page, '2:2:1');

  const afterShiftArrowDown = await getCameraState(context.page);
  assert.equal(afterShiftArrowDown.label, '2:2:1', 'Shift+ArrowDown should zoom back to the prior layer.');
  assert.equal(afterShiftArrowDown.layer, 1, 'Shift+ArrowDown should return to layer 1.');

  await resetCamera(context.page);

  const afterReset = await getCameraState(context.page);
  assert.equal(afterReset.label, FIRST_ROOT_LABEL, 'Reset should restore the default label.');
  assert.equal(afterReset.column, 1, 'Reset should restore column 1.');
  assert.equal(afterReset.row, 1, 'Reset should restore row 1.');
  assert.equal(afterReset.layer, 1, 'Reset should restore layer 1.');
  assert.equal(afterReset.zoom, 0, 'Reset control should restore zoom.');
  assert.deepEqual(
    await getCameraQueryState(context.page),
    {label: null, centerX: null, centerY: null, zoom: null},
    'Reset should clear camera query params from the URL.',
  );

  const textAfterReset = await getTextState(context.page);
  assertDemoRootLayerVisible(textAfterReset, 'Reset should restore the initial zoom-band visibility');

  await clickControl(context.page, 'zoom-out');
  await waitForBrowserUpdate(context.page);
  assert.equal(
    (await getCameraState(context.page)).label,
    FIRST_ROOT_LABEL,
    'Zoom Out should stop at the root layer.',
  );

  await resetCamera(context.page);

  const seededCameraUrl = new URL(context.url);
  seededCameraUrl.searchParams.set('cameraLabel', '3:4:2');

  await openRoute(context.page, seededCameraUrl.toString());

  const seededCamera = await getCameraState(context.page);
  assert.equal(seededCamera.label, '3:4:2', 'cameraLabel should seed the focused label.');
  assert.equal(seededCamera.column, 3, 'cameraLabel should seed the correct column.');
  assert.equal(seededCamera.row, 4, 'cameraLabel should seed the correct row.');
  assert.equal(seededCamera.layer, 2, 'cameraLabel should seed the correct layer.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {label: '3:4:2', centerX: null, centerY: null, zoom: null},
    'Seeded cameraLabel routes should preserve the focused label in the URL.',
  );

  await openRoute(context.page, context.url);
}

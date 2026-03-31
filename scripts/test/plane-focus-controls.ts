import assert from 'node:assert/strict';

import {
  assertDemoChildLayerVisible,
  assertDemoRootLayerVisible,
  clickControl,
  getCameraState,
  getTextState,
  openRoute,
  waitForCameraLabel,
  type BrowserTestContext,
} from './shared';

export async function runPlaneFocusControlsFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, context.url);

  await clickControl(context.page, 'zoom-in');
  await waitForCameraLabel(context.page, '1:1:2');

  const zoomedInText = await getTextState(context.page);
  assertDemoChildLayerVisible(
    zoomedInText,
    'Plane-focus controls should reveal the child layer after zoom-in.',
  );

  await clickControl(context.page, 'zoom-out');
  await waitForCameraLabel(context.page, '1:1:1');

  const zoomedOutText = await getTextState(context.page);
  assertDemoRootLayerVisible(
    zoomedOutText,
    'Plane-focus controls should restore the root layer after zoom-out.',
  );

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, '2:1:1');
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:1:1',
    'Plane-focus controls should move right in 2d mode.',
  );

  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '2:2:1');
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'Plane-focus controls should move down in 2d mode.',
  );
}

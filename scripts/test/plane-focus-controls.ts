import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  assertDemoChildLayerVisible,
  assertDemoRootLayerVisible,
  buildClassicDemoUrl,
  captureInteractionScreenshot,
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
  await openRoute(context.page, buildClassicDemoUrl(context.url));
  await captureInteractionScreenshot(context, 'plane-focus-initial');

  await clickControl(context.page, 'zoom-in');
  await waitForCameraLabel(context.page, buildLabelKey('wp-1', 2, 1, 1));

  const zoomedInText = await getTextState(context.page);
  assertDemoChildLayerVisible(
    zoomedInText,
    'Plane-focus controls should reveal the child layer after zoom-in.',
  );
  await captureInteractionScreenshot(context, 'plane-focus-zoom-in');

  await clickControl(context.page, 'zoom-out');
  await waitForCameraLabel(context.page, buildLabelKey('wp-1', 1, 1, 1));

  const zoomedOutText = await getTextState(context.page);
  assertDemoRootLayerVisible(
    zoomedOutText,
    'Plane-focus controls should restore the root layer after zoom-out.',
  );
  await captureInteractionScreenshot(context, 'plane-focus-zoom-out');

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, buildLabelKey('wp-1', 1, 1, 2));
  assert.equal(
    (await getCameraState(context.page)).label,
    buildLabelKey('wp-1', 1, 1, 2),
    'Plane-focus controls should move right in 2d mode.',
  );
  await captureInteractionScreenshot(context, 'plane-focus-pan-right');

  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, buildLabelKey('wp-1', 1, 2, 2));
  assert.equal(
    (await getCameraState(context.page)).label,
    buildLabelKey('wp-1', 1, 2, 2),
    'Plane-focus controls should move down in 2d mode.',
  );
  await captureInteractionScreenshot(context, 'plane-focus-pan-down');
}

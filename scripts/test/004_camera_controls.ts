import assert from 'node:assert/strict';

import {
  type BrowserTestContext,
  assertCameraQueryClose,
  assertCameraStateClose,
  assertDemoChildLayerVisible,
  assertDemoRootLayerVisible,
  clickControl,
  clickControlRepeatedly,
  getCameraQueryState,
  getCameraState,
  getTextState,
  openRoute,
  resetCamera,
} from './shared';

export async function runCameraControlsStep(
  context: BrowserTestContext,
): Promise<void> {
  const initialCamera = await getCameraState(context.page);

  await clickControlRepeatedly(context.page, 'zoom-in', 4);
  await context.page.waitForFunction(
    ({zoom}) => Number(document.body.dataset.cameraZoom) > zoom,
    {},
    {zoom: initialCamera.zoom},
  );

  const afterZoomIn = await getCameraState(context.page);
  assert.ok(afterZoomIn.zoom > initialCamera.zoom, 'Zoom In button should increase zoom.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {centerX: null, centerY: null, zoom: afterZoomIn.zoom},
    'Zoom In should write the current camera zoom into the URL.',
  );

  const textAfterZoomIn = await getTextState(context.page);
  assertDemoChildLayerVisible(
    textAfterZoomIn,
    'Zoom In should reveal the hidden child layer',
  );

  await clickControlRepeatedly(context.page, 'zoom-out', 4);
  await context.page.waitForFunction(() => Number(document.body.dataset.cameraZoom) === 0);

  const afterZoomOut = await getCameraState(context.page);
  assert.ok(afterZoomOut.zoom < afterZoomIn.zoom, 'Zoom Out button should decrease zoom.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {centerX: null, centerY: null, zoom: null},
    'Zoom Out should keep the URL camera params aligned with the current view.',
  );

  const textAfterZoomOut = await getTextState(context.page);
  assertDemoRootLayerVisible(
    textAfterZoomOut,
    'Zoom Out should restore the root layer',
  );

  await clickControl(context.page, 'pan-right');
  await context.page.waitForFunction(
    ({centerX}) => Number(document.body.dataset.cameraCenterX) !== centerX,
    {},
    {centerX: afterZoomOut.centerX},
  );

  const afterPanRight = await getCameraState(context.page);
  assert.ok(
    afterPanRight.centerX > afterZoomOut.centerX,
    'Right pan control should move the camera center to the right.',
  );
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {centerX: afterPanRight.centerX, centerY: null, zoom: null},
    'Pan Right should write the current camera centerX into the URL.',
  );

  await clickControl(context.page, 'pan-up');
  await context.page.waitForFunction(
    ({centerY}) => Number(document.body.dataset.cameraCenterY) !== centerY,
    {},
    {centerY: afterPanRight.centerY},
  );

  const afterPanUp = await getCameraState(context.page);
  assert.ok(afterPanUp.centerY > afterPanRight.centerY, 'Up pan control should increase centerY.');
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {centerX: afterPanUp.centerX, centerY: afterPanUp.centerY, zoom: null},
    'Pan Up should keep the full camera view synchronized in the URL.',
  );

  await resetCamera(context.page);

  const afterReset = await getCameraState(context.page);
  assert.equal(afterReset.centerX, 0, 'Reset control should restore centerX.');
  assert.equal(afterReset.centerY, 0, 'Reset control should restore centerY.');
  assert.equal(afterReset.zoom, 0, 'Reset control should restore zoom.');
  assert.deepEqual(
    await getCameraQueryState(context.page),
    {centerX: null, centerY: null, zoom: null},
    'Reset should clear camera query params from the URL.',
  );

  const textAfterReset = await getTextState(context.page);
  assertDemoRootLayerVisible(textAfterReset, 'Reset should restore the initial zoom-band visibility');

  await clickControl(context.page, 'zoom-out');
  await context.page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  assert.equal(
    (await getCameraState(context.page)).zoom,
    0,
    'Zoom Out should stop at the camera floor of 0.',
  );

  await resetCamera(context.page);

  const seededCameraUrl = new URL(context.url);
  seededCameraUrl.searchParams.set('cameraCenterX', '1.25');
  seededCameraUrl.searchParams.set('cameraCenterY', '-2.5');
  seededCameraUrl.searchParams.set('cameraZoom', '0.75');

  await openRoute(context.page, seededCameraUrl.toString());

  const seededCamera = await getCameraState(context.page);
  assertCameraStateClose(
    seededCamera,
    {centerX: 1.25, centerY: -2.5, zoom: 0.75},
    'Camera query params should seed the initial camera view.',
  );
  assertCameraQueryClose(
    await getCameraQueryState(context.page),
    {centerX: seededCamera.centerX, centerY: seededCamera.centerY, zoom: seededCamera.zoom},
    'Seeded camera routes should preserve the current camera view in the URL.',
  );

  await openRoute(context.page, context.url);
}

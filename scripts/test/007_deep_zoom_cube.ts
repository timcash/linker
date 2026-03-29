import assert from 'node:assert/strict';

import {getDemoLabelSetId} from '../../src/data/demo-meta';
import {
  MAX_DEMO_LAYER_COUNT,
  getDemoLabelCount,
} from '../../src/data/labels';
import {
  FIRST_ROOT_LABEL,
  type BrowserTestContext,
  clickControl,
  getCameraState,
  getTextState,
  openRoute,
  waitForBrowserUpdate,
  waitForCameraLabel,
  waitForCameraSettled,
} from './shared';

export async function runDeepZoomCubeStep(
  context: BrowserTestContext,
): Promise<void> {
  const deepZoomUrl = new URL(context.url);
  deepZoomUrl.searchParams.set('demoLayers', String(MAX_DEMO_LAYER_COUNT));

  await openRoute(context.page, deepZoomUrl.toString());

  const initialText = await getTextState(context.page);
  assert.equal(
    initialText.labelCount,
    getDemoLabelCount(MAX_DEMO_LAYER_COUNT),
    'Deep-zoom demo route should build the full 12x12x12 label cube.',
  );
  assert.equal(
    initialText.labelSetPreset,
    getDemoLabelSetId(MAX_DEMO_LAYER_COUNT),
    'Deep-zoom demo route should report a 12-layer label-set preset.',
  );

  const initialCamera = await getCameraState(context.page);
  assert.equal(
    initialCamera.label,
    FIRST_ROOT_LABEL,
    'Deep-zoom demo route should still start at the first root label.',
  );
  assert.equal(initialCamera.layer, 1, 'Deep-zoom demo route should start at layer 1.');
  assert.equal(initialCamera.canZoomIn, true, 'Deep-zoom demo route should allow zooming deeper.');

  for (let layer = 2; layer <= MAX_DEMO_LAYER_COUNT; layer += 1) {
    const expectedLabel = `1:1:${layer}`;

    await clickControl(context.page, 'zoom-in');
    await waitForCameraLabel(context.page, expectedLabel);

    const camera = await getCameraState(context.page);
    assert.equal(camera.label, expectedLabel, `Zoom In should advance focus to ${expectedLabel}.`);
    assert.equal(camera.layer, layer, `Zoom In should advance the camera to layer ${layer}.`);
    assert.ok(
      Math.abs(camera.zoom - getExpectedDemoLayerZoom(layer)) <= 0.0001,
      `Layer ${layer} should settle at zoom ${getExpectedDemoLayerZoom(layer)}.`,
    );
  }

  await clickControl(context.page, 'zoom-in');
  await waitForBrowserUpdate(context.page);
  await waitForCameraSettled(context.page);

  const deepZoomCamera = await getCameraState(context.page);
  assert.equal(
    deepZoomCamera.label,
    `1:1:${MAX_DEMO_LAYER_COUNT}`,
    'The last layer should stay focused while zooming deeper than the explicit label stack.',
  );
  assert.equal(
    deepZoomCamera.layer,
    MAX_DEMO_LAYER_COUNT,
    'Infinite zoom should keep the deepest explicit layer active.',
  );
  assert.ok(
    deepZoomCamera.zoom > getExpectedDemoLayerZoom(MAX_DEMO_LAYER_COUNT),
    'One more zoom-in should continue past the deepest explicit layer zoom.',
  );
  assert.equal(
    deepZoomCamera.canZoomIn,
    true,
    'Infinite zoom should keep the zoom-in control available at the deepest explicit layer.',
  );

  context.addBrowserLog(
    'test',
    `Deep zoom cube verified labelCount=${initialText.labelCount} label=${deepZoomCamera.label} zoom=${deepZoomCamera.zoom.toFixed(2)}`,
  );

  await openRoute(context.page, context.url);
}

function getExpectedDemoLayerZoom(layer: number): number {
  if (layer <= 1) {
    return 0;
  }

  if (layer === 2) {
    return 2;
  }

  return layer;
}

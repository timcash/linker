import assert from 'node:assert/strict';

import {
  DEMO_LABEL_COUNT,
  DEMO_LABEL_SET_ID,
  FIRST_ROOT_LABEL,
  type BrowserTestContext,
  type ReadyResult,
  assertDemoRootLayerVisible,
  getCameraQueryState,
  getCanvasPixelSignature,
  getStageRouteState,
  openRoute,
  readAppResult,
  waitForBrowserUpdate,
} from './shared';

export async function runBootFlow(
  context: BrowserTestContext,
): Promise<ReadyResult | null> {
  const {page, pageErrors} = context;

  await openRoute(page, context.url);

  assert.deepEqual(
    pageErrors,
    [],
    `Boot flow should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
  );

  const result = await readAppResult(page);

  assert.notEqual(
    result.state,
    'error',
    `App entered error state: ${'message' in result ? result.message : 'unknown error'}`,
  );

  if (result.state !== 'ready' || !('width' in result)) {
    context.addBrowserLog('test', 'App reached unsupported state.');
    assert.equal(result.state, 'unsupported', 'Expected either a ready or unsupported app state.');
    assert.match(result.message, /webgpu/i, 'Unsupported state should explain the WebGPU requirement.');
    return null;
  }

  assert.equal(result.width, result.innerWidth, 'Canvas should fill the viewport width.');
  assert.equal(result.height, result.innerHeight, 'Canvas should fill the viewport height.');
  assert.ok(result.camera.lineCount > 0, 'Plane-focus view should render grid geometry.');
  assert.ok(
    result.camera.majorSpacing > result.camera.minorSpacing,
    'Grid major spacing should remain larger than minor spacing.',
  );
  assert.equal(result.stage.stageMode, '2d-mode', 'Default boot should start in plane-focus view.');
  assert.equal(result.stage.planeCount, 1, 'Default boot should start with one workplane.');
  assert.equal(result.stage.activeWorkplaneId, 'wp-1', 'Default boot should start on wp-1.');
  assert.equal(
    result.stage.workplaneCanDelete,
    false,
    'Default boot should block deleting the only workplane.',
  );
  assert.equal(result.text.labelSetPreset, DEMO_LABEL_SET_ID, 'Default boot should use the demo label set.');
  assert.equal(result.text.labelCount, DEMO_LABEL_COUNT, 'Default boot should build the full demo label set.');
  assert.ok(result.text.glyphCount > 0, 'Default boot should generate glyph geometry.');
  assert.ok(result.text.visibleGlyphCount > 0, 'Default boot should render visible glyphs.');
  assert.equal(result.camera.label, FIRST_ROOT_LABEL, 'Default boot should focus the first root label.');
  assertDemoRootLayerVisible(result.text, 'Boot flow');
  assert.equal(
    await isSelectionBoxVisible(context),
    true,
    'Plane-focus view should show the selection box at boot.',
  );
  assert.deepEqual(
    await getCameraQueryState(page),
    {label: FIRST_ROOT_LABEL},
    'Default boot should mirror the focused label into the route.',
  );
  assert.deepEqual(
    await getStageRouteState(page),
    {stageMode: '2d-mode', workplaneId: 'wp-1'},
    'Default boot should mirror stage mode and workplane into the route.',
  );

  const initialSignature = await getCanvasPixelSignature(page);
  await openRoute(page, context.url);
  await waitForBrowserUpdate(page);
  assert.deepEqual(
    await getCanvasPixelSignature(page),
    initialSignature,
    'Reopening the same boot route should keep the render output stable.',
  );

  return result;
}

async function isSelectionBoxVisible(
  context: BrowserTestContext,
): Promise<boolean> {
  return context.page.evaluate(() => {
    const selectionBox = document.querySelector('[data-testid="selection-box"]');

    return (
      selectionBox instanceof HTMLElement &&
      !selectionBox.hidden &&
      window.getComputedStyle(selectionBox).display !== 'none'
    );
  });
}

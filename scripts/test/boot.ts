import assert from 'node:assert/strict';

import {
  DAG_RANK_FANOUT_EDGE_COUNT,
  DAG_RANK_FANOUT_LAYOUT_FINGERPRINT,
  DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
  DAG_RANK_FANOUT_WORKPLANE_ORDER,
  getDagRankFanoutFocusLabelKey,
} from '../../src/data/dag-rank-fanout';
import {
  DEMO_LABEL_SET_ID,
  captureInteractionScreenshot,
  type BrowserTestContext,
  type ReadyResult,
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
  const route = context.url;

  await openRoute(page, route);

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
  assert.ok(
    result.canvasWidth >= result.width,
    'Canvas backing width should be at least as large as the visible width at boot.',
  );
  assert.ok(
    result.canvasHeight >= result.height,
    'Canvas backing height should be at least as large as the visible height at boot.',
  );
  assert.equal(result.stage.stageMode, '3d-mode', 'Default boot should start in DAG overview mode.');
  assert.equal(
    result.stage.planeCount,
    DAG_RANK_FANOUT_WORKPLANE_ORDER.length,
    'Default boot should start on the full twelve-workplane DAG dataset.',
  );
  assert.equal(
    result.stage.activeWorkplaneId,
    DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
    'Default boot should start on the DAG root workplane.',
  );
  assert.equal(
    result.stage.dagRootWorkplaneId,
    DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
    'Default boot should expose the DAG root workplane id.',
  );
  assert.equal(
    result.stage.dagNodeCount,
    DAG_RANK_FANOUT_WORKPLANE_ORDER.length,
    'Default boot should expose all twelve DAG workplanes.',
  );
  assert.equal(
    result.stage.dagEdgeCount,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Default boot should expose the authored dependency count.',
  );
  assert.equal(
    result.stage.dagLayoutFingerprint,
    DAG_RANK_FANOUT_LAYOUT_FINGERPRINT,
    'Default boot should keep the stable twelve-workplane layout fingerprint.',
  );
  assert.equal(
    result.stage.workplaneCanDelete,
    true,
    'Default boot should allow deletion because the default DAG has more than one workplane.',
  );
  assert.equal(result.text.labelSetPreset, DEMO_LABEL_SET_ID, 'Default boot should use the demo label set.');
  assert.ok(result.text.glyphCount > 0, 'Default boot should generate glyph geometry.');
  assert.ok(result.text.visibleGlyphCount > 0, 'Default boot should render visible glyphs.');
  assert.equal(
    result.camera.label,
    getDagRankFanoutFocusLabelKey(DAG_RANK_FANOUT_ROOT_WORKPLANE_ID),
    'Default boot should keep the root workplane focus label active.',
  );
  assert.equal(
    result.stage.renderBridgeLinkCount,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Default boot should render the full DAG dependency set in 3d mode.',
  );
  assert.equal(
    result.stage.dagVisibleEdgeCount,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Default boot should expose the visible DAG edge count for the default overview.',
  );
  assert.equal(
    result.stage.dagFullWorkplaneCount +
      result.stage.dagLabelPointWorkplaneCount +
      result.stage.dagTitleOnlyWorkplaneCount +
      result.stage.dagGraphPointWorkplaneCount,
    result.stage.planeCount,
    'Default boot should account for every visible workplane in exactly one DAG LOD bucket.',
  );
  assert.equal(
    await isSelectionBoxVisible(context),
    false,
    'Default 3d boot should not show the plane-focus selection box.',
  );
  assert.deepEqual(
    await getCameraQueryState(page),
    {label: getDagRankFanoutFocusLabelKey(DAG_RANK_FANOUT_ROOT_WORKPLANE_ID)},
    'Default boot should mirror the focused label into the route.',
  );
  assert.deepEqual(
    await getStageRouteState(page),
    {stageMode: '3d-mode', workplaneId: DAG_RANK_FANOUT_ROOT_WORKPLANE_ID},
    'Default boot should mirror stage mode and workplane into the route.',
  );
  assert.equal(
    await page.evaluate(() => new URL(window.location.href).searchParams.get('demoPreset')),
    'dag-rank-fanout',
    'Default boot should persist the authored DAG preset into the route.',
  );
  await captureInteractionScreenshot(context, 'boot-ready');

  const initialSignature = await getCanvasPixelSignature(page);
  await openRoute(page, route);
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

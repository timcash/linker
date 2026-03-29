import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
  DEMO_LABEL_COUNT,
  DEMO_LABEL_SET_ID,
  ERROR_PING_TOKEN,
  FIRST_ROOT_LABEL,
  INTENTIONAL_ERROR_MARKER,
  type BrowserTestContext,
  type ReadyResult,
  assertDemoRootLayerVisible,
  getCameraQueryState,
  openRoute,
  readAppResult,
  waitForCondition,
} from './shared';

export async function runReadyStep(
  context: BrowserTestContext,
): Promise<ReadyResult | null> {
  const {logPath, page, pageErrors} = context;

  await openRoute(page, context.url);

  assert.equal(
    pageErrors.length,
    0,
    'Page should reach ready state without unexpected browser errors.',
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

  context.addBrowserLog('test', 'App reached ready state.');

  context.addBrowserLog('test', 'Starting error ping test.');
  await page.evaluate((token: string) => {
    queueMicrotask(() => {
      throw new Error(token);
    });
  }, ERROR_PING_TOKEN);

  await waitForCondition(
    () => pageErrors.some((message) => message.includes(ERROR_PING_TOKEN)),
    5_000,
    'expected browser error ping',
  );

  await context.flushBrowserLog();

  const logContents = await readFile(logPath, 'utf8');
  assert.equal(
    logContents.includes(`${INTENTIONAL_ERROR_MARKER} Error: Uncaught Error: ${ERROR_PING_TOKEN}`),
    true,
    'test.log should contain the intentional error ping marker.',
  );

  const unexpectedPageErrors = pageErrors.filter(
    (message) => !message.includes(ERROR_PING_TOKEN),
  );
  assert.deepEqual(
    unexpectedPageErrors,
    [],
    `Unexpected browser errors were captured: ${unexpectedPageErrors.join('\n\n')}`,
  );
  context.addBrowserLog('test', 'Error ping test passed.');

  assert.equal(result.width, result.innerWidth, 'Canvas should fill the viewport width.');
  assert.equal(result.height, result.innerHeight, 'Canvas should fill the viewport height.');
  assert.ok(result.camera.lineCount > 0, 'Grid should render visible line geometry.');
  assert.ok(
    result.camera.majorSpacing > result.camera.minorSpacing,
    'Major grid spacing should be larger than minor spacing.',
  );
  assert.equal(
    result.text.labelCount,
    DEMO_LABEL_COUNT,
    'Demo route should build the full default demo label set.',
  );
  assert.ok(result.text.glyphCount > 0, 'At least one text glyph should be generated.');
  assert.equal(
    result.text.labelSetPreset,
    DEMO_LABEL_SET_ID,
    'Demo route should report the default demo label-set preset.',
  );
  assert.equal(result.camera.label, FIRST_ROOT_LABEL, 'Default route should focus the first root label.');
  assertDemoRootLayerVisible(result.text, 'Zoom 0');
  assert.ok(
    result.text.visibleGlyphCount > 0,
    'At least one text glyph should be visible in the viewport.',
  );
  assert.deepEqual(
    await getCameraQueryState(page),
    {label: null, centerX: null, centerY: null, zoom: null},
    'Default route should omit camera query params.',
  );

  return result;
}

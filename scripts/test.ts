import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import puppeteer, {
  type Browser,
  type ConsoleMessage,
  type HTTPRequest,
  type HTTPResponse,
  type Page
} from 'puppeteer';
import {createServer} from 'vite';

import {Camera2D, type ViewportSize} from '../src/camera';

type ReadyResult = {
  state: 'ready';
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  camera: CameraState;
  text: TextState;
};

type NonReadyResult = {
  state: string;
  message: string;
};

type CameraState = {
  centerX: number;
  centerY: number;
  zoom: number;
  scale: number;
  lineCount: number;
  minorSpacing: number;
  majorSpacing: number;
};

type TextState = {
  labelCount: number;
  glyphCount: number;
  visibleLabelCount: number;
  visibleLabels: string;
  visibleGlyphCount: number;
};

type BenchmarkState = {
  cpuDrawAvgMs: number;
  cpuFrameAvgMs: number;
  cpuFrameSamples: number;
  cpuTextAvgMs: number;
  datasetName: string;
  error: string;
  gpuFrameAvgMs: number | null;
  gpuFrameSamples: number;
  gpuSupported: boolean;
  gpuTimingEnabled: boolean;
  labelCount: number;
  requestedLabelCount: number;
  state: string;
  visibleGlyphCount: number;
  visibleLabelCount: number;
};

const logPath = path.resolve(process.cwd(), 'browser.log');
const screenshotPath = path.resolve(process.cwd(), 'browser.png');
const browserLogLines: string[] = [];
const ERROR_PING_TOKEN = 'ERROR_PING_TEST';
const INTENTIONAL_ERROR_MARKER = '[intentional-error-ping]';

await writeFile(logPath, '', 'utf8');

runCameraUnitTests();

function addBrowserLog(kind: string, message: string): void {
  const timestamp = new Date().toISOString();
  browserLogLines.push(`[${timestamp}] [${kind}] ${message}`);
}

const server = await createServer({
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});

let browser: Browser | undefined;
let page: Page | undefined;
let testError: Error | undefined;

try {
  await server.listen();

  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4173/';

  addBrowserLog('test', `Starting browser test for ${url}`);

  browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    defaultViewport: {width: 1280, height: 800},
    args: [
      '--enable-unsafe-webgpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  page = await browser.newPage();
  const pageErrors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    const location = message.location();
    const suffix = location.url
      ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
      : '';
    addBrowserLog(`console.${message.type()}`, `${message.text()}${suffix}`);
  });

  page.on('pageerror', (error) => {
    const pageErrorValue = error instanceof Error ? error : new Error(String(error));
    const message = pageErrorValue.stack ?? pageErrorValue.message;
    pageErrors.push(message);
    if (message.includes(ERROR_PING_TOKEN)) {
      addBrowserLog('pageerror.intentional', `${INTENTIONAL_ERROR_MARKER} ${message}`);
      return;
    }

    addBrowserLog('pageerror', message);
  });

  page.on('error', (error) => {
    addBrowserLog('error', error.stack ?? error.message);
  });

  page.on('requestfailed', (request: HTTPRequest) => {
    const failure = request.failure();
    addBrowserLog(
      'requestfailed',
      `${request.method()} ${request.url()}${failure ? ` :: ${failure.errorText}` : ''}`,
    );
  });

  page.on('response', (response: HTTPResponse) => {
    if (response.status() >= 400) {
      addBrowserLog('response.error', `${response.status()} ${response.url()}`);
    }
  });

  await page.goto(url, {waitUntil: 'networkidle0'});
  await waitForAppDatasets(page);

  assert.equal(
    pageErrors.length,
    0,
    'Page should reach ready state without unexpected browser errors.',
  );

  const result = await page.evaluate((): ReadyResult | NonReadyResult => {
    const state = document.body.dataset.appState ?? 'missing';
    const canvas = document.querySelector('[data-testid="gpu-canvas"]');
    const message = document.querySelector('[data-testid="app-message"]');

    if (state === 'ready' && canvas instanceof HTMLCanvasElement) {
      const rect = canvas.getBoundingClientRect();

      return {
        state,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        camera: {
          centerX: Number(document.body.dataset.cameraCenterX ?? '0'),
          centerY: Number(document.body.dataset.cameraCenterY ?? '0'),
          zoom: Number(document.body.dataset.cameraZoom ?? '0'),
          scale: Number(document.body.dataset.cameraScale ?? '0'),
          lineCount: Number(document.body.dataset.gridLineCount ?? '0'),
          minorSpacing: Number(document.body.dataset.gridMinorSpacing ?? '0'),
          majorSpacing: Number(document.body.dataset.gridMajorSpacing ?? '0'),
        },
        text: {
          labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
          glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
          visibleLabelCount: Number(document.body.dataset.textVisibleLabelCount ?? '0'),
          visibleLabels: document.body.dataset.textVisibleLabels ?? '',
          visibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
        },
      };
    }

    return {
      state,
      message: message?.textContent?.trim() ?? '',
    };
  });

  assert.notEqual(
    result.state,
    'error',
    `App entered error state: ${'message' in result ? result.message : 'unknown error'}`,
  );

  if (result.state === 'ready' && 'width' in result) {
    addBrowserLog('test', 'App reached ready state.');

    addBrowserLog('test', 'Starting error ping test.');
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

    await flushBrowserLog();

    const logContents = await readFile(logPath, 'utf8');
    assert.equal(
      logContents.includes(`${INTENTIONAL_ERROR_MARKER} Error: Uncaught Error: ${ERROR_PING_TOKEN}`),
      true,
      'browser.log should contain the intentional error ping marker.',
    );

    const unexpectedPageErrors = pageErrors.filter(
      (message) => !message.includes(ERROR_PING_TOKEN),
    );
    assert.deepEqual(
      unexpectedPageErrors,
      [],
      `Unexpected browser errors were captured: ${unexpectedPageErrors.join('\n\n')}`,
    );
    addBrowserLog('test', 'Error ping test passed.');

    assert.equal(result.width, result.innerWidth, 'Canvas should fill the viewport width.');
    assert.equal(result.height, result.innerHeight, 'Canvas should fill the viewport height.');
    assert.ok(result.camera.lineCount > 0, 'Grid should render visible line geometry.');
    assert.ok(
      result.camera.majorSpacing > result.camera.minorSpacing,
      'Major grid spacing should be larger than minor spacing.',
    );
    assert.ok(result.text.labelCount > 0, 'At least one text label should be laid out.');
    assert.ok(result.text.glyphCount > 0, 'At least one text glyph should be generated.');
    assert.ok(result.text.visibleLabelCount > 0, 'At least one text label should be visible.');
    assert.ok(
      result.text.visibleGlyphCount > 0,
      'At least one text glyph should be visible in the viewport.',
    );
    assert.match(result.text.visibleLabels, /BUTTON PAN/, 'BUTTON PAN should be visible at zoom 0.');
    assert.doesNotMatch(
      result.text.visibleLabels,
      /LUMA TEXT/,
      'LUMA TEXT should be hidden until the zoom reaches its minimum.',
    );

    const readyUiState = await page.evaluate(() => {
      const message = document.querySelector('[data-testid="app-message"]');
      const controls = document.querySelector('[data-testid="button-panel"]');
      const statusPanel = document.querySelector('[data-testid="status-panel"]');
      const controlsRect = controls instanceof HTMLElement ? controls.getBoundingClientRect() : null;
      const statusRect = statusPanel instanceof HTMLElement ? statusPanel.getBoundingClientRect() : null;

      return {
        messageHiddenProperty: message instanceof HTMLElement ? message.hidden : false,
        messageDisplay: message instanceof HTMLElement ? window.getComputedStyle(message).display : '',
        controlsVisible:
          controls instanceof HTMLElement && window.getComputedStyle(controls).display !== 'none',
        controlsRightGap: controlsRect ? Math.round(window.innerWidth - controlsRect.right) : -1,
        controlsBottomGap: controlsRect ? Math.round(window.innerHeight - controlsRect.bottom) : -1,
        statusLeftGap: statusRect ? Math.round(statusRect.left) : -1,
        statusTopGap: statusRect ? Math.round(statusRect.top) : -1,
      };
    });

    assert.equal(
      readyUiState.messageHiddenProperty,
      true,
      'Ready state should hide the startup message.',
    );
    assert.equal(
      readyUiState.messageDisplay,
      'none',
      'Ready state should remove the startup message from layout.',
    );
    assert.equal(readyUiState.controlsVisible, true, 'Button panel should be visible.');
    assert.ok(
      readyUiState.statusLeftGap >= 0 && readyUiState.statusLeftGap <= 32,
      'Status panel should sit near the left edge.',
    );
    assert.ok(
      readyUiState.statusTopGap >= 0 && readyUiState.statusTopGap <= 32,
      'Status panel should sit near the top edge.',
    );
    assert.ok(
      readyUiState.controlsRightGap >= 0 && readyUiState.controlsRightGap <= 32,
      'Button panel should sit near the right edge.',
    );
    assert.ok(
      readyUiState.controlsBottomGap >= 0 && readyUiState.controlsBottomGap <= 32,
      'Button panel should sit near the bottom edge.',
    );

    const initialCamera = result.camera;

    await clickControl(page, 'zoom-in');
    await page.waitForFunction(
      ({zoom}) => Number(document.body.dataset.cameraZoom) > zoom,
      {},
      {zoom: initialCamera.zoom},
    );

    const afterZoomIn = await getCameraState(page);
    assert.ok(afterZoomIn.zoom > initialCamera.zoom, 'Zoom In button should increase zoom.');

    const textAfterZoomIn = await getTextState(page);
    assert.doesNotMatch(
      textAfterZoomIn.visibleLabels,
      /BUTTON PAN/,
      'BUTTON PAN should disappear once the zoom exceeds its maxZoom.',
    );
    assert.match(
      textAfterZoomIn.visibleLabels,
      /LUMA TEXT/,
      'LUMA TEXT should appear once the zoom reaches its minZoom.',
    );

    await clickControl(page, 'zoom-out');
    await page.waitForFunction(
      ({zoom}) => Number(document.body.dataset.cameraZoom) < zoom,
      {},
      {zoom: afterZoomIn.zoom},
    );

    const afterZoomOut = await getCameraState(page);
    assert.ok(afterZoomOut.zoom < afterZoomIn.zoom, 'Zoom Out button should decrease zoom.');

    const textAfterZoomOut = await getTextState(page);
    assert.match(
      textAfterZoomOut.visibleLabels,
      /BUTTON PAN/,
      'BUTTON PAN should reappear after zooming back into its allowed range.',
    );

    await clickControl(page, 'pan-right');
    await page.waitForFunction(
      ({centerX}) => Number(document.body.dataset.cameraCenterX) !== centerX,
      {},
      {centerX: afterZoomOut.centerX},
    );

    const afterPanRight = await getCameraState(page);
    assert.ok(
      afterPanRight.centerX > afterZoomOut.centerX,
      'Right pan control should move the camera center to the right.',
    );

    await clickControl(page, 'pan-up');
    await page.waitForFunction(
      ({centerY}) => Number(document.body.dataset.cameraCenterY) !== centerY,
      {},
      {centerY: afterPanRight.centerY},
    );

    const afterPanUp = await getCameraState(page);
    assert.ok(afterPanUp.centerY > afterPanRight.centerY, 'Up pan control should increase centerY.');

    await clickControl(page, 'reset-camera');
    await page.waitForFunction(
      () =>
        Number(document.body.dataset.cameraCenterX) === 0 &&
        Number(document.body.dataset.cameraCenterY) === 0 &&
        Number(document.body.dataset.cameraZoom) === 0,
    );

    const afterReset = await getCameraState(page);
    assert.equal(afterReset.centerX, 0, 'Reset control should restore centerX.');
    assert.equal(afterReset.centerY, 0, 'Reset control should restore centerY.');
    assert.equal(afterReset.zoom, 0, 'Reset control should restore zoom.');

    const textAfterReset = await getTextState(page);
    assert.match(
      textAfterReset.visibleLabels,
      /BUTTON PAN/,
      'Reset should restore the initial zoom-window visibility.',
    );
    assert.doesNotMatch(
      textAfterReset.visibleLabels,
      /WORLD VIEW/,
      'WORLD VIEW should stay hidden until zooming out far enough.',
    );

    await clickControl(page, 'zoom-out');
    await clickControl(page, 'zoom-out');
    await page.waitForFunction(
      () => (document.body.dataset.textVisibleLabels ?? '').includes('WORLD VIEW'),
    );

    const textAfterZoomOutTwice = await getTextState(page);
    assert.match(
      textAfterZoomOutTwice.visibleLabels,
      /WORLD VIEW/,
      'WORLD VIEW should appear after zooming out into its allowed range.',
    );

    await clickControl(page, 'reset-camera');
    await page.waitForFunction(
      () =>
        Number(document.body.dataset.cameraCenterX) === 0 &&
        Number(document.body.dataset.cameraCenterY) === 0 &&
        Number(document.body.dataset.cameraZoom) === 0,
    );

    const baselineCamera = await getCameraState(page);

    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="gpu-canvas"]');

      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Expected a canvas element.');
      }

      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 12,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await waitForBrowserUpdate(page);

    const afterWheel = await getCameraState(page);
    assert.equal(
      afterWheel.centerX,
      baselineCamera.centerX,
      'Wheel input should not pan when button-only controls are enabled.',
    );
    assert.equal(
      afterWheel.centerY,
      baselineCamera.centerY,
      'Wheel input should not move the camera when button-only controls are enabled.',
    );
    assert.equal(
      afterWheel.zoom,
      baselineCamera.zoom,
      'Wheel input should not zoom when button-only controls are enabled.',
    );

    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="gpu-canvas"]');

      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Expected a canvas element.');
      }

      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: 96,
          ctrlKey: true,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await waitForBrowserUpdate(page);

    const afterCtrlWheel = await getCameraState(page);
    assert.equal(
      afterCtrlWheel.zoom,
      baselineCamera.zoom,
      'Ctrl-wheel input should not zoom when button-only controls are enabled.',
    );

    await page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="gpu-canvas"]');

      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Expected a canvas element.');
      }

      canvas.dispatchEvent(
        new PointerEvent('pointerdown', {
          pointerId: 1,
          clientX: 120,
          clientY: 120,
          bubbles: true,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 240,
          clientY: 240,
          bubbles: true,
        }),
      );
      canvas.dispatchEvent(
        new PointerEvent('pointerup', {
          pointerId: 1,
          clientX: 240,
          clientY: 240,
          bubbles: true,
        }),
      );
    });

    await waitForBrowserUpdate(page);

    const afterDragAttempt = await getCameraState(page);
    assert.equal(
      afterDragAttempt.centerX,
      baselineCamera.centerX,
      'Pointer drag should not pan when button-only controls are enabled.',
    );
    assert.equal(
      afterDragAttempt.centerY,
      baselineCamera.centerY,
      'Pointer drag should not move the camera when button-only controls are enabled.',
    );
    assert.equal(
      afterDragAttempt.zoom,
      baselineCamera.zoom,
      'Pointer drag should not affect zoom when button-only controls are enabled.',
    );

    const benchmarkUrl = new URL(url);
    benchmarkUrl.searchParams.set('dataset', 'benchmark');
    benchmarkUrl.searchParams.set('benchmark', '1');
    benchmarkUrl.searchParams.set('gpuTiming', '1');
    benchmarkUrl.searchParams.set('labelCount', '1024');
    benchmarkUrl.searchParams.set('benchmarkFrames', '28');

    addBrowserLog('test', `Starting benchmark route ${benchmarkUrl.toString()}`);
    const benchmarkPageErrorCount = pageErrors.length;

    await page.goto(benchmarkUrl.toString(), {waitUntil: 'networkidle0'});
    await waitForAppDatasets(page);

    const benchmarkAppState = await page.evaluate(() => document.body.dataset.appState ?? 'missing');
    assert.notEqual(benchmarkAppState, 'error', 'Benchmark route should not enter error state.');

    if (benchmarkAppState === 'ready') {
      await page.waitForFunction(() => {
        const state = document.body.dataset.benchmarkState;
        return state === 'complete' || state === 'error';
      }, {timeout: 20_000});

      const benchmark = await getBenchmarkState(page);

      assert.equal(
        benchmark.state,
        'complete',
        `Benchmark should complete successfully. ${benchmark.error || 'No benchmark error was reported.'}`,
      );
      assert.equal(benchmark.datasetName, 'benchmark', 'Benchmark route should load the benchmark dataset.');
      assert.equal(
        benchmark.requestedLabelCount,
        1024,
        'Benchmark route should request the expected dataset size.',
      );
      assert.equal(
        benchmark.labelCount,
        1024,
        'Benchmark dataset should create the requested label count.',
      );
      assert.ok(
        benchmark.cpuFrameSamples >= 12,
        'Benchmark should capture a useful number of CPU frame samples.',
      );
      assert.ok(benchmark.cpuFrameAvgMs > 0, 'Benchmark should record average CPU frame time.');
      assert.ok(benchmark.cpuTextAvgMs > 0, 'Benchmark should record average CPU text-update time.');
      assert.ok(benchmark.cpuDrawAvgMs > 0, 'Benchmark should record average CPU draw/submit time.');
      assert.ok(
        benchmark.visibleLabelCount > 0,
        'Benchmark dataset should produce visible labels.',
      );
      assert.ok(
        benchmark.visibleGlyphCount > 0,
        'Benchmark dataset should produce visible glyphs.',
      );

      if (!benchmark.gpuTimingEnabled) {
        addBrowserLog(
          'test',
          'Benchmark GPU timestamps are disabled in the default benchmark route.',
        );
      } else if (benchmark.gpuSupported) {
        assert.ok(
          benchmark.gpuFrameSamples > 0,
          'Benchmark should capture GPU timestamp samples when the feature is supported.',
        );
        assert.ok(
          benchmark.gpuFrameAvgMs !== null && benchmark.gpuFrameAvgMs > 0,
          'GPU benchmark samples should produce a positive average frame time.',
        );
      } else {
        addBrowserLog(
          'test',
          'Benchmark GPU timestamps were requested, but this browser/device did not expose timestamp-query.',
        );
      }

      const benchmarkSummary = [
        `cpuFrame=${benchmark.cpuFrameAvgMs.toFixed(3)}ms`,
        `cpuText=${benchmark.cpuTextAvgMs.toFixed(3)}ms`,
        `cpuDraw=${benchmark.cpuDrawAvgMs.toFixed(3)}ms`,
        !benchmark.gpuTimingEnabled
          ? 'gpu=disabled'
          : benchmark.gpuFrameAvgMs === null
          ? 'gpu=unsupported'
          : `gpu=${benchmark.gpuFrameAvgMs.toFixed(3)}ms`,
        `visibleLabels=${benchmark.visibleLabelCount}`,
        `visibleGlyphs=${benchmark.visibleGlyphCount}`,
      ].join(' ');
      addBrowserLog('test', `Benchmark summary ${benchmarkSummary}`);

      const newUnexpectedBenchmarkErrors = pageErrors
        .slice(benchmarkPageErrorCount)
        .filter((message) => !message.includes(ERROR_PING_TOKEN));
      assert.deepEqual(
        newUnexpectedBenchmarkErrors,
        [],
        `Unexpected browser errors were captured during benchmark route: ${newUnexpectedBenchmarkErrors.join('\n\n')}`,
      );

      await flushBrowserLog();
      const logContents = await readFile(logPath, 'utf8');
      assert.match(
        logContents,
        /Benchmark complete/,
        'browser.log should contain the benchmark completion console entry.',
      );
      assert.match(
        logContents,
        /Benchmark summary/,
        'browser.log should contain the benchmark summary line.',
      );
    } else {
      addBrowserLog('test', 'Benchmark route reached unsupported state.');
      assert.equal(
        benchmarkAppState,
        'unsupported',
        'Benchmark route should only fall back to the unsupported state, not another state.',
      );
    }

  } else {
    addBrowserLog('test', 'App reached unsupported state.');
    assert.equal(result.state, 'unsupported', 'Expected either a ready or unsupported app state.');
    assert.match(result.message, /webgpu/i, 'Unsupported state should explain the WebGPU requirement.');
  }

  addBrowserLog('test', 'Browser test passed.');
  console.log('Browser test passed.');
} catch (error) {
  testError = error instanceof Error ? error : new Error(String(error));
  addBrowserLog('test.failure', testError.stack ?? testError.message);
} finally {
  if (page) {
    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      addBrowserLog('artifact', `Saved screenshot to ${screenshotPath}`);
    } catch (error) {
      addBrowserLog(
        'artifact.error',
        `Failed to save screenshot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    await flushBrowserLog();
  } catch (error) {
    console.error(
      `Failed to write browser log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await browser?.close();
  await server.close();
}

if (testError) {
  throw testError;
}

async function getCameraState(page: Page): Promise<CameraState> {
  return page.evaluate(() => ({
    centerX: Number(document.body.dataset.cameraCenterX ?? '0'),
    centerY: Number(document.body.dataset.cameraCenterY ?? '0'),
    zoom: Number(document.body.dataset.cameraZoom ?? '0'),
    scale: Number(document.body.dataset.cameraScale ?? '0'),
    lineCount: Number(document.body.dataset.gridLineCount ?? '0'),
    minorSpacing: Number(document.body.dataset.gridMinorSpacing ?? '0'),
    majorSpacing: Number(document.body.dataset.gridMajorSpacing ?? '0'),
  }));
}

async function getTextState(page: Page): Promise<TextState> {
  return page.evaluate(() => ({
    labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
    glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.textVisibleLabelCount ?? '0'),
    visibleLabels: document.body.dataset.textVisibleLabels ?? '',
    visibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
  }));
}

async function getBenchmarkState(page: Page): Promise<BenchmarkState> {
  return page.evaluate(() => ({
    cpuDrawAvgMs: Number(document.body.dataset.benchmarkCpuDrawAvgMs ?? '0'),
    cpuFrameAvgMs: Number(document.body.dataset.benchmarkCpuFrameAvgMs ?? '0'),
    cpuFrameSamples: Number(document.body.dataset.benchmarkCpuFrameSamples ?? '0'),
    cpuTextAvgMs: Number(document.body.dataset.benchmarkCpuTextAvgMs ?? '0'),
    datasetName: document.body.dataset.datasetName ?? '',
    error: document.body.dataset.benchmarkError ?? '',
    gpuFrameAvgMs:
      document.body.dataset.benchmarkGpuFrameAvgMs === 'unsupported' ||
      document.body.dataset.benchmarkGpuFrameAvgMs === 'disabled'
        ? null
        : Number(document.body.dataset.benchmarkGpuFrameAvgMs ?? '0'),
    gpuFrameSamples: Number(document.body.dataset.benchmarkGpuFrameSamples ?? '0'),
    gpuSupported: document.body.dataset.benchmarkGpuSupported === 'true',
    gpuTimingEnabled: document.body.dataset.benchmarkGpuTimingEnabled === 'true',
    labelCount: Number(document.body.dataset.benchmarkLabelCount ?? '0'),
    requestedLabelCount: Number(document.body.dataset.benchmarkRequestedLabelCount ?? '0'),
    state: document.body.dataset.benchmarkState ?? 'missing',
    visibleGlyphCount: Number(document.body.dataset.benchmarkVisibleGlyphCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.benchmarkVisibleLabelCount ?? '0'),
  }));
}

async function clickControl(page: Page, control: string): Promise<void> {
  const selector = `[data-control="${control}"]`;
  await page.waitForSelector(selector);
  await page.click(selector);
}

async function waitForBrowserUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 100);
    });
  });
}

async function flushBrowserLog(): Promise<void> {
  await writeFile(logPath, `${browserLogLines.join('\n')}\n`, 'utf8');
}

async function waitForAppDatasets(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const state = document.body.dataset.appState;
    return state === 'ready' || state === 'unsupported' || state === 'error';
  });

  await page.waitForFunction(() => {
    if (document.body.dataset.appState !== 'ready') {
      return true;
    }

    return Boolean(
      document.body.dataset.cameraCenterX &&
        document.body.dataset.cameraCenterY &&
        document.body.dataset.cameraZoom &&
        document.body.dataset.gridLineCount &&
        document.body.dataset.textLabelCount &&
        document.body.dataset.textGlyphCount &&
        document.body.dataset.textVisibleLabelCount &&
        document.body.dataset.perfCpuFrameAvgMs &&
        document.body.dataset.perfCpuTextAvgMs,
    );
  });
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  description: string,
): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${description}.`);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

function runCameraUnitTests(): void {
  const viewport: ViewportSize = {width: 800, height: 600};
  const camera = new Camera2D();

  const beforePan = camera.getSnapshot();
  camera.panByPixels(112, 56);
  const afterPan = camera.getSnapshot();

  assert.notEqual(afterPan.centerX, beforePan.centerX, 'Camera pan should change centerX.');
  assert.notEqual(afterPan.centerY, beforePan.centerY, 'Camera pan should change centerY.');

  const anchorScreenPoint = {x: 400, y: 300};
  const worldBeforeZoom = camera.screenToWorld(anchorScreenPoint, viewport);
  const zoomBefore = camera.zoom;

  camera.zoomAtScreenPoint(-120, anchorScreenPoint, viewport);

  const worldAfterZoom = camera.screenToWorld(anchorScreenPoint, viewport);

  assert.notEqual(camera.zoom, zoomBefore, 'Camera zoom should change after wheel zoom input.');
  assert.ok(
    Math.abs(worldAfterZoom.x - worldBeforeZoom.x) < 0.0001,
    'Zooming around a screen point should preserve world X at the anchor.',
  );
  assert.ok(
    Math.abs(worldAfterZoom.y - worldBeforeZoom.y) < 0.0001,
    'Zooming around a screen point should preserve world Y at the anchor.',
  );
}

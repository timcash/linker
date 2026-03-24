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
import {
  STATIC_BENCHMARK_COUNTS,
  STATIC_BENCHMARK_DATASET_ID,
} from '../src/data/static-benchmark';
import {RENDERER_MODES, type RendererMode} from '../src/text/types';

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
  bytesUploadedPerFrame: number;
  datasetPreset: string;
  labelCount: number;
  glyphCount: number;
  rendererMode: RendererMode;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleLabelCount: number;
  visibleLabels: string;
  visibleGlyphCount: number;
};

type BenchmarkState = {
  bytesUploadedPerFrame: number;
  cpuDrawAvgMs: number;
  cpuFrameAvgMs: number;
  cpuFrameSamples: number;
  cpuTextAvgMs: number;
  datasetPreset: string;
  datasetName: string;
  error: string;
  glyphCount: number;
  gpuFrameAvgMs: number | null;
  gpuFrameSamples: number;
  gpuSupported: boolean;
  gpuTimingEnabled: boolean;
  labelCount: number;
  requestedLabelCount: number;
  rendererMode: RendererMode;
  state: string;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
};

type LargeScaleSweepState = {
  bytesUploadedPerFrame: number;
  datasetPreset: string;
  name: string;
  rendererMode: RendererMode;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
  zoom: number;
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
          bytesUploadedPerFrame: Number(document.body.dataset.textBytesUploadedPerFrame ?? '0'),
          datasetPreset: document.body.dataset.datasetPreset ?? '',
          labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
          glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
          rendererMode: (document.body.dataset.rendererMode ?? 'baseline') as RendererMode,
          submittedGlyphCount: Number(document.body.dataset.textSubmittedGlyphCount ?? '0'),
          submittedVertexCount: Number(document.body.dataset.textSubmittedVertexCount ?? '0'),
          visibleChunkCount: Number(document.body.dataset.textVisibleChunkCount ?? '0'),
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
    assert.equal(result.text.rendererMode, 'baseline', 'Demo route should default to the baseline renderer.');
    assert.equal(result.text.datasetPreset, 'demo-v1', 'Demo route should report the fixed demo dataset preset.');
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
      const rendererPanel = document.querySelector('[data-testid="renderer-panel"]');
      const statusPanel = document.querySelector('[data-testid="status-panel"]');
      const rendererButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-renderer-mode]')];
      const controlsRect = controls instanceof HTMLElement ? controls.getBoundingClientRect() : null;
      const statusRect = statusPanel instanceof HTMLElement ? statusPanel.getBoundingClientRect() : null;

      return {
        messageHiddenProperty: message instanceof HTMLElement ? message.hidden : false,
        messageDisplay: message instanceof HTMLElement ? window.getComputedStyle(message).display : '',
        controlsVisible:
          controls instanceof HTMLElement && window.getComputedStyle(controls).display !== 'none',
        rendererPanelVisible:
          rendererPanel instanceof HTMLElement &&
          window.getComputedStyle(rendererPanel).display !== 'none',
        controlsRightGap: controlsRect ? Math.round(window.innerWidth - controlsRect.right) : -1,
        controlsBottomGap: controlsRect ? Math.round(window.innerHeight - controlsRect.bottom) : -1,
        rendererButtonModes: rendererButtons.map((button) => button.dataset.rendererMode ?? ''),
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
    assert.equal(readyUiState.rendererPanelVisible, true, 'Renderer panel should be visible.');
    assert.deepEqual(
      readyUiState.rendererButtonModes,
      [...RENDERER_MODES],
      'Renderer panel should expose a button for every renderer strategy.',
    );
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

    const demoRendererChecks = new Map<RendererMode, TextState>();

    for (const rendererMode of getRendererModes()) {
      addBrowserLog('test', `Verifying demo renderer mode ${rendererMode}`);
      await switchRendererMode(page, rendererMode);
      const demoTextState = await verifyDemoRendererVisibility(page, rendererMode);
      demoRendererChecks.set(rendererMode, demoTextState);
    }

    const baselineDemo = getRequiredMapValue(
      demoRendererChecks,
      'baseline',
      'Baseline demo renderer should be verified.',
    );
    const instancedDemo = getRequiredMapValue(
      demoRendererChecks,
      'instanced',
      'Instanced demo renderer should be verified.',
    );
    const visibleIndexDemo = getRequiredMapValue(
      demoRendererChecks,
      'visible-index',
      'Visible-index demo renderer should be verified.',
    );
    const chunkedDemo = getRequiredMapValue(
      demoRendererChecks,
      'chunked',
      'Chunked demo renderer should be verified.',
    );
    const packedDemo = getRequiredMapValue(
      demoRendererChecks,
      'packed',
      'Packed demo renderer should be verified.',
    );

    for (const rendererMode of getRendererModes()) {
      const demoState = getRequiredMapValue(
        demoRendererChecks,
        rendererMode,
        `Demo renderer mode ${rendererMode} should be verified.`,
      );
      assert.equal(
        demoState.datasetPreset,
        'demo-v1',
        `${rendererMode} demo mode should use the shared demo dataset preset.`,
      );
      assert.equal(
        demoState.visibleLabelCount,
        baselineDemo.visibleLabelCount,
        `Demo visibility should match baseline for renderer ${rendererMode}.`,
      );
      assert.equal(
        demoState.visibleGlyphCount,
        baselineDemo.visibleGlyphCount,
        `Demo glyph visibility should match baseline for renderer ${rendererMode}.`,
      );
    }

    assert.ok(
      instancedDemo.bytesUploadedPerFrame < baselineDemo.bytesUploadedPerFrame,
      'Instanced demo mode should upload fewer per-frame bytes than baseline.',
    );
    assert.ok(
      visibleIndexDemo.bytesUploadedPerFrame < instancedDemo.bytesUploadedPerFrame,
      'Visible-index demo mode should upload fewer per-frame bytes than instanced.',
    );
    assert.ok(
      chunkedDemo.bytesUploadedPerFrame <= visibleIndexDemo.bytesUploadedPerFrame,
      'Chunked demo mode should upload no more than visible-index.',
    );
    assert.ok(
      packedDemo.bytesUploadedPerFrame < visibleIndexDemo.bytesUploadedPerFrame,
      'Packed demo mode should upload fewer per-frame bytes than visible-index.',
    );

    const largeScaleLabelCount = STATIC_BENCHMARK_COUNTS[1];
    const largeScaleSweeps = new Map<RendererMode, LargeScaleSweepState[]>();

    for (const rendererMode of getRendererModes()) {
      addBrowserLog(
        'test',
        `Running large-scale visibility sweep renderer=${rendererMode} labels=${largeScaleLabelCount}`,
      );
      const sweep = await runLargeScaleRendererSweep(page, url, rendererMode, largeScaleLabelCount);
      largeScaleSweeps.set(rendererMode, sweep);
    }

    const baselineSweep = getRequiredMapValue(
      largeScaleSweeps,
      'baseline',
      'Baseline large-scale sweep should be recorded.',
    );
    const sweepTraceNames = baselineSweep.map((state) => state.name);

    for (const rendererMode of getRendererModes()) {
      const sweep = getRequiredMapValue(
        largeScaleSweeps,
        rendererMode,
        `Missing large-scale sweep for renderer ${rendererMode}.`,
      );
      assert.deepEqual(
        sweep.map((state) => state.name),
        sweepTraceNames,
        `Sweep checkpoints should use the same zoom trace for renderer ${rendererMode}.`,
      );
      assertZoomSweepTransitions(sweep, rendererMode);
    }

    for (let index = 0; index < sweepTraceNames.length; index += 1) {
      const checkpointName = sweepTraceNames[index];
      const baselineCheckpoint = baselineSweep[index];
      const instancedCheckpoint = getRequiredMapValue(
        largeScaleSweeps,
        'instanced',
        'Instanced sweep should be recorded.',
      )[index];
      const visibleIndexCheckpoint = getRequiredMapValue(
        largeScaleSweeps,
        'visible-index',
        'Visible-index sweep should be recorded.',
      )[index];
      const chunkedCheckpoint = getRequiredMapValue(
        largeScaleSweeps,
        'chunked',
        'Chunked sweep should be recorded.',
      )[index];
      const packedCheckpoint = getRequiredMapValue(
        largeScaleSweeps,
        'packed',
        'Packed sweep should be recorded.',
      )[index];

      for (const checkpoint of [
        baselineCheckpoint,
        instancedCheckpoint,
        visibleIndexCheckpoint,
        chunkedCheckpoint,
        packedCheckpoint,
      ]) {
        assert.equal(
          checkpoint.datasetPreset,
          STATIC_BENCHMARK_DATASET_ID,
          `${checkpoint.rendererMode} sweep checkpoint ${checkpoint.name} should use the static benchmark dataset.`,
        );
        assert.equal(
          checkpoint.visibleLabelCount,
          baselineCheckpoint.visibleLabelCount,
          `${checkpointName} visible label counts should match baseline for renderer ${checkpoint.rendererMode}.`,
        );
        assert.equal(
          checkpoint.visibleGlyphCount,
          baselineCheckpoint.visibleGlyphCount,
          `${checkpointName} visible glyph counts should match baseline for renderer ${checkpoint.rendererMode}.`,
        );
      }

      if (baselineCheckpoint.visibleGlyphCount === 0) {
        for (const checkpoint of [
          baselineCheckpoint,
          instancedCheckpoint,
          visibleIndexCheckpoint,
          chunkedCheckpoint,
          packedCheckpoint,
        ]) {
          assert.equal(
            checkpoint.bytesUploadedPerFrame,
            0,
            `${checkpointName} ${checkpoint.rendererMode} sweep should upload nothing when no glyphs are visible.`,
          );
          assert.equal(
            checkpoint.submittedVertexCount,
            0,
            `${checkpointName} ${checkpoint.rendererMode} sweep should submit no vertices when no glyphs are visible.`,
          );
        }
        assert.equal(
          chunkedCheckpoint.visibleChunkCount,
          0,
          `${checkpointName} chunked sweep should report zero visible chunks when no glyphs are visible.`,
        );
        continue;
      }

      assert.ok(
        instancedCheckpoint.bytesUploadedPerFrame < baselineCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} instanced sweep should upload fewer bytes than baseline.`,
      );
      assert.ok(
        visibleIndexCheckpoint.bytesUploadedPerFrame < instancedCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} visible-index sweep should upload fewer bytes than instanced.`,
      );
      assert.ok(
        chunkedCheckpoint.bytesUploadedPerFrame <= visibleIndexCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} chunked sweep should upload no more than visible-index.`,
      );
      assert.ok(
        packedCheckpoint.bytesUploadedPerFrame < visibleIndexCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} packed sweep should upload fewer bytes than visible-index.`,
      );
      assert.equal(
        visibleIndexCheckpoint.submittedVertexCount,
        visibleIndexCheckpoint.visibleGlyphCount * 4,
        `${checkpointName} visible-index sweep should submit four vertices per visible glyph.`,
      );
      assert.equal(
        chunkedCheckpoint.submittedVertexCount,
        chunkedCheckpoint.visibleGlyphCount * 4,
        `${checkpointName} chunked sweep should submit four vertices per visible glyph.`,
      );
      assert.ok(
        packedCheckpoint.submittedVertexCount > visibleIndexCheckpoint.submittedVertexCount,
        `${checkpointName} packed sweep should submit more vertices than visible-index because it still draws packed glyphs.`,
      );
      assert.ok(
        chunkedCheckpoint.visibleChunkCount > 0,
        `${checkpointName} chunked sweep should report visible chunks.`,
      );
    }

    const benchmarkResults = new Map<string, BenchmarkState>();
    const benchmarkLabelCounts = STATIC_BENCHMARK_COUNTS;

    for (const labelCount of benchmarkLabelCounts) {
      for (const rendererMode of getRendererModes()) {
        const benchmark = await runBenchmarkRoute(page, url, rendererMode, labelCount, pageErrors);
        benchmarkResults.set(getBenchmarkKey(rendererMode, labelCount), benchmark);
      }

      const baselineBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('baseline', labelCount),
        `Missing baseline benchmark for labelCount=${labelCount}.`,
      );
      const instancedBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('instanced', labelCount),
        `Missing instanced benchmark for labelCount=${labelCount}.`,
      );
      const visibleIndexBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('visible-index', labelCount),
        `Missing visible-index benchmark for labelCount=${labelCount}.`,
      );
      const chunkedBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('chunked', labelCount),
        `Missing chunked benchmark for labelCount=${labelCount}.`,
      );
      const packedBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('packed', labelCount),
        `Missing packed benchmark for labelCount=${labelCount}.`,
      );

      for (const rendererMode of getRendererModes()) {
        const benchmark = getRequiredMapValue(
          benchmarkResults,
          getBenchmarkKey(rendererMode, labelCount),
          `Missing benchmark for renderer=${rendererMode} labelCount=${labelCount}.`,
        );
        assert.equal(
          benchmark.datasetPreset,
          STATIC_BENCHMARK_DATASET_ID,
          `Benchmark should use the static dataset for renderer=${rendererMode} labelCount=${labelCount}.`,
        );
        assert.equal(
          benchmark.visibleLabelCount,
          baselineBenchmark.visibleLabelCount,
          `Visible label counts should match baseline for renderer=${rendererMode} at ${labelCount} labels.`,
        );
        assert.equal(
          benchmark.visibleGlyphCount,
          baselineBenchmark.visibleGlyphCount,
          `Visible glyph counts should match baseline for renderer=${rendererMode} at ${labelCount} labels.`,
        );
      }

      assert.ok(
        instancedBenchmark.bytesUploadedPerFrame < baselineBenchmark.bytesUploadedPerFrame,
        `Instanced benchmark should upload fewer bytes than baseline at ${labelCount} labels.`,
      );
      assert.ok(
        visibleIndexBenchmark.bytesUploadedPerFrame < instancedBenchmark.bytesUploadedPerFrame,
        `Visible-index benchmark should upload fewer bytes than instanced at ${labelCount} labels.`,
      );
      assert.ok(
        chunkedBenchmark.bytesUploadedPerFrame <= visibleIndexBenchmark.bytesUploadedPerFrame,
        `Chunked benchmark should upload no more than visible-index at ${labelCount} labels.`,
      );
      assert.ok(
        packedBenchmark.bytesUploadedPerFrame < visibleIndexBenchmark.bytesUploadedPerFrame,
        `Packed benchmark should upload fewer bytes than visible-index at ${labelCount} labels.`,
      );
      assert.ok(
        instancedBenchmark.submittedVertexCount < baselineBenchmark.submittedVertexCount,
        `Instanced benchmark should submit fewer vertices than baseline at ${labelCount} labels.`,
      );
      assert.equal(
        visibleIndexBenchmark.submittedVertexCount,
        visibleIndexBenchmark.visibleGlyphCount * 4,
        `Visible-index benchmark should submit four vertices per visible glyph at ${labelCount} labels.`,
      );
      assert.equal(
        chunkedBenchmark.submittedVertexCount,
        chunkedBenchmark.visibleGlyphCount * 4,
        `Chunked benchmark should submit four vertices per visible glyph at ${labelCount} labels.`,
      );
      assert.ok(
        packedBenchmark.submittedVertexCount > visibleIndexBenchmark.submittedVertexCount,
        `Packed benchmark should draw more vertices than visible-index at ${labelCount} labels because it submits the packed glyph set.`,
      );
      assert.ok(
        chunkedBenchmark.visibleChunkCount > 0,
        `Chunked benchmark should report visible chunks at ${labelCount} labels.`,
      );
    }

    const packed1024 = getRequiredMapValue(
      benchmarkResults,
      getBenchmarkKey('packed', 1024),
      'Missing packed 1024 benchmark.',
    );
    const packed4096 = getRequiredMapValue(
      benchmarkResults,
      getBenchmarkKey('packed', 4096),
      'Missing packed 4096 benchmark.',
    );
    const packed16384 = getRequiredMapValue(
      benchmarkResults,
      getBenchmarkKey('packed', 16384),
      'Missing packed 16384 benchmark.',
    );

    assert.ok(
      packed1024.bytesUploadedPerFrame === packed4096.bytesUploadedPerFrame &&
        packed4096.bytesUploadedPerFrame === packed16384.bytesUploadedPerFrame,
      'Packed benchmark uploads should stay constant across dataset sizes.',
    );

    await flushBrowserLog();
    const benchmarkLogContents = await readFile(logPath, 'utf8');
    assert.match(
      benchmarkLogContents,
      /Benchmark complete/,
      'browser.log should contain benchmark completion console entries.',
    );
    assert.match(
      benchmarkLogContents,
      /Benchmark summary renderer=/,
      'browser.log should contain benchmark summary lines for renderer runs.',
    );

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
    bytesUploadedPerFrame: Number(document.body.dataset.textBytesUploadedPerFrame ?? '0'),
    datasetPreset: document.body.dataset.datasetPreset ?? '',
    labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
    glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
    rendererMode: (document.body.dataset.rendererMode ?? 'baseline') as RendererMode,
    submittedGlyphCount: Number(document.body.dataset.textSubmittedGlyphCount ?? '0'),
    submittedVertexCount: Number(document.body.dataset.textSubmittedVertexCount ?? '0'),
    visibleChunkCount: Number(document.body.dataset.textVisibleChunkCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.textVisibleLabelCount ?? '0'),
    visibleLabels: document.body.dataset.textVisibleLabels ?? '',
    visibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
  }));
}

async function getBenchmarkState(page: Page): Promise<BenchmarkState> {
  return page.evaluate(() => ({
    bytesUploadedPerFrame: Number(document.body.dataset.benchmarkBytesUploadedPerFrame ?? '0'),
    cpuDrawAvgMs: Number(document.body.dataset.benchmarkCpuDrawAvgMs ?? '0'),
    cpuFrameAvgMs: Number(document.body.dataset.benchmarkCpuFrameAvgMs ?? '0'),
    cpuFrameSamples: Number(document.body.dataset.benchmarkCpuFrameSamples ?? '0'),
    cpuTextAvgMs: Number(document.body.dataset.benchmarkCpuTextAvgMs ?? '0'),
    datasetPreset: document.body.dataset.benchmarkDatasetPreset ?? '',
    datasetName: document.body.dataset.datasetName ?? '',
    error: document.body.dataset.benchmarkError ?? '',
    glyphCount: Number(document.body.dataset.benchmarkGlyphCount ?? '0'),
    gpuFrameAvgMs:
      document.body.dataset.benchmarkGpuFrameAvgMs === 'unsupported' ||
      document.body.dataset.benchmarkGpuFrameAvgMs === 'disabled' ||
      document.body.dataset.benchmarkGpuFrameAvgMs === 'pending'
        ? null
        : Number(document.body.dataset.benchmarkGpuFrameAvgMs ?? '0'),
    gpuFrameSamples: Number(document.body.dataset.benchmarkGpuFrameSamples ?? '0'),
    gpuSupported: document.body.dataset.benchmarkGpuSupported === 'true',
    gpuTimingEnabled: document.body.dataset.benchmarkGpuTimingEnabled === 'true',
    labelCount: Number(document.body.dataset.benchmarkLabelCount ?? '0'),
    requestedLabelCount: Number(document.body.dataset.benchmarkRequestedLabelCount ?? '0'),
    rendererMode: (document.body.dataset.benchmarkRendererMode ?? 'baseline') as RendererMode,
    state: document.body.dataset.benchmarkState ?? 'missing',
    submittedGlyphCount: Number(document.body.dataset.benchmarkSubmittedGlyphCount ?? '0'),
    submittedVertexCount: Number(document.body.dataset.benchmarkSubmittedVertexCount ?? '0'),
    visibleChunkCount: Number(document.body.dataset.benchmarkVisibleChunkCount ?? '0'),
    visibleGlyphCount: Number(document.body.dataset.benchmarkVisibleGlyphCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.benchmarkVisibleLabelCount ?? '0'),
  }));
}

async function clickControl(page: Page, control: string): Promise<void> {
  const selector = `[data-control="${control}"]`;
  await page.waitForSelector(selector);
  await page.evaluate((buttonSelector) => {
    const button = document.querySelector<HTMLButtonElement>(buttonSelector);

    if (!button) {
      throw new Error(`Missing control button ${buttonSelector}`);
    }

    button.click();
  }, selector);
}

async function clickControlRepeatedly(page: Page, control: string, times: number): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await clickControl(page, control);
    await waitForBrowserUpdate(page);
  }
}

function getRendererModes(): RendererMode[] {
  return [...RENDERER_MODES];
}

async function switchRendererMode(page: Page, rendererMode: RendererMode): Promise<void> {
  const currentMode = await page.evaluate(
    () => (document.body.dataset.rendererMode ?? 'baseline') as RendererMode,
  );

  if (currentMode !== rendererMode) {
    const selector = `button[data-renderer-mode="${rendererMode}"]`;
    await page.waitForSelector(selector);
    await page.evaluate((buttonSelector) => {
      const button = document.querySelector<HTMLButtonElement>(buttonSelector);

      if (!button) {
        throw new Error(`Missing renderer button ${buttonSelector}`);
      }

      button.click();
    }, selector);
  }

  await page.waitForFunction(
    (expectedMode) => document.body.dataset.rendererMode === expectedMode,
    {},
    rendererMode,
  );
  await page.waitForFunction(
    (expectedMode) => {
      const button = document.querySelector(`button[data-renderer-mode="${expectedMode}"]`);
      return button?.getAttribute('aria-pressed') === 'true';
    },
    {},
    rendererMode,
  );
  await waitForBrowserUpdate(page);
}

async function verifyDemoRendererVisibility(
  page: Page,
  rendererMode: RendererMode,
): Promise<TextState> {
  const rendererState = await getTextState(page);

  assert.equal(rendererState.rendererMode, rendererMode, `${rendererMode} mode should be active.`);

  await clickControl(page, 'reset-camera');
  await page.waitForFunction(
    () =>
      Number(document.body.dataset.cameraCenterX) === 0 &&
      Number(document.body.dataset.cameraCenterY) === 0 &&
      Number(document.body.dataset.cameraZoom) === 0,
  );

  const initialText = await getTextState(page);
  assert.equal(
    initialText.datasetPreset,
    'demo-v1',
    `${rendererMode} mode should continue using the demo dataset preset.`,
  );
  assert.match(
    initialText.visibleLabels,
    /BUTTON PAN/,
    `${rendererMode} mode should show BUTTON PAN at the default zoom.`,
  );
  assert.doesNotMatch(
    initialText.visibleLabels,
    /LUMA TEXT/,
    `${rendererMode} mode should hide LUMA TEXT at the default zoom.`,
  );
  assert.ok(
    initialText.bytesUploadedPerFrame > 0,
    `${rendererMode} mode should report positive per-frame upload cost while drawing.`,
  );
  if (rendererMode === 'chunked') {
    assert.ok(
      initialText.visibleChunkCount > 0,
      'Chunked demo mode should report visible chunks.',
    );
  }

  const beforeZoomIn = await getCameraState(page);
  await clickControl(page, 'zoom-in');
  await page.waitForFunction(
    ({zoom}) => Number(document.body.dataset.cameraZoom) > zoom,
    {},
    {zoom: beforeZoomIn.zoom},
  );

  const afterZoomIn = await getTextState(page);
  assert.doesNotMatch(
    afterZoomIn.visibleLabels,
    /BUTTON PAN/,
    `${rendererMode} mode should hide BUTTON PAN after zooming in.`,
  );
  assert.match(
    afterZoomIn.visibleLabels,
    /LUMA TEXT/,
    `${rendererMode} mode should show LUMA TEXT after zooming in.`,
  );

  await clickControl(page, 'zoom-out');
  await page.waitForFunction(
    () => Number(document.body.dataset.cameraZoom) === 0,
  );

  await clickControlRepeatedly(page, 'zoom-out', 2);
  await page.waitForFunction(
    () => (document.body.dataset.textVisibleLabels ?? '').includes('WORLD VIEW'),
  );

  const afterZoomOut = await getTextState(page);
  assert.match(
    afterZoomOut.visibleLabels,
    /WORLD VIEW/,
    `${rendererMode} mode should show WORLD VIEW after zooming out.`,
  );
  if (rendererMode === 'chunked') {
    assert.ok(
      afterZoomOut.visibleChunkCount > 0,
      'Chunked demo mode should keep reporting visible chunks after zooming out.',
    );
  }

  await clickControl(page, 'reset-camera');
  await page.waitForFunction(
    () =>
      Number(document.body.dataset.cameraCenterX) === 0 &&
      Number(document.body.dataset.cameraCenterY) === 0 &&
      Number(document.body.dataset.cameraZoom) === 0,
  );

  return getTextState(page);
}

async function runLargeScaleRendererSweep(
  page: Page,
  baseUrl: string,
  rendererMode: RendererMode,
  labelCount: number,
): Promise<LargeScaleSweepState[]> {
  const sweepUrl = new URL(baseUrl);
  sweepUrl.searchParams.set('dataset', 'benchmark');
  sweepUrl.searchParams.set('labelCount', String(labelCount));
  sweepUrl.searchParams.set('renderer', rendererMode);
  sweepUrl.searchParams.delete('benchmark');
  sweepUrl.searchParams.delete('gpuTiming');
  sweepUrl.searchParams.delete('benchmarkFrames');

  await page.goto(sweepUrl.toString(), {waitUntil: 'networkidle0'});
  await waitForAppDatasets(page);

  const appState = await page.evaluate(() => document.body.dataset.appState ?? 'missing');
  assert.equal(appState, 'ready', `Large-scale sweep should reach ready state for ${rendererMode}.`);
  assert.equal(
    await page.evaluate(() => document.body.dataset.rendererMode ?? 'missing'),
    rendererMode,
    `Large-scale sweep should activate ${rendererMode}.`,
  );
  assert.equal(
    await page.evaluate(() => document.body.dataset.datasetPreset ?? 'missing'),
    STATIC_BENCHMARK_DATASET_ID,
    `Large-scale sweep should use the static benchmark dataset for ${rendererMode}.`,
  );
  assert.equal(
    await page.evaluate(() => Number(document.body.dataset.datasetLabelCount ?? '0')),
    labelCount,
    `Large-scale sweep should use ${labelCount} labels for ${rendererMode}.`,
  );

  const checkpoints: LargeScaleSweepState[] = [];

  await clickControl(page, 'reset-camera');
  await page.waitForFunction(
    () =>
      Number(document.body.dataset.cameraCenterX) === 0 &&
      Number(document.body.dataset.cameraCenterY) === 0 &&
      Number(document.body.dataset.cameraZoom) === 0,
  );
  checkpoints.push(await captureLargeScaleSweepState(page, 'reset'));

  for (let step = 1; step <= 4; step += 1) {
    await clickControl(page, 'zoom-out');
    await waitForBrowserUpdate(page);
    checkpoints.push(await captureLargeScaleSweepState(page, `zoom-out-${step}`));
  }

  for (let step = 1; step <= 24; step += 1) {
    await clickControl(page, 'zoom-in');
    await waitForBrowserUpdate(page);
    checkpoints.push(await captureLargeScaleSweepState(page, `zoom-in-${step}`));
  }

  for (const checkpoint of checkpoints) {
    assert.equal(
      checkpoint.rendererMode,
      rendererMode,
      `${rendererMode} sweep checkpoint ${checkpoint.name} should report the active renderer mode.`,
    );
    assert.ok(
      checkpoint.visibleLabelCount >= 0,
      `${rendererMode} sweep checkpoint ${checkpoint.name} should report a non-negative visible label count.`,
    );
    assert.ok(
      checkpoint.visibleGlyphCount >= 0,
      `${rendererMode} sweep checkpoint ${checkpoint.name} should report a non-negative visible glyph count.`,
    );
    addBrowserLog(
      'test',
      `Sweep summary renderer=${rendererMode} checkpoint=${checkpoint.name} zoom=${checkpoint.zoom.toFixed(2)} visibleLabels=${checkpoint.visibleLabelCount} visibleGlyphs=${checkpoint.visibleGlyphCount} visibleChunks=${checkpoint.visibleChunkCount} bytes=${checkpoint.bytesUploadedPerFrame} vertices=${checkpoint.submittedVertexCount} datasetPreset=${checkpoint.datasetPreset}`,
    );
  }

  return checkpoints;
}

async function captureLargeScaleSweepState(
  page: Page,
  name: string,
): Promise<LargeScaleSweepState> {
  const [camera, text] = await Promise.all([getCameraState(page), getTextState(page)]);

  return {
    bytesUploadedPerFrame: text.bytesUploadedPerFrame,
    datasetPreset: text.datasetPreset,
    name,
    rendererMode: text.rendererMode,
    submittedVertexCount: text.submittedVertexCount,
    visibleChunkCount: text.visibleChunkCount,
    visibleGlyphCount: text.visibleGlyphCount,
    visibleLabelCount: text.visibleLabelCount,
    zoom: camera.zoom,
  };
}

async function runBenchmarkRoute(
  page: Page,
  baseUrl: string,
  rendererMode: RendererMode,
  labelCount: number,
  pageErrors: string[],
): Promise<BenchmarkState> {
  const benchmarkUrl = new URL(baseUrl);
  benchmarkUrl.searchParams.set('dataset', 'benchmark');
  benchmarkUrl.searchParams.set('benchmark', '1');
  benchmarkUrl.searchParams.set('gpuTiming', '1');
  benchmarkUrl.searchParams.set('renderer', rendererMode);
  benchmarkUrl.searchParams.set('labelCount', String(labelCount));
  benchmarkUrl.searchParams.set('benchmarkFrames', '40');

  addBrowserLog('test', `Starting benchmark route ${benchmarkUrl.toString()}`);
  const benchmarkPageErrorCount = pageErrors.length;

  await page.goto(benchmarkUrl.toString(), {waitUntil: 'networkidle0'});
  await waitForAppDatasets(page);

  const benchmarkAppState = await page.evaluate(() => document.body.dataset.appState ?? 'missing');
  assert.notEqual(
    benchmarkAppState,
    'error',
    `Benchmark route should not enter error state for renderer=${rendererMode} labelCount=${labelCount}.`,
  );

  if (benchmarkAppState !== 'ready') {
    addBrowserLog(
      'test',
      `Benchmark route reached ${benchmarkAppState} for renderer=${rendererMode} labelCount=${labelCount}`,
    );
    assert.equal(
      benchmarkAppState,
      'unsupported',
      'Benchmark route should only fall back to the unsupported state, not another state.',
    );
    return {
      bytesUploadedPerFrame: 0,
      cpuDrawAvgMs: 0,
      cpuFrameAvgMs: 0,
      cpuFrameSamples: 0,
      cpuTextAvgMs: 0,
      datasetPreset: STATIC_BENCHMARK_DATASET_ID,
      datasetName: 'benchmark',
      error: '',
      glyphCount: 0,
      gpuFrameAvgMs: null,
      gpuFrameSamples: 0,
      gpuSupported: false,
      gpuTimingEnabled: false,
      labelCount,
      requestedLabelCount: labelCount,
      rendererMode,
      state: benchmarkAppState,
      submittedGlyphCount: 0,
      submittedVertexCount: 0,
      visibleChunkCount: 0,
      visibleGlyphCount: 0,
      visibleLabelCount: 0,
    };
  }

  await page.waitForFunction(() => {
    const state = document.body.dataset.benchmarkState;
    return state === 'complete' || state === 'error';
  }, {timeout: 40_000});

  const benchmark = await getBenchmarkState(page);

  assert.equal(
    benchmark.state,
    'complete',
    `Benchmark should complete successfully for renderer=${rendererMode} labelCount=${labelCount}. ${benchmark.error || 'No benchmark error was reported.'}`,
  );
  assert.equal(benchmark.datasetName, 'benchmark', 'Benchmark route should load the benchmark dataset.');
  assert.equal(
    benchmark.datasetPreset,
    STATIC_BENCHMARK_DATASET_ID,
    'Benchmark route should report the static benchmark dataset preset.',
  );
  assert.equal(
    benchmark.requestedLabelCount,
    labelCount,
    'Benchmark route should request the expected dataset size.',
  );
  assert.equal(
    benchmark.labelCount,
    labelCount,
    'Benchmark dataset should create the requested label count.',
  );
  assert.equal(
    benchmark.rendererMode,
    rendererMode,
    `Benchmark dataset should report renderer=${rendererMode}.`,
  );
  assert.ok(
    benchmark.glyphCount > benchmark.labelCount,
    'Benchmark should include multiple glyphs per label.',
  );
  assert.ok(
    benchmark.cpuFrameSamples >= 12,
    'Benchmark should capture a useful number of CPU frame samples.',
  );
  assert.ok(benchmark.cpuFrameAvgMs > 0, 'Benchmark should record average CPU frame time.');
  assert.ok(benchmark.cpuTextAvgMs > 0, 'Benchmark should record average CPU text-update time.');
  assert.ok(benchmark.cpuDrawAvgMs > 0, 'Benchmark should record average CPU draw/submit time.');
  assert.ok(
    benchmark.bytesUploadedPerFrame > 0,
    'Benchmark should record a positive per-frame upload cost.',
  );
  assert.ok(
    benchmark.submittedVertexCount > 0,
    'Benchmark should record submitted vertex counts.',
  );
  assert.ok(
    benchmark.submittedGlyphCount > 0,
    'Benchmark should record submitted glyph counts.',
  );
  assert.ok(
    benchmark.visibleLabelCount > 0,
    'Benchmark dataset should produce visible labels.',
  );
  assert.ok(
    benchmark.visibleGlyphCount > 0,
    'Benchmark dataset should produce visible glyphs.',
  );

  if (!benchmark.gpuTimingEnabled) {
    addBrowserLog('test', 'Benchmark GPU timestamps are disabled in the benchmark route.');
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
    `renderer=${benchmark.rendererMode}`,
    `labels=${benchmark.labelCount}`,
    `glyphs=${benchmark.glyphCount}`,
    `cpuFrame=${benchmark.cpuFrameAvgMs.toFixed(3)}ms`,
    `cpuText=${benchmark.cpuTextAvgMs.toFixed(3)}ms`,
    `cpuDraw=${benchmark.cpuDrawAvgMs.toFixed(3)}ms`,
    !benchmark.gpuTimingEnabled
      ? 'gpu=disabled'
      : benchmark.gpuFrameAvgMs === null
      ? 'gpu=unsupported'
      : `gpu=${benchmark.gpuFrameAvgMs.toFixed(3)}ms`,
    `uploaded=${benchmark.bytesUploadedPerFrame}B`,
    `submittedGlyphs=${benchmark.submittedGlyphCount}`,
    `submittedVertices=${benchmark.submittedVertexCount}`,
    `visibleChunks=${benchmark.visibleChunkCount}`,
    `visibleLabels=${benchmark.visibleLabelCount}`,
    `visibleGlyphs=${benchmark.visibleGlyphCount}`,
    `datasetPreset=${benchmark.datasetPreset}`,
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

  return benchmark;
}

function getBenchmarkKey(rendererMode: RendererMode, labelCount: number): string {
  return `${rendererMode}:${labelCount}`;
}

function getRequiredMapValue<K, V>(
  map: Map<K, V>,
  key: K,
  message: string,
): V {
  const value = map.get(key);

  assert.ok(value, message);
  return value;
}

function assertZoomSweepTransitions(
  checkpoints: LargeScaleSweepState[],
  rendererMode: RendererMode,
): void {
  const glyphCounts = checkpoints.map((checkpoint) => checkpoint.visibleGlyphCount);
  const uniqueGlyphCounts = new Set(glyphCounts);
  const deltas = glyphCounts.slice(1).map((count, index) => count - glyphCounts[index]);
  const hasVisibleState = glyphCounts.some((count) => count > 0);
  const hasHiddenState = glyphCounts.some((count) => count === 0);
  const hasIncrease = deltas.some((delta) => delta > 0);
  const hasDecrease = deltas.some((delta) => delta < 0);

  assert.ok(
    uniqueGlyphCounts.size >= 2,
    `${rendererMode} sweep should change visible glyph counts while zooming.`,
  );
  assert.ok(
    hasVisibleState,
    `${rendererMode} sweep should enter a visible text state during the zoom trace.`,
  );
  assert.ok(
    hasHiddenState,
    `${rendererMode} sweep should enter a hidden text state during the zoom trace.`,
  );
  assert.ok(
    hasIncrease,
    `${rendererMode} sweep should reveal more visible glyphs at some point while zooming.`,
  );
  assert.ok(
    hasDecrease,
    `${rendererMode} sweep should hide visible glyphs at some point while zooming.`,
  );
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
        document.body.dataset.rendererMode &&
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

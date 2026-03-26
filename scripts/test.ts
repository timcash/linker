import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
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
import {DEMO_LABEL_SET_ID} from '../src/data/demo-meta';
import {
  STATIC_BENCHMARK_COUNTS,
  STATIC_BENCHMARK_LABEL_SET_ID,
} from '../src/data/static-benchmark';
import {TEXT_STRATEGIES, type TextStrategy} from '../src/text/types';
import {
  MIN_ZOOM_SCALE,
  createZoomBand,
  getMaxVisibleZoom,
  getMinVisibleZoom,
  getZoomScale,
  isZoomVisible,
} from '../src/text/zoom';

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

type CameraQueryState = {
  centerX: number | null;
  centerY: number | null;
  zoom: number | null;
};

type StrategyPanelMode = 'text' | 'layout';
type LayoutStrategy = 'column-ramp' | 'scan-grid';

type TextState = {
  bytesUploadedPerFrame: number;
  labelSetPreset: string;
  labelCount: number;
  glyphCount: number;
  layoutFingerprint: string;
  layoutStrategy: string;
  textStrategy: TextStrategy;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  strategyPanelMode: string;
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
  labelSetKind: string;
  labelSetPreset: string;
  labelTargetCount: number;
  error: string;
  glyphCount: number;
  gpuFrameAvgMs: number | null;
  gpuFrameSamples: number;
  gpuSupported: boolean;
  gpuTextAvgMs: number | null;
  gpuTimingEnabled: boolean;
  labelCount: number;
  textStrategy: TextStrategy;
  state: string;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
};

type LargeScaleSweepState = {
  bytesUploadedPerFrame: number;
  labelSetPreset: string;
  name: string;
  textStrategy: TextStrategy;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
  zoom: number;
};

type CanvasPixelSignature = {
  brightPixelCount: number;
  nonZeroAlphaPixelCount: number;
  pixelHash: string;
  pixelSum: number;
  height: number;
  width: number;
};

type CameraTraceStep = {
  control: string;
  name: string;
  repeat: number;
};

const logPath = path.resolve(process.cwd(), 'browser.log');
const screenshotPath = path.resolve(process.cwd(), 'browser.png');
const readmeScreenshotPath = path.resolve(process.cwd(), 'docs/readme-ui.png');
const readmePath = path.resolve(process.cwd(), 'README.md');
const browserLogLines: string[] = [];
const benchmarkHistory: BenchmarkState[] = [];
const ERROR_PING_TOKEN = 'ERROR_PING_TEST';
const INTENTIONAL_ERROR_MARKER = '[intentional-error-ping]';
const BROWSER_UPDATE_FRAME_COUNT = 1;
const BENCHMARK_TRACE_FRAME_COUNT = 1;
const README_PERFORMANCE_HISTORY_HEADING = '## Performance History';
const README_PERFORMANCE_HISTORY_ENTRY_LIMIT = 3;
const README_PERFORMANCE_HISTORY_NOTE =
  'This section is auto-appended by `npm test` and keeps only the 3 most recent benchmark snapshots.';
const DEFAULT_LAYOUT_STRATEGY: LayoutStrategy = 'column-ramp';
const LAYOUT_STRATEGIES: readonly LayoutStrategy[] = ['column-ramp', 'scan-grid'];
const LARGE_SCALE_SWEEP_CAMERA_ZOOM = 4.08;
const LARGE_SCALE_CAMERA_TRACE: readonly CameraTraceStep[] = [
  {name: 'zoom-out-visible', control: 'zoom-out', repeat: 1},
  {name: 'zoom-out-wide', control: 'zoom-out', repeat: 1},
  {name: 'zoom-out-wider', control: 'zoom-out', repeat: 1},
  {name: 'zoom-in-return', control: 'zoom-in', repeat: 1},
  {name: 'zoom-in-tight', control: 'zoom-in', repeat: 1},
  {name: 'zoom-in-hidden', control: 'zoom-in', repeat: 1},
] as const;

await writeFile(logPath, '', 'utf8');

runCameraUnitTests();
runReadmePerformanceHistoryUnitTests();
runZoomBandUnitTests();

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
          labelSetPreset: document.body.dataset.labelSetPreset ?? '',
          labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
          glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
          layoutFingerprint: document.body.dataset.layoutFingerprint ?? '',
          layoutStrategy: document.body.dataset.layoutStrategy ?? '',
          textStrategy: (document.body.dataset.textStrategy ?? 'baseline') as TextStrategy,
          submittedGlyphCount: Number(document.body.dataset.textSubmittedGlyphCount ?? '0'),
          submittedVertexCount: Number(document.body.dataset.textSubmittedVertexCount ?? '0'),
          strategyPanelMode: document.body.dataset.strategyPanelMode ?? '',
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
    assert.equal(result.text.textStrategy, 'baseline', 'Demo route should default to the baseline text strategy.');
    assert.equal(result.text.labelSetPreset, DEMO_LABEL_SET_ID, 'Demo route should report the fixed demo label-set preset.');
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
    assert.deepEqual(
      await getCameraQueryState(page),
      {centerX: null, centerY: null, zoom: null},
      'Default route should omit camera query params.',
    );

    const readyUiState = await page.evaluate(() => {
      const message = document.querySelector('[data-testid="app-message"]');
      const cameraPanel = document.querySelector('[data-testid="camera-panel"]');
      const detailsPanel = document.querySelector('[data-testid="details-panel"]');
      const renderPanel = document.querySelector('[data-testid="render-panel"]');
      const layoutStrategyPanel = document.querySelector('[data-testid="layout-strategy-panel"]');
      const strategyModePanel = document.querySelector('[data-testid="strategy-mode-panel"]');
      const strategyPanelLabel = document.querySelector('[data-testid="strategy-panel-label"]');
      const textStrategyPanel = document.querySelector('[data-testid="text-strategy-panel"]');
      const statusPanel = document.querySelector('[data-testid="status-panel"]');
      const layoutStrategyButtons = [
        ...document.querySelectorAll<HTMLButtonElement>('button[data-layout-strategy]'),
      ];
      const strategyButtons = [...document.querySelectorAll<HTMLButtonElement>('button[data-text-strategy]')];
      const strategyModeButtons = [
        ...document.querySelectorAll<HTMLButtonElement>('button[data-strategy-panel-mode]'),
      ];
      const cameraRect = cameraPanel instanceof HTMLElement ? cameraPanel.getBoundingClientRect() : null;
      const detailsRect = detailsPanel instanceof HTMLElement ? detailsPanel.getBoundingClientRect() : null;
      const renderRect = renderPanel instanceof HTMLElement ? renderPanel.getBoundingClientRect() : null;
      const statusRect = statusPanel instanceof HTMLElement ? statusPanel.getBoundingClientRect() : null;
      const strategyModeRect =
        strategyModePanel instanceof HTMLElement ? strategyModePanel.getBoundingClientRect() : null;

      return {
        messageHiddenProperty: message instanceof HTMLElement ? message.hidden : false,
        messageDisplay: message instanceof HTMLElement ? window.getComputedStyle(message).display : '',
        cameraPanelVisible:
          cameraPanel instanceof HTMLElement &&
          window.getComputedStyle(cameraPanel).display !== 'none',
        detailsPanelVisible:
          detailsPanel instanceof HTMLElement &&
          window.getComputedStyle(detailsPanel).display !== 'none',
        strategyModePanelVisible:
          strategyModePanel instanceof HTMLElement &&
          window.getComputedStyle(strategyModePanel).display !== 'none',
        renderPanelVisible:
          renderPanel instanceof HTMLElement && window.getComputedStyle(renderPanel).display !== 'none',
        layoutStrategyPanelVisible:
          layoutStrategyPanel instanceof HTMLElement &&
          !layoutStrategyPanel.hidden &&
          window.getComputedStyle(layoutStrategyPanel).display !== 'none',
        textStrategyPanelVisible:
          textStrategyPanel instanceof HTMLElement &&
          !textStrategyPanel.hidden &&
          window.getComputedStyle(textStrategyPanel).display !== 'none',
        cameraRightGap: cameraRect ? Math.round(window.innerWidth - cameraRect.right) : -1,
        cameraBottomGap: cameraRect ? Math.round(window.innerHeight - cameraRect.bottom) : -1,
        detailsRightGap: detailsRect ? Math.round(window.innerWidth - detailsRect.right) : -1,
        layoutStrategyButtonModes: layoutStrategyButtons.map((button) => button.dataset.layoutStrategy ?? ''),
        strategyModeButtonModes: strategyModeButtons.map((button) => button.dataset.strategyPanelMode ?? ''),
        strategyModeRightGap: strategyModeRect ? Math.round(window.innerWidth - strategyModeRect.right) : -1,
        strategyModeTopGap: strategyModeRect ? Math.round(strategyModeRect.top) : -1,
        strategyPanelLabelText: strategyPanelLabel instanceof HTMLElement ? strategyPanelLabel.textContent ?? '' : '',
        textStrategyButtonModes: strategyButtons.map((button) => button.dataset.textStrategy ?? ''),
        renderLeftGap: renderRect ? Math.round(renderRect.left) : -1,
        renderBottomGap: renderRect ? Math.round(window.innerHeight - renderRect.bottom) : -1,
        statusLeftGap: statusRect ? Math.round(statusRect.left) : -1,
        statusTopGap: statusRect ? Math.round(statusRect.top) : -1,
        detailsTopGap: detailsRect ? Math.round(detailsRect.top) : -1,
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
    assert.equal(readyUiState.cameraPanelVisible, true, 'Camera panel should be visible.');
    assert.equal(readyUiState.detailsPanelVisible, true, 'Details panel should be visible.');
    assert.equal(readyUiState.strategyModePanelVisible, true, 'Strategy view panel should be visible.');
    assert.equal(readyUiState.renderPanelVisible, true, 'Render panel should be visible.');
    assert.equal(readyUiState.textStrategyPanelVisible, true, 'Text strategy panel should be visible.');
    assert.equal(readyUiState.layoutStrategyPanelVisible, false, 'Layout strategy panel should be hidden by default.');
    assert.equal(readyUiState.strategyPanelLabelText, 'Text Strategy', 'Render panel should default to the text strategy label.');
    assert.deepEqual(
      readyUiState.textStrategyButtonModes,
      [...TEXT_STRATEGIES],
      'Text strategy panel should expose a button for every text strategy.',
    );
    assert.deepEqual(
      readyUiState.layoutStrategyButtonModes,
      [...getLayoutStrategies()],
      'Layout strategy panel should expose a button for every layout strategy.',
    );
    assert.deepEqual(
      readyUiState.strategyModeButtonModes,
      ['text', 'layout'],
      'Strategy view panel should expose text and layout toggles.',
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
      readyUiState.detailsRightGap >= 0 && readyUiState.detailsRightGap <= 32,
      'Details panel should sit near the right edge.',
    );
    assert.ok(
      readyUiState.detailsTopGap >= 0 && readyUiState.detailsTopGap <= 32,
      'Details panel should sit near the top edge.',
    );
    assert.ok(
      readyUiState.strategyModeRightGap >= 0 && readyUiState.strategyModeRightGap <= 32,
      'Strategy view panel should sit near the right edge.',
    );
    assert.ok(
      readyUiState.strategyModeTopGap > readyUiState.detailsTopGap,
      'Strategy view panel should sit below the details panel.',
    );
    assert.ok(
      readyUiState.renderLeftGap >= 0 && readyUiState.renderLeftGap <= 32,
      'Render panel should sit near the left edge.',
    );
    assert.ok(
      readyUiState.renderBottomGap >= 0 && readyUiState.renderBottomGap <= 32,
      'Render panel should sit near the bottom edge.',
    );
    assert.ok(
      readyUiState.cameraRightGap >= 0 && readyUiState.cameraRightGap <= 32,
      'Camera panel should sit near the right edge.',
    );
    assert.ok(
      readyUiState.cameraBottomGap >= 0 && readyUiState.cameraBottomGap <= 32,
      'Camera panel should sit near the bottom edge.',
    );

    const baselineLayoutFingerprint = result.text.layoutFingerprint;

    await showStrategyPanelMode(page, 'layout');

    const layoutPanelUiState = await page.evaluate(() => {
      const layoutStrategyPanel = document.querySelector('[data-testid="layout-strategy-panel"]');
      const strategyPanelLabel = document.querySelector('[data-testid="strategy-panel-label"]');
      const textStrategyPanel = document.querySelector('[data-testid="text-strategy-panel"]');

      return {
        layoutStrategyPanelVisible:
          layoutStrategyPanel instanceof HTMLElement &&
          !layoutStrategyPanel.hidden &&
          window.getComputedStyle(layoutStrategyPanel).display !== 'none',
        strategyPanelLabelText: strategyPanelLabel instanceof HTMLElement ? strategyPanelLabel.textContent ?? '' : '',
        textStrategyPanelVisible:
          textStrategyPanel instanceof HTMLElement &&
          !textStrategyPanel.hidden &&
          window.getComputedStyle(textStrategyPanel).display !== 'none',
      };
    });

    assert.equal(layoutPanelUiState.layoutStrategyPanelVisible, true, 'Layout strategy panel should appear when selected.');
    assert.equal(layoutPanelUiState.textStrategyPanelVisible, false, 'Text strategy panel should hide while layout strategy view is active.');
    assert.equal(layoutPanelUiState.strategyPanelLabelText, 'Layout Strategy', 'Render panel should rename itself for layout strategies.');

    await switchLayoutStrategy(page, 'scan-grid');

    const relaidTextState = await getTextState(page);
    assert.equal(relaidTextState.layoutStrategy, 'scan-grid', 'Scan Grid should become the active layout strategy.');
    assert.equal(relaidTextState.strategyPanelMode, 'layout', 'Layout strategy view should remain active after switching layouts.');
    assert.ok(relaidTextState.visibleLabelCount > 0, 'Relayout should keep visible demo labels on screen.');

    assert.notEqual(
      relaidTextState.layoutFingerprint,
      baselineLayoutFingerprint,
      'Changing the layout strategy should rewrite the generated label locations.',
    );

    await switchLayoutStrategy(page, DEFAULT_LAYOUT_STRATEGY);
    await showStrategyPanelMode(page, 'text');

    const restoredTextState = await getTextState(page);
    assert.equal(
      restoredTextState.layoutStrategy,
      DEFAULT_LAYOUT_STRATEGY,
      'Switching back should restore the default layout strategy.',
    );
    assert.equal(
      restoredTextState.strategyPanelMode,
      'text',
      'Text strategy view should become active again after switching back.',
    );

    assert.equal(
      restoredTextState.layoutFingerprint,
      baselineLayoutFingerprint,
      'Restoring the default layout strategy should restore the original label locations.',
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
    assertCameraQueryClose(
      await getCameraQueryState(page),
      {centerX: null, centerY: null, zoom: afterZoomIn.zoom},
      'Zoom In should write the current camera zoom into the URL.',
    );

    const textAfterZoomIn = await getTextState(page);
    assert.doesNotMatch(
      textAfterZoomIn.visibleLabels,
      /BUTTON PAN/,
      'BUTTON PAN should disappear once the zoom leaves its focal zoom band.',
    );
    assert.match(
      textAfterZoomIn.visibleLabels,
      /LUMA TEXT/,
      'LUMA TEXT should appear once the zoom enters its focal zoom band.',
    );

    await clickControl(page, 'zoom-out');
    await page.waitForFunction(
      ({zoom}) => Number(document.body.dataset.cameraZoom) < zoom,
      {},
      {zoom: afterZoomIn.zoom},
    );

    const afterZoomOut = await getCameraState(page);
    assert.ok(afterZoomOut.zoom < afterZoomIn.zoom, 'Zoom Out button should decrease zoom.');
    assertCameraQueryClose(
      await getCameraQueryState(page),
      {centerX: null, centerY: null, zoom: null},
      'Zoom Out should keep the URL camera params aligned with the current view.',
    );

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
    assertCameraQueryClose(
      await getCameraQueryState(page),
      {centerX: afterPanRight.centerX, centerY: null, zoom: null},
      'Pan Right should write the current camera centerX into the URL.',
    );

    await clickControl(page, 'pan-up');
    await page.waitForFunction(
      ({centerY}) => Number(document.body.dataset.cameraCenterY) !== centerY,
      {},
      {centerY: afterPanRight.centerY},
    );

    const afterPanUp = await getCameraState(page);
    assert.ok(afterPanUp.centerY > afterPanRight.centerY, 'Up pan control should increase centerY.');
    assertCameraQueryClose(
      await getCameraQueryState(page),
      {centerX: afterPanUp.centerX, centerY: afterPanUp.centerY, zoom: null},
      'Pan Up should keep the full camera view synchronized in the URL.',
    );

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
    assert.deepEqual(
      await getCameraQueryState(page),
      {centerX: null, centerY: null, zoom: null},
      'Reset should clear camera query params from the URL.',
    );

    const textAfterReset = await getTextState(page);
    assert.match(
      textAfterReset.visibleLabels,
      /BUTTON PAN/,
      'Reset should restore the initial zoom-band visibility.',
    );
    assert.doesNotMatch(
      textAfterReset.visibleLabels,
      /WORLD VIEW/,
      'WORLD VIEW should stay hidden until zooming out far enough.',
    );

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

    const seededCameraUrl = new URL(url);
    seededCameraUrl.searchParams.set('cameraCenterX', '1.25');
    seededCameraUrl.searchParams.set('cameraCenterY', '-2.5');
    seededCameraUrl.searchParams.set('cameraZoom', '0.75');

    await page.goto(seededCameraUrl.toString(), {waitUntil: 'networkidle0'});
    await waitForAppDatasets(page);

    const seededCamera = await getCameraState(page);
    assertCameraStateClose(
      seededCamera,
      {centerX: 1.25, centerY: -2.5, zoom: 0.75},
      'Camera query params should seed the initial camera view.',
    );
    assertCameraQueryClose(
      await getCameraQueryState(page),
      {centerX: seededCamera.centerX, centerY: seededCamera.centerY, zoom: seededCamera.zoom},
      'Seeded camera routes should preserve the current camera view in the URL.',
    );

    await page.goto(url, {waitUntil: 'networkidle0'});
    await waitForAppDatasets(page);

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

    const demoStrategyChecks = new Map<TextStrategy, TextState>();
    const demoStrategySignatures = new Map<TextStrategy, CanvasPixelSignature>();

    for (const textStrategy of getTextStrategies()) {
      addBrowserLog('test', `Verifying demo text strategy ${textStrategy}`);
      await switchTextStrategy(page, textStrategy);
      const demoTextState = await verifyDemoTextStrategyVisibility(page, textStrategy);
      demoStrategyChecks.set(textStrategy, demoTextState);
      demoStrategySignatures.set(textStrategy, await getCanvasPixelSignature(page));
    }

    const baselineDemo = getRequiredMapValue(
      demoStrategyChecks,
      'baseline',
      'Baseline demo text strategy should be verified.',
    );
    const instancedDemo = getRequiredMapValue(
      demoStrategyChecks,
      'instanced',
      'Instanced demo text strategy should be verified.',
    );
    const visibleIndexDemo = getRequiredMapValue(
      demoStrategyChecks,
      'visible-index',
      'Visible-index demo text strategy should be verified.',
    );
    const chunkedDemo = getRequiredMapValue(
      demoStrategyChecks,
      'chunked',
      'Chunked demo text strategy should be verified.',
    );
    const packedDemo = getRequiredMapValue(
      demoStrategyChecks,
      'packed',
      'Packed demo text strategy should be verified.',
    );
    const sdfInstancedDemo = getRequiredMapValue(
      demoStrategyChecks,
      'sdf-instanced',
      'SDF instanced demo text strategy should be verified.',
    );
    const sdfVisibleIndexDemo = getRequiredMapValue(
      demoStrategyChecks,
      'sdf-visible-index',
      'SDF visible-index demo text strategy should be verified.',
    );

    for (const textStrategy of getTextStrategies()) {
      const demoState = getRequiredMapValue(
        demoStrategyChecks,
        textStrategy,
        `Demo text strategy ${textStrategy} should be verified.`,
      );
      assert.equal(
        demoState.labelSetPreset,
        DEMO_LABEL_SET_ID,
        `${textStrategy} demo mode should use the shared demo label-set preset.`,
      );
      assert.equal(
        demoState.visibleLabelCount,
        baselineDemo.visibleLabelCount,
        `Demo visibility should match baseline for text strategy ${textStrategy}.`,
      );
      assert.equal(
        demoState.visibleGlyphCount,
        baselineDemo.visibleGlyphCount,
        `Demo glyph visibility should match baseline for text strategy ${textStrategy}.`,
      );
    }

    const baselineDemoSignature = getRequiredMapValue(
      demoStrategySignatures,
      'baseline',
      'Baseline demo canvas signature should be captured.',
    );

    for (const textStrategy of getTextStrategies()) {
      const demoSignature = getRequiredMapValue(
        demoStrategySignatures,
        textStrategy,
        `Demo canvas signature should be captured for text strategy ${textStrategy}.`,
      );

      if (preservesBaselinePixels(textStrategy)) {
        assert.deepEqual(
          demoSignature,
          baselineDemoSignature,
          `Demo canvas pixels should match baseline for text strategy ${textStrategy}.`,
        );
        continue;
      }

      assert.equal(
        demoSignature.width,
        baselineDemoSignature.width,
        `${textStrategy} demo signature should keep the canvas width stable.`,
      );
      assert.equal(
        demoSignature.height,
        baselineDemoSignature.height,
        `${textStrategy} demo signature should keep the canvas height stable.`,
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
    assert.ok(
      sdfInstancedDemo.bytesUploadedPerFrame < baselineDemo.bytesUploadedPerFrame,
      'SDF instanced demo mode should upload fewer per-frame bytes than baseline.',
    );
    assert.ok(
      sdfInstancedDemo.bytesUploadedPerFrame >= instancedDemo.bytesUploadedPerFrame,
      'SDF instanced demo mode should upload at least as much as bitmap instanced because it adds SDF uniforms.',
    );
    assert.equal(
      sdfInstancedDemo.submittedVertexCount,
      sdfInstancedDemo.visibleGlyphCount * 4,
      'SDF instanced demo mode should submit four vertices per visible glyph.',
    );
    assert.ok(
      sdfVisibleIndexDemo.bytesUploadedPerFrame < sdfInstancedDemo.bytesUploadedPerFrame,
      'SDF visible-index demo mode should upload fewer per-frame bytes than SDF instanced.',
    );
    assert.ok(
      sdfVisibleIndexDemo.bytesUploadedPerFrame >= visibleIndexDemo.bytesUploadedPerFrame,
      'SDF visible-index demo mode should upload at least as much as bitmap visible-index because it adds SDF uniforms.',
    );
    assert.equal(
      sdfVisibleIndexDemo.submittedVertexCount,
      sdfVisibleIndexDemo.visibleGlyphCount * 4,
      'SDF visible-index demo mode should submit four vertices per visible glyph.',
    );

    const largeScaleLabelCount = STATIC_BENCHMARK_COUNTS[1];
    const largeScaleSweeps = new Map<TextStrategy, LargeScaleSweepState[]>();

    for (const textStrategy of getTextStrategies()) {
      addBrowserLog(
        'test',
        `Running large-scale visibility sweep strategy=${textStrategy} labels=${largeScaleLabelCount}`,
      );
      const sweep = await runLargeScaleTextStrategySweep(page, url, textStrategy, largeScaleLabelCount);
      largeScaleSweeps.set(textStrategy, sweep);
    }

    const baselineSweep = getRequiredMapValue(
      largeScaleSweeps,
      'baseline',
      'Baseline large-scale sweep should be recorded.',
    );
    const sweepTraceNames = baselineSweep.map((state) => state.name);

    for (const textStrategy of getTextStrategies()) {
      const sweep = getRequiredMapValue(
        largeScaleSweeps,
        textStrategy,
        `Missing large-scale sweep for text strategy ${textStrategy}.`,
      );
      assert.deepEqual(
        sweep.map((state) => state.name),
        sweepTraceNames,
        `Sweep checkpoints should use the same zoom trace for text strategy ${textStrategy}.`,
      );
      assertZoomSweepTransitions(sweep, textStrategy);
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
      const sdfInstancedCheckpoint = getRequiredMapValue(
        largeScaleSweeps,
        'sdf-instanced',
        'SDF instanced sweep should be recorded.',
      )[index];
      const sdfVisibleIndexCheckpoint = getRequiredMapValue(
        largeScaleSweeps,
        'sdf-visible-index',
        'SDF visible-index sweep should be recorded.',
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
        sdfInstancedCheckpoint,
        sdfVisibleIndexCheckpoint,
        packedCheckpoint,
      ]) {
        assert.equal(
          checkpoint.labelSetPreset,
          STATIC_BENCHMARK_LABEL_SET_ID,
          `${checkpoint.textStrategy} sweep checkpoint ${checkpoint.name} should use the static benchmark label set.`,
        );
        assert.equal(
          checkpoint.visibleLabelCount,
          baselineCheckpoint.visibleLabelCount,
          `${checkpointName} visible label counts should match baseline for text strategy ${checkpoint.textStrategy}.`,
        );
        assert.equal(
          checkpoint.visibleGlyphCount,
          baselineCheckpoint.visibleGlyphCount,
          `${checkpointName} visible glyph counts should match baseline for text strategy ${checkpoint.textStrategy}.`,
        );
      }

      if (baselineCheckpoint.visibleGlyphCount === 0) {
        for (const checkpoint of [
          baselineCheckpoint,
          instancedCheckpoint,
          visibleIndexCheckpoint,
          chunkedCheckpoint,
          sdfInstancedCheckpoint,
          sdfVisibleIndexCheckpoint,
          packedCheckpoint,
        ]) {
          assert.equal(
            checkpoint.bytesUploadedPerFrame,
            0,
            `${checkpointName} ${checkpoint.textStrategy} sweep should upload nothing when no glyphs are visible.`,
          );
          assert.equal(
            checkpoint.submittedVertexCount,
            0,
            `${checkpointName} ${checkpoint.textStrategy} sweep should submit no vertices when no glyphs are visible.`,
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
        sdfInstancedCheckpoint.bytesUploadedPerFrame < baselineCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} SDF instanced sweep should upload fewer bytes than baseline.`,
      );
      assert.ok(
        sdfInstancedCheckpoint.bytesUploadedPerFrame >= instancedCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} SDF instanced sweep should upload at least as much as bitmap instanced.`,
      );
      assert.ok(
        sdfVisibleIndexCheckpoint.bytesUploadedPerFrame < sdfInstancedCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} SDF visible-index sweep should upload fewer bytes than SDF instanced.`,
      );
      assert.ok(
        sdfVisibleIndexCheckpoint.bytesUploadedPerFrame >= visibleIndexCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} SDF visible-index sweep should upload at least as much as bitmap visible-index.`,
      );
      assert.ok(
        packedCheckpoint.bytesUploadedPerFrame < visibleIndexCheckpoint.bytesUploadedPerFrame,
        `${checkpointName} packed sweep should upload fewer bytes than visible-index.`,
      );
      assert.equal(
        sdfInstancedCheckpoint.submittedVertexCount,
        sdfInstancedCheckpoint.visibleGlyphCount * 4,
        `${checkpointName} SDF instanced sweep should submit four vertices per visible glyph.`,
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
      assert.equal(
        sdfVisibleIndexCheckpoint.submittedVertexCount,
        sdfVisibleIndexCheckpoint.visibleGlyphCount * 4,
        `${checkpointName} SDF visible-index sweep should submit four vertices per visible glyph.`,
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
      for (const textStrategy of getTextStrategies()) {
        const benchmark = await runBenchmarkRoute(page, url, textStrategy, labelCount, pageErrors);
        benchmarkResults.set(getBenchmarkKey(textStrategy, labelCount), benchmark);
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
      const sdfInstancedBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('sdf-instanced', labelCount),
        `Missing SDF instanced benchmark for labelCount=${labelCount}.`,
      );
      const sdfVisibleIndexBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('sdf-visible-index', labelCount),
        `Missing SDF visible-index benchmark for labelCount=${labelCount}.`,
      );
      const packedBenchmark = getRequiredMapValue(
        benchmarkResults,
        getBenchmarkKey('packed', labelCount),
        `Missing packed benchmark for labelCount=${labelCount}.`,
      );

      for (const textStrategy of getTextStrategies()) {
        const benchmark = getRequiredMapValue(
          benchmarkResults,
          getBenchmarkKey(textStrategy, labelCount),
          `Missing benchmark for strategy=${textStrategy} labelCount=${labelCount}.`,
        );
        assert.equal(
          benchmark.labelSetPreset,
          STATIC_BENCHMARK_LABEL_SET_ID,
          `Benchmark should use the static benchmark label set for strategy=${textStrategy} labelCount=${labelCount}.`,
        );
        assert.equal(
          benchmark.visibleLabelCount,
          baselineBenchmark.visibleLabelCount,
          `Visible label counts should match baseline for strategy=${textStrategy} at ${labelCount} labels.`,
        );
        assert.equal(
          benchmark.visibleGlyphCount,
          baselineBenchmark.visibleGlyphCount,
          `Visible glyph counts should match baseline for strategy=${textStrategy} at ${labelCount} labels.`,
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
        sdfInstancedBenchmark.bytesUploadedPerFrame < baselineBenchmark.bytesUploadedPerFrame,
        `SDF instanced benchmark should upload fewer bytes than baseline at ${labelCount} labels.`,
      );
      assert.ok(
        sdfInstancedBenchmark.bytesUploadedPerFrame >= instancedBenchmark.bytesUploadedPerFrame,
        `SDF instanced benchmark should upload at least as much as bitmap instanced at ${labelCount} labels.`,
      );
      assert.ok(
        sdfVisibleIndexBenchmark.bytesUploadedPerFrame < sdfInstancedBenchmark.bytesUploadedPerFrame,
        `SDF visible-index benchmark should upload fewer bytes than SDF instanced at ${labelCount} labels.`,
      );
      assert.ok(
        sdfVisibleIndexBenchmark.bytesUploadedPerFrame >= visibleIndexBenchmark.bytesUploadedPerFrame,
        `SDF visible-index benchmark should upload at least as much as bitmap visible-index at ${labelCount} labels.`,
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
        sdfInstancedBenchmark.submittedVertexCount,
        sdfInstancedBenchmark.visibleGlyphCount * 4,
        `SDF instanced benchmark should submit four vertices per visible glyph at ${labelCount} labels.`,
      );
      assert.equal(
        chunkedBenchmark.submittedVertexCount,
        chunkedBenchmark.visibleGlyphCount * 4,
        `Chunked benchmark should submit four vertices per visible glyph at ${labelCount} labels.`,
      );
      assert.equal(
        sdfVisibleIndexBenchmark.submittedVertexCount,
        sdfVisibleIndexBenchmark.visibleGlyphCount * 4,
        `SDF visible-index benchmark should submit four vertices per visible glyph at ${labelCount} labels.`,
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
      'Packed benchmark uploads should stay constant across benchmark label counts.',
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
      /Benchmark summary strategy=/,
      'browser.log should contain benchmark summary lines for strategy runs.',
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
      await mkdir(path.dirname(readmeScreenshotPath), {recursive: true});
      const screenshot = await page.screenshot({
        fullPage: true,
      });

      await Promise.all([
        writeFile(screenshotPath, screenshot),
        writeFile(readmeScreenshotPath, screenshot),
      ]);
      addBrowserLog(
        'artifact',
        `Saved screenshots to ${screenshotPath} and ${readmeScreenshotPath}`,
      );
    } catch (error) {
      addBrowserLog(
        'artifact.error',
        `Failed to save screenshot: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  try {
    await appendReadmePerformanceHistory(benchmarkHistory);
    if (benchmarkHistory.length > 0) {
      addBrowserLog(
        'artifact',
        `Appended ${benchmarkHistory.length} benchmark summaries to ${readmePath}`,
      );
    }
  } catch (error) {
    console.error(
      `Failed to append README performance history: ${error instanceof Error ? error.message : String(error)}`,
    );
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

async function getCameraQueryState(page: Page): Promise<CameraQueryState> {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    const centerXValue = url.searchParams.get('cameraCenterX');
    const centerYValue = url.searchParams.get('cameraCenterY');
    const zoomValue = url.searchParams.get('cameraZoom');
    const centerX = centerXValue === null ? null : Number(centerXValue);
    const centerY = centerYValue === null ? null : Number(centerYValue);
    const zoom = zoomValue === null ? null : Number(zoomValue);

    return {
      centerX: Number.isFinite(centerX) ? centerX : null,
      centerY: Number.isFinite(centerY) ? centerY : null,
      zoom: Number.isFinite(zoom) ? zoom : null,
    };
  });
}

async function getTextState(page: Page): Promise<TextState> {
  return page.evaluate(() => ({
    bytesUploadedPerFrame: Number(document.body.dataset.textBytesUploadedPerFrame ?? '0'),
    labelSetPreset: document.body.dataset.labelSetPreset ?? '',
    labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
    glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
    layoutFingerprint: document.body.dataset.layoutFingerprint ?? '',
    layoutStrategy: document.body.dataset.layoutStrategy ?? '',
    textStrategy: (document.body.dataset.textStrategy ?? 'baseline') as TextStrategy,
    submittedGlyphCount: Number(document.body.dataset.textSubmittedGlyphCount ?? '0'),
    submittedVertexCount: Number(document.body.dataset.textSubmittedVertexCount ?? '0'),
    strategyPanelMode: document.body.dataset.strategyPanelMode ?? '',
    visibleChunkCount: Number(document.body.dataset.textVisibleChunkCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.textVisibleLabelCount ?? '0'),
    visibleLabels: document.body.dataset.textVisibleLabels ?? '',
    visibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
  }));
}

async function getCanvasPixelSignature(page: Page): Promise<CanvasPixelSignature> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gpu-canvas"]');

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Expected a canvas element.');
    }

    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;

    const context = copy.getContext('2d', {willReadFrequently: true});

    if (!context) {
      throw new Error('Expected a 2D context.');
    }

    context.drawImage(canvas, 0, 0);

    const {data, width, height} = context.getImageData(0, 0, copy.width, copy.height);
    let hash = 2166136261;
    let pixelSum = 0;
    let nonZeroAlphaPixelCount = 0;
    let brightPixelCount = 0;

    for (let index = 0; index < data.length; index += 4) {
      const red = data[index] ?? 0;
      const green = data[index + 1] ?? 0;
      const blue = data[index + 2] ?? 0;
      const alpha = data[index + 3] ?? 0;

      hash ^= red;
      hash = Math.imul(hash, 16777619);
      hash ^= green;
      hash = Math.imul(hash, 16777619);
      hash ^= blue;
      hash = Math.imul(hash, 16777619);
      hash ^= alpha;
      hash = Math.imul(hash, 16777619);

      pixelSum = (pixelSum + red + green + blue + alpha) >>> 0;

      if (alpha > 0) {
        nonZeroAlphaPixelCount += 1;
      }

      if (red + green + blue > 540) {
        brightPixelCount += 1;
      }
    }

    return {
      brightPixelCount,
      nonZeroAlphaPixelCount,
      pixelHash: (hash >>> 0).toString(16).padStart(8, '0'),
      pixelSum,
      height,
      width,
    };
  });
}

async function getBenchmarkState(page: Page): Promise<BenchmarkState> {
  return page.evaluate(() => ({
    bytesUploadedPerFrame: Number(document.body.dataset.benchmarkBytesUploadedPerFrame ?? '0'),
    cpuDrawAvgMs: Number(document.body.dataset.benchmarkCpuDrawAvgMs ?? '0'),
    cpuFrameAvgMs: Number(document.body.dataset.benchmarkCpuFrameAvgMs ?? '0'),
    cpuFrameSamples: Number(document.body.dataset.benchmarkCpuFrameSamples ?? '0'),
    cpuTextAvgMs: Number(document.body.dataset.benchmarkCpuTextAvgMs ?? '0'),
    labelSetKind: document.body.dataset.benchmarkLabelSetKind ?? '',
    labelSetPreset: document.body.dataset.benchmarkLabelSetPreset ?? '',
    labelTargetCount: Number(document.body.dataset.benchmarkLabelTargetCount ?? '0'),
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
    gpuTextAvgMs:
      document.body.dataset.benchmarkGpuTextAvgMs === 'unsupported' ||
      document.body.dataset.benchmarkGpuTextAvgMs === 'disabled' ||
      document.body.dataset.benchmarkGpuTextAvgMs === 'pending'
        ? null
        : Number(document.body.dataset.benchmarkGpuTextAvgMs ?? '0'),
    gpuTimingEnabled: document.body.dataset.benchmarkGpuTimingEnabled === 'true',
    labelCount: Number(document.body.dataset.benchmarkLabelCount ?? '0'),
    textStrategy: (document.body.dataset.benchmarkTextStrategy ?? 'baseline') as TextStrategy,
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
  }

  await waitForBrowserUpdate(page);
}

function getTextStrategies(): TextStrategy[] {
  return [...TEXT_STRATEGIES];
}

function getLayoutStrategies(): LayoutStrategy[] {
  return [...LAYOUT_STRATEGIES];
}

function isSdfTextStrategy(textStrategy: TextStrategy): boolean {
  return textStrategy === 'sdf-instanced' || textStrategy === 'sdf-visible-index';
}

function preservesBaselinePixels(textStrategy: TextStrategy): boolean {
  return !isSdfTextStrategy(textStrategy);
}

async function showStrategyPanelMode(page: Page, mode: StrategyPanelMode): Promise<void> {
  const currentMode = await page.evaluate(
    () => (document.body.dataset.strategyPanelMode ?? 'text') as StrategyPanelMode,
  );

  if (currentMode !== mode) {
    const selector = `button[data-strategy-panel-mode="${mode}"]`;
    await page.waitForSelector(selector);
    await page.evaluate((buttonSelector) => {
      const button = document.querySelector<HTMLButtonElement>(buttonSelector);

      if (!button) {
        throw new Error(`Missing strategy panel mode button ${buttonSelector}`);
      }

      button.click();
    }, selector);
  }

  await page.waitForFunction(
    (expectedMode) => document.body.dataset.strategyPanelMode === expectedMode,
    {},
    mode,
  );
  await page.waitForFunction(
    (expectedMode) => {
      const button = document.querySelector(`button[data-strategy-panel-mode="${expectedMode}"]`);
      return button?.getAttribute('aria-pressed') === 'true';
    },
    {},
    mode,
  );
  await waitForBrowserUpdate(page);
}

async function switchTextStrategy(page: Page, textStrategy: TextStrategy): Promise<void> {
  await showStrategyPanelMode(page, 'text');

  const currentMode = await page.evaluate(
    () => (document.body.dataset.textStrategy ?? 'baseline') as TextStrategy,
  );

  if (currentMode !== textStrategy) {
    const selector = `button[data-text-strategy="${textStrategy}"]`;
    await page.waitForSelector(selector);
    await page.evaluate((buttonSelector) => {
      const button = document.querySelector<HTMLButtonElement>(buttonSelector);

      if (!button) {
        throw new Error(`Missing text strategy button ${buttonSelector}`);
      }

      button.click();
    }, selector);
  }

  await page.waitForFunction(
    (expectedMode) => document.body.dataset.textStrategy === expectedMode,
    {},
    textStrategy,
  );
  await page.waitForFunction(
    (expectedMode) => {
      const button = document.querySelector(`button[data-text-strategy="${expectedMode}"]`);
      return button?.getAttribute('aria-pressed') === 'true';
    },
    {},
    textStrategy,
  );
  await waitForBrowserUpdate(page);
}

async function switchLayoutStrategy(page: Page, layoutStrategy: LayoutStrategy): Promise<void> {
  await showStrategyPanelMode(page, 'layout');

  const currentMode = await page.evaluate(() => document.body.dataset.layoutStrategy ?? '');

  if (currentMode !== layoutStrategy) {
    const selector = `button[data-layout-strategy="${layoutStrategy}"]`;
    await page.waitForSelector(selector);
    await page.evaluate((buttonSelector) => {
      const button = document.querySelector<HTMLButtonElement>(buttonSelector);

      if (!button) {
        throw new Error(`Missing layout strategy button ${buttonSelector}`);
      }

      button.click();
    }, selector);
  }

  await page.waitForFunction(
    (expectedMode) => document.body.dataset.layoutStrategy === expectedMode,
    {},
    layoutStrategy,
  );
  await page.waitForFunction(
    (expectedMode) => {
      const button = document.querySelector(`button[data-layout-strategy="${expectedMode}"]`);
      return button?.getAttribute('aria-pressed') === 'true';
    },
    {},
    layoutStrategy,
  );
  await waitForBrowserUpdate(page);
}

async function verifyDemoTextStrategyVisibility(
  page: Page,
  textStrategy: TextStrategy,
): Promise<TextState> {
  const textState = await getTextState(page);

  assert.equal(
    textState.layoutStrategy,
    DEFAULT_LAYOUT_STRATEGY,
    `${textStrategy} mode should keep the default layout strategy active.`,
  );
  assert.equal(
    textState.strategyPanelMode,
    'text',
    `${textStrategy} mode should keep the text strategy panel visible.`,
  );
  assert.equal(textState.textStrategy, textStrategy, `${textStrategy} mode should be active.`);

  await clickControl(page, 'reset-camera');
  await page.waitForFunction(
    () =>
      Number(document.body.dataset.cameraCenterX) === 0 &&
      Number(document.body.dataset.cameraCenterY) === 0 &&
      Number(document.body.dataset.cameraZoom) === 0,
  );

  const initialText = await getTextState(page);
  assert.equal(
    initialText.labelSetPreset,
    DEMO_LABEL_SET_ID,
    `${textStrategy} mode should continue using the demo label-set preset.`,
  );
  assert.match(
    initialText.visibleLabels,
    /BUTTON PAN/,
    `${textStrategy} mode should show BUTTON PAN at the default zoom.`,
  );
  assert.doesNotMatch(
    initialText.visibleLabels,
    /LUMA TEXT/,
    `${textStrategy} mode should hide LUMA TEXT at the default zoom.`,
  );
  assert.ok(
    initialText.bytesUploadedPerFrame > 0,
    `${textStrategy} mode should report positive per-frame upload cost while drawing.`,
  );
  if (textStrategy === 'chunked') {
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
    `${textStrategy} mode should hide BUTTON PAN after zooming in.`,
  );
  assert.match(
    afterZoomIn.visibleLabels,
    /LUMA TEXT/,
    `${textStrategy} mode should show LUMA TEXT after zooming in.`,
  );

  await clickControl(page, 'zoom-out');
  await page.waitForFunction(
    () => Number(document.body.dataset.cameraZoom) === 0,
  );

  await clickControlRepeatedly(page, 'zoom-out', 1);
  await page.waitForFunction(
    () => (document.body.dataset.textVisibleLabels ?? '').includes('WORLD VIEW'),
  );

  const afterZoomOut = await getTextState(page);
  assert.match(
    afterZoomOut.visibleLabels,
    /WORLD VIEW/,
    `${textStrategy} mode should show WORLD VIEW after zooming out.`,
  );
  if (textStrategy === 'chunked') {
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

async function runLargeScaleTextStrategySweep(
  page: Page,
  baseUrl: string,
  textStrategy: TextStrategy,
  labelCount: number,
): Promise<LargeScaleSweepState[]> {
  const sweepUrl = new URL(baseUrl);
  sweepUrl.searchParams.set('labelSet', 'benchmark');
  sweepUrl.searchParams.set('labelCount', String(labelCount));
  sweepUrl.searchParams.set('textStrategy', textStrategy);
  sweepUrl.searchParams.set('cameraZoom', String(LARGE_SCALE_SWEEP_CAMERA_ZOOM));
  sweepUrl.searchParams.delete('benchmark');
  sweepUrl.searchParams.set('gpuTiming', '0');
  sweepUrl.searchParams.delete('benchmarkFrames');

  await page.goto(sweepUrl.toString(), {waitUntil: 'networkidle0'});
  await waitForAppDatasets(page);

  const appState = await page.evaluate(() => document.body.dataset.appState ?? 'missing');
  assert.equal(appState, 'ready', `Large-scale sweep should reach ready state for ${textStrategy}.`);
  assert.equal(
    await page.evaluate(() => document.body.dataset.textStrategy ?? 'missing'),
    textStrategy,
    `Large-scale sweep should activate ${textStrategy}.`,
  );
  assert.equal(
    await page.evaluate(() => document.body.dataset.labelSetPreset ?? 'missing'),
    STATIC_BENCHMARK_LABEL_SET_ID,
    `Large-scale sweep should use the static benchmark label set for ${textStrategy}.`,
  );
  assert.equal(
    await page.evaluate(() => Number(document.body.dataset.labelSetCount ?? '0')),
    labelCount,
    `Large-scale sweep should use ${labelCount} labels from the benchmark label set for ${textStrategy}.`,
  );

  const checkpoints: LargeScaleSweepState[] = [];

  checkpoints.push(await captureLargeScaleSweepState(page, 'start-hidden'));

  for (const step of LARGE_SCALE_CAMERA_TRACE) {
    await clickControlRepeatedly(page, step.control, step.repeat);
    checkpoints.push(await captureLargeScaleSweepState(page, step.name));
  }

  for (const checkpoint of checkpoints) {
    assert.equal(
      checkpoint.textStrategy,
      textStrategy,
      `${textStrategy} sweep checkpoint ${checkpoint.name} should report the active text strategy.`,
    );
    assert.ok(
      checkpoint.visibleLabelCount >= 0,
      `${textStrategy} sweep checkpoint ${checkpoint.name} should report a non-negative visible label count.`,
    );
    assert.ok(
      checkpoint.visibleGlyphCount >= 0,
      `${textStrategy} sweep checkpoint ${checkpoint.name} should report a non-negative visible glyph count.`,
    );
    addBrowserLog(
      'test',
      `Sweep summary strategy=${textStrategy} checkpoint=${checkpoint.name} zoom=${checkpoint.zoom.toFixed(2)} visibleLabels=${checkpoint.visibleLabelCount} visibleGlyphs=${checkpoint.visibleGlyphCount} visibleChunks=${checkpoint.visibleChunkCount} bytes=${checkpoint.bytesUploadedPerFrame} vertices=${checkpoint.submittedVertexCount} labelSetPreset=${checkpoint.labelSetPreset}`,
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
    labelSetPreset: text.labelSetPreset,
    name,
    textStrategy: text.textStrategy,
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
  textStrategy: TextStrategy,
  labelCount: number,
  pageErrors: string[],
): Promise<BenchmarkState> {
  const benchmarkUrl = new URL(baseUrl);
  benchmarkUrl.searchParams.set('labelSet', 'benchmark');
  benchmarkUrl.searchParams.set('benchmark', '1');
  benchmarkUrl.searchParams.set('gpuTiming', '1');
  benchmarkUrl.searchParams.set('textStrategy', textStrategy);
  benchmarkUrl.searchParams.set('labelCount', String(labelCount));
  benchmarkUrl.searchParams.set('benchmarkFrames', String(BENCHMARK_TRACE_FRAME_COUNT));

  addBrowserLog('test', `Starting benchmark route ${benchmarkUrl.toString()}`);
  const benchmarkPageErrorCount = pageErrors.length;

  await page.goto(benchmarkUrl.toString(), {waitUntil: 'networkidle0'});
  await waitForAppDatasets(page);

  const benchmarkAppState = await page.evaluate(() => document.body.dataset.appState ?? 'missing');
  assert.notEqual(
    benchmarkAppState,
    'error',
    `Benchmark route should not enter error state for strategy=${textStrategy} labelCount=${labelCount}.`,
  );

  if (benchmarkAppState !== 'ready') {
    addBrowserLog(
      'test',
      `Benchmark route reached ${benchmarkAppState} for strategy=${textStrategy} labelCount=${labelCount}`,
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
      labelSetKind: 'benchmark',
      labelSetPreset: STATIC_BENCHMARK_LABEL_SET_ID,
      labelTargetCount: labelCount,
      error: '',
      glyphCount: 0,
      gpuFrameAvgMs: null,
      gpuFrameSamples: 0,
      gpuSupported: false,
      gpuTextAvgMs: null,
      gpuTimingEnabled: false,
      labelCount,
      textStrategy,
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
    `Benchmark should complete successfully for strategy=${textStrategy} labelCount=${labelCount}. ${benchmark.error || 'No benchmark error was reported.'}`,
  );
  assert.equal(benchmark.labelSetKind, 'benchmark', 'Benchmark route should load the benchmark label set.');
  assert.equal(
    benchmark.labelSetPreset,
    STATIC_BENCHMARK_LABEL_SET_ID,
    'Benchmark route should report the static benchmark label-set preset.',
  );
  assert.equal(
    benchmark.labelTargetCount,
    labelCount,
    'Benchmark route should request the expected label count.',
  );
  assert.equal(
    benchmark.labelCount,
    labelCount,
    'Benchmark label set should create the requested label count.',
  );
  assert.equal(
    benchmark.textStrategy,
    textStrategy,
    `Benchmark label set should report strategy=${textStrategy}.`,
  );
  assert.ok(
    benchmark.glyphCount > benchmark.labelCount,
    'Benchmark should include multiple glyphs per label.',
  );
  assert.ok(
    benchmark.cpuFrameSamples >= BENCHMARK_TRACE_FRAME_COUNT,
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
    'Benchmark label set should produce visible labels.',
  );
  assert.ok(
    benchmark.visibleGlyphCount > 0,
    'Benchmark label set should produce visible glyphs.',
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
    assert.ok(
      benchmark.gpuTextAvgMs !== null && benchmark.gpuTextAvgMs >= 0,
      'GPU benchmark samples should produce a non-negative average text-pass time.',
    );
    assert.ok(
      benchmark.gpuFrameAvgMs !== null &&
        benchmark.gpuTextAvgMs !== null &&
        benchmark.gpuFrameAvgMs >= benchmark.gpuTextAvgMs,
      'Whole-frame GPU time should be at least as large as the text-only GPU pass time.',
    );
  } else {
    addBrowserLog(
      'test',
      'Benchmark GPU timestamps were requested, but this browser/device did not expose timestamp-query.',
    );
  }

  const benchmarkSummary = formatBenchmarkSummary(benchmark);
  addBrowserLog('test', `Benchmark summary ${benchmarkSummary}`);
  benchmarkHistory.push(benchmark);

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

function formatBenchmarkSummary(benchmark: BenchmarkState): string {
  const visibleVertexCount = getVisibleVertexCount(benchmark);

  return [
    `strategy=${benchmark.textStrategy}`,
    `labels=${benchmark.labelCount}`,
    `glyphs=${benchmark.glyphCount}`,
    `cpuFrame=${benchmark.cpuFrameAvgMs.toFixed(3)}ms`,
    `cpuSamples=${benchmark.cpuFrameSamples}`,
    `cpuText=${benchmark.cpuTextAvgMs.toFixed(3)}ms`,
    `cpuDraw=${benchmark.cpuDrawAvgMs.toFixed(3)}ms`,
    !benchmark.gpuTimingEnabled
      ? 'gpu=disabled'
      : benchmark.gpuFrameAvgMs === null
      ? 'gpu=unsupported'
      : `gpu=${benchmark.gpuFrameAvgMs.toFixed(3)}ms`,
    `gpuSamples=${benchmark.gpuFrameSamples}`,
    !benchmark.gpuTimingEnabled
      ? 'gpuText=disabled'
      : benchmark.gpuTextAvgMs === null
      ? 'gpuText=unsupported'
      : `gpuText=${benchmark.gpuTextAvgMs.toFixed(3)}ms`,
    `uploaded=${benchmark.bytesUploadedPerFrame}B`,
    `visibleLabels=${benchmark.visibleLabelCount}`,
    `visibleGlyphs=${benchmark.visibleGlyphCount}`,
    `visibleVertices=${visibleVertexCount}`,
    `submittedGlyphs=${benchmark.submittedGlyphCount}`,
    `submittedVertices=${benchmark.submittedVertexCount}`,
    `visibleChunks=${benchmark.visibleChunkCount}`,
    `labelSetPreset=${benchmark.labelSetPreset}`,
  ].join(' ');
}

async function appendReadmePerformanceHistory(benchmarks: BenchmarkState[]): Promise<void> {
  if (benchmarks.length === 0) {
    return;
  }

  const existingReadme = await readFile(readmePath, 'utf8');
  const timestamp = new Date().toISOString();
  const benchmarkLines = benchmarks.map((benchmark) => formatBenchmarkSummary(benchmark)).join('\n');
  const historyEntry = buildReadmePerformanceHistoryEntry(timestamp, benchmarkLines);
  const nextReadme = updateReadmePerformanceHistory(existingReadme, historyEntry);

  await writeFile(readmePath, nextReadme, 'utf8');
}

function buildReadmePerformanceHistoryEntry(timestamp: string, benchmarkLines: string): string {
  return [
    `### ${timestamp}`,
    '',
    '```text',
    benchmarkLines,
    '```',
  ].join('\n');
}

function extractReadmePerformanceHistoryEntries(readme: string): string[] {
  const sectionStart = readme.indexOf(README_PERFORMANCE_HISTORY_HEADING);

  if (sectionStart < 0) {
    return [];
  }

  const sectionBody = readme.slice(sectionStart + README_PERFORMANCE_HISTORY_HEADING.length);
  const entryPattern = /### [^\n]+\n\n```text\n[\s\S]*?\n```/g;

  return [...sectionBody.matchAll(entryPattern)].map((match) => match[0].trim());
}

function updateReadmePerformanceHistory(readme: string, nextEntry: string): string {
  const headingIndex = readme.indexOf(README_PERFORMANCE_HISTORY_HEADING);
  const baseReadme = headingIndex < 0 ? readme : readme.slice(0, headingIndex);
  const historyEntries = [
    ...extractReadmePerformanceHistoryEntries(readme),
    nextEntry,
  ].slice(-README_PERFORMANCE_HISTORY_ENTRY_LIMIT);

  return `${baseReadme.trimEnd()}\n\n${README_PERFORMANCE_HISTORY_HEADING}\n\n${README_PERFORMANCE_HISTORY_NOTE}\n\n${historyEntries.join('\n\n')}\n`;
}

function getVisibleVertexCount(benchmark: BenchmarkState): number {
  switch (benchmark.textStrategy) {
    case 'baseline':
      return benchmark.visibleGlyphCount * 6;
    default:
      return benchmark.visibleGlyphCount * 4;
  }
}

function getBenchmarkKey(textStrategy: TextStrategy, labelCount: number): string {
  return `${textStrategy}:${labelCount}`;
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
  textStrategy: TextStrategy,
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
    `${textStrategy} sweep should change visible glyph counts while zooming.`,
  );
  assert.ok(
    hasVisibleState,
    `${textStrategy} sweep should enter a visible text state during the zoom trace.`,
  );
  assert.ok(
    hasHiddenState,
    `${textStrategy} sweep should enter a hidden text state during the zoom trace.`,
  );
  assert.ok(
    hasIncrease,
    `${textStrategy} sweep should reveal more visible glyphs at some point while zooming.`,
  );
  assert.ok(
    hasDecrease,
    `${textStrategy} sweep should hide visible glyphs at some point while zooming.`,
  );
}

function assertCameraStateClose(
  actual: Pick<CameraState, 'centerX' | 'centerY' | 'zoom'>,
  expected: Pick<CameraState, 'centerX' | 'centerY' | 'zoom'>,
  message: string,
): void {
  const centerXTolerance = Math.abs(actual.centerX - expected.centerX);
  const centerYTolerance = Math.abs(actual.centerY - expected.centerY);
  const zoomTolerance = Math.abs(actual.zoom - expected.zoom);

  assert.ok(
    centerXTolerance <= 0.0001 &&
      centerYTolerance <= 0.0001 &&
      zoomTolerance <= 0.0001,
    `${message} actual=(${actual.centerX.toFixed(4)}, ${actual.centerY.toFixed(4)}, ${actual.zoom.toFixed(4)}) expected=(${expected.centerX.toFixed(4)}, ${expected.centerY.toFixed(4)}, ${expected.zoom.toFixed(4)})`,
  );
}

function assertCameraQueryClose(
  actual: CameraQueryState,
  expected: CameraQueryState,
  message: string,
): void {
  assertCameraQueryValueClose(actual.centerX, expected.centerX, `${message} centerX`);
  assertCameraQueryValueClose(actual.centerY, expected.centerY, `${message} centerY`);
  assertCameraQueryValueClose(actual.zoom, expected.zoom, `${message} zoom`);
}

function assertCameraQueryValueClose(
  actual: number | null,
  expected: number | null,
  message: string,
): void {
  if (expected === null) {
    assert.equal(actual, null, message);
    return;
  }

  assert.notEqual(actual, null, message);
  assert.ok(
    Math.abs((actual ?? 0) - expected) <= 0.0001,
    `${message} actual=${actual ?? 'null'} expected=${expected.toFixed(4)}`,
  );
}

async function waitForBrowserUpdate(page: Page): Promise<void> {
  await page.evaluate(async (frameCount: number) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }, BROWSER_UPDATE_FRAME_COUNT);
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
        document.body.dataset.textStrategy &&
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

function runReadmePerformanceHistoryUnitTests(): void {
  const entryA = buildReadmePerformanceHistoryEntry('2026-03-25T20:00:00.000Z', 'strategy=baseline labels=1024');
  const entryB = buildReadmePerformanceHistoryEntry('2026-03-25T21:00:00.000Z', 'strategy=instanced labels=1024');
  const entryC = buildReadmePerformanceHistoryEntry('2026-03-25T22:00:00.000Z', 'strategy=packed labels=1024');
  const entryD = buildReadmePerformanceHistoryEntry('2026-03-25T23:00:00.000Z', 'strategy=chunked labels=1024');
  const existingReadme = [
    '# Linker',
    '',
    'Intro text.',
    '',
    README_PERFORMANCE_HISTORY_HEADING,
    '',
    README_PERFORMANCE_HISTORY_NOTE,
    '',
    entryA,
    '',
    entryB,
    '',
    entryC,
    '',
  ].join('\n');
  const nextReadme = updateReadmePerformanceHistory(existingReadme, entryD);

  assert.deepEqual(
    extractReadmePerformanceHistoryEntries(nextReadme),
    [entryB, entryC, entryD],
    'README performance history should keep only the three most recent entries.',
  );
  assert.match(
    nextReadme,
    new RegExp(README_PERFORMANCE_HISTORY_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'README performance history should include its retention note.',
  );
  assert.equal(
    (nextReadme.match(new RegExp(README_PERFORMANCE_HISTORY_HEADING, 'g')) ?? []).length,
    1,
    'README performance history should keep a single heading after rewrites.',
  );
}

function runZoomBandUnitTests(): void {
  const detailBand = createZoomBand(3.5, 4.5);

  assert.equal(detailBand.zoomLevel, 4, 'Zoom bands should store the focal zoom midpoint.');
  assert.equal(detailBand.zoomRange, 0.5, 'Zoom bands should store half of the visible zoom span.');
  assert.equal(
    getMinVisibleZoom(detailBand.zoomLevel, detailBand.zoomRange),
    3.5,
    'Zoom bands should expose the lower visible bound.',
  );
  assert.equal(
    getMaxVisibleZoom(detailBand.zoomLevel, detailBand.zoomRange),
    4.5,
    'Zoom bands should expose the upper visible bound.',
  );
  assert.equal(
    isZoomVisible(3.49, detailBand.zoomLevel, detailBand.zoomRange),
    false,
    'Zoom bands should keep labels hidden before the reveal threshold.',
  );
  assert.equal(
    isZoomVisible(3.5, detailBand.zoomLevel, detailBand.zoomRange),
    true,
    'Zoom bands should reveal labels at the threshold.',
  );
  assert.equal(
    isZoomVisible(4.5, detailBand.zoomLevel, detailBand.zoomRange),
    true,
    'Zoom bands should remain visible through the upper threshold.',
  );
  assert.equal(
    isZoomVisible(4.51, detailBand.zoomLevel, detailBand.zoomRange),
    false,
    'Zoom bands should hide labels once the zoom passes the upper threshold.',
  );
  assert.equal(
    getZoomScale(3.5, detailBand.zoomLevel, detailBand.zoomRange),
    MIN_ZOOM_SCALE,
    'Zoom-band scaling should start at the minimum reveal scale.',
  );
  assert.equal(
    getZoomScale(4, detailBand.zoomLevel, detailBand.zoomRange),
    1,
    'Zoom-band scaling should reach full size at the focal zoom.',
  );
  assert.ok(
    getZoomScale(3.75, detailBand.zoomLevel, detailBand.zoomRange) > MIN_ZOOM_SCALE &&
      getZoomScale(3.75, detailBand.zoomLevel, detailBand.zoomRange) < 1,
    'Zoom-band scaling should interpolate between the reveal edge and the focal zoom.',
  );
}

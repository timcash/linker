import assert from 'node:assert/strict';

import type {Page} from 'puppeteer';

import {
  BROWSER_UPDATE_FRAME_COUNT,
  DEFAULT_LINE_STRATEGY,
  DEFAULT_LAYOUT_STRATEGY,
  DEFAULT_TEXT_STRATEGY,
  DEMO_LABEL_SET_ID,
  type BenchmarkState,
  type CameraQueryState,
  type CameraState,
  type CanvasPixelSignature,
  type LineState,
  type LineStrategy,
  type NonReadyResult,
  type ReadyResult,
  type StrategyPanelMode,
  type TextState,
  type TextStrategy,
} from './types';
import {
  assertDemoChildLayerVisible,
  assertDemoRootLayerVisible,
} from './assertions';

export async function readAppResult(page: Page): Promise<ReadyResult | NonReadyResult> {
  return page.evaluate((): ReadyResult | NonReadyResult => {
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
          textStrategy: (document.body.dataset.textStrategy ?? DEFAULT_TEXT_STRATEGY) as TextStrategy,
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
}

export async function getCameraState(page: Page): Promise<CameraState> {
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

export async function getCameraQueryState(page: Page): Promise<CameraQueryState> {
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

export async function getTextState(page: Page): Promise<TextState> {
  return page.evaluate(() => ({
    bytesUploadedPerFrame: Number(document.body.dataset.textBytesUploadedPerFrame ?? '0'),
    labelSetPreset: document.body.dataset.labelSetPreset ?? '',
    labelCount: Number(document.body.dataset.textLabelCount ?? '0'),
    glyphCount: Number(document.body.dataset.textGlyphCount ?? '0'),
    layoutFingerprint: document.body.dataset.layoutFingerprint ?? '',
    layoutStrategy: document.body.dataset.layoutStrategy ?? '',
    textStrategy: (document.body.dataset.textStrategy ?? DEFAULT_TEXT_STRATEGY) as TextStrategy,
    submittedGlyphCount: Number(document.body.dataset.textSubmittedGlyphCount ?? '0'),
    submittedVertexCount: Number(document.body.dataset.textSubmittedVertexCount ?? '0'),
    strategyPanelMode: document.body.dataset.strategyPanelMode ?? '',
    visibleChunkCount: Number(document.body.dataset.textVisibleChunkCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.textVisibleLabelCount ?? '0'),
    visibleLabels: document.body.dataset.textVisibleLabels ?? '',
    visibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
  }));
}

export async function getLineState(page: Page): Promise<LineState> {
  return page.evaluate(() => ({
    curveFingerprint: document.body.dataset.lineCurveFingerprint ?? '',
    lineLinkCount: Number(document.body.dataset.lineLinkCount ?? '0'),
    lineStrategy: (document.body.dataset.lineStrategy ?? DEFAULT_LINE_STRATEGY) as LineStrategy,
    lineVisibleLinkCount: Number(document.body.dataset.lineVisibleLinkCount ?? '0'),
    strategyPanelMode: document.body.dataset.strategyPanelMode ?? '',
    submittedVertexCount: Number(document.body.dataset.lineSubmittedVertexCount ?? '0'),
  }));
}

export async function getCanvasPixelSignature(page: Page): Promise<CanvasPixelSignature> {
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

export async function getBenchmarkState(page: Page): Promise<BenchmarkState> {
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
    textStrategy: (document.body.dataset.benchmarkTextStrategy ?? DEFAULT_TEXT_STRATEGY) as TextStrategy,
    state: document.body.dataset.benchmarkState ?? 'missing',
    submittedGlyphCount: Number(document.body.dataset.benchmarkSubmittedGlyphCount ?? '0'),
    submittedVertexCount: Number(document.body.dataset.benchmarkSubmittedVertexCount ?? '0'),
    visibleChunkCount: Number(document.body.dataset.benchmarkVisibleChunkCount ?? '0'),
    visibleGlyphCount: Number(document.body.dataset.benchmarkVisibleGlyphCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.benchmarkVisibleLabelCount ?? '0'),
  }));
}

export async function openRoute(page: Page, url: string): Promise<void> {
  await page.goto(url, {waitUntil: 'networkidle0'});
  await waitForAppDatasets(page);
}

export async function clickButton(
  page: Page,
  selector: string,
  missingMessage: string,
): Promise<void> {
  await page.waitForSelector(selector);
  await page.evaluate(
    ({buttonSelector, errorMessage}) => {
      const button = document.querySelector<HTMLButtonElement>(buttonSelector);

      if (!button) {
        throw new Error(errorMessage);
      }

      button.click();
    },
    {buttonSelector: selector, errorMessage: missingMessage},
  );
}

export async function clickControl(page: Page, control: string): Promise<void> {
  const selector = `[data-control="${control}"]`;
  await clickButton(page, selector, `Missing control button ${selector}`);
}

export async function clickControlRepeatedly(
  page: Page,
  control: string,
  times: number,
): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await clickControl(page, control);
  }

  await waitForBrowserUpdate(page);
}

export async function waitForCameraReset(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Number(document.body.dataset.cameraCenterX) === 0 &&
      Number(document.body.dataset.cameraCenterY) === 0 &&
      Number(document.body.dataset.cameraZoom) === 0,
  );
}

export async function resetCamera(page: Page): Promise<void> {
  await clickControl(page, 'reset-camera');
  await waitForCameraReset(page);
}

export async function selectToggleValue<TValue extends string>(
  page: Page,
  options: {
    currentValue: TValue;
    datasetKey: string;
    expectedValue: TValue;
    missingMessage: string;
    selector: string;
  },
): Promise<void> {
  const {
    currentValue,
    datasetKey,
    expectedValue,
    missingMessage,
    selector,
  } = options;

  if (currentValue !== expectedValue) {
    await clickButton(page, selector, missingMessage);
  }

  await page.waitForFunction(
    ({bodyDatasetKey, value}) => document.body.dataset[bodyDatasetKey] === value,
    {},
    {bodyDatasetKey: datasetKey, value: expectedValue},
  );
  await page.waitForFunction(
    (buttonSelector) =>
      document.querySelector(buttonSelector)?.getAttribute('aria-pressed') === 'true',
    {},
    selector,
  );
  await waitForBrowserUpdate(page);
}

export async function showStrategyPanelMode(
  page: Page,
  mode: StrategyPanelMode,
): Promise<void> {
  const currentMode = await page.evaluate(
    () => (document.body.dataset.strategyPanelMode ?? 'text') as StrategyPanelMode,
  );
  const selector = `button[data-strategy-panel-mode="${mode}"]`;

  await selectToggleValue(page, {
    currentValue: currentMode,
    datasetKey: 'strategyPanelMode',
    expectedValue: mode,
    missingMessage: `Missing strategy panel mode button ${selector}`,
    selector,
  });
}

export async function switchTextStrategy(
  page: Page,
  textStrategy: TextStrategy,
): Promise<void> {
  await showStrategyPanelMode(page, 'text');

  const currentMode = await page.evaluate(
    () => (document.body.dataset.textStrategy ?? DEFAULT_TEXT_STRATEGY) as TextStrategy,
  );
  const selector = `button[data-text-strategy="${textStrategy}"]`;

  await selectToggleValue(page, {
    currentValue: currentMode,
    datasetKey: 'textStrategy',
    expectedValue: textStrategy,
    missingMessage: `Missing text strategy button ${selector}`,
    selector,
  });
}

export async function switchLineStrategy(
  page: Page,
  lineStrategy: LineStrategy,
): Promise<void> {
  await showStrategyPanelMode(page, 'line');

  const currentMode = await page.evaluate(
    () => (document.body.dataset.lineStrategy ?? DEFAULT_LINE_STRATEGY) as LineStrategy,
  );
  const selector = `button[data-line-strategy="${lineStrategy}"]`;

  await selectToggleValue(page, {
    currentValue: currentMode,
    datasetKey: 'lineStrategy',
    expectedValue: lineStrategy,
    missingMessage: `Missing line strategy button ${selector}`,
    selector,
  });
}

export async function switchLayoutStrategy(
  page: Page,
  layoutStrategy: string,
): Promise<void> {
  await showStrategyPanelMode(page, 'layout');

  const currentMode = await page.evaluate(() => document.body.dataset.layoutStrategy ?? '');
  const selector = `button[data-layout-strategy="${layoutStrategy}"]`;

  await selectToggleValue(page, {
    currentValue: currentMode,
    datasetKey: 'layoutStrategy',
    expectedValue: layoutStrategy,
    missingMessage: `Missing layout strategy button ${selector}`,
    selector,
  });
}

export async function verifyDemoTextStrategyVisibility(
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

  await resetCamera(page);

  const initialText = await getTextState(page);
  assert.equal(
    initialText.labelSetPreset,
    DEMO_LABEL_SET_ID,
    `${textStrategy} mode should continue using the demo label-set preset.`,
  );
  assertDemoRootLayerVisible(initialText, `${textStrategy} mode at zoom 0`);
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
  await clickControlRepeatedly(page, 'zoom-in', 4);
  await page.waitForFunction(
    ({zoom}) => Number(document.body.dataset.cameraZoom) > zoom,
    {},
    {zoom: beforeZoomIn.zoom},
  );

  const afterZoomIn = await getTextState(page);
  assertDemoChildLayerVisible(afterZoomIn, `${textStrategy} mode after zooming into the child band`);

  await clickControlRepeatedly(page, 'zoom-out', 4);
  await page.waitForFunction(() => Number(document.body.dataset.cameraZoom) === 0);

  await clickControl(page, 'zoom-out');
  await waitForBrowserUpdate(page);
  assert.equal(
    (await getCameraState(page)).zoom,
    0,
    `${textStrategy} mode should stop zooming out at the camera floor.`,
  );

  await resetCamera(page);

  return getTextState(page);
}

export async function waitForBrowserUpdate(page: Page): Promise<void> {
  await page.evaluate(async (frameCount: number) => {
    for (let index = 0; index < frameCount; index += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }, BROWSER_UPDATE_FRAME_COUNT);
}

export async function waitForAppDatasets(page: Page): Promise<void> {
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

export async function waitForCondition(
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

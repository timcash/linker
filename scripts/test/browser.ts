import path from 'node:path';

import assert from 'node:assert/strict';

import type {Page} from 'puppeteer';
import type {StageSystemState} from '../../src/plane-stack';

import {
  BROWSER_UPDATE_FRAME_COUNT,
  DEFAULT_LINE_STRATEGY,
  DEFAULT_LAYOUT_STRATEGY,
  DEFAULT_TEXT_STRATEGY,
  DEMO_LABEL_SET_ID,
  FIRST_CHILD_LABEL,
  FIRST_ROOT_LABEL,
  type BenchmarkState,
  type CameraQueryState,
  type CameraState,
  type CanvasPixelSignature,
  type EditorState,
  type LineState,
  type LayoutShellState,
  type LineStrategy,
  type NonReadyResult,
  type PerfSnapshot,
  type ReadyResult,
  type BrowserTestContext,
  type StageState,
  type StageRouteState,
  type StrategyPanelMode,
  type TextState,
  type TextStrategy,
} from './types';
import {
  assertDemoChildLayerVisible,
  assertDemoRootLayerVisible,
} from './assertions';

const TEST_MOBILE_VIEWPORT = {
  height: 852,
  width: 393,
} as const;

export async function readAppResult(page: Page): Promise<ReadyResult | NonReadyResult> {
  return page.evaluate((): ReadyResult | NonReadyResult => {
    const state = document.body.dataset.appState ?? 'missing';
    const canvas = document.querySelector('[data-testid="gpu-canvas"]');
    const message = document.querySelector('[data-testid="app-message"]');

    if (state === 'ready' && canvas instanceof HTMLCanvasElement) {
      const rect = canvas.getBoundingClientRect();

      return {
        canvasHeight: canvas.height,
        canvasWidth: canvas.width,
        devicePixelRatio: window.devicePixelRatio,
        state,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        camera: {
          animating: document.body.dataset.cameraAnimating === 'true',
          canMoveDown: document.body.dataset.cameraCanMoveDown === 'true',
          canMoveLeft: document.body.dataset.cameraCanMoveLeft === 'true',
          canMoveRight: document.body.dataset.cameraCanMoveRight === 'true',
          canReset: document.body.dataset.cameraCanReset === 'true',
          canMoveUp: document.body.dataset.cameraCanMoveUp === 'true',
          canZoomIn: document.body.dataset.cameraCanZoomIn === 'true',
          canZoomOut: document.body.dataset.cameraCanZoomOut === 'true',
          column: Number(document.body.dataset.cameraColumn ?? '0'),
          centerX: Number(document.body.dataset.cameraCenterX ?? '0'),
          centerY: Number(document.body.dataset.cameraCenterY ?? '0'),
          label: document.body.dataset.cameraLabel ?? '',
          layer: Number(document.body.dataset.cameraLayer ?? '0'),
          zoom: Number(document.body.dataset.cameraZoom ?? '0'),
          row: Number(document.body.dataset.cameraRow ?? '0'),
          scale: Number(document.body.dataset.cameraScale ?? '0'),
          lineCount: Number(document.body.dataset.gridLineCount ?? '0'),
          minorSpacing: Number(document.body.dataset.gridMinorSpacing ?? '0'),
          majorSpacing: Number(document.body.dataset.gridMajorSpacing ?? '0'),
          stackCameraAzimuth: Number(document.body.dataset.stackCameraAzimuth ?? '0'),
          stackCameraDistanceScale: Number(document.body.dataset.stackCameraDistanceScale ?? '0'),
          stackCameraElevation: Number(document.body.dataset.stackCameraElevation ?? '0'),
        },
        editor: {
          cursorColumn: Number(document.body.dataset.editorCursorColumn ?? '0'),
          cursorKey: document.body.dataset.editorCursorKey ?? '',
          cursorKind: document.body.dataset.editorCursorKind ?? '',
          cursorLayer: Number(document.body.dataset.editorCursorLayer ?? '0'),
          cursorRow: Number(document.body.dataset.editorCursorRow ?? '0'),
          documentLabelCount: Number(document.body.dataset.documentLabelCount ?? '0'),
          documentLinkCount: Number(document.body.dataset.documentLinkCount ?? '0'),
          selectedLabelCount: Number(document.body.dataset.editorSelectedLabelCount ?? '0'),
          selectedLabelKeys: document.body.dataset.editorSelectedLabelKeys ?? '',
        },
        stage: {
          activeWorkplaneId: document.body.dataset.activeWorkplaneId ?? '',
          controlPadPage: document.body.dataset.controlPadPage ?? '',
          documentBridgeLinkCount: Number(document.body.dataset.documentBridgeLinkCount ?? '0'),
          planeCount: Number(document.body.dataset.planeCount ?? '0'),
          renderBridgeLinkCount: Number(document.body.dataset.renderBridgeLinkCount ?? '0'),
          stageMode: document.body.dataset.stageMode ?? '',
          workplaneCanDelete: document.body.dataset.workplaneCanDelete === 'true',
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
    animating: document.body.dataset.cameraAnimating === 'true',
    canMoveDown: document.body.dataset.cameraCanMoveDown === 'true',
    canMoveLeft: document.body.dataset.cameraCanMoveLeft === 'true',
    canMoveRight: document.body.dataset.cameraCanMoveRight === 'true',
    canReset: document.body.dataset.cameraCanReset === 'true',
    canMoveUp: document.body.dataset.cameraCanMoveUp === 'true',
    canZoomIn: document.body.dataset.cameraCanZoomIn === 'true',
    canZoomOut: document.body.dataset.cameraCanZoomOut === 'true',
    column: Number(document.body.dataset.cameraColumn ?? '0'),
    centerX: Number(document.body.dataset.cameraCenterX ?? '0'),
    centerY: Number(document.body.dataset.cameraCenterY ?? '0'),
    label: document.body.dataset.cameraLabel ?? '',
    layer: Number(document.body.dataset.cameraLayer ?? '0'),
    zoom: Number(document.body.dataset.cameraZoom ?? '0'),
    row: Number(document.body.dataset.cameraRow ?? '0'),
    scale: Number(document.body.dataset.cameraScale ?? '0'),
    lineCount: Number(document.body.dataset.gridLineCount ?? '0'),
    minorSpacing: Number(document.body.dataset.gridMinorSpacing ?? '0'),
    majorSpacing: Number(document.body.dataset.gridMajorSpacing ?? '0'),
    stackCameraAzimuth: Number(document.body.dataset.stackCameraAzimuth ?? '0'),
    stackCameraDistanceScale: Number(document.body.dataset.stackCameraDistanceScale ?? '0'),
    stackCameraElevation: Number(document.body.dataset.stackCameraElevation ?? '0'),
  }));
}

export async function getCameraQueryState(page: Page): Promise<CameraQueryState> {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    return {
      label: url.searchParams.get('cameraLabel'),
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

export async function getStageState(page: Page): Promise<StageState> {
  return page.evaluate(() => ({
    activeWorkplaneId: document.body.dataset.activeWorkplaneId ?? '',
    controlPadPage: document.body.dataset.controlPadPage ?? '',
    documentBridgeLinkCount: Number(document.body.dataset.documentBridgeLinkCount ?? '0'),
    planeCount: Number(document.body.dataset.planeCount ?? '0'),
    renderBridgeLinkCount: Number(document.body.dataset.renderBridgeLinkCount ?? '0'),
    stageMode: document.body.dataset.stageMode ?? '',
    workplaneCanDelete: document.body.dataset.workplaneCanDelete === 'true',
  }));
}

export async function getEditorState(page: Page): Promise<EditorState> {
  return page.evaluate(() => ({
    cursorColumn: Number(document.body.dataset.editorCursorColumn ?? '0'),
    cursorKey: document.body.dataset.editorCursorKey ?? '',
    cursorKind: document.body.dataset.editorCursorKind ?? '',
    cursorLayer: Number(document.body.dataset.editorCursorLayer ?? '0'),
    cursorRow: Number(document.body.dataset.editorCursorRow ?? '0'),
    documentLabelCount: Number(document.body.dataset.documentLabelCount ?? '0'),
    documentLinkCount: Number(document.body.dataset.documentLinkCount ?? '0'),
    selectedLabelCount: Number(document.body.dataset.editorSelectedLabelCount ?? '0'),
    selectedLabelKeys: document.body.dataset.editorSelectedLabelKeys ?? '',
  }));
}

export async function getStageRouteState(page: Page): Promise<StageRouteState> {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    return {
      stageMode: url.searchParams.get('stageMode'),
      workplaneId: url.searchParams.get('workplane'),
    };
  });
}

export async function getLineState(page: Page): Promise<LineState> {
  return page.evaluate(() => ({
    curveFingerprint: document.body.dataset.lineCurveFingerprint ?? '',
    lineDimmedLinkCount: Number(document.body.dataset.lineDimmedLinkCount ?? '0'),
    lineHighlightedInputLinkCount: Number(document.body.dataset.lineHighlightedInputLinkCount ?? '0'),
    lineHighlightedOutputLinkCount: Number(document.body.dataset.lineHighlightedOutputLinkCount ?? '0'),
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

export async function getPerformanceSnapshot(page: Page): Promise<PerfSnapshot> {
  return page.evaluate(() => ({
    bytesUploadedPerFrame: Number(document.body.dataset.textBytesUploadedPerFrame ?? '0'),
    cpuDrawAvgMs: Number(document.body.dataset.perfCpuDrawAvgMs ?? '0'),
    cpuFrameAvgMs: Number(document.body.dataset.perfCpuFrameAvgMs ?? '0'),
    cpuFrameMaxMs: Number(document.body.dataset.perfCpuFrameMaxMs ?? '0'),
    cpuFrameSamples: Number(document.body.dataset.perfCpuFrameSamples ?? '0'),
    cpuTextAvgMs: Number(document.body.dataset.perfCpuTextAvgMs ?? '0'),
    frameGapAvgMs: Number(document.body.dataset.perfFrameGapAvgMs ?? '0'),
    frameGapMaxMs: Number(document.body.dataset.perfFrameGapMaxMs ?? '0'),
    frameGapSamples: Number(document.body.dataset.perfFrameGapSamples ?? '0'),
    gpuFrameAvgMs:
      document.body.dataset.perfGpuFrameAvgMs === 'unsupported' ||
      document.body.dataset.perfGpuFrameAvgMs === 'disabled'
        ? null
        : Number(document.body.dataset.perfGpuFrameAvgMs ?? '0'),
    gpuFrameSamples: Number(document.body.dataset.perfGpuFrameSamples ?? '0'),
    gpuSupported: document.body.dataset.perfGpuSupported === 'true',
    gpuTextAvgMs:
      document.body.dataset.perfGpuTextAvgMs === 'unsupported' ||
      document.body.dataset.perfGpuTextAvgMs === 'disabled'
        ? null
        : Number(document.body.dataset.perfGpuTextAvgMs ?? '0'),
    gpuTimingEnabled: document.body.dataset.perfGpuFrameAvgMs !== 'disabled',
    lineVisibleLinkCount: Number(document.body.dataset.lineVisibleLinkCount ?? '0'),
    planeCount: Number(document.body.dataset.planeCount ?? '0'),
    stageMode: document.body.dataset.stageMode ?? '',
    submittedGlyphCount: Number(document.body.dataset.textSubmittedGlyphCount ?? '0'),
    submittedVertexCount: Number(document.body.dataset.textSubmittedVertexCount ?? '0'),
    textStrategy: (document.body.dataset.textStrategy ?? DEFAULT_TEXT_STRATEGY) as TextStrategy,
    visibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
    visibleLabelCount: Number(document.body.dataset.textVisibleLabelCount ?? '0'),
  }));
}

export async function resetPerformanceTelemetry(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const hooks = (window as Window & {
      __LINKER_TEST_HOOKS__?: {
        resetPerformanceTelemetry?: () => Promise<void>;
      };
    }).__LINKER_TEST_HOOKS__;
    await hooks?.resetPerformanceTelemetry?.();
  });
  await waitForBrowserUpdate(page);
}

export async function flushPerformanceTelemetry(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const hooks = (window as Window & {
      __LINKER_TEST_HOOKS__?: {
        flushPerformanceTelemetry?: () => Promise<void>;
      };
    }).__LINKER_TEST_HOOKS__;
    await hooks?.flushPerformanceTelemetry?.();
  });
}

export async function waitForBenchmarkResult(
  page: Page,
  options?: {timeoutMs?: number},
): Promise<BenchmarkState> {
  await page.waitForFunction(
    () => {
      const state = document.body.dataset.benchmarkState;
      return state === 'complete' || state === 'error';
    },
    {timeout: options?.timeoutMs ?? 60_000},
  );
  await waitForBrowserUpdate(page);
  return getBenchmarkState(page);
}

export function buildClassicDemoUrl(
  baseUrl: string,
  extraParams?: Record<string, string>,
): string {
  return buildStageUrl(baseUrl, {
    demoLayers: '12',
    demoPreset: 'classic',
    labelSet: 'demo',
    stageMode: '2d-mode',
    workplane: 'wp-1',
    ...extraParams,
  });
}

export function buildEditorLabUrl(
  baseUrl: string,
  extraParams?: Record<string, string>,
): string {
  return buildStageUrl(baseUrl, {
    demoPreset: 'editor-lab',
    labelSet: 'demo',
    stageMode: '2d-mode',
    workplane: 'wp-3',
    ...extraParams,
  });
}

export function buildWorkplaneShowcaseUrl(
  baseUrl: string,
  extraParams?: Record<string, string>,
): string {
  return buildStageUrl(baseUrl, {
    demoPreset: 'workplane-showcase',
    labelSet: 'demo',
    stageMode: '3d-mode',
    workplane: 'wp-3',
    ...extraParams,
  });
}

export async function openRoute(page: Page, url: string): Promise<void> {
  await page.goto(url, {waitUntil: 'load'});
  await waitForAppDatasets(page);
}

export async function captureInteractionScreenshot(
  context: BrowserTestContext,
  name: string,
): Promise<void> {
  await waitForOverlayShell(context.page);
  await assertMobileViewportStable(context.page, name);
  context.interactionScreenshotCounter += 1;
  const safeName = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'step';
  const filename = `${String(context.interactionScreenshotCounter).padStart(2, '0')}-${safeName}.png`;
  const screenshotPath = path.join(context.interactionScreenshotDir, filename);

  await context.page.screenshot({
    path: screenshotPath,
  });
  context.addBrowserLog('artifact.step', `Saved interaction screenshot to ${screenshotPath}`);
}

export async function getLayoutShellState(page: Page): Promise<LayoutShellState> {
  return page.evaluate(() => {
    const statusElement = document.querySelector<HTMLElement>('[data-testid="status-panel"]');
    const controlElement = document.querySelector<HTMLElement>('[data-testid="strategy-mode-panel"]');
    const statusRect = statusElement?.getBoundingClientRect();
    const controlRect = controlElement?.getBoundingClientRect();
    const statusStyle = statusElement ? window.getComputedStyle(statusElement) : null;
    const controlStyle = controlElement ? window.getComputedStyle(controlElement) : null;
    const statusVisible =
      statusElement instanceof HTMLElement &&
      !statusElement.hidden &&
      !!statusRect &&
      statusRect.width > 0 &&
      statusRect.height > 0 &&
      statusStyle?.display !== 'none' &&
      statusStyle?.visibility !== 'hidden';
    const controlVisible =
      controlElement instanceof HTMLElement &&
      !controlElement.hidden &&
      !!controlRect &&
      controlRect.width > 0 &&
      controlRect.height > 0 &&
      controlStyle?.display !== 'none' &&
      controlStyle?.visibility !== 'hidden';

    const visibleControlPadPage =
      Array.from(document.querySelectorAll<HTMLElement>('[data-control-pad-page]')).find(
        (pageElement) =>
          !pageElement.hidden &&
          pageElement.getClientRects().length > 0 &&
          window.getComputedStyle(pageElement).display !== 'none' &&
          window.getComputedStyle(pageElement).visibility !== 'hidden',
      )?.dataset.controlPadPage ?? '';

    return {
      controlPad: {
        bottom: Math.round(controlRect?.bottom ?? 0),
        centerX: Math.round((controlRect?.left ?? 0) + (controlRect?.width ?? 0) / 2),
        height: Math.round(controlRect?.height ?? 0),
        left: Math.round(controlRect?.left ?? 0),
        right: Math.round(controlRect?.right ?? 0),
        top: Math.round(controlRect?.top ?? 0),
        visible: controlVisible,
        width: Math.round(controlRect?.width ?? 0),
      },
      statusPanel: {
        bottom: Math.round(statusRect?.bottom ?? 0),
        centerX: Math.round((statusRect?.left ?? 0) + (statusRect?.width ?? 0) / 2),
        height: Math.round(statusRect?.height ?? 0),
        left: Math.round(statusRect?.left ?? 0),
        right: Math.round(statusRect?.right ?? 0),
        top: Math.round(statusRect?.top ?? 0),
        visible: statusVisible,
        width: Math.round(statusRect?.width ?? 0),
      },
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      visibleControlPadPage,
    };
  });
}

export async function assertOverlayShellPinned(
  page: Page,
  options?: {
    expectedPage?: 'edit' | 'navigate' | 'stage';
    label?: string;
  },
): Promise<void> {
  const layout = await getLayoutShellState(page);
  const labelPrefix = options?.label ? `${options.label}: ` : '';

  assert.equal(
    layout.statusPanel.visible,
    true,
    `${labelPrefix}status panel should remain visible.`,
  );
  assert.equal(
    layout.controlPad.visible,
    true,
    `${labelPrefix}control pad should remain visible.`,
  );
  assert.ok(
    layout.statusPanel.top <= 16,
    `${labelPrefix}status panel should stay pinned near the top edge. layout=${JSON.stringify(layout)}`,
  );
  assert.ok(
    layout.viewportHeight - layout.controlPad.bottom <= 20,
    `${labelPrefix}control pad should stay pinned near the bottom edge. layout=${JSON.stringify(layout)}`,
  );
  assert.ok(
    Math.abs(layout.controlPad.centerX - layout.viewportWidth / 2) <= 6,
    `${labelPrefix}control pad should stay horizontally centered. layout=${JSON.stringify(layout)}`,
  );

  if (options?.expectedPage) {
    assert.equal(
      layout.visibleControlPadPage,
      options.expectedPage,
      `${labelPrefix}expected the ${options.expectedPage} control container to be visible. layout=${JSON.stringify(layout)}`,
    );
  }
}

export async function assertMobileViewportStable(
  page: Page,
  label?: string,
): Promise<void> {
  const viewport = await page.evaluate(() => ({
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    visualViewportHeight: Math.round(window.visualViewport?.height ?? window.innerHeight),
    visualViewportWidth: Math.round(window.visualViewport?.width ?? window.innerWidth),
  }));
  const labelPrefix = label ? `${label}: ` : '';

  assert.equal(
    viewport.innerWidth,
    TEST_MOBILE_VIEWPORT.width,
    `${labelPrefix}innerWidth should stay on the shared mobile viewport.`,
  );
  assert.equal(
    viewport.innerHeight,
    TEST_MOBILE_VIEWPORT.height,
    `${labelPrefix}innerHeight should stay on the shared mobile viewport.`,
  );
  assert.equal(
    viewport.visualViewportWidth,
    TEST_MOBILE_VIEWPORT.width,
    `${labelPrefix}visualViewport width should stay on the shared mobile viewport.`,
  );
  assert.equal(
    viewport.visualViewportHeight,
    TEST_MOBILE_VIEWPORT.height,
    `${labelPrefix}visualViewport height should stay on the shared mobile viewport.`,
  );
}

export async function openRouteWithBootState(
  page: Page,
  url: string,
  bootState: {
    initialState: StageSystemState;
    strategyPanelMode?: StrategyPanelMode;
  },
): Promise<void> {
  const script = await page.evaluateOnNewDocument((nextBootState) => {
    (window as Window & {
      __LINKER_TEST_BOOT_STATE__?: {
        initialState: StageSystemState;
        strategyPanelMode?: StrategyPanelMode;
      };
    }).__LINKER_TEST_BOOT_STATE__ = nextBootState;
  }, bootState);

  try {
    await openRoute(page, url);
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(
      (script as {identifier: string}).identifier,
    );
  }
}

export async function clickButton(
  page: Page,
  selector: string,
  missingMessage: string,
): Promise<void> {
  await page.waitForFunction(
    (buttonSelector) =>
      Array.from(document.querySelectorAll(buttonSelector)).some((candidate) =>
        candidate instanceof HTMLElement &&
        !candidate.hidden &&
        candidate.getClientRects().length > 0 &&
        window.getComputedStyle(candidate).visibility !== 'hidden' &&
        window.getComputedStyle(candidate).display !== 'none',
      ),
    {},
    selector,
  );
  await page.evaluate(
    ({buttonSelector, expectedMessage}) => {
      const button = Array.from(document.querySelectorAll(buttonSelector)).find((candidate) =>
        candidate instanceof HTMLElement &&
        !candidate.hidden &&
        candidate.getClientRects().length > 0 &&
        window.getComputedStyle(candidate).visibility !== 'hidden' &&
        window.getComputedStyle(candidate).display !== 'none',
      );

      if (!(button instanceof HTMLElement)) {
        throw new Error(expectedMessage);
      }

      button.click();
    },
    {buttonSelector: selector, expectedMessage: missingMessage},
  );
}

export async function clickControl(page: Page, control: string): Promise<void> {
  await showControlPadPage(page, 'navigate');
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
  await waitForCameraSettled(page);
}

export async function waitForCameraReset(page: Page): Promise<void> {
  await page.waitForFunction(
    (label) => document.body.dataset.cameraLabel === label,
    {},
    FIRST_ROOT_LABEL,
  );
  await waitForCameraSettled(page);
}

export async function resetCamera(page: Page): Promise<void> {
  await clickControl(page, 'reset-camera');
  await waitForCameraReset(page);
}

export async function waitForCameraLabel(page: Page, label: string): Promise<void> {
  await page.waitForFunction(
    (expectedLabel) => document.body.dataset.cameraLabel === expectedLabel,
    {},
    label,
  );
  await waitForCameraSettled(page);
}

export async function waitForStageWorkplane(
  page: Page,
  expected: {activeWorkplaneId: string; planeCount?: number},
): Promise<void> {
  await page.waitForFunction(
    ({expectedWorkplaneId, expectedPlaneCount}) => {
      const activeWorkplaneId = document.body.dataset.activeWorkplaneId ?? '';
      const planeCount = Number(document.body.dataset.planeCount ?? '0');

      return (
        activeWorkplaneId === expectedWorkplaneId &&
        (expectedPlaneCount === null || planeCount === expectedPlaneCount)
      );
    },
    {},
    {
      expectedPlaneCount: expected.planeCount ?? null,
      expectedWorkplaneId: expected.activeWorkplaneId,
    },
  );
  await waitForBrowserUpdate(page);
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

export async function submitFocusedLabelInput(
  page: Page,
  value: string,
): Promise<void> {
  const inputSelector = '[data-testid="label-input-field"]';
  const submitSelector = '[data-testid="label-input-submit"]';

  await page.waitForFunction(
    () => (document.body.dataset.strategyPanelMode ?? 'label-edit') === 'label-edit',
  );
  await showControlPadPage(page, 'edit');
  await page.waitForSelector(inputSelector);
  await page.waitForSelector(submitSelector);
  await page.click(inputSelector, {clickCount: 3});
  await page.keyboard.press('Backspace');
  await page.keyboard.type(value);
  await page.click(submitSelector);
  await page.waitForFunction(
    ({expectedValue, inputButtonSelector, submitButtonSelector}) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
      const submitButton =
        document.querySelector<HTMLButtonElement>(submitButtonSelector);

      return (
        input instanceof HTMLInputElement &&
        submitButton instanceof HTMLButtonElement &&
        input.matches(inputButtonSelector) &&
        input.value === expectedValue &&
        !input.disabled &&
        !submitButton.disabled
      );
    },
    {},
    {
      expectedValue: value,
      inputButtonSelector: inputSelector,
      submitButtonSelector: submitSelector,
    },
  );
  await waitForBrowserUpdate(page);
}

export async function clickEditorAction(
  page: Page,
  action: 'add-label' | 'clear-selection' | 'link-selection' | 'remove-label' | 'remove-links',
): Promise<void> {
  await showControlPadPage(page, 'edit');
  const selector = `button[data-editor-action="${action}"]`;
  await clickButton(page, selector, `Missing editor action button ${selector}`);
  await waitForBrowserUpdate(page);
}

export async function clickEditorShortcut(
  page: Page,
  action: 'toggle-selection-or-create',
): Promise<void> {
  await showControlPadPage(page, 'edit');
  const selector = `button[data-editor-shortcut="${action}"]`;
  await clickButton(page, selector, `Missing editor shortcut button ${selector}`);
  await waitForBrowserUpdate(page);
}

export async function pressNavigationKey(
  page: Page,
  key: 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp',
  options?: {shift?: boolean},
): Promise<void> {
  if (options?.shift) {
    await page.keyboard.down('Shift');
  }

  try {
    await page.keyboard.press(key);
  } finally {
    if (options?.shift) {
      await page.keyboard.up('Shift');
    }
  }

  await waitForBrowserUpdate(page);
}

export async function pressEditorKey(
  page: Page,
  key: 'Delete' | 'Enter' | 'Escape',
  options?: {shift?: boolean},
): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  if (options?.shift) {
    await page.keyboard.down('Shift');
  }

  try {
    await page.keyboard.press(key);
  } finally {
    if (options?.shift) {
      await page.keyboard.up('Shift');
    }
  }

  await waitForBrowserUpdate(page);
}

export async function pressPlaneStackKey(
  page: Page,
  action:
    | 'delete-active-workplane'
    | 'select-next-workplane'
    | 'select-previous-workplane'
    | 'spawn-workplane',
): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  switch (action) {
    case 'delete-active-workplane':
      await page.keyboard.press('Minus');
      break;
    case 'select-next-workplane':
      await page.keyboard.press('BracketRight');
      break;
    case 'select-previous-workplane':
      await page.keyboard.press('BracketLeft');
      break;
    case 'spawn-workplane':
      await page.keyboard.down('Shift');

      try {
        await page.keyboard.press('Equal');
      } finally {
        await page.keyboard.up('Shift');
      }
      break;
  }

  await waitForBrowserUpdate(page);
}

export async function pressStageModeKey(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press('Slash');
  await waitForBrowserUpdate(page);
}

export async function clickStageModeButton(
  page: Page,
  stageMode: '2d-mode' | '3d-mode',
): Promise<void> {
  await showControlPadPage(page, 'stage');
  const selector =
    stageMode === '2d-mode'
      ? 'button[data-stage-mode-action="set-2d-mode"]'
      : 'button[data-stage-mode-action="set-3d-mode"]';
  const currentMode = await page.evaluate(
    () => (document.body.dataset.stageMode ?? '2d-mode') as '2d-mode' | '3d-mode',
  );

  await selectToggleValue(page, {
    currentValue: currentMode,
    datasetKey: 'stageMode',
    expectedValue: stageMode,
    missingMessage: `Missing stage mode button ${selector}`,
    selector,
  });
}

export async function clickWorkplaneButton(
  page: Page,
  action:
    | 'delete-active-workplane'
    | 'select-next-workplane'
    | 'select-previous-workplane'
    | 'spawn-workplane',
): Promise<void> {
  await showControlPadPage(page, 'stage');
  const selector = `button[data-workplane-action="${action}"]`;
  await clickButton(page, selector, `Missing workplane button ${selector}`);
  await waitForBrowserUpdate(page);
}

export async function clickControlPadToggle(page: Page): Promise<void> {
  const selector = 'button[data-control-pad-action="toggle-page"]';
  await clickButton(page, selector, `Missing control pad toggle button ${selector}`);
  await waitForBrowserUpdate(page);
}

export async function showControlPadPage(
  page: Page,
  controlPadPage: 'edit' | 'navigate' | 'stage',
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentPage = await page.evaluate(
      () => (document.body.dataset.controlPadPage ?? 'navigate') as 'edit' | 'navigate' | 'stage',
    );

    if (currentPage === controlPadPage) {
      return;
    }

    await clickControlPadToggle(page);
  }

  await page.waitForFunction(
    (expectedPage) => document.body.dataset.controlPadPage === expectedPage,
    {},
    controlPadPage,
  );
}

export async function dragStackCameraOrbit(
  page: Page,
  delta: {x: number; y: number},
): Promise<void> {
  const canvas = await page.$('[data-testid="gpu-canvas"]');

  if (!canvas) {
    throw new Error('Missing GPU canvas for stack-camera orbit test.');
  }

  const box = await canvas.boundingBox();

  if (!box) {
    throw new Error('Expected the GPU canvas to have a visible bounding box.');
  }

  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + delta.x, startY + delta.y, {steps: 10});
  await page.mouse.up();
  await waitForBrowserUpdate(page);
}

export async function dragStackCameraFullOrbit(
  page: Page,
  options?: {durationMs?: number; revolutions?: number},
): Promise<void> {
  const canvas = await page.$('[data-testid="gpu-canvas"]');

  if (!canvas) {
    throw new Error('Missing GPU canvas for stack-camera orbit coverage test.');
  }

  const box = await canvas.boundingBox();

  if (!box) {
    throw new Error('Expected the GPU canvas to have a visible bounding box.');
  }

  const durationMs = Math.max(1200, Math.trunc(options?.durationMs ?? 2200));
  const revolutions = Math.max(1, options?.revolutions ?? 1);
  const radiansPerPixel = 0.0055;
  const requestedSweepWidth =
    ((Math.PI * 2) * revolutions) / radiansPerPixel;
  const maxSweepWidth = box.width * 0.46 * 2;
  const sweepWidth = Math.min(maxSweepWidth, requestedSweepWidth);
  const stepCount = Math.max(60, Math.ceil(durationMs / 20));
  const centerX = box.x + box.width * 0.5;
  const centerY = box.y + box.height * 0.5;
  const startX = centerX + sweepWidth * 0.5;
  const startY = centerY;
  const startedAt = Date.now();

  await page.mouse.move(startX, startY);
  await page.mouse.down();

  for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
    const progress = stepIndex / stepCount;
    const x = startX - sweepWidth * progress;
    await page.mouse.move(x, startY);

    const targetElapsedMs = progress * durationMs;
    const remainingMs = startedAt + targetElapsedMs - Date.now();

    if (remainingMs > 0) {
      await sleep(remainingMs);
    }
  }

  await page.mouse.up();
  await waitForBrowserUpdate(page);
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

  await clickControl(page, 'zoom-in');
  await waitForCameraLabel(page, FIRST_CHILD_LABEL);

  const afterZoomIn = await getTextState(page);
  assertDemoChildLayerVisible(afterZoomIn, `${textStrategy} mode after zooming into the child band`);

  await clickControl(page, 'zoom-out');
  await waitForCameraLabel(page, FIRST_ROOT_LABEL);

  await clickControl(page, 'zoom-out');
  await waitForBrowserUpdate(page);
  assert.equal(
    (await getCameraState(page)).label,
    FIRST_ROOT_LABEL,
    `${textStrategy} mode should stop zooming out at the root layer.`,
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

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function buildStageUrl(
  baseUrl: string,
  params: Record<string, string>,
): string {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export async function waitForCameraSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (document.body.dataset.cameraAnimating ?? 'false') === 'false',
    {timeout: 10_000},
  );
}

export async function waitForAppDatasets(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => {
      const state = document.body.dataset.appState;
      return state === 'ready' || state === 'unsupported' || state === 'error';
    });

    await page.waitForFunction(() => {
      if (document.body.dataset.appState !== 'ready') {
        return true;
      }

      return Boolean(
        document.body.dataset.activeWorkplaneId &&
          document.body.dataset.planeCount &&
          document.body.dataset.gridLineCount &&
          document.body.dataset.stageMode &&
          document.body.dataset.textStrategy &&
          document.body.dataset.textLabelCount &&
          document.body.dataset.textGlyphCount &&
          document.body.dataset.textVisibleLabelCount &&
          document.body.dataset.perfCpuFrameAvgMs &&
          document.body.dataset.perfCpuTextAvgMs &&
          document.body.dataset.workplaneCanDelete,
      );
    });
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      appState: document.body.dataset.appState ?? '',
      dataset: {...document.body.dataset},
    }));
    throw new Error(
      `Timed out waiting for app datasets. Diagnostics: ${JSON.stringify(diagnostics)}. Cause: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {cause: error},
    );
  }
}

async function waitForOverlayShell(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
  const layout = await getLayoutShellState(page);

  if (!layout.statusPanel.visible || !layout.controlPad.visible) {
    const diagnostics = await page.evaluate(() => ({
      appState: document.body.dataset.appState ?? '',
      stageHtml: document.querySelector('.luma-stage')?.outerHTML.slice(0, 1500) ?? '',
    }));
    throw new Error(
      `Overlay shell is not visible after waiting: ${JSON.stringify({
        diagnostics,
        layout,
      })}`,
    );
  }
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

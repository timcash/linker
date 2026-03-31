import assert from 'node:assert/strict';

import type {Page} from 'puppeteer';
import type {StageMode, WorkplaneId} from '../../src/plane-stack';
import type {PersistedStageSessionRecord} from '../../src/stage-session-store';

import {
  BROWSER_UPDATE_FRAME_COUNT,
  DEFAULT_LINE_STRATEGY,
  DEFAULT_LAYOUT_STRATEGY,
  DEFAULT_TEXT_STRATEGY,
  DEMO_LABEL_SET_ID,
  FIRST_ROOT_LABEL,
  type BenchmarkState,
  type CameraQueryState,
  type CameraState,
  type CanvasPixelSignature,
  type HistoryState,
  type LineState,
  type LineStrategy,
  type NonReadyResult,
  type PerfSnapshot,
  type ReadyResult,
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
        stage: {
          activeWorkplaneId: document.body.dataset.activeWorkplaneId ?? '',
          planeCount: Number(document.body.dataset.planeCount ?? '0'),
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
    const labelValue = url.searchParams.get('cameraLabel');
    const centerXValue = url.searchParams.get('cameraCenterX');
    const centerYValue = url.searchParams.get('cameraCenterY');
    const zoomValue = url.searchParams.get('cameraZoom');
    const centerX = centerXValue === null ? null : Number(centerXValue);
    const centerY = centerYValue === null ? null : Number(centerYValue);
    const zoom = zoomValue === null ? null : Number(zoomValue);

    return {
      label: labelValue,
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

export async function getStageState(page: Page): Promise<StageState> {
  return page.evaluate(() => ({
    activeWorkplaneId: document.body.dataset.activeWorkplaneId ?? '',
    planeCount: Number(document.body.dataset.planeCount ?? '0'),
    stageMode: document.body.dataset.stageMode ?? '',
    workplaneCanDelete: document.body.dataset.workplaneCanDelete === 'true',
  }));
}

export async function getStageRouteState(page: Page): Promise<StageRouteState> {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    const queryHistoryValue = url.searchParams.get('history');
    const queryHistoryStep = queryHistoryValue === null ? null : Number(queryHistoryValue);

    return {
      historyStep:
        Number.isInteger(queryHistoryStep) && queryHistoryStep !== null
          ? queryHistoryStep
          : null,
      sessionToken: url.searchParams.get('session'),
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

export async function getHistoryState(page: Page): Promise<HistoryState> {
  return page.evaluate(() => ({
    canGoBack: document.body.dataset.historyCanGoBack === 'true',
    canGoForward: document.body.dataset.historyCanGoForward === 'true',
    cursorStep: Number(document.body.dataset.historyCursorStep ?? '0'),
    headStep: Number(document.body.dataset.historyHeadStep ?? '0'),
    trackingEnabled: document.body.dataset.historyTrackingEnabled !== 'false',
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

export async function seedPersistedStageSessionRecord(
  page: Page,
  record: PersistedStageSessionRecord,
): Promise<void> {
  await page.evaluate(async (snapshot) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('linker-stage', 3);

      request.addEventListener('upgradeneeded', () => {
        const nextDatabase = request.result;

        if (!nextDatabase.objectStoreNames.contains('stage-sessions')) {
          nextDatabase.createObjectStore('stage-sessions', {keyPath: 'sessionToken'});
        }

        let historyStore: IDBObjectStore;

        if (!nextDatabase.objectStoreNames.contains('stage-history-entries')) {
          historyStore = nextDatabase.createObjectStore('stage-history-entries', {
            keyPath: ['sessionToken', 'step'],
          });
        } else {
          historyStore = request.transaction!.objectStore('stage-history-entries');
        }

        if (!historyStore.indexNames.contains('by-session-token')) {
          historyStore.createIndex('by-session-token', 'sessionToken', {unique: false});
        }
      });
      request.addEventListener('success', () => resolve(request.result));
      request.addEventListener('error', () => {
        reject(request.error ?? new Error('Failed to open the stage session database.'));
      });
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          ['stage-sessions', 'stage-history-entries'],
          'readwrite',
        );
        const sessionStore = transaction.objectStore('stage-sessions');
        const historyStore = transaction.objectStore('stage-history-entries');

        historyStore.delete(
          IDBKeyRange.bound(
            [snapshot.sessionToken, 0],
            [snapshot.sessionToken, Number.MAX_SAFE_INTEGER],
          ),
        );

        if (snapshot.version === 1) {
          sessionStore.put(snapshot);
        } else {
          sessionStore.put({
            version: 3,
            sessionToken: snapshot.sessionToken,
            savedAt: snapshot.savedAt,
            config: snapshot.config,
            historyCursorStep: snapshot.history.cursorStep,
            historyHeadStep: snapshot.history.headStep,
            ui: snapshot.ui,
          });

          snapshot.history.entries.forEach((entry, step) => {
            historyStore.put({
              entry,
              sessionToken: snapshot.sessionToken,
              step,
            });
          });
        }

        transaction.addEventListener('complete', () => resolve());
        transaction.addEventListener('error', () => {
          reject(transaction.error ?? new Error('Failed to seed the stage session snapshot.'));
        });
        transaction.addEventListener('abort', () => {
          reject(transaction.error ?? new Error('Stage session seeding was aborted.'));
        });
      });

      window.localStorage.setItem('linker:last-session-token', snapshot.sessionToken);
    } finally {
      database.close();
    }
  }, record);
}

export async function openPersistedSessionRoute(
  page: Page,
  baseUrl: string,
  record: PersistedStageSessionRecord,
  options?: {
    historyTrackingEnabled?: boolean;
    historyStep?: number | null;
    stageMode?: StageMode | null;
    workplaneId?: WorkplaneId | null;
  },
): Promise<void> {
  await seedPersistedStageSessionRecord(page, record);

  const url = new URL(baseUrl);
  url.searchParams.set('session', record.sessionToken);

  if (options?.historyTrackingEnabled) {
    url.searchParams.set('historyTracking', '1');
  } else {
    url.searchParams.delete('historyTracking');
  }

  if (options && 'historyStep' in options) {
    if (options.historyStep === null) {
      url.searchParams.delete('history');
    } else {
      url.searchParams.set('history', String(options.historyStep));
    }
  }

  if (options && 'stageMode' in options) {
    if (options.stageMode === null) {
      url.searchParams.delete('stageMode');
    } else {
      url.searchParams.set('stageMode', options.stageMode);
    }
  }

  if (options && 'workplaneId' in options) {
    if (options.workplaneId === null) {
      url.searchParams.delete('workplane');
    } else {
      url.searchParams.set('workplane', options.workplaneId);
    }
  }

  await openRoute(page, url.toString());
}

export async function openRoute(page: Page, url: string): Promise<void> {
  await page.goto(url, {waitUntil: 'load'});
  await waitForAppDatasets(page);
}

export async function clickButton(
  page: Page,
  selector: string,
  missingMessage: string,
): Promise<void> {
  await page.waitForSelector(selector);
  const button = await page.$(selector);

  if (!button) {
    throw new Error(missingMessage);
  }

  await button.click();
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

export async function waitForPersistedStageSession(
  page: Page,
  sessionToken: string,
): Promise<void> {
  await page.waitForFunction(
    async (expectedSessionToken) => {
      if (typeof indexedDB === 'undefined') {
        return true;
      }

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('linker-stage');

        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
          reject(request.error ?? new Error('Failed to open stage-session database.'));
        });
      });

      try {
        if (!database.objectStoreNames.contains('stage-sessions')) {
          return false;
        }

        const snapshot = await new Promise<unknown>((resolve, reject) => {
          const transaction = database.transaction('stage-sessions', 'readonly');
          const store = transaction.objectStore('stage-sessions');
          const request = store.get(expectedSessionToken);

          request.addEventListener('success', () => resolve(request.result ?? null));
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to read stage-session snapshot.'));
          });
        });

        return Boolean(snapshot);
      } finally {
        database.close();
      }
    },
    {timeout: 10_000},
    sessionToken,
  );
  await waitForBrowserUpdate(page);
}

export async function waitForPersistedStageHistoryHead(
  page: Page,
  sessionToken: string,
  expectedHeadStep: number,
): Promise<void> {
  await page.waitForFunction(
    async ({expectedHead, expectedSessionToken}) => {
      if (typeof indexedDB === 'undefined') {
        return true;
      }

      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('linker-stage');

        request.addEventListener('success', () => resolve(request.result));
        request.addEventListener('error', () => {
          reject(request.error ?? new Error('Failed to open stage-session database.'));
        });
      });

      try {
        if (!database.objectStoreNames.contains('stage-sessions')) {
          return false;
        }

        const metadata = await new Promise<unknown>((resolve, reject) => {
          const transaction = database.transaction('stage-sessions', 'readonly');
          const store = transaction.objectStore('stage-sessions');
          const request = store.get(expectedSessionToken);

          request.addEventListener('success', () => resolve(request.result ?? null));
          request.addEventListener('error', () => {
            reject(request.error ?? new Error('Failed to read stage-session metadata.'));
          });
        });

        if (
          !metadata ||
          typeof metadata !== 'object' ||
          !('historyHeadStep' in metadata) ||
          !('historyCursorStep' in metadata)
        ) {
          return false;
        }

        return (
          (metadata as {historyCursorStep?: unknown}).historyCursorStep === expectedHead &&
          (metadata as {historyHeadStep?: unknown}).historyHeadStep === expectedHead
        );
      } finally {
        database.close();
      }
    },
    {timeout: 10_000},
    {
      expectedHead: expectedHeadStep,
      expectedSessionToken: sessionToken,
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

export async function submitFocusedLabelInput(
  page: Page,
  value: string,
): Promise<void> {
  const inputSelector = '[data-testid="label-input-field"]';
  const submitSelector = '[data-testid="label-input-submit"]';

  await showStrategyPanelMode(page, 'label-edit');
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

export async function pressHistoryKey(
  page: Page,
  action: 'history-back' | 'history-forward',
): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });

  await page.keyboard.press(action === 'history-back' ? 'Comma' : 'Period');
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
      await page.keyboard.press('Delete');
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

export async function navigateBrowserHistory(
  page: Page,
  direction: 'back' | 'forward',
  options?: {expectedHistoryStep?: number | null},
): Promise<void> {
  await page.evaluate((nextDirection) => {
    if (nextDirection === 'back') {
      window.history.back();
      return;
    }

    window.history.forward();
  }, direction);
  if (options && 'expectedHistoryStep' in options) {
    await waitForRouteHistoryStep(page, options.expectedHistoryStep ?? null);
  }
  await waitForBrowserUpdate(page);
}

export async function waitForRouteHistoryStep(
  page: Page,
  expectedHistoryStep: number | null,
): Promise<void> {
  await page.waitForFunction(
    (expectedStep) => {
      const url = new URL(window.location.href);
      const routeState: unknown = window.history.state;
      const stateHistoryStep =
        routeState && typeof routeState === 'object'
          ? (routeState as {stageHistoryStep?: unknown}).stageHistoryStep
          : null;
      const queryHistoryValue = url.searchParams.get('history');
      const queryHistoryStep = queryHistoryValue === null ? null : Number(queryHistoryValue);
      const currentHistoryStep =
        Number.isInteger(queryHistoryStep) && queryHistoryStep !== null
          ? queryHistoryStep
          : Number.isInteger(stateHistoryStep) && (stateHistoryStep as number) >= 0
          ? (stateHistoryStep as number)
          : null;

      return currentHistoryStep === expectedStep;
    },
    {timeout: 10_000},
    expectedHistoryStep,
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
  await waitForCameraLabel(page, '1:1:2');

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

export async function waitForCameraSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (document.body.dataset.cameraAnimating ?? 'false') === 'false',
    {timeout: 10_000},
  );
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
      document.body.dataset.activeWorkplaneId &&
        document.body.dataset.planeCount &&
        document.body.dataset.cameraCenterX &&
        document.body.dataset.cameraCenterY &&
        document.body.dataset.cameraZoom &&
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

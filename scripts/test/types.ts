import type {Browser, Page} from 'puppeteer';
import type {ViteDevServer} from 'vite';

import {
  DEFAULT_LAYOUT_STRATEGY,
  LAYOUT_STRATEGIES,
  type LayoutStrategy,
} from '../../src/data/demo-layout';
import {
  DEFAULT_LINE_STRATEGY,
  LINE_STRATEGIES,
  type LineStrategy,
} from '../../src/line/types';
import {DEMO_LABEL_SET_ID} from '../../src/data/demo-meta';
import {
  STATIC_BENCHMARK_COUNTS,
  STATIC_BENCHMARK_LABEL_SET_ID,
} from '../../src/data/static-benchmark';
import {
  DEFAULT_DEMO_LAYER_COUNT,
  getDemoLabelCount,
} from '../../src/data/labels';
import {
  DEFAULT_TEXT_STRATEGY,
  TEXT_STRATEGIES,
  type TextStrategy,
} from '../../src/text/types';

export type ReadyResult = {
  state: 'ready';
  width: number;
  height: number;
  innerWidth: number;
  innerHeight: number;
  camera: CameraState;
  text: TextState;
};

export type NonReadyResult = {
  state: string;
  message: string;
};

export type CameraState = {
  animating: boolean;
  canMoveDown: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canMoveUp: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  column: number;
  centerX: number;
  centerY: number;
  label: string;
  layer: number;
  zoom: number;
  row: number;
  scale: number;
  lineCount: number;
  minorSpacing: number;
  majorSpacing: number;
};

export type CameraQueryState = {
  label: string | null;
  centerX: number | null;
  centerY: number | null;
  zoom: number | null;
};

export type StrategyPanelMode = 'text' | 'line' | 'layout' | 'label-edit';

export type LineState = {
  curveFingerprint: string;
  lineDimmedLinkCount: number;
  lineHighlightedInputLinkCount: number;
  lineHighlightedOutputLinkCount: number;
  lineLinkCount: number;
  lineStrategy: LineStrategy;
  lineVisibleLinkCount: number;
  strategyPanelMode: string;
  submittedVertexCount: number;
};

export type TextState = {
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

export type BenchmarkState = {
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

export type LargeScaleSweepState = {
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

export type CanvasPixelSignature = {
  brightPixelCount: number;
  nonZeroAlphaPixelCount: number;
  pixelHash: string;
  pixelSum: number;
  height: number;
  width: number;
};

export type CameraTraceStep = {
  control: string;
  name: string;
  repeat: number;
};

export type StrategyComparisonOperator = '<' | '<=' | '>' | '>=';

export type StrategyMetricRule<TState> = {
  description: string;
  left: TextStrategy;
  operator: StrategyComparisonOperator;
  readValue: (state: TState) => number;
  right: TextStrategy;
};

export type BrowserTestContext = {
  addBrowserLog: (kind: string, message: string) => void;
  addErrorLog: (kind: string, message: string) => void;
  browser: Browser;
  flushBrowserLog: () => Promise<void>;
  flushErrorLog: () => Promise<void>;
  logPath: string;
  page: Page;
  pageErrors: string[];
  screenshotPath: string;
  server: ViteDevServer;
  url: string;
};

export {
  DEFAULT_LINE_STRATEGY,
  DEFAULT_LAYOUT_STRATEGY,
  DEFAULT_TEXT_STRATEGY,
  DEMO_LABEL_SET_ID,
  LINE_STRATEGIES,
  LAYOUT_STRATEGIES,
  STATIC_BENCHMARK_COUNTS,
  STATIC_BENCHMARK_LABEL_SET_ID,
  TEXT_STRATEGIES,
};

export type {LineStrategy, TextStrategy};

export const ERROR_PING_TOKEN = 'ERROR_PING_TEST';
export const INTENTIONAL_ERROR_MARKER = '[intentional-error-ping]';
export const BROWSER_UPDATE_FRAME_COUNT = 1;
export const BENCHMARK_TRACE_FRAME_COUNT = 1;
export const LARGE_SCALE_SWEEP_CAMERA_ZOOM = 4.08;
export const DEMO_SOURCE_COLUMN_COUNT = 12;
export const DEMO_ROWS_PER_SOURCE_COLUMN = 12;
export const DEMO_ROOT_LABEL_COUNT = DEMO_SOURCE_COLUMN_COUNT * DEMO_ROWS_PER_SOURCE_COLUMN;
export const DEMO_LABEL_COUNT = getDemoLabelCount(DEFAULT_DEMO_LAYER_COUNT);
export const DEMO_ROOT_LABEL_SIZE = 0.26;
export const DEMO_CHILD_LABEL_SIZE = 0.28;
export const FIRST_ROOT_LABEL = '1:1:1';
export const FIRST_CHILD_LABEL = '1:1:2';
export const CENTER_ROOT_LABEL = '6:6:1';
export const CENTER_CHILD_LABEL = '6:6:2';
export const LAST_ROOT_LABEL = '12:12:1';
export const LAST_CHILD_LABEL = '12:12:2';
export const LAST_DEMO_LABEL = `12:12:${DEFAULT_DEMO_LAYER_COUNT}`;
export const RUN_EXTENDED_TEST_MATRIX = process.env.LINKER_EXTENDED_TEST_MATRIX === '1';

export const BYTE_UPLOAD_RULES: readonly StrategyMetricRule<{
  bytesUploadedPerFrame: number;
}>[] = [
  {
    description: 'upload fewer bytes than',
    left: 'instanced',
    operator: '<',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'baseline',
  },
  {
    description: 'upload fewer bytes than',
    left: 'visible-index',
    operator: '<',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'instanced',
  },
  {
    description: 'upload no more bytes than',
    left: 'chunked',
    operator: '<=',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'visible-index',
  },
  {
    description: 'upload fewer bytes than',
    left: 'sdf-instanced',
    operator: '<',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'baseline',
  },
  {
    description: 'upload at least as many bytes as',
    left: 'sdf-instanced',
    operator: '>=',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'instanced',
  },
  {
    description: 'upload fewer bytes than',
    left: 'sdf-visible-index',
    operator: '<',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'sdf-instanced',
  },
  {
    description: 'upload at least as many bytes as',
    left: 'sdf-visible-index',
    operator: '>=',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'visible-index',
  },
  {
    description: 'upload fewer bytes than',
    left: 'packed',
    operator: '<',
    readValue: (state) => state.bytesUploadedPerFrame,
    right: 'visible-index',
  },
] as const;

export const LARGE_SCALE_CAMERA_TRACE: readonly CameraTraceStep[] = [
  {name: 'zoom-out-visible', control: 'zoom-out', repeat: 1},
  {name: 'zoom-out-wide', control: 'zoom-out', repeat: 1},
  {name: 'zoom-out-wider', control: 'zoom-out', repeat: 1},
  {name: 'zoom-in-return', control: 'zoom-in', repeat: 1},
  {name: 'zoom-in-tight', control: 'zoom-in', repeat: 1},
  {name: 'zoom-in-hidden', control: 'zoom-in', repeat: 1},
] as const;

export function getLayoutStrategies(): LayoutStrategy[] {
  return [...LAYOUT_STRATEGIES];
}

export function getLineStrategies(): LineStrategy[] {
  return [...LINE_STRATEGIES];
}

export function isSdfTextStrategy(textStrategy: TextStrategy): boolean {
  return textStrategy === 'sdf-instanced' || textStrategy === 'sdf-visible-index';
}

export function preservesBaselinePixels(textStrategy: TextStrategy): boolean {
  return !isSdfTextStrategy(textStrategy);
}

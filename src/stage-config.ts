import type {CameraSnapshot} from './camera';
import {
  DEFAULT_STAGE_MODE,
  isStageMode,
  isWorkplaneId,
  type StageMode,
  type WorkplaneId,
} from './plane-stack';
import {
  DEFAULT_DEMO_LAYER_COUNT,
  DEFAULT_LAYOUT_STRATEGY,
  LAYOUT_STRATEGIES,
  MAX_DEMO_LAYER_COUNT,
  MIN_DEMO_LAYER_COUNT,
  getDemoLabelCount,
  type LayoutStrategy,
} from './data/labels';
import {DEFAULT_BENCHMARK_LABEL_COUNT} from './data/static-benchmark';
import {DEFAULT_LINE_STRATEGY, LINE_STRATEGIES, type LineStrategy} from './line/types';
import {DEFAULT_TEXT_STRATEGY, type TextStrategy} from './text/types';

export type LabelSetKind = 'demo' | 'benchmark';
export type RouteUpdateMode = 'push' | 'replace';

export type CameraView = Pick<CameraSnapshot, 'centerX' | 'centerY' | 'zoom'>;

export type StageConfig = {
  benchmarkTraceStepCount: number;
  benchmarkEnabled: boolean;
  demoLayerCount: number;
  gpuTimingEnabled: boolean;
  historyTrackingEnabled: boolean;
  initialCamera: CameraView;
  initialCameraLabel: string | null;
  labelSetKind: LabelSetKind;
  layoutStrategy: LayoutStrategy;
  labelTargetCount: number;
  lineStrategy: LineStrategy;
  requestedHistoryStep: number | null;
  requestedSessionToken: string | null;
  requestedStageMode: StageMode | null;
  requestedWorkplaneId: WorkplaneId | null;
  stageMode: StageMode;
  textStrategy: TextStrategy;
};

const DEFAULT_BENCHMARK_TRACE_STEP_COUNT = 8;
const MANAGED_STAGE_ROUTE_PARAM_KEYS = [
  'cameraCenterX',
  'cameraCenterY',
  'cameraLabel',
  'cameraZoom',
  'layoutStrategy',
  'lineStrategy',
  'stageMode',
  'textStrategy',
  'workplane',
] as const;

export function readStageConfig(search: string): StageConfig {
  const params = new URLSearchParams(search);
  const labelSetKind: LabelSetKind = params.get('labelSet') === 'benchmark' ? 'benchmark' : 'demo';
  const layoutStrategy = parseLayoutStrategy(params.get('layoutStrategy'));
  const lineStrategy = parseLineStrategy(params.get('lineStrategy'));
  const requestedStageMode = parseRequestedStageMode(params.get('stageMode'));
  const demoLayerCount = parseBoundedInteger(
    params.get('demoLayers'),
    DEFAULT_DEMO_LAYER_COUNT,
    MIN_DEMO_LAYER_COUNT,
    MAX_DEMO_LAYER_COUNT,
  );
  const labelTargetCount =
    labelSetKind === 'benchmark'
      ? parseBoundedInteger(params.get('labelCount'), DEFAULT_BENCHMARK_LABEL_COUNT, 64, 16384)
      : getDemoLabelCount(demoLayerCount);

  return {
    benchmarkTraceStepCount: parseBoundedInteger(
      params.get('benchmarkFrames'),
      DEFAULT_BENCHMARK_TRACE_STEP_COUNT,
      8,
      120,
    ),
    benchmarkEnabled: params.get('benchmark') === '1',
    demoLayerCount,
    gpuTimingEnabled: params.get('gpuTiming') !== '0',
    historyTrackingEnabled: params.get('historyTracking') !== '0',
    initialCamera: {
      centerX: parseFiniteNumber(params.get('cameraCenterX'), 0),
      centerY: parseFiniteNumber(params.get('cameraCenterY'), 0),
      zoom: parseFiniteNumber(params.get('cameraZoom'), 0),
    },
    initialCameraLabel: params.get('cameraLabel'),
    labelSetKind,
    layoutStrategy,
    labelTargetCount,
    lineStrategy,
    requestedHistoryStep: parseNonNegativeInteger(params.get('history')),
    requestedSessionToken: parseSessionToken(params.get('session')),
    requestedStageMode,
    requestedWorkplaneId: parseWorkplaneId(params.get('workplane')),
    stageMode: requestedStageMode ?? DEFAULT_STAGE_MODE,
    textStrategy: parseTextStrategy(params.get('textStrategy')),
  };
}

export function syncStageTextStrategyQueryParam(textStrategy: TextStrategy): void {
  void textStrategy;
  updateRouteSearchParams((searchParams) => {
    searchParams.delete('textStrategy');
  }, 'replace');
}

export function syncStageLineStrategyQueryParam(lineStrategy: LineStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (lineStrategy === DEFAULT_LINE_STRATEGY) {
      searchParams.delete('lineStrategy');
    } else {
      searchParams.set('lineStrategy', lineStrategy);
    }
  }, 'replace');
}

export function syncStageLayoutStrategyQueryParam(layoutStrategy: LayoutStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (layoutStrategy === DEFAULT_LAYOUT_STRATEGY) {
      searchParams.delete('layoutStrategy');
    } else {
      searchParams.set('layoutStrategy', layoutStrategy);
    }
  }, 'replace');
}

export function syncStageModeQueryParam(stageMode: StageMode): void {
  updateRouteSearchParams((searchParams) => {
    if (stageMode === DEFAULT_STAGE_MODE) {
      searchParams.delete('stageMode');
    } else {
      searchParams.set('stageMode', stageMode);
    }
  }, 'replace');
}

export function syncStageSessionQueryParam(sessionToken: string | null): void {
  updateRouteSearchParams((searchParams) => {
    if (!sessionToken) {
      searchParams.delete('session');
      return;
    }

    searchParams.set('session', sessionToken);
  }, 'replace');
}

export function syncStageWorkplaneQueryParam(activeWorkplaneId: WorkplaneId): void {
  updateRouteSearchParams((searchParams) => {
    if (activeWorkplaneId === 'wp-1') {
      searchParams.delete('workplane');
    } else {
      searchParams.set('workplane', activeWorkplaneId);
    }
  }, 'replace');
}

export function syncStageNumericCameraQueryParams(camera: CameraView): void {
  updateRouteSearchParams((searchParams) => {
    searchParams.delete('cameraLabel');
    syncCameraNumberQueryParam(searchParams, 'cameraCenterX', camera.centerX);
    syncCameraNumberQueryParam(searchParams, 'cameraCenterY', camera.centerY);
    syncCameraNumberQueryParam(searchParams, 'cameraZoom', camera.zoom);
  }, 'replace');
}

export function syncStageDemoCameraQueryParams(labelKey: string, defaultLabelKey: string): void {
  updateRouteSearchParams((searchParams) => {
    searchParams.delete('cameraCenterX');
    searchParams.delete('cameraCenterY');
    searchParams.delete('cameraZoom');

    if (labelKey === defaultLabelKey) {
      searchParams.delete('cameraLabel');
    } else {
      searchParams.set('cameraLabel', labelKey);
    }
  }, 'replace');
}

export function syncStageHistoryQueryParam(
  historyStep: number | null,
): void {
  updateRouteSearchParams((searchParams) => {
    if (historyStep === null) {
      searchParams.delete('history');
    } else {
      searchParams.set('history', String(Math.max(0, Math.trunc(historyStep))));
    }
  });
}

export function readStageHistoryRouteState(): number | null {
  return parseNonNegativeInteger(new URL(window.location.href).searchParams.get('history'));
}

function parseTextStrategy(value: string | null): TextStrategy {
  void value;
  return DEFAULT_TEXT_STRATEGY;
}

function parseLineStrategy(value: string | null): LineStrategy {
  return isLineStrategy(value) ? value : DEFAULT_LINE_STRATEGY;
}

function parseLayoutStrategy(value: string | null): LayoutStrategy {
  return isLayoutStrategy(value) ? value : DEFAULT_LAYOUT_STRATEGY;
}

function parseRequestedStageMode(value: string | null): StageMode | null {
  return isStageMode(value) ? value : null;
}

function parseWorkplaneId(value: string | null): WorkplaneId | null {
  return isWorkplaneId(value) ? value : null;
}

function parseSessionToken(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sessionToken = value.trim();
  return sessionToken.length > 0 ? sessionToken : null;
}

function parseNonNegativeInteger(input: string | null): number | null {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseBoundedInteger(
  input: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function isLineStrategy(value: string | null | undefined): value is LineStrategy {
  return LINE_STRATEGIES.includes(value as LineStrategy);
}

function isLayoutStrategy(value: string | null | undefined): value is LayoutStrategy {
  return LAYOUT_STRATEGIES.includes(value as LayoutStrategy);
}

function updateRouteSearchParams(
  mutate: (searchParams: URLSearchParams) => void,
): void {
  const url = new URL(window.location.href);
  const previousSearch = url.search;
  stripManagedStageRouteParams(url.searchParams);
  mutate(url.searchParams);

  if (url.search === previousSearch) {
    return;
  }

  window.history.replaceState(null, '', url.toString());
}

function stripManagedStageRouteParams(searchParams: URLSearchParams): void {
  for (const key of MANAGED_STAGE_ROUTE_PARAM_KEYS) {
    searchParams.delete(key);
  }
}

function syncCameraNumberQueryParam(
  searchParams: URLSearchParams,
  key: 'cameraCenterX' | 'cameraCenterY' | 'cameraZoom',
  value: number,
): void {
  const normalizedValue = normalizeCameraQueryNumber(value);

  if (normalizedValue === null) {
    searchParams.delete(key);
    return;
  }

  searchParams.set(key, normalizedValue);
}

function normalizeCameraQueryNumber(value: number): string | null {
  if (Math.abs(value) < 0.00005) {
    return null;
  }

  return value.toFixed(4).replace(/\.?0+$/u, '');
}

function parseFiniteNumber(input: string | null, fallback: number): number {
  const parsed = input ? Number(input) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

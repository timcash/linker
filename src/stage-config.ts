import type {CameraSnapshot} from './camera';
import {DEMO_LABELS, DEFAULT_LAYOUT_STRATEGY, LAYOUT_STRATEGIES, type LayoutStrategy} from './data/labels';
import {DEFAULT_BENCHMARK_LABEL_COUNT} from './data/static-benchmark';
import {DEFAULT_LINE_STRATEGY, LINE_STRATEGIES, type LineStrategy} from './line/types';
import {DEFAULT_TEXT_STRATEGY, TEXT_STRATEGIES, type TextStrategy} from './text/types';

export type LabelSetKind = 'demo' | 'benchmark';

export type CameraView = Pick<CameraSnapshot, 'centerX' | 'centerY' | 'zoom'>;

export type StageConfig = {
  benchmarkTraceStepCount: number;
  benchmarkEnabled: boolean;
  gpuTimingEnabled: boolean;
  initialCamera: CameraView;
  initialCameraLabel: string | null;
  labelSetKind: LabelSetKind;
  layoutStrategy: LayoutStrategy;
  labelTargetCount: number;
  lineStrategy: LineStrategy;
  textStrategy: TextStrategy;
};

const DEFAULT_BENCHMARK_TRACE_STEP_COUNT = 8;

export function readStageConfig(search: string): StageConfig {
  const params = new URLSearchParams(search);
  const labelSetKind: LabelSetKind = params.get('labelSet') === 'benchmark' ? 'benchmark' : 'demo';
  const layoutStrategy = parseLayoutStrategy(params.get('layoutStrategy'));
  const lineStrategy = parseLineStrategy(params.get('lineStrategy'));
  const labelTargetCount =
    labelSetKind === 'benchmark'
      ? parseBoundedInteger(params.get('labelCount'), DEFAULT_BENCHMARK_LABEL_COUNT, 64, 16384)
      : DEMO_LABELS.length;

  return {
    benchmarkTraceStepCount: parseBoundedInteger(
      params.get('benchmarkFrames'),
      DEFAULT_BENCHMARK_TRACE_STEP_COUNT,
      8,
      120,
    ),
    benchmarkEnabled: params.get('benchmark') === '1',
    gpuTimingEnabled: params.get('gpuTiming') !== '0',
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
    textStrategy: parseTextStrategy(params.get('textStrategy')),
  };
}

export function syncStageTextStrategyQueryParam(textStrategy: TextStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (textStrategy === DEFAULT_TEXT_STRATEGY) {
      searchParams.delete('textStrategy');
    } else {
      searchParams.set('textStrategy', textStrategy);
    }
  });
}

export function syncStageLineStrategyQueryParam(lineStrategy: LineStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (lineStrategy === DEFAULT_LINE_STRATEGY) {
      searchParams.delete('lineStrategy');
    } else {
      searchParams.set('lineStrategy', lineStrategy);
    }
  });
}

export function syncStageLayoutStrategyQueryParam(layoutStrategy: LayoutStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (layoutStrategy === DEFAULT_LAYOUT_STRATEGY) {
      searchParams.delete('layoutStrategy');
    } else {
      searchParams.set('layoutStrategy', layoutStrategy);
    }
  });
}

export function syncStageNumericCameraQueryParams(camera: CameraView): void {
  updateRouteSearchParams((searchParams) => {
    searchParams.delete('cameraLabel');
    syncCameraNumberQueryParam(searchParams, 'cameraCenterX', camera.centerX);
    syncCameraNumberQueryParam(searchParams, 'cameraCenterY', camera.centerY);
    syncCameraNumberQueryParam(searchParams, 'cameraZoom', camera.zoom);
  });
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
  });
}

function parseTextStrategy(value: string | null): TextStrategy {
  return isTextStrategy(value) ? value : DEFAULT_TEXT_STRATEGY;
}

function parseLineStrategy(value: string | null): LineStrategy {
  return isLineStrategy(value) ? value : DEFAULT_LINE_STRATEGY;
}

function parseLayoutStrategy(value: string | null): LayoutStrategy {
  return isLayoutStrategy(value) ? value : DEFAULT_LAYOUT_STRATEGY;
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

function isTextStrategy(value: string | null | undefined): value is TextStrategy {
  return TEXT_STRATEGIES.includes(value as TextStrategy);
}

function isLineStrategy(value: string | null | undefined): value is LineStrategy {
  return LINE_STRATEGIES.includes(value as LineStrategy);
}

function isLayoutStrategy(value: string | null | undefined): value is LayoutStrategy {
  return LAYOUT_STRATEGIES.includes(value as LayoutStrategy);
}

function updateRouteSearchParams(mutate: (searchParams: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  const previousSearch = url.search;
  mutate(url.searchParams);

  if (url.search === previousSearch) {
    return;
  }

  window.history.replaceState({}, '', url.toString());
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

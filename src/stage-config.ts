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
import {DEFAULT_TEXT_STRATEGY, TEXT_STRATEGIES, type TextStrategy} from './text/types';

export type LabelSetKind = 'demo' | 'benchmark';
export type DemoPreset =
  | 'classic'
  | 'dag-empty'
  | 'dag-rank-fanout'
  | 'editor-lab';

export type StageConfig = {
  benchmarkTraceStepCount: number;
  benchmarkEnabled: boolean;
  demoPreset: DemoPreset;
  demoLayerCount: number;
  gpuTimingEnabled: boolean;
  initialCameraLabel: string | null;
  labelSetKind: LabelSetKind;
  layoutStrategy: LayoutStrategy;
  labelTargetCount: number;
  lineStrategy: LineStrategy;
  requestedStageMode: StageMode | null;
  requestedWorkplaneId: WorkplaneId | null;
  stageMode: StageMode;
  textStrategy: TextStrategy;
};

const DEFAULT_BENCHMARK_TRACE_STEP_COUNT = 8;
const MANAGED_STAGE_ROUTE_PARAM_KEYS = [
  'demoPreset',
  'demoLayers',
  'cameraCenterX',
  'cameraCenterY',
  'cameraLabel',
  'cameraZoom',
  'labelCount',
  'labelSet',
  'layoutStrategy',
  'lineStrategy',
  'stageMode',
  'textStrategy',
  'workplane',
] as const;

export function readStageConfig(search: string): StageConfig {
  const params = new URLSearchParams(search);
  const labelSetKind: LabelSetKind = params.get('labelSet') === 'benchmark' ? 'benchmark' : 'demo';
  const demoPreset = parseDemoPreset(params, labelSetKind);
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
    demoPreset,
    demoLayerCount,
    gpuTimingEnabled: params.get('gpuTiming') !== '0',
    initialCameraLabel: params.get('cameraLabel'),
    labelSetKind,
    layoutStrategy,
    labelTargetCount,
    lineStrategy,
    requestedStageMode,
    requestedWorkplaneId: parseWorkplaneId(params.get('workplane')),
    stageMode: requestedStageMode ?? DEFAULT_STAGE_MODE,
    textStrategy: parseTextStrategy(params.get('textStrategy')),
  };
}

export function syncStageRouteQueryParams(input: {
  cameraLabel: string | null;
  demoPreset: DemoPreset;
  demoLayerCount: number;
  labelSetKind: LabelSetKind;
  labelTargetCount: number;
  layoutStrategy: LayoutStrategy;
  lineStrategy: LineStrategy;
  stageMode: StageMode;
  textStrategy: TextStrategy;
  workplaneId: WorkplaneId;
}): void {
  updateRouteSearchParams((searchParams) => {
    searchParams.set('labelSet', input.labelSetKind);
    searchParams.set('layoutStrategy', input.layoutStrategy);
    searchParams.set('lineStrategy', input.lineStrategy);
    searchParams.set('textStrategy', input.textStrategy);

    if (input.labelSetKind === 'benchmark') {
      searchParams.delete('demoPreset');
      searchParams.delete('demoLayers');
      searchParams.set('labelCount', String(input.labelTargetCount));
    } else {
      searchParams.set('demoPreset', input.demoPreset);
      if (input.demoPreset === 'classic') {
        searchParams.set('demoLayers', String(input.demoLayerCount));
      } else {
        searchParams.delete('demoLayers');
      }
      searchParams.delete('labelCount');
    }

    searchParams.set('stageMode', input.stageMode);
    searchParams.set('workplane', input.workplaneId);

    if (input.cameraLabel) {
      searchParams.delete('cameraCenterX');
      searchParams.delete('cameraCenterY');
      searchParams.delete('cameraZoom');
      searchParams.set('cameraLabel', input.cameraLabel);
      return;
    }

    searchParams.delete('cameraLabel');
    searchParams.delete('cameraCenterX');
    searchParams.delete('cameraCenterY');
    searchParams.delete('cameraZoom');
  });
}

function parseTextStrategy(value: string | null): TextStrategy {
  return isTextStrategy(value) ? value : DEFAULT_TEXT_STRATEGY;
}

function parseDemoPreset(
  params: URLSearchParams,
  labelSetKind: LabelSetKind,
): DemoPreset {
  if (labelSetKind === 'benchmark') {
    return 'classic';
  }

  const requestedPreset = params.get('demoPreset');

  if (
    requestedPreset === 'classic' ||
    requestedPreset === 'dag-empty' ||
    requestedPreset === 'dag-rank-fanout' ||
    requestedPreset === 'editor-lab'
  ) {
    return requestedPreset;
  }

  return hasClassicDemoRouteHints(params) ? 'classic' : 'dag-rank-fanout';
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

function isTextStrategy(value: string | null | undefined): value is TextStrategy {
  return TEXT_STRATEGIES.includes(value as TextStrategy);
}

function isLayoutStrategy(value: string | null | undefined): value is LayoutStrategy {
  return LAYOUT_STRATEGIES.includes(value as LayoutStrategy);
}

function hasClassicDemoRouteHints(params: URLSearchParams): boolean {
  return (
    params.has('cameraLabel') ||
    params.has('demoLayers') ||
    params.has('layoutStrategy')
  );
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

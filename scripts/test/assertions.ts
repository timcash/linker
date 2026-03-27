import assert from 'node:assert/strict';

import {
  FIRST_CHILD_LABEL,
  FIRST_ROOT_LABEL,
  TEXT_STRATEGIES,
  type BenchmarkState,
  type CameraQueryState,
  type CameraState,
  type LargeScaleSweepState,
  type StrategyComparisonOperator,
  type StrategyMetricRule,
  type TextState,
  type TextStrategy,
} from './types';

const QUAD_VERTEX_TEXT_STRATEGIES: readonly TextStrategy[] = [
  'visible-index',
  'chunked',
  'sdf-instanced',
  'sdf-visible-index',
];

export function labelPattern(label: string): RegExp {
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

export function assertVisibleLabels(
  visibleLabels: string,
  options: {
    absent?: string[];
    present?: string[];
  },
  context: string,
): void {
  for (const label of options.present ?? []) {
    assert.match(visibleLabels, labelPattern(label), `${context} should show ${label}.`);
  }

  for (const label of options.absent ?? []) {
    assert.doesNotMatch(visibleLabels, labelPattern(label), `${context} should hide ${label}.`);
  }
}

export function assertDemoRootLayerVisible(
  textState: Pick<TextState, 'visibleLabelCount' | 'visibleLabels'>,
  context: string,
): void {
  assert.ok(textState.visibleLabelCount > 0, `${context} should show at least one visible root label.`);
  assertVisibleLabels(
    textState.visibleLabels,
    {
      absent: [FIRST_CHILD_LABEL],
      present: [FIRST_ROOT_LABEL],
    },
    context,
  );
}

export function assertDemoChildLayerVisible(
  textState: Pick<TextState, 'visibleLabels'>,
  context: string,
): void {
  assertVisibleLabels(
    textState.visibleLabels,
    {
      absent: [FIRST_ROOT_LABEL],
      present: [FIRST_CHILD_LABEL],
    },
    context,
  );
}

export function formatBenchmarkSummary(benchmark: BenchmarkState): string {
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

function getVisibleVertexCount(benchmark: BenchmarkState): number {
  switch (benchmark.textStrategy) {
    case 'baseline':
      return benchmark.visibleGlyphCount * 6;
    default:
      return benchmark.visibleGlyphCount * 4;
  }
}

export function getRequiredMapValue<K, V>(
  map: Map<K, V>,
  key: K,
  message: string,
): V {
  const value = map.get(key);

  assert.ok(value, message);
  return value;
}

function compareNumbers(
  left: number,
  operator: StrategyComparisonOperator,
  right: number,
): boolean {
  switch (operator) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    default:
      return false;
  }
}

export function assertVisibilityMatchesBaseline<
  TState extends {
    labelSetPreset: string;
    textStrategy: TextStrategy;
    visibleGlyphCount: number;
    visibleLabelCount: number;
  },
>(
  states: Map<TextStrategy, TState>,
  labelSetPreset: string,
  context: string,
): void {
  const baselineState = getRequiredMapValue(
    states,
    'baseline',
    `${context} should include the baseline strategy.`,
  );

  for (const textStrategy of TEXT_STRATEGIES) {
    const state = getRequiredMapValue(
      states,
      textStrategy,
      `${context} should include ${textStrategy}.`,
    );
    assert.equal(
      state.labelSetPreset,
      labelSetPreset,
      `${context} ${textStrategy} should use ${labelSetPreset}.`,
    );
    assert.equal(
      state.visibleLabelCount,
      baselineState.visibleLabelCount,
      `${context} visible label counts should match baseline for ${textStrategy}.`,
    );
    assert.equal(
      state.visibleGlyphCount,
      baselineState.visibleGlyphCount,
      `${context} visible glyph counts should match baseline for ${textStrategy}.`,
    );
  }
}

export function assertStrategyMetricRules<TState>(
  states: Map<TextStrategy, TState>,
  rules: readonly StrategyMetricRule<TState>[],
  context: string,
): void {
  for (const rule of rules) {
    const leftState = getRequiredMapValue(
      states,
      rule.left,
      `${context} should include ${rule.left}.`,
    );
    const rightState = getRequiredMapValue(
      states,
      rule.right,
      `${context} should include ${rule.right}.`,
    );
    const leftValue = rule.readValue(leftState);
    const rightValue = rule.readValue(rightState);

    assert.ok(
      compareNumbers(leftValue, rule.operator, rightValue),
      `${context} ${rule.left} should ${rule.description} ${rule.right}. actual=${leftValue} expected ${rule.operator} ${rightValue}`,
    );
  }
}

export function assertQuadVertexStrategies<
  TState extends {
    submittedVertexCount: number;
    visibleGlyphCount: number;
  },
>(
  states: Map<TextStrategy, TState>,
  context: string,
): void {
  for (const textStrategy of QUAD_VERTEX_TEXT_STRATEGIES) {
    const state = getRequiredMapValue(
      states,
      textStrategy,
      `${context} should include ${textStrategy}.`,
    );

    assert.equal(
      state.submittedVertexCount,
      state.visibleGlyphCount * 4,
      `${context} ${textStrategy} should submit four vertices per visible glyph.`,
    );
  }
}

export function assertChunkedVisibleChunks<
  TState extends {
    visibleChunkCount: number;
  },
>(
  states: Map<TextStrategy, TState>,
  operator: '>' | '=',
  expectedValue: number,
  context: string,
): void {
  const chunkedState = getRequiredMapValue(
    states,
    'chunked',
    `${context} should include chunked.`,
  );

  if (operator === '>') {
    assert.ok(
      chunkedState.visibleChunkCount > expectedValue,
      `${context} chunked should report visible chunks.`,
    );
    return;
  }

  assert.equal(
    chunkedState.visibleChunkCount,
    expectedValue,
    `${context} chunked should report ${expectedValue} visible chunks.`,
  );
}

export function assertPackedSubmitsMoreVertices<
  TState extends {
    submittedVertexCount: number;
  },
>(
  states: Map<TextStrategy, TState>,
  context: string,
): void {
  const packedState = getRequiredMapValue(
    states,
    'packed',
    `${context} should include packed.`,
  );
  const visibleIndexState = getRequiredMapValue(
    states,
    'visible-index',
    `${context} should include visible-index.`,
  );

  assert.ok(
    packedState.submittedVertexCount > visibleIndexState.submittedVertexCount,
    `${context} packed should submit more vertices than visible-index because it still draws packed glyphs.`,
  );
}

export function assertZeroGlyphSweepState(
  states: Map<TextStrategy, LargeScaleSweepState>,
  context: string,
): void {
  for (const textStrategy of TEXT_STRATEGIES) {
    const state = getRequiredMapValue(
      states,
      textStrategy,
      `${context} should include ${textStrategy}.`,
    );
    assert.equal(
      state.bytesUploadedPerFrame,
      0,
      `${context} ${textStrategy} should upload nothing when no glyphs are visible.`,
    );
    assert.equal(
      state.submittedVertexCount,
      0,
      `${context} ${textStrategy} should submit no vertices when no glyphs are visible.`,
    );
  }

  assertChunkedVisibleChunks(states, '=', 0, context);
}

export function assertZoomSweepTransitions(
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

export function assertCameraStateClose(
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

export function assertCameraQueryClose(
  actual: CameraQueryState,
  expected: CameraQueryState,
  message: string,
): void {
  assert.equal(actual.label, expected.label, `${message} label`);
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

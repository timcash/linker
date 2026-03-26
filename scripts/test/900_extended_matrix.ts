import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

import {
  BENCHMARK_TRACE_FRAME_COUNT,
  BYTE_UPLOAD_RULES,
  DEMO_LABEL_SET_ID,
  ERROR_PING_TOKEN,
  LARGE_SCALE_CAMERA_TRACE,
  LARGE_SCALE_SWEEP_CAMERA_ZOOM,
  STATIC_BENCHMARK_COUNTS,
  STATIC_BENCHMARK_LABEL_SET_ID,
  TEXT_STRATEGIES,
  type BenchmarkState,
  type BrowserTestContext,
  type LargeScaleSweepState,
  type TextState,
  type TextStrategy,
  assertChunkedVisibleChunks,
  assertPackedSubmitsMoreVertices,
  assertQuadVertexStrategies,
  assertStrategyMetricRules,
  assertVisibilityMatchesBaseline,
  assertZeroGlyphSweepState,
  assertZoomSweepTransitions,
  clickControlRepeatedly,
  formatBenchmarkSummary,
  getBenchmarkState,
  getCameraState,
  getCanvasPixelSignature,
  getRequiredMapValue,
  getTextState,
  openRoute,
  preservesBaselinePixels,
  switchTextStrategy,
  verifyDemoTextStrategyVisibility,
} from './shared';

export async function runExtendedMatrixStep(
  context: BrowserTestContext,
): Promise<void> {
  const demoStrategyChecks = new Map<TextStrategy, TextState>();
  const demoStrategySignatures = new Map<TextStrategy, Awaited<ReturnType<typeof getCanvasPixelSignature>>>();

  for (const textStrategy of TEXT_STRATEGIES) {
    context.addBrowserLog('test', `Verifying demo text strategy ${textStrategy}`);
    await switchTextStrategy(context.page, textStrategy);
    const demoTextState = await verifyDemoTextStrategyVisibility(context.page, textStrategy);
    demoStrategyChecks.set(textStrategy, demoTextState);
    demoStrategySignatures.set(textStrategy, await getCanvasPixelSignature(context.page));
  }

  assertVisibilityMatchesBaseline(
    demoStrategyChecks,
    DEMO_LABEL_SET_ID,
    'Demo text strategy check',
  );
  assertStrategyMetricRules(
    demoStrategyChecks,
    BYTE_UPLOAD_RULES,
    'Demo text strategy check',
  );
  assertQuadVertexStrategies(
    demoStrategyChecks,
    'Demo text strategy check',
  );
  assertChunkedVisibleChunks(
    demoStrategyChecks,
    '>',
    0,
    'Demo text strategy check',
  );

  const baselineDemoSignature = getRequiredMapValue(
    demoStrategySignatures,
    'baseline',
    'Baseline demo canvas signature should be captured.',
  );

  for (const textStrategy of TEXT_STRATEGIES) {
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

  const largeScaleLabelCount = STATIC_BENCHMARK_COUNTS[1];
  const largeScaleSweeps = new Map<TextStrategy, LargeScaleSweepState[]>();

  for (const textStrategy of TEXT_STRATEGIES) {
    context.addBrowserLog(
      'test',
      `Running large-scale visibility sweep strategy=${textStrategy} labels=${largeScaleLabelCount}`,
    );
    const sweep = await runLargeScaleTextStrategySweep(context, textStrategy, largeScaleLabelCount);
    largeScaleSweeps.set(textStrategy, sweep);
  }

  const baselineSweep = getRequiredMapValue(
    largeScaleSweeps,
    'baseline',
    'Baseline large-scale sweep should be recorded.',
  );
  const sweepTraceNames = baselineSweep.map((state) => state.name);

  for (const textStrategy of TEXT_STRATEGIES) {
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
    const checkpointName = getArrayValue(
      sweepTraceNames,
      index,
      `Missing sweep checkpoint name at index ${index}.`,
    );
    const checkpointsByStrategy = new Map<TextStrategy, LargeScaleSweepState>(
      TEXT_STRATEGIES.map((textStrategy) => [
        textStrategy,
        getArrayValue(
          getRequiredMapValue(
            largeScaleSweeps,
            textStrategy,
            `Missing large-scale sweep for text strategy ${textStrategy}.`,
          ),
          index,
          `Missing ${textStrategy} sweep checkpoint at index ${index}.`,
        ),
      ]),
    );
    const baselineCheckpoint = getRequiredMapValue(
      checkpointsByStrategy,
      'baseline',
      `Missing baseline checkpoint for ${checkpointName}.`,
    );

    assertVisibilityMatchesBaseline(
      checkpointsByStrategy,
      STATIC_BENCHMARK_LABEL_SET_ID,
      `${checkpointName} sweep`,
    );

    if (baselineCheckpoint.visibleGlyphCount === 0) {
      assertZeroGlyphSweepState(checkpointsByStrategy, `${checkpointName} sweep`);
      continue;
    }

    assertStrategyMetricRules(
      checkpointsByStrategy,
      BYTE_UPLOAD_RULES,
      `${checkpointName} sweep`,
    );
    assertQuadVertexStrategies(
      checkpointsByStrategy,
      `${checkpointName} sweep`,
    );
    assertPackedSubmitsMoreVertices(
      checkpointsByStrategy,
      `${checkpointName} sweep`,
    );
    assertChunkedVisibleChunks(
      checkpointsByStrategy,
      '>',
      0,
      `${checkpointName} sweep`,
    );
  }

  const packedUploadCounts: number[] = [];

  for (const labelCount of STATIC_BENCHMARK_COUNTS) {
    const benchmarksByStrategy = new Map<TextStrategy, BenchmarkState>();

    for (const textStrategy of TEXT_STRATEGIES) {
      const benchmark = await runBenchmarkRoute(context, textStrategy, labelCount);
      benchmarksByStrategy.set(textStrategy, benchmark);
    }

    const baselineBenchmark = getRequiredMapValue(
      benchmarksByStrategy,
      'baseline',
      `Missing baseline benchmark for labelCount=${labelCount}.`,
    );
    const instancedBenchmark = getRequiredMapValue(
      benchmarksByStrategy,
      'instanced',
      `Missing instanced benchmark for labelCount=${labelCount}.`,
    );
    const packedBenchmark = getRequiredMapValue(
      benchmarksByStrategy,
      'packed',
      `Missing packed benchmark for labelCount=${labelCount}.`,
    );

    assertVisibilityMatchesBaseline(
      benchmarksByStrategy,
      STATIC_BENCHMARK_LABEL_SET_ID,
      `Benchmark ${labelCount}`,
    );
    assertStrategyMetricRules(
      benchmarksByStrategy,
      BYTE_UPLOAD_RULES,
      `Benchmark ${labelCount}`,
    );
    assert.ok(
      instancedBenchmark.submittedVertexCount < baselineBenchmark.submittedVertexCount,
      `Benchmark ${labelCount} instanced should submit fewer vertices than baseline.`,
    );
    assertQuadVertexStrategies(
      benchmarksByStrategy,
      `Benchmark ${labelCount}`,
    );
    assertPackedSubmitsMoreVertices(
      benchmarksByStrategy,
      `Benchmark ${labelCount}`,
    );
    assertChunkedVisibleChunks(
      benchmarksByStrategy,
      '>',
      0,
      `Benchmark ${labelCount}`,
    );

    packedUploadCounts.push(packedBenchmark.bytesUploadedPerFrame);
  }

  assert.equal(
    new Set(packedUploadCounts).size,
    1,
    'Packed benchmark uploads should stay constant across benchmark label counts.',
  );

  await context.flushBrowserLog();
  const benchmarkLogContents = await readFile(context.logPath, 'utf8');
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
}

function getArrayValue<T>(values: T[], index: number, message: string): T {
  const value = values[index];

  assert.notEqual(value, undefined, message);
  return value;
}

async function runLargeScaleTextStrategySweep(
  context: BrowserTestContext,
  textStrategy: TextStrategy,
  labelCount: number,
): Promise<LargeScaleSweepState[]> {
  const sweepUrl = new URL(context.url);
  sweepUrl.searchParams.set('labelSet', 'benchmark');
  sweepUrl.searchParams.set('labelCount', String(labelCount));
  sweepUrl.searchParams.set('textStrategy', textStrategy);
  sweepUrl.searchParams.set('cameraZoom', String(LARGE_SCALE_SWEEP_CAMERA_ZOOM));
  sweepUrl.searchParams.delete('benchmark');
  sweepUrl.searchParams.set('gpuTiming', '0');
  sweepUrl.searchParams.delete('benchmarkFrames');

  await openRoute(context.page, sweepUrl.toString());

  const appState = await context.page.evaluate(() => document.body.dataset.appState ?? 'missing');
  assert.equal(appState, 'ready', `Large-scale sweep should reach ready state for ${textStrategy}.`);
  assert.equal(
    await context.page.evaluate(() => document.body.dataset.textStrategy ?? 'missing'),
    textStrategy,
    `Large-scale sweep should activate ${textStrategy}.`,
  );
  assert.equal(
    await context.page.evaluate(() => document.body.dataset.labelSetPreset ?? 'missing'),
    STATIC_BENCHMARK_LABEL_SET_ID,
    `Large-scale sweep should use the static benchmark label set for ${textStrategy}.`,
  );
  assert.equal(
    await context.page.evaluate(() => Number(document.body.dataset.labelSetCount ?? '0')),
    labelCount,
    `Large-scale sweep should use ${labelCount} labels from the benchmark label set for ${textStrategy}.`,
  );

  const checkpoints: LargeScaleSweepState[] = [];

  checkpoints.push(await captureLargeScaleSweepState(context, 'start-hidden'));

  for (const step of LARGE_SCALE_CAMERA_TRACE) {
    await clickControlRepeatedly(context.page, step.control, step.repeat);
    checkpoints.push(await captureLargeScaleSweepState(context, step.name));
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
    context.addBrowserLog(
      'test',
      `Sweep summary strategy=${textStrategy} checkpoint=${checkpoint.name} zoom=${checkpoint.zoom.toFixed(2)} visibleLabels=${checkpoint.visibleLabelCount} visibleGlyphs=${checkpoint.visibleGlyphCount} visibleChunks=${checkpoint.visibleChunkCount} bytes=${checkpoint.bytesUploadedPerFrame} vertices=${checkpoint.submittedVertexCount} labelSetPreset=${checkpoint.labelSetPreset}`,
    );
  }

  return checkpoints;
}

async function captureLargeScaleSweepState(
  context: BrowserTestContext,
  name: string,
): Promise<LargeScaleSweepState> {
  const [camera, text] = await Promise.all([
    getCameraState(context.page),
    getTextState(context.page),
  ]);

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
  context: BrowserTestContext,
  textStrategy: TextStrategy,
  labelCount: number,
): Promise<BenchmarkState> {
  const benchmarkUrl = new URL(context.url);
  benchmarkUrl.searchParams.set('labelSet', 'benchmark');
  benchmarkUrl.searchParams.set('benchmark', '1');
  benchmarkUrl.searchParams.set('gpuTiming', '1');
  benchmarkUrl.searchParams.set('textStrategy', textStrategy);
  benchmarkUrl.searchParams.set('labelCount', String(labelCount));
  benchmarkUrl.searchParams.set('benchmarkFrames', String(BENCHMARK_TRACE_FRAME_COUNT));

  context.addBrowserLog('test', `Starting benchmark route ${benchmarkUrl.toString()}`);
  const benchmarkPageErrorCount = context.pageErrors.length;

  await openRoute(context.page, benchmarkUrl.toString());

  const benchmarkAppState = await context.page.evaluate(() => document.body.dataset.appState ?? 'missing');
  assert.notEqual(
    benchmarkAppState,
    'error',
    `Benchmark route should not enter error state for strategy=${textStrategy} labelCount=${labelCount}.`,
  );

  if (benchmarkAppState !== 'ready') {
    context.addBrowserLog(
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

  await context.page.waitForFunction(() => {
    const state = document.body.dataset.benchmarkState;
    return state === 'complete' || state === 'error';
  }, {timeout: 40_000});

  const benchmark = await getBenchmarkState(context.page);

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
    context.addBrowserLog('test', 'Benchmark GPU timestamps are disabled in the benchmark route.');
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
    context.addBrowserLog(
      'test',
      'Benchmark GPU timestamps were requested, but this browser/device did not expose timestamp-query.',
    );
  }

  const benchmarkSummary = formatBenchmarkSummary(benchmark);
  context.addBrowserLog('test', `Benchmark summary ${benchmarkSummary}`);

  const newUnexpectedBenchmarkErrors = context.pageErrors
    .slice(benchmarkPageErrorCount)
    .filter((message) => !message.includes(ERROR_PING_TOKEN));
  assert.deepEqual(
    newUnexpectedBenchmarkErrors,
    [],
    `Unexpected browser errors were captured during benchmark route: ${newUnexpectedBenchmarkErrors.join('\n\n')}`,
  );

  return benchmark;
}

import assert from 'node:assert/strict';

import {formatBenchmarkSummary} from './assertions';
import {openRoute, waitForBenchmarkResult} from './browser';
import type {TestPerformanceCollector} from './performance';
import {
  DEFAULT_TEXT_STRATEGY,
  RUN_EXTENDED_TEST_MATRIX,
  STATIC_BENCHMARK_COUNTS,
  STATIC_BENCHMARK_LABEL_SET_ID,
  type BrowserTestContext,
} from './types';

type BenchmarkScenario = {
  gpuTimingEnabled: boolean;
  labelCount: number;
  name: string;
};

const BENCHMARK_TRACE_FRAME_COUNT = 8;

export async function runBenchmarkFlow(
  context: BrowserTestContext,
  collector: TestPerformanceCollector,
): Promise<void> {
  for (const scenario of getBenchmarkScenarios()) {
    const route = buildBenchmarkScenarioUrl(context.url, scenario);

    await openRoute(context.page, route);

    const benchmark = await waitForBenchmarkResult(context.page, {
      timeoutMs: scenario.labelCount >= 16384 ? 120_000 : 60_000,
    });

    assert.equal(
      benchmark.state,
      'complete',
      `${scenario.name} should complete. ${benchmark.error || 'No benchmark error was reported.'}`,
    );
    assert.equal(benchmark.error, '', `${scenario.name} should not report a benchmark error.`);
    assert.equal(
      benchmark.labelSetKind,
      'benchmark',
      `${scenario.name} should use the benchmark label set.`,
    );
    assert.equal(
      benchmark.labelSetPreset,
      STATIC_BENCHMARK_LABEL_SET_ID,
      `${scenario.name} should report the static benchmark label-set id.`,
    );
    assert.equal(
      benchmark.labelTargetCount,
      scenario.labelCount,
      `${scenario.name} should preserve the requested benchmark label count.`,
    );
    assert.equal(
      benchmark.labelCount,
      scenario.labelCount,
      `${scenario.name} should build the requested number of benchmark labels.`,
    );
    assert.equal(
      benchmark.textStrategy,
      DEFAULT_TEXT_STRATEGY,
      `${scenario.name} should stay on the production text strategy.`,
    );
    assert.equal(
      benchmark.gpuTimingEnabled,
      scenario.gpuTimingEnabled,
      `${scenario.name} should mirror the requested GPU timing mode.`,
    );
    assert.ok(
      benchmark.cpuFrameSamples > 0,
      `${scenario.name} should collect at least one CPU frame sample.`,
    );
    assert.ok(
      benchmark.cpuFrameAvgMs > 0,
      `${scenario.name} should report a positive CPU frame average.`,
    );
    assert.ok(
      benchmark.cpuTextAvgMs > 0,
      `${scenario.name} should report a positive CPU text average.`,
    );
    assert.ok(
      benchmark.cpuDrawAvgMs > 0,
      `${scenario.name} should report a positive CPU draw average.`,
    );
    assert.ok(benchmark.glyphCount > 0, `${scenario.name} should build benchmark glyphs.`);
    assert.ok(
      benchmark.visibleLabelCount > 0,
      `${scenario.name} should keep benchmark labels visible during the trace.`,
    );
    assert.ok(
      benchmark.visibleGlyphCount > 0,
      `${scenario.name} should keep benchmark glyphs visible during the trace.`,
    );
    assert.ok(
      benchmark.submittedGlyphCount >= benchmark.visibleGlyphCount,
      `${scenario.name} should not submit fewer glyphs than it renders visibly.`,
    );
    assert.ok(
      benchmark.submittedVertexCount >= benchmark.submittedGlyphCount * 4,
      `${scenario.name} should keep quad submission counts aligned with glyph submission.`,
    );

    if (!scenario.gpuTimingEnabled) {
      assert.equal(
        benchmark.gpuFrameAvgMs,
        null,
        `${scenario.name} should suppress GPU frame timing when GPU timing is disabled.`,
      );
      assert.equal(
        benchmark.gpuTextAvgMs,
        null,
        `${scenario.name} should suppress GPU text timing when GPU timing is disabled.`,
      );
    } else if (benchmark.gpuSupported) {
      assert.ok(
        benchmark.gpuFrameAvgMs !== null,
        `${scenario.name} should report a GPU frame average when GPU timing is supported.`,
      );
      assert.ok(
        benchmark.gpuFrameSamples > 0,
        `${scenario.name} should collect GPU frame samples when GPU timing is supported.`,
      );
    }

    collector.recordBenchmark({
      benchmark,
      name: scenario.name,
      route,
    });
    context.addBrowserLog('perf.sample', `${scenario.name} ${formatBenchmarkSummary(benchmark)}`);
  }
}

function getBenchmarkScenarios(): BenchmarkScenario[] {
  const [defaultCount, mediumCount, largeCount] = STATIC_BENCHMARK_COUNTS;
  const scenarios: BenchmarkScenario[] = [
    {
      gpuTimingEnabled: true,
      labelCount: defaultCount,
      name: `benchmark.${defaultCount}.gpu`,
    },
  ];

  if (RUN_EXTENDED_TEST_MATRIX) {
    scenarios.push(
      {
        gpuTimingEnabled: true,
        labelCount: mediumCount,
        name: `benchmark.${mediumCount}.gpu`,
      },
      {
        gpuTimingEnabled: true,
        labelCount: largeCount,
        name: `benchmark.${largeCount}.gpu`,
      },
      {
        gpuTimingEnabled: false,
        labelCount: mediumCount,
        name: `benchmark.${mediumCount}.cpu-only`,
      },
    );
  }

  return scenarios;
}

function buildBenchmarkScenarioUrl(baseUrl: string, scenario: BenchmarkScenario): string {
  const url = new URL(baseUrl);

  url.searchParams.set('labelSet', 'benchmark');
  url.searchParams.set('benchmark', '1');
  url.searchParams.set('benchmarkFrames', String(BENCHMARK_TRACE_FRAME_COUNT));
  url.searchParams.set('labelCount', String(scenario.labelCount));

  if (scenario.gpuTimingEnabled) {
    url.searchParams.delete('gpuTiming');
  } else {
    url.searchParams.set('gpuTiming', '0');
  }

  return url.toString();
}

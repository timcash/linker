import {formatBenchmarkSummary} from './assertions';
import type {BenchmarkState} from './types';

type BenchmarkSample = {
  benchmark: BenchmarkState;
  name: string;
  route: string;
};

export type TestPerformanceCollector = {
  formatReportLines: () => string[];
  hasEntries: () => boolean;
  recordBenchmark: (sample: BenchmarkSample) => void;
};

export function createTestPerformanceCollector(): TestPerformanceCollector {
  const benchmarkSamples: BenchmarkSample[] = [];

  return {
    formatReportLines: () => formatReportLines(benchmarkSamples),
    hasEntries: () => benchmarkSamples.length > 0,
    recordBenchmark: (sample) => {
      benchmarkSamples.push(sample);
    },
  };
}

function formatReportLines(benchmarkSamples: BenchmarkSample[]): string[] {
  if (benchmarkSamples.length === 0) {
    return ['Performance summary: no benchmark samples collected.'];
  }

  const lines = [
    `Performance summary (${benchmarkSamples.length} benchmark scenario${benchmarkSamples.length === 1 ? '' : 's'}):`,
  ];

  for (const sample of benchmarkSamples) {
    lines.push(`[perf.benchmark] ${sample.name} ${formatBenchmarkSummary(sample.benchmark)}`);
  }

  lines.push(
    `[perf.rollup] cpuFrame ${formatMetricSummary(benchmarkSamples.map((sample) => sample.benchmark.cpuFrameAvgMs))}`,
  );
  lines.push(
    `[perf.rollup] cpuText ${formatMetricSummary(benchmarkSamples.map((sample) => sample.benchmark.cpuTextAvgMs))}`,
  );
  lines.push(
    `[perf.rollup] cpuDraw ${formatMetricSummary(benchmarkSamples.map((sample) => sample.benchmark.cpuDrawAvgMs))}`,
  );
  lines.push(
    `[perf.rollup] uploaded ${formatIntegerMetricSummary(
      benchmarkSamples.map((sample) => sample.benchmark.bytesUploadedPerFrame),
      'B',
    )}`,
  );

  const gpuTimedSamples = benchmarkSamples.filter((sample) => sample.benchmark.gpuTimingEnabled);
  const gpuFrameValues = gpuTimedSamples
    .map((sample) => sample.benchmark.gpuFrameAvgMs)
    .filter((value): value is number => value !== null);

  if (gpuTimedSamples.length === 0) {
    lines.push('[perf.rollup] gpuFrame no GPU-timed scenarios ran.');
  } else if (gpuFrameValues.length === 0) {
    lines.push(
      `[perf.rollup] gpuFrame unavailable across ${gpuTimedSamples.length} GPU-timed scenario${gpuTimedSamples.length === 1 ? '' : 's'}.`,
    );
  } else {
    lines.push(
      `[perf.rollup] gpuFrame ${formatMetricSummary(gpuFrameValues)} across ${gpuFrameValues.length}/${gpuTimedSamples.length} GPU-timed scenario${gpuTimedSamples.length === 1 ? '' : 's'}.`,
    );
  }

  return lines;
}

function formatMetricSummary(values: number[]): string {
  return `avg=${formatMs(average(values))} min=${formatMs(Math.min(...values))} max=${formatMs(Math.max(...values))}`;
}

function formatIntegerMetricSummary(values: number[], suffix: string): string {
  return `avg=${Math.round(average(values))}${suffix} min=${Math.min(...values)}${suffix} max=${Math.max(...values)}${suffix}`;
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatMs(value: number): string {
  return `${value.toFixed(3)}ms`;
}

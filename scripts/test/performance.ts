import type {PerfSnapshot} from './types';

export type OrbitPerformanceSample = PerfSnapshot & {
  durationMs: number;
  name: string;
};

export type PlaneFocusPanPerformanceSample = PerfSnapshot & {
  durationMs: number;
  historyHeadStepDelta: number;
  historyTrackingEnabled: boolean;
  idleAfterStepMs: number;
  name: string;
  stepCount: number;
  stepLatencyAvgMs: number;
  stepLatencyMaxMs: number;
};

export type TestPerformanceCollector = {
  formatReportLines: () => string[];
  hasEntries: () => boolean;
  recordOrbit: (sample: OrbitPerformanceSample) => void;
  recordPlaneFocusPan: (sample: PlaneFocusPanPerformanceSample) => void;
};

export function createTestPerformanceCollector(): TestPerformanceCollector {
  const orbitSamples: OrbitPerformanceSample[] = [];
  const planeFocusPanSamples: PlaneFocusPanPerformanceSample[] = [];

  return {
    formatReportLines: () => formatReportLines(orbitSamples, planeFocusPanSamples),
    hasEntries: () => orbitSamples.length > 0 || planeFocusPanSamples.length > 0,
    recordOrbit: (sample) => {
      orbitSamples.push(sample);
    },
    recordPlaneFocusPan: (sample) => {
      planeFocusPanSamples.push(sample);
    },
  };
}

export function createOrbitPerformanceSample(input: {
  after: PerfSnapshot;
  before: PerfSnapshot;
  durationMs: number;
  name: string;
}): OrbitPerformanceSample {
  const {after, before, durationMs, name} = input;
  const cpuFrameSamples = Math.max(0, after.cpuFrameSamples - before.cpuFrameSamples);
  const gpuFrameSamples = Math.max(0, after.gpuFrameSamples - before.gpuFrameSamples);

  return {
    ...after,
    cpuDrawAvgMs: getSegmentAverage(
      before.cpuDrawAvgMs,
      before.cpuFrameSamples,
      after.cpuDrawAvgMs,
      after.cpuFrameSamples,
    ),
    cpuFrameAvgMs: getSegmentAverage(
      before.cpuFrameAvgMs,
      before.cpuFrameSamples,
      after.cpuFrameAvgMs,
      after.cpuFrameSamples,
    ),
    cpuFrameSamples,
    cpuTextAvgMs: getSegmentAverage(
      before.cpuTextAvgMs,
      before.cpuFrameSamples,
      after.cpuTextAvgMs,
      after.cpuFrameSamples,
    ),
    durationMs,
    gpuFrameAvgMs: getOptionalSegmentAverage(
      before.gpuFrameAvgMs,
      before.gpuFrameSamples,
      after.gpuFrameAvgMs,
      after.gpuFrameSamples,
    ),
    gpuFrameSamples,
    gpuTextAvgMs: getOptionalSegmentAverage(
      before.gpuTextAvgMs,
      before.gpuFrameSamples,
      after.gpuTextAvgMs,
      after.gpuFrameSamples,
    ),
    name,
  };
}

export function formatOrbitPerformanceSummary(sample: OrbitPerformanceSample): string {
  return [
    `name=${sample.name}`,
    `stage=${sample.stageMode}`,
    `planes=${sample.planeCount}`,
    `duration=${Math.round(sample.durationMs)}ms`,
    `strategy=${sample.textStrategy}`,
    `cpuFrame=${sample.cpuFrameAvgMs.toFixed(3)}ms`,
    `cpuSamples=${sample.cpuFrameSamples}`,
    `cpuText=${sample.cpuTextAvgMs.toFixed(3)}ms`,
    `cpuDraw=${sample.cpuDrawAvgMs.toFixed(3)}ms`,
    !sample.gpuTimingEnabled
      ? 'gpu=disabled'
      : sample.gpuFrameAvgMs === null
      ? 'gpu=unsupported'
      : `gpu=${sample.gpuFrameAvgMs.toFixed(3)}ms`,
    `gpuSamples=${sample.gpuFrameSamples}`,
    !sample.gpuTimingEnabled
      ? 'gpuText=disabled'
      : sample.gpuTextAvgMs === null
      ? 'gpuText=unsupported'
      : `gpuText=${sample.gpuTextAvgMs.toFixed(3)}ms`,
    `uploaded=${sample.bytesUploadedPerFrame}B`,
    `visibleLabels=${sample.visibleLabelCount}`,
    `visibleGlyphs=${sample.visibleGlyphCount}`,
    `visibleLinks=${sample.lineVisibleLinkCount}`,
    `submittedGlyphs=${sample.submittedGlyphCount}`,
    `submittedVertices=${sample.submittedVertexCount}`,
  ].join(' ');
}

export function createPlaneFocusPanPerformanceSample(input: {
  durationMs: number;
  historyHeadStepDelta: number;
  historyTrackingEnabled: boolean;
  idleAfterStepMs: number;
  name: string;
  snapshot: PerfSnapshot;
  stepDurationsMs: number[];
}): PlaneFocusPanPerformanceSample {
  return {
    ...input.snapshot,
    durationMs: input.durationMs,
    historyHeadStepDelta: input.historyHeadStepDelta,
    historyTrackingEnabled: input.historyTrackingEnabled,
    idleAfterStepMs: input.idleAfterStepMs,
    name: input.name,
    stepCount: input.stepDurationsMs.length,
    stepLatencyAvgMs: average(input.stepDurationsMs),
    stepLatencyMaxMs: Math.max(...input.stepDurationsMs),
  };
}

export function formatPlaneFocusPanPerformanceSummary(
  sample: PlaneFocusPanPerformanceSample,
): string {
  return [
    `name=${sample.name}`,
    `stage=${sample.stageMode}`,
    `planes=${sample.planeCount}`,
    `duration=${Math.round(sample.durationMs)}ms`,
    `historyTracking=${sample.historyTrackingEnabled ? 'on' : 'off'}`,
    `historySteps=${sample.historyHeadStepDelta}`,
    `idleAfterStep=${Math.round(sample.idleAfterStepMs)}ms`,
    `stepLatency=${sample.stepLatencyAvgMs.toFixed(1)}ms`,
    `stepLatencyMax=${sample.stepLatencyMaxMs.toFixed(1)}ms`,
    `fps=${formatFps(sample.frameGapAvgMs, sample.frameGapSamples)}`,
    `worstGap=${formatOptionalMs(sample.frameGapMaxMs, sample.frameGapSamples > 0)}`,
    `cpuFrame=${sample.cpuFrameAvgMs.toFixed(3)}ms`,
    `cpuFrameMax=${sample.cpuFrameMaxMs.toFixed(3)}ms`,
    `cpuText=${sample.cpuTextAvgMs.toFixed(3)}ms`,
    `cpuDraw=${sample.cpuDrawAvgMs.toFixed(3)}ms`,
    `uploaded=${sample.bytesUploadedPerFrame}B`,
    `visibleLabels=${sample.visibleLabelCount}`,
    `visibleGlyphs=${sample.visibleGlyphCount}`,
    `submittedGlyphs=${sample.submittedGlyphCount}`,
  ].join(' ');
}

function formatReportLines(
  orbitSamples: OrbitPerformanceSample[],
  planeFocusPanSamples: PlaneFocusPanPerformanceSample[],
): string[] {
  if (orbitSamples.length === 0 && planeFocusPanSamples.length === 0) {
    return ['Performance summary: no samples collected.'];
  }

  const lines = ['Performance summary:'];

  if (orbitSamples.length > 0) {
    lines.push(
      `Orbit scenarios (${orbitSamples.length}):`,
    );

    for (const sample of orbitSamples) {
      lines.push(`[perf.orbit] ${formatOrbitPerformanceSummary(sample)}`);
    }

    lines.push(
      `[perf.rollup] cpuFrame ${formatMetricSummary(orbitSamples.map((sample) => sample.cpuFrameAvgMs))}`,
    );
    lines.push(
      `[perf.rollup] cpuText ${formatMetricSummary(orbitSamples.map((sample) => sample.cpuTextAvgMs))}`,
    );
    lines.push(
      `[perf.rollup] cpuDraw ${formatMetricSummary(orbitSamples.map((sample) => sample.cpuDrawAvgMs))}`,
    );
    lines.push(
      `[perf.rollup] uploaded ${formatIntegerMetricSummary(
        orbitSamples.map((sample) => sample.bytesUploadedPerFrame),
        'B',
      )}`,
    );

    const gpuTimedSamples = orbitSamples.filter((sample) => sample.gpuTimingEnabled);
    const gpuFrameValues = gpuTimedSamples
      .map((sample) => sample.gpuFrameAvgMs)
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
  }

  if (planeFocusPanSamples.length > 0) {
    lines.push(
      `2d high-zoom pan scenarios (${planeFocusPanSamples.length}):`,
    );

    for (const sample of planeFocusPanSamples) {
      lines.push(`[perf.pan] ${formatPlaneFocusPanPerformanceSummary(sample)}`);
    }

    lines.push(
      `[perf.pan.rollup] fps ${formatFpsSummary(
        planeFocusPanSamples
          .filter((sample) => sample.frameGapSamples > 0 && sample.frameGapAvgMs > 0)
          .map((sample) => 1000 / sample.frameGapAvgMs),
      )}`,
    );
    lines.push(
      `[perf.pan.rollup] worstGap ${formatMetricSummary(
        planeFocusPanSamples.map((sample) => sample.frameGapMaxMs),
      )}`,
    );
    lines.push(
      `[perf.pan.rollup] cpuFrame ${formatMetricSummary(
        planeFocusPanSamples.map((sample) => sample.cpuFrameAvgMs),
      )}`,
    );

    const historyOnSample =
      planeFocusPanSamples.find((sample) => sample.historyTrackingEnabled) ?? null;
    const historyOffSample =
      planeFocusPanSamples.find((sample) => !sample.historyTrackingEnabled) ?? null;

    if (historyOnSample && historyOffSample) {
      lines.push(
        [
          '[perf.pan.compare]',
          `fps on=${formatFps(historyOnSample.frameGapAvgMs, historyOnSample.frameGapSamples)}`,
          `off=${formatFps(historyOffSample.frameGapAvgMs, historyOffSample.frameGapSamples)}`,
          `worstGap on=${formatOptionalMs(historyOnSample.frameGapMaxMs, historyOnSample.frameGapSamples > 0)}`,
          `off=${formatOptionalMs(historyOffSample.frameGapMaxMs, historyOffSample.frameGapSamples > 0)}`,
          `cpuFrame on=${historyOnSample.cpuFrameAvgMs.toFixed(3)}ms`,
          `off=${historyOffSample.cpuFrameAvgMs.toFixed(3)}ms`,
          `cpuFrameMax on=${historyOnSample.cpuFrameMaxMs.toFixed(3)}ms`,
          `off=${historyOffSample.cpuFrameMaxMs.toFixed(3)}ms`,
          `stepLatency on=${historyOnSample.stepLatencyAvgMs.toFixed(1)}ms`,
          `off=${historyOffSample.stepLatencyAvgMs.toFixed(1)}ms`,
          `stepLatencyMax on=${historyOnSample.stepLatencyMaxMs.toFixed(1)}ms`,
          `off=${historyOffSample.stepLatencyMaxMs.toFixed(1)}ms`,
          `historySteps on=${historyOnSample.historyHeadStepDelta}`,
          `off=${historyOffSample.historyHeadStepDelta}`,
        ].join(' '),
      );
    }
  }

  return lines;
}

function getSegmentAverage(
  beforeAverage: number,
  beforeSamples: number,
  afterAverage: number,
  afterSamples: number,
): number {
  const segmentSamples = afterSamples - beforeSamples;

  if (segmentSamples <= 0) {
    return afterAverage;
  }

  const beforeTotal = beforeAverage * beforeSamples;
  const afterTotal = afterAverage * afterSamples;
  return Math.max(0, (afterTotal - beforeTotal) / segmentSamples);
}

function getOptionalSegmentAverage(
  beforeAverage: number | null,
  beforeSamples: number,
  afterAverage: number | null,
  afterSamples: number,
): number | null {
  if (afterAverage === null) {
    return null;
  }

  const segmentSamples = afterSamples - beforeSamples;

  if (segmentSamples <= 0) {
    return afterAverage;
  }

  const beforeTotal = (beforeAverage ?? 0) * beforeSamples;
  const afterTotal = afterAverage * afterSamples;
  return Math.max(0, (afterTotal - beforeTotal) / segmentSamples);
}

function formatMetricSummary(values: number[]): string {
  return `avg=${formatMs(average(values))} min=${formatMs(Math.min(...values))} max=${formatMs(Math.max(...values))}`;
}

function formatFpsSummary(values: number[]): string {
  if (values.length === 0) {
    return 'unavailable';
  }

  return `avg=${formatFpsValue(average(values))} min=${formatFpsValue(Math.min(...values))} max=${formatFpsValue(Math.max(...values))}`;
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

function formatFps(frameGapAvgMs: number, frameGapSamples: number): string {
  if (frameGapSamples <= 0 || frameGapAvgMs <= 0) {
    return 'n/a';
  }

  return formatFpsValue(1000 / frameGapAvgMs);
}

function formatOptionalMs(value: number, enabled: boolean): string {
  return enabled ? formatMs(value) : 'n/a';
}

function formatFpsValue(value: number): string {
  return `${value.toFixed(1)}`;
}

import type {LabelFocusedCameraAction} from './label-focused-camera';
import type {FrameTelemetrySnapshot} from './perf';
import type {StageScene} from './scene-model';
import type {LabelSetKind} from './stage-config';
import type {TextLayerStats, TextStrategy} from './text/types';

const BENCHMARK_CAMERA_TRACE: LabelFocusedCameraAction[] = [
  'zoom-out',
  'zoom-out',
  'pan-right',
  'pan-up',
  'zoom-in',
  'zoom-in',
  'pan-left',
  'pan-down',
];

export type StageBenchmarkSummary = {
  bytesUploadedPerFrame: number;
  cpuDrawAvgMs: number;
  cpuFrameAvgMs: number;
  cpuFrameSamples: number;
  cpuTextAvgMs: number;
  glyphCount: number;
  gpuFrameAvgMs: number | null;
  gpuFrameSamples: number;
  gpuTextAvgMs: number | null;
  gpuSupported: boolean;
  labelCount: number;
  textStrategy: TextStrategy;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
};

export function buildBenchmarkCameraTrace(stepCount: number): LabelFocusedCameraAction[] {
  const safeCount = Math.max(1, stepCount);
  const actions: LabelFocusedCameraAction[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    actions.push(BENCHMARK_CAMERA_TRACE[index % BENCHMARK_CAMERA_TRACE.length]);
  }

  return actions;
}

export function createStageBenchmarkSummary(input: {
  perf: FrameTelemetrySnapshot;
  textStats: TextLayerStats;
  textStrategy: TextStrategy;
}): StageBenchmarkSummary {
  const {perf, textStats, textStrategy} = input;

  return {
    bytesUploadedPerFrame: textStats.bytesUploadedPerFrame,
    cpuDrawAvgMs: perf.cpuDrawAvgMs,
    cpuFrameAvgMs: perf.cpuFrameAvgMs,
    cpuFrameSamples: perf.cpuFrameSamples,
    cpuTextAvgMs: perf.cpuTextAvgMs,
    glyphCount: textStats.glyphCount,
    gpuFrameAvgMs: perf.gpuFrameAvgMs,
    gpuFrameSamples: perf.gpuFrameSamples,
    gpuTextAvgMs: perf.gpuTextAvgMs,
    gpuSupported: perf.gpuSupported,
    labelCount: textStats.labelCount,
    textStrategy,
    submittedGlyphCount: textStats.submittedGlyphCount,
    submittedVertexCount: textStats.submittedVertexCount,
    visibleChunkCount: textStats.visibleChunkCount,
    visibleGlyphCount: textStats.visibleGlyphCount,
    visibleLabelCount: textStats.visibleLabelCount,
  };
}

export function createStageBenchmarkDatasets(input: {
  gpuTimingEnabled: boolean;
  labelSetKind: LabelSetKind;
  labelTargetCount: number;
  scene: StageScene;
  summary: StageBenchmarkSummary | null;
  textStrategy: TextStrategy;
}): Record<string, string> {
  const {
    gpuTimingEnabled,
    labelSetKind,
    labelTargetCount,
    scene,
    summary,
    textStrategy,
  } = input;

  const baseDataset = {
    benchmarkGpuTimingEnabled: String(gpuTimingEnabled),
    benchmarkLabelCount: String(scene.labels.length),
    benchmarkLabelSetKind: labelSetKind,
    benchmarkLabelSetPreset: scene.labelSetPreset,
    benchmarkLabelTargetCount: String(labelTargetCount),
    benchmarkTextStrategy: textStrategy,
  };

  if (!summary) {
    return {
      ...baseDataset,
      benchmarkBytesUploadedPerFrame: '0',
      benchmarkCpuDrawAvgMs: '0.000',
      benchmarkCpuFrameAvgMs: '0.000',
      benchmarkCpuFrameSamples: '0',
      benchmarkCpuTextAvgMs: '0.000',
      benchmarkGlyphCount: '0',
      benchmarkGpuFrameAvgMs: gpuTimingEnabled ? 'pending' : 'disabled',
      benchmarkGpuFrameSamples: '0',
      benchmarkGpuSupported: 'false',
      benchmarkGpuTextAvgMs: gpuTimingEnabled ? 'pending' : 'disabled',
      benchmarkSubmittedGlyphCount: '0',
      benchmarkSubmittedVertexCount: '0',
      benchmarkVisibleChunkCount: '0',
      benchmarkVisibleGlyphCount: '0',
      benchmarkVisibleLabelCount: '0',
    };
  }

  return {
    ...baseDataset,
    benchmarkBytesUploadedPerFrame: String(summary.bytesUploadedPerFrame),
    benchmarkCpuDrawAvgMs: summary.cpuDrawAvgMs.toFixed(3),
    benchmarkCpuFrameAvgMs: summary.cpuFrameAvgMs.toFixed(3),
    benchmarkCpuFrameSamples: String(summary.cpuFrameSamples),
    benchmarkCpuTextAvgMs: summary.cpuTextAvgMs.toFixed(3),
    benchmarkGlyphCount: String(summary.glyphCount),
    benchmarkGpuFrameAvgMs: formatBenchmarkGpuMetric(summary.gpuFrameAvgMs, gpuTimingEnabled),
    benchmarkGpuFrameSamples: String(summary.gpuFrameSamples),
    benchmarkGpuSupported: String(summary.gpuSupported),
    benchmarkGpuTextAvgMs: formatBenchmarkGpuMetric(summary.gpuTextAvgMs, gpuTimingEnabled),
    benchmarkSubmittedGlyphCount: String(summary.submittedGlyphCount),
    benchmarkSubmittedVertexCount: String(summary.submittedVertexCount),
    benchmarkVisibleChunkCount: String(summary.visibleChunkCount),
    benchmarkVisibleGlyphCount: String(summary.visibleGlyphCount),
    benchmarkVisibleLabelCount: String(summary.visibleLabelCount),
  };
}

export function writeStageBenchmarkDatasets(datasets: Record<string, string>): void {
  for (const [key, value] of Object.entries(datasets)) {
    document.body.dataset[key] = value;
  }
}

function formatBenchmarkGpuMetric(value: number | null, gpuTimingEnabled: boolean): string {
  if (!gpuTimingEnabled) {
    return 'disabled';
  }

  return value === null ? 'unsupported' : value.toFixed(3);
}

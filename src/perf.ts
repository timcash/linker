import {Buffer, luma, type Device, type QuerySet, type RenderPassProps} from '@luma.gl/core';

const GPU_PASS_QUERY_COUNT = 2;
const GPU_QUERY_COUNT = GPU_PASS_QUERY_COUNT * 2;
const GPU_QUERY_RESULT_BYTES = GPU_QUERY_COUNT * BigUint64Array.BYTES_PER_ELEMENT;
const GPU_TIMER_SLOT_COUNT = 3;
const LINKER_PERF_STATS_ID = 'Linker Performance';
const LUMA_RESOURCE_STATS_ID = 'GPU Time and Memory';
const CPU_DRAW_STAT_NAME = 'CPU Draw Time';
const CPU_FRAME_STAT_NAME = 'CPU Frame Time';
const CPU_GRID_STAT_NAME = 'CPU Grid Time';
const CPU_LINE_STAT_NAME = 'CPU Line Time';
const CPU_TEXT_STAT_NAME = 'CPU Text Time';
const GPU_FRAME_STAT_NAME = 'GPU Frame Time';
const GPU_TEXT_STAT_NAME = 'GPU Text Time';

const GPU_FRAME_QUERY_RANGE = {
  beginIndex: 0,
  endIndex: 1,
} as const;

const GPU_TEXT_QUERY_RANGE = {
  beginIndex: 2,
  endIndex: 3,
} as const;

export type FrameTelemetrySnapshot = {
  bufferMemoryBytes: number;
  buffersActive: number;
  cpuDrawAvgMs: number;
  cpuDrawLastMs: number;
  cpuFrameAvgMs: number;
  cpuFrameLastMs: number;
  cpuFrameMaxMs: number;
  cpuFrameSamples: number;
  cpuGridAvgMs: number;
  cpuGridLastMs: number;
  cpuLineAvgMs: number;
  cpuLineLastMs: number;
  cpuTextAvgMs: number;
  cpuTextLastMs: number;
  gpuError: string | null;
  gpuFrameAvgMs: number | null;
  gpuFrameLastMs: number | null;
  gpuFrameMaxMs: number | null;
  gpuFrameSamples: number;
  gpuMemoryBytes: number;
  gpuSupported: boolean;
  gpuTextAvgMs: number | null;
  gpuTextLastMs: number | null;
  gpuTextMaxMs: number | null;
  resourcesActive: number;
  textureMemoryBytes: number;
  texturesActive: number;
};

export type FrameTelemetryOptions = {
  enableGpuTimestamps?: boolean;
};

type GpuTimerSlot = {
  busy: boolean;
  pendingRead: Promise<void> | null;
  querySet: QuerySet;
  resultBuffer: Buffer;
};

type TimerStat = ReturnType<ReturnType<typeof luma.stats.get>['get']>;
type TimerMetrics = {
  lastMs: number;
  maxMs: number;
  sampleCount: number;
  totalMs: number;
};

export class FrameTelemetry {
  private readonly cpuDrawStat: TimerStat;
  private readonly cpuFrameStat: TimerStat;
  private readonly cpuGridStat: TimerStat;
  private readonly cpuLineStat: TimerStat;
  private readonly cpuTextStat: TimerStat;
  private readonly gpuFrameStat: TimerStat;
  private readonly gpuSupported: boolean;
  private readonly gpuSlots: GpuTimerSlot[] = [];
  private readonly gpuTextStat: TimerStat;
  private readonly perfStats = luma.stats.get(LINKER_PERF_STATS_ID);
  private activeGpuSlot: GpuTimerSlot | null = null;
  private cpuDrawMetrics = createTimerMetrics();
  private cpuFrameMetrics = createTimerMetrics();
  private cpuGridMetrics = createTimerMetrics();
  private cpuLineMetrics = createTimerMetrics();
  private cpuTextMetrics = createTimerMetrics();
  private gpuError: string | null = null;
  private gpuFrameMetrics = createTimerMetrics();
  private gpuTextMetrics = createTimerMetrics();

  constructor(
    private readonly device: Device,
    options: FrameTelemetryOptions = {},
  ) {
    this.cpuDrawStat = createTimerStat(this.perfStats, CPU_DRAW_STAT_NAME);
    this.cpuFrameStat = createTimerStat(this.perfStats, CPU_FRAME_STAT_NAME);
    this.cpuGridStat = createTimerStat(this.perfStats, CPU_GRID_STAT_NAME);
    this.cpuLineStat = createTimerStat(this.perfStats, CPU_LINE_STAT_NAME);
    this.cpuTextStat = createTimerStat(this.perfStats, CPU_TEXT_STAT_NAME);
    this.gpuFrameStat = createTimerStat(this.perfStats, GPU_FRAME_STAT_NAME);
    this.gpuTextStat = createTimerStat(this.perfStats, GPU_TEXT_STAT_NAME);
    this.reset();

    this.gpuSupported = Boolean(options.enableGpuTimestamps) && device.features.has('timestamp-query');

    if (!this.gpuSupported) {
      return;
    }

    for (let index = 0; index < GPU_TIMER_SLOT_COUNT; index += 1) {
      this.gpuSlots.push({
        busy: false,
        pendingRead: null,
        querySet: device.createQuerySet({
          id: `frame-profiler-query-set-${index}`,
          type: 'timestamp',
          count: GPU_QUERY_COUNT,
        }),
        resultBuffer: device.createBuffer({
          id: `frame-profiler-result-buffer-${index}`,
          usage: Buffer.QUERY_RESOLVE | Buffer.COPY_SRC,
          byteLength: GPU_QUERY_RESULT_BYTES,
        }),
      });
    }
  }

  destroy(): void {
    this.perfStats.reset();

    for (const slot of this.gpuSlots) {
      slot.querySet.destroy();
      slot.resultBuffer.destroy();
    }
  }

  startCpuDraw(): void {
    this.cpuDrawStat.timeStart();
  }

  endCpuDraw(): void {
    this.cpuDrawStat.timeEnd();
    recordTimerSample(this.cpuDrawMetrics, this.cpuDrawStat.lastTiming);
  }

  startCpuFrame(): void {
    this.cpuFrameStat.timeStart();
  }

  endCpuFrame(): void {
    this.cpuFrameStat.timeEnd();
    recordTimerSample(this.cpuFrameMetrics, this.cpuFrameStat.lastTiming);
  }

  startCpuGrid(): void {
    this.cpuGridStat.timeStart();
  }

  endCpuGrid(): void {
    this.cpuGridStat.timeEnd();
    recordTimerSample(this.cpuGridMetrics, this.cpuGridStat.lastTiming);
  }

  startCpuLine(): void {
    this.cpuLineStat.timeStart();
  }

  endCpuLine(): void {
    this.cpuLineStat.timeEnd();
    recordTimerSample(this.cpuLineMetrics, this.cpuLineStat.lastTiming);
  }

  startCpuText(): void {
    this.cpuTextStat.timeStart();
  }

  endCpuText(): void {
    this.cpuTextStat.timeEnd();
    recordTimerSample(this.cpuTextMetrics, this.cpuTextStat.lastTiming);
  }

  async flushGpuSamples(): Promise<void> {
    await Promise.all(
      this.gpuSlots.map((slot) => slot.pendingRead ?? Promise.resolve()),
    );
  }

  getRenderPassTimingProps(): Pick<
    Partial<RenderPassProps>,
    'beginTimestampIndex' | 'endTimestampIndex' | 'timestampQuerySet'
  > {
    if (!this.gpuSupported || this.activeGpuSlot) {
      return {};
    }

    const slot = this.gpuSlots.find((candidate) => !candidate.busy && !candidate.pendingRead);

    if (!slot) {
      return {};
    }

    slot.busy = true;
    this.activeGpuSlot = slot;

    return {
      timestampQuerySet: slot.querySet,
      beginTimestampIndex: GPU_FRAME_QUERY_RANGE.beginIndex,
      endTimestampIndex: GPU_FRAME_QUERY_RANGE.endIndex,
    };
  }

  getTextRenderPassTimingProps(): Pick<
    Partial<RenderPassProps>,
    'beginTimestampIndex' | 'endTimestampIndex' | 'timestampQuerySet'
  > {
    if (!this.gpuSupported || !this.activeGpuSlot) {
      return {};
    }

    return {
      timestampQuerySet: this.activeGpuSlot.querySet,
      beginTimestampIndex: GPU_TEXT_QUERY_RANGE.beginIndex,
      endTimestampIndex: GPU_TEXT_QUERY_RANGE.endIndex,
    };
  }

  getSnapshot(): FrameTelemetrySnapshot {
    const resourceTable = luma.stats.get(LUMA_RESOURCE_STATS_ID).getTable();

    return {
      bufferMemoryBytes: getTableCount(resourceTable, 'Buffer Memory'),
      buffersActive: getTableCount(resourceTable, 'Buffers Active'),
      cpuDrawAvgMs: getTimerAverage(this.cpuDrawMetrics),
      cpuDrawLastMs: this.cpuDrawMetrics.lastMs,
      cpuFrameAvgMs: getTimerAverage(this.cpuFrameMetrics),
      cpuFrameLastMs: this.cpuFrameMetrics.lastMs,
      cpuFrameMaxMs: this.cpuFrameMetrics.maxMs,
      cpuFrameSamples: this.cpuFrameMetrics.sampleCount,
      cpuGridAvgMs: getTimerAverage(this.cpuGridMetrics),
      cpuGridLastMs: this.cpuGridMetrics.lastMs,
      cpuLineAvgMs: getTimerAverage(this.cpuLineMetrics),
      cpuLineLastMs: this.cpuLineMetrics.lastMs,
      cpuTextAvgMs: getTimerAverage(this.cpuTextMetrics),
      cpuTextLastMs: this.cpuTextMetrics.lastMs,
      gpuError: this.gpuError,
      gpuFrameAvgMs: this.gpuFrameMetrics.sampleCount > 0 ? getTimerAverage(this.gpuFrameMetrics) : null,
      gpuFrameLastMs: this.gpuFrameMetrics.sampleCount > 0 ? this.gpuFrameMetrics.lastMs : null,
      gpuFrameMaxMs: this.gpuFrameMetrics.sampleCount > 0 ? this.gpuFrameMetrics.maxMs : null,
      gpuFrameSamples: this.gpuFrameMetrics.sampleCount,
      gpuMemoryBytes: getTableCount(resourceTable, 'GPU Memory'),
      gpuSupported: this.gpuSupported,
      gpuTextAvgMs: this.gpuTextMetrics.sampleCount > 0 ? getTimerAverage(this.gpuTextMetrics) : null,
      gpuTextLastMs: this.gpuTextMetrics.sampleCount > 0 ? this.gpuTextMetrics.lastMs : null,
      gpuTextMaxMs: this.gpuTextMetrics.sampleCount > 0 ? this.gpuTextMetrics.maxMs : null,
      resourcesActive: getTableCount(resourceTable, 'Resources Active'),
      textureMemoryBytes: getTableCount(resourceTable, 'Texture Memory'),
      texturesActive: getTableCount(resourceTable, 'Textures Active'),
    };
  }

  reset(): void {
    this.perfStats.reset();
    resetTimerMetrics(this.cpuDrawMetrics);
    resetTimerMetrics(this.cpuFrameMetrics);
    resetTimerMetrics(this.cpuGridMetrics);
    resetTimerMetrics(this.cpuLineMetrics);
    resetTimerMetrics(this.cpuTextMetrics);
    resetTimerMetrics(this.gpuFrameMetrics);
    resetTimerMetrics(this.gpuTextMetrics);
    this.gpuError = null;
  }

  resolveGpuPass(): void {
    if (!this.activeGpuSlot) {
      return;
    }

    this.device.commandEncoder.resolveQuerySet(this.activeGpuSlot.querySet, this.activeGpuSlot.resultBuffer, {
      firstQuery: 0,
      queryCount: GPU_QUERY_COUNT,
    });
  }

  submitGpuPass(): void {
    if (!this.activeGpuSlot) {
      return;
    }

    const slot = this.activeGpuSlot;

    slot.busy = false;
    this.activeGpuSlot = null;
    slot.pendingRead = slot.resultBuffer
      .readAsync(0, GPU_QUERY_RESULT_BYTES)
      .then((bytes) => {
        if (bytes.byteLength < GPU_QUERY_RESULT_BYTES) {
          return;
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const mainPassDurationMs = getGpuQueryDurationMs(
          view,
          GPU_FRAME_QUERY_RANGE.beginIndex,
          GPU_FRAME_QUERY_RANGE.endIndex,
        );
        const textDurationMs = getGpuQueryDurationMs(view, GPU_TEXT_QUERY_RANGE.beginIndex, GPU_TEXT_QUERY_RANGE.endIndex);
        const frameDurationMs =
          mainPassDurationMs === null
            ? textDurationMs
            : textDurationMs === null
            ? mainPassDurationMs
            : mainPassDurationMs + textDurationMs;

        if (frameDurationMs !== null) {
          this.gpuFrameStat.addTime(frameDurationMs);
          recordTimerSample(this.gpuFrameMetrics, frameDurationMs);
        }

        if (textDurationMs !== null) {
          this.gpuTextStat.addTime(textDurationMs);
          recordTimerSample(this.gpuTextMetrics, textDurationMs);
        }
      })
      .catch((error: unknown) => {
        this.gpuError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        slot.pendingRead = null;
      });
  }
}

function createTimerStat(stats: ReturnType<typeof luma.stats.get>, name: string): TimerStat {
  return stats.get(name, 'time').setSampleSize(1);
}

function createTimerMetrics(): TimerMetrics {
  return {
    lastMs: 0,
    maxMs: 0,
    sampleCount: 0,
    totalMs: 0,
  };
}

function resetTimerMetrics(metrics: TimerMetrics): void {
  metrics.lastMs = 0;
  metrics.maxMs = 0;
  metrics.sampleCount = 0;
  metrics.totalMs = 0;
}

function recordTimerSample(metrics: TimerMetrics, durationMs: number): void {
  metrics.lastMs = durationMs;
  metrics.maxMs = Math.max(metrics.maxMs, durationMs);
  metrics.sampleCount += 1;
  metrics.totalMs += durationMs;
}

function getTimerAverage(metrics: TimerMetrics): number {
  return metrics.sampleCount === 0 ? 0 : metrics.totalMs / metrics.sampleCount;
}

function getGpuQueryDurationMs(
  view: DataView,
  beginIndex: number,
  endIndex: number,
): number | null {
  const start = view.getBigUint64(beginIndex * BigUint64Array.BYTES_PER_ELEMENT, true);
  const end = view.getBigUint64(endIndex * BigUint64Array.BYTES_PER_ELEMENT, true);

  if (end <= start) {
    return null;
  }

  return Number(end - start) / 1_000_000;
}

function getTableCount(
  table: ReturnType<ReturnType<typeof luma.stats.get>['getTable']>,
  key: string,
): number {
  return table[key]?.count ?? 0;
}

import {Buffer, type Device, type QuerySet, type RenderPassProps} from '@luma.gl/core';

const MAX_SAMPLES = 120;
const GPU_QUERY_COUNT = 2;
const GPU_QUERY_RESULT_BYTES = GPU_QUERY_COUNT * BigUint64Array.BYTES_PER_ELEMENT;
const GPU_TIMER_SLOT_COUNT = 3;

type RollingMetricSummary = {
  averageMs: number;
  maxMs: number;
  lastMs: number;
  sampleCount: number;
};

export type PerfSnapshot = {
  cpuDrawAvgMs: number;
  cpuFrameAvgMs: number;
  cpuFrameMaxMs: number;
  cpuFrameSamples: number;
  cpuGridAvgMs: number;
  cpuTextAvgMs: number;
  gpuError: string | null;
  gpuFrameAvgMs: number | null;
  gpuFrameMaxMs: number | null;
  gpuFrameSamples: number;
  gpuSupported: boolean;
};

export type FrameProfilerOptions = {
  enableGpuTimestamps?: boolean;
};

type GpuTimerSlot = {
  busy: boolean;
  pendingRead: Promise<void> | null;
  querySet: QuerySet;
  resultBuffer: Buffer;
};

class RollingMetric {
  private readonly values = new Array<number>(MAX_SAMPLES).fill(0);
  private count = 0;
  private cursor = 0;
  private sum = 0;
  private max = 0;
  private last = 0;

  push(value: number): void {
    const nextValue = Number.isFinite(value) ? Math.max(0, value) : 0;

    this.last = nextValue;

    if (this.count < MAX_SAMPLES) {
      this.values[this.cursor] = nextValue;
      this.count += 1;
      this.sum += nextValue;
      this.max = Math.max(this.max, nextValue);
      this.cursor = (this.cursor + 1) % MAX_SAMPLES;
      return;
    }

    const replacedValue = this.values[this.cursor];
    this.values[this.cursor] = nextValue;
    this.cursor = (this.cursor + 1) % MAX_SAMPLES;
    this.sum += nextValue - replacedValue;

    if (nextValue >= this.max) {
      this.max = nextValue;
      return;
    }

    if (replacedValue >= this.max) {
      this.max = 0;

      for (let index = 0; index < this.count; index += 1) {
        this.max = Math.max(this.max, this.values[index]);
      }
    }
  }

  reset(): void {
    this.values.fill(0);
    this.count = 0;
    this.cursor = 0;
    this.sum = 0;
    this.max = 0;
    this.last = 0;
  }

  getSummary(): RollingMetricSummary {
    return {
      averageMs: this.count > 0 ? this.sum / this.count : 0,
      maxMs: this.max,
      lastMs: this.last,
      sampleCount: this.count,
    };
  }
}

export class FrameProfiler {
  private readonly cpuDraw = new RollingMetric();
  private readonly cpuFrame = new RollingMetric();
  private readonly cpuGrid = new RollingMetric();
  private readonly cpuText = new RollingMetric();
  private readonly gpuFrame = new RollingMetric();
  private readonly gpuSupported: boolean;
  private readonly gpuSlots: GpuTimerSlot[] = [];
  private activeGpuSlot: GpuTimerSlot | null = null;
  private gpuError: string | null = null;

  constructor(
    private readonly device: Device,
    options: FrameProfilerOptions = {},
  ) {
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
    for (const slot of this.gpuSlots) {
      slot.querySet.destroy();
      slot.resultBuffer.destroy();
    }
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
      beginTimestampIndex: 0,
      endTimestampIndex: 1,
    };
  }

  getSnapshot(): PerfSnapshot {
    const cpuFrame = this.cpuFrame.getSummary();
    const cpuGrid = this.cpuGrid.getSummary();
    const cpuText = this.cpuText.getSummary();
    const cpuDraw = this.cpuDraw.getSummary();
    const gpuFrame = this.gpuFrame.getSummary();

    return {
      cpuDrawAvgMs: cpuDraw.averageMs,
      cpuFrameAvgMs: cpuFrame.averageMs,
      cpuFrameMaxMs: cpuFrame.maxMs,
      cpuFrameSamples: cpuFrame.sampleCount,
      cpuGridAvgMs: cpuGrid.averageMs,
      cpuTextAvgMs: cpuText.averageMs,
      gpuError: this.gpuError,
      gpuFrameAvgMs: gpuFrame.sampleCount > 0 ? gpuFrame.averageMs : null,
      gpuFrameMaxMs: gpuFrame.sampleCount > 0 ? gpuFrame.maxMs : null,
      gpuFrameSamples: gpuFrame.sampleCount,
      gpuSupported: this.gpuSupported,
    };
  }

  recordCpuDraw(valueMs: number): void {
    this.cpuDraw.push(valueMs);
  }

  recordCpuFrame(valueMs: number): void {
    this.cpuFrame.push(valueMs);
  }

  recordCpuGrid(valueMs: number): void {
    this.cpuGrid.push(valueMs);
  }

  recordCpuText(valueMs: number): void {
    this.cpuText.push(valueMs);
  }

  reset(): void {
    this.cpuDraw.reset();
    this.cpuFrame.reset();
    this.cpuGrid.reset();
    this.cpuText.reset();
    this.gpuFrame.reset();
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
        const start = view.getBigUint64(0, true);
        const end = view.getBigUint64(BigUint64Array.BYTES_PER_ELEMENT, true);

        if (end > start) {
          this.gpuFrame.push(Number(end - start) / 1_000_000);
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

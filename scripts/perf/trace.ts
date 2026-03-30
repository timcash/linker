import puppeteer, {type Page} from 'puppeteer';
import {createServer} from 'vite';

type ControlAction =
  | 'pan-down'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'zoom-in'
  | 'zoom-out';

type TraceOptions = {
  gpuTimingEnabled: boolean;
  labelCount: number;
  labelSet: 'benchmark' | 'demo';
  orbitCount: number;
  sampleCount: number | null;
  stageMode: '2d-mode' | '3d-mode';
  warmupCycles: number;
};

type FrameSample = {
  control: ControlAction;
  cpuDrawMs: number;
  cpuFrameMs: number;
  cpuLineMs: number;
  cpuTextMs: number;
  frameSampleCount: number;
  index: number;
  lineVisibleLinkCount: number;
  stackCameraAzimuthRadians: number;
  textBytesUploadedPerFrame: number;
  textVisibleGlyphCount: number;
};

type PerfSnapshot = {
  cpuDrawLastMs: number;
  cpuFrameLastMs: number;
  cpuFrameSamples: number;
  cpuLineLastMs: number;
  cpuTextLastMs: number;
  lineVisibleLinkCount: number;
  stackCameraAzimuthRadians: number;
  textBytesUploadedPerFrame: number;
  textVisibleGlyphCount: number;
};

const FULL_ORBIT_RADIANS = Math.PI * 2;
const STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS = Math.PI / 18;
const STACK_CAMERA_FULL_ORBIT_STEP_COUNT = Math.round(
  FULL_ORBIT_RADIANS / STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS,
);
const DEFAULT_TRACE_PATTERN: readonly ControlAction[] = [
  'pan-left',
  'pan-up',
  'pan-right',
  'pan-down',
  'zoom-in',
  'zoom-out',
];

const DEFAULT_OPTIONS: TraceOptions = {
  gpuTimingEnabled: false,
  labelCount: 4096,
  labelSet: 'benchmark',
  orbitCount: 1,
  sampleCount: null,
  stageMode: '3d-mode',
  warmupCycles: 1,
};

const SERVER_PORT = 4173;

const options = parseArgs(process.argv.slice(2));
const server = await createServer({
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: SERVER_PORT,
    strictPort: true,
  },
});

await server.listen();

let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

try {
  browser = await puppeteer.launch({
    channel: 'chrome',
    headless: true,
    defaultViewport: {width: 1280, height: 800},
    args: [
      '--enable-unsafe-webgpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--no-sandbox',
    ],
  });

  const page = await browser.newPage();
  const url = buildTraceUrl(options);

  await page.goto(url, {waitUntil: 'load'});
  await waitForReady(page);

  const trace = buildTrace(options);
  const initialSnapshot = await readPerfSnapshot(page);

  for (let cycle = 0; cycle < options.warmupCycles; cycle += 1) {
    for (const control of trace) {
      await executeControl(page, control);
    }
  }

  const samples: FrameSample[] = [];

  for (const [index, control] of trace.entries()) {
    const snapshot = await executeControl(page, control);
    samples.push({
      control,
      cpuDrawMs: snapshot.cpuDrawLastMs,
      cpuFrameMs: snapshot.cpuFrameLastMs,
      cpuLineMs: snapshot.cpuLineLastMs,
      cpuTextMs: snapshot.cpuTextLastMs,
      frameSampleCount: snapshot.cpuFrameSamples,
      index,
      lineVisibleLinkCount: snapshot.lineVisibleLinkCount,
      stackCameraAzimuthRadians: snapshot.stackCameraAzimuthRadians,
      textBytesUploadedPerFrame: snapshot.textBytesUploadedPerFrame,
      textVisibleGlyphCount: snapshot.textVisibleGlyphCount,
    });
  }

  const visibleTextSamples = samples.filter((sample) => sample.textVisibleGlyphCount > 0);

  const report = {
    meta: {
      gpuTimingEnabled: options.gpuTimingEnabled,
      labelCount: options.labelCount,
      labelSet: options.labelSet,
      orbitCount: options.orbitCount,
      route: url,
      sampleCount: samples.length,
      stackCameraFullOrbitStepCount: STACK_CAMERA_FULL_ORBIT_STEP_COUNT,
      stageMode: options.stageMode,
      trace,
      warmupCycles: options.warmupCycles,
    },
    summary: {
      cpuDrawMs: summarizeMetric(samples.map((sample) => sample.cpuDrawMs)),
      cpuFrameMs: summarizeMetric(samples.map((sample) => sample.cpuFrameMs)),
      cpuLineMs: summarizeMetric(samples.map((sample) => sample.cpuLineMs)),
      cpuTextMs: summarizeMetric(samples.map((sample) => sample.cpuTextMs)),
      lineVisibleLinkCount: summarizeMetric(samples.map((sample) => sample.lineVisibleLinkCount)),
      orbitAzimuthRadians: {
        delta: getAzimuthDeltaRadians(initialSnapshot.stackCameraAzimuthRadians, samples),
        end: samples[samples.length - 1]?.stackCameraAzimuthRadians ?? initialSnapshot.stackCameraAzimuthRadians,
        start: initialSnapshot.stackCameraAzimuthRadians,
      },
      textBytesUploadedPerFrame: summarizeMetric(samples.map((sample) => sample.textBytesUploadedPerFrame)),
      textVisibleGlyphCount: summarizeMetric(samples.map((sample) => sample.textVisibleGlyphCount)),
    },
    visibleTextOnly: {
      sampleCount: visibleTextSamples.length,
      cpuDrawMs: summarizeMetric(visibleTextSamples.map((sample) => sample.cpuDrawMs)),
      cpuFrameMs: summarizeMetric(visibleTextSamples.map((sample) => sample.cpuFrameMs)),
      cpuLineMs: summarizeMetric(visibleTextSamples.map((sample) => sample.cpuLineMs)),
      cpuTextMs: summarizeMetric(visibleTextSamples.map((sample) => sample.cpuTextMs)),
      lineVisibleLinkCount: summarizeMetric(visibleTextSamples.map((sample) => sample.lineVisibleLinkCount)),
      textBytesUploadedPerFrame: summarizeMetric(visibleTextSamples.map((sample) => sample.textBytesUploadedPerFrame)),
      textVisibleGlyphCount: summarizeMetric(visibleTextSamples.map((sample) => sample.textVisibleGlyphCount)),
    },
    samples,
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) {
    await browser.close();
  }

  await server.close();
}

function buildTrace(options: TraceOptions): ControlAction[] {
  if (options.stageMode === '3d-mode') {
    return buildFullOrbitTrace(options);
  }

  const safeSampleCount = Math.max(1, options.sampleCount ?? DEFAULT_TRACE_PATTERN.length);
  const trace: ControlAction[] = [];

  for (let index = 0; index < safeSampleCount; index += 1) {
    trace.push(DEFAULT_TRACE_PATTERN[index % DEFAULT_TRACE_PATTERN.length] ?? 'pan-left');
  }

  return trace;
}

function buildFullOrbitTrace(options: TraceOptions): ControlAction[] {
  const orbitCount = Math.max(1, options.orbitCount);
  const stepCount = Math.max(
    1,
    options.sampleCount ?? orbitCount * STACK_CAMERA_FULL_ORBIT_STEP_COUNT,
  );

  return Array.from({length: stepCount}, () => 'pan-left' as const);
}

function buildTraceUrl(options: TraceOptions): string {
  const url = new URL(`http://127.0.0.1:${SERVER_PORT}/`);

  url.searchParams.set('stageMode', options.stageMode);
  url.searchParams.set('labelSet', options.labelSet);
  url.searchParams.set('gpuTiming', options.gpuTimingEnabled ? '1' : '0');

  if (options.labelSet === 'benchmark') {
    url.searchParams.set('labelCount', String(options.labelCount));
  }

  return url.toString();
}

async function executeControl(page: Page, control: ControlAction): Promise<PerfSnapshot> {
  const before = await readPerfSnapshot(page);

  await page.click(`[data-control="${control}"]`);
  await page.waitForFunction(
    (sampleCount: number) => Number(document.body.dataset.perfCpuFrameSamples ?? '0') > sampleCount,
    {timeout: 10_000},
    before.cpuFrameSamples,
  );
  await page.waitForFunction(
    () => (document.body.dataset.cameraAnimating ?? 'false') === 'false',
    {timeout: 10_000},
  );

  return readPerfSnapshot(page);
}

async function readPerfSnapshot(page: Page): Promise<PerfSnapshot> {
  return page.evaluate(() => ({
    cpuDrawLastMs: Number(document.body.dataset.perfCpuDrawLastMs ?? '0'),
    cpuFrameLastMs: Number(document.body.dataset.perfCpuFrameLastMs ?? '0'),
    cpuFrameSamples: Number(document.body.dataset.perfCpuFrameSamples ?? '0'),
    cpuLineLastMs: Number(document.body.dataset.perfCpuLineLastMs ?? '0'),
    cpuTextLastMs: Number(document.body.dataset.perfCpuTextLastMs ?? '0'),
    lineVisibleLinkCount: Number(document.body.dataset.lineVisibleLinkCount ?? '0'),
    stackCameraAzimuthRadians: Number(document.body.dataset.stackCameraAzimuth ?? '0'),
    textBytesUploadedPerFrame: Number(document.body.dataset.textBytesUploadedPerFrame ?? '0'),
    textVisibleGlyphCount: Number(document.body.dataset.textVisibleGlyphCount ?? '0'),
  }));
}

function getAzimuthDeltaRadians(initialAzimuthRadians: number, samples: FrameSample[]): number {
  if (samples.length === 0) {
    return 0;
  }

  let delta = 0;
  let previous = initialAzimuthRadians;

  for (const sample of samples) {
    delta += unwrapAzimuthDelta(previous, sample.stackCameraAzimuthRadians);
    previous = sample.stackCameraAzimuthRadians;
  }

  return delta;
}

function unwrapAzimuthDelta(previous: number, next: number): number {
  let delta = next - previous;

  while (delta <= -Math.PI) {
    delta += FULL_ORBIT_RADIANS;
  }

  while (delta > Math.PI) {
    delta -= FULL_ORBIT_RADIANS;
  }

  return delta;
}

function summarizeMetric(values: number[]): {
  avg: number;
  max: number;
  median: number;
  min: number;
  p95: number;
} {
  if (values.length === 0) {
    return {avg: 0, max: 0, median: 0, min: 0, p95: 0};
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    avg: sum / values.length,
    max: sorted[sorted.length - 1] ?? 0,
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? 0,
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const clampedFraction = Math.min(1, Math.max(0, fraction));
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * clampedFraction) - 1),
  );

  return sortedValues[index] ?? 0;
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.body.dataset.appState === 'ready', {timeout: 20_000});
  await page.waitForFunction(
    () => (document.body.dataset.cameraAnimating ?? 'false') === 'false',
    {timeout: 20_000},
  );
}

function parseArgs(args: string[]): TraceOptions {
  const options = {...DEFAULT_OPTIONS};

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (!flag?.startsWith('--')) {
      continue;
    }

    switch (flag) {
      case '--gpu-timing':
        options.gpuTimingEnabled = value !== '0';
        index += 1;
        break;
      case '--label-count':
        options.labelCount = parsePositiveInteger(value, options.labelCount);
        index += 1;
        break;
      case '--label-set':
        options.labelSet = value === 'demo' ? 'demo' : 'benchmark';
        index += 1;
        break;
      case '--orbit-count':
        options.orbitCount = parsePositiveInteger(value, options.orbitCount);
        index += 1;
        break;
      case '--sample-count':
        options.sampleCount = parsePositiveInteger(value, STACK_CAMERA_FULL_ORBIT_STEP_COUNT);
        index += 1;
        break;
      case '--stage-mode':
        options.stageMode = value === '2d-mode' ? '2d-mode' : '3d-mode';
        index += 1;
        break;
      case '--warmup-cycles':
        options.warmupCycles = parsePositiveInteger(value, options.warmupCycles);
        index += 1;
        break;
      default:
        break;
    }
  }

  return options;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

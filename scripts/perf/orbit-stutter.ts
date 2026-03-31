import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import puppeteer, {type Page} from 'puppeteer';
import {createServer} from 'vite';

type OrbitStutterOptions = {
  assertEnabled: boolean;
  gpuTimingEnabled: boolean;
  headless: boolean;
  labelCount: number;
  labelSet: 'benchmark' | 'demo';
  maxFrameJitterMs: number;
  maxLongTaskMs: number;
  maxP95FrameJitterMs: number;
  maxStutterFrameCount: number;
  postReleaseMs: number;
  radiusXRatio: number;
  radiusYRatio: number;
  revolutionsPerSegment: number;
  profileEnabled: boolean;
  samplingIntervalUs: number;
  segmentCount: number;
  segmentDurationMs: number;
  segmentGapMs: number;
  stageMode: '3d-mode';
  stepIntervalMs: number;
  stutterCadenceMultiplier: number;
  stutterThresholdMs: number;
  topFunctionCount: number;
  traceEnabled: boolean;
  warmupSegments: number;
  warmupSegmentDurationMs: number;
};

type OrbitMonitorFrame = {
  azimuthRadians: number;
  deltaMs: number;
  timeMs: number;
};

type OrbitMonitorLongTask = {
  durationMs: number;
  startTimeMs: number;
};

type OrbitMonitorResult = {
  durationMs: number;
  frames: OrbitMonitorFrame[];
  longTasks: OrbitMonitorLongTask[];
  marks: Record<string, number>;
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

type MetricSummary = {
  avg: number;
  max: number;
  median: number;
  min: number;
  p95: number;
  p99: number;
};

type PhaseSummary = {
  azimuthDeltaRadians: number;
  durationMs: number;
  frameCount: number;
  frameDeltaMs: MetricSummary;
  longTaskCount: number;
  longTaskDurationMs: MetricSummary;
  name: string;
  stutterFrameCount: number;
  stutterFrameThresholdMs: number;
};

type OrbitScenarioPlan = {
  plannedSegmentAzimuthDeltaRadians: number;
  plannedTotalAzimuthDeltaRadians: number;
  sweepWidthPx: number;
  verticalAmplitudePx: number;
};

type CpuProfileCallFrame = {
  columnNumber: number;
  functionName: string;
  lineNumber: number;
  url: string;
};

type CpuProfileNode = {
  callFrame: CpuProfileCallFrame;
  id: number;
};

type CpuProfile = {
  endTime: number;
  nodes: CpuProfileNode[];
  samples?: number[];
  startTime: number;
  timeDeltas?: number[];
};

type CpuProfileFunctionSummary = {
  column: number;
  functionName: string;
  line: number;
  selfMs: number;
  url: string;
};

const SERVER_PORT = 4173;
const FULL_ORBIT_RADIANS = Math.PI * 2;
const MIN_ORBIT_SEGMENT_DURATION_MS = 2000;
const STACK_CAMERA_DRAG_RADIANS_PER_PIXEL = 0.0055;
const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-v8.cpu_profiler',
];

const DEFAULT_OPTIONS: OrbitStutterOptions = {
  assertEnabled: true,
  gpuTimingEnabled: false,
  headless: true,
  labelCount: 4096,
  labelSet: 'benchmark',
  maxFrameJitterMs: 12,
  maxLongTaskMs: 40,
  maxP95FrameJitterMs: 4,
  maxStutterFrameCount: 3,
  postReleaseMs: 900,
  radiusXRatio: 0.46,
  radiusYRatio: 0.18,
  revolutionsPerSegment: 1,
  profileEnabled: false,
  samplingIntervalUs: 100,
  segmentCount: 3,
  segmentDurationMs: 2500,
  segmentGapMs: 200,
  stageMode: '3d-mode',
  stepIntervalMs: 10,
  stutterCadenceMultiplier: 1.5,
  stutterThresholdMs: 25,
  topFunctionCount: 15,
  traceEnabled: false,
  warmupSegments: 1,
  warmupSegmentDurationMs: 1200,
};

const options = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replaceAll(':', '-');
const artifactDirectory = path.resolve(process.cwd(), 'artifacts', 'perf');
const summaryPath = path.join(
  artifactDirectory,
  `orbit-stutter-${options.stageMode}-${options.labelSet}-${options.labelCount}-${timestamp}.summary.json`,
);
const cpuProfilePath = path.join(
  artifactDirectory,
  `orbit-stutter-${options.stageMode}-${options.labelSet}-${options.labelCount}-${timestamp}.cpuprofile`,
);
const tracePath = path.join(
  artifactDirectory,
  `orbit-stutter-${options.stageMode}-${options.labelSet}-${options.labelCount}-${timestamp}.trace.json`,
);

await mkdir(artifactDirectory, {recursive: true});

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
    headless: options.headless,
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
  const client = options.profileEnabled ? await page.target().createCDPSession() : null;
  const url = buildUrl(options);

  await page.goto(url, {waitUntil: 'load'});
  await waitForReady(page, options.stageMode);

  if (options.warmupSegments > 0) {
    await runOrbitScenario(page, {
      ...options,
      postReleaseMs: 0,
      segmentCount: options.warmupSegments,
      segmentDurationMs: options.warmupSegmentDurationMs,
      segmentGapMs: 100,
    });
    await waitForQuiet(page, 200);
  }

  const beforePerf = await readPerfSnapshot(page);

  if (client) {
    await client.send('Profiler.enable');
    await client.send('Profiler.setSamplingInterval', {interval: options.samplingIntervalUs});
    await client.send('Profiler.start');
  }

  if (options.traceEnabled) {
    await page.tracing.start({
      categories: TRACE_CATEGORIES,
      path: tracePath,
    });
  }

  await installOrbitMonitor(page);
  const scenarioStartedAt = performance.now();
  const scenarioPlan = await runOrbitScenario(page, options);
  const scenarioElapsedMs = performance.now() - scenarioStartedAt;
  const monitor = await stopOrbitMonitor(page);
  const cpuProfile = client
    ? (await client.send('Profiler.stop') as {profile: CpuProfile}).profile
    : null;

  if (options.traceEnabled) {
    await page.tracing.stop();
  }

  if (client) {
    await client.send('Profiler.disable');
  }

  const afterPerf = await readPerfSnapshot(page);
  const phaseSummaries = summarizePhases(monitor, options);
  const dragSummary = summarizeDragPhase(phaseSummaries);
  const thresholds = {
    maxFrameJitterMs: options.maxFrameJitterMs,
    maxLongTaskMs: options.maxLongTaskMs,
    maxP95FrameJitterMs: options.maxP95FrameJitterMs,
    maxStutterFrameCount: options.maxStutterFrameCount,
    minDragDurationMs: MIN_ORBIT_SEGMENT_DURATION_MS,
    minOrbitDeltaRadians: scenarioPlan.plannedTotalAzimuthDeltaRadians * 0.85,
    stutterCadenceMultiplier: options.stutterCadenceMultiplier,
    stutterThresholdMs: options.stutterThresholdMs,
  };
  const failures = collectFailures(dragSummary, thresholds);
  const cpuProfileSummary = cpuProfile
    ? summarizeCpuProfile(cpuProfile, options.topFunctionCount)
    : null;
  const report = {
    artifacts: {
      cpuProfilePath: cpuProfile ? cpuProfilePath : null,
      summaryPath,
      tracePath: options.traceEnabled ? tracePath : null,
    },
    meta: {
      assertEnabled: options.assertEnabled,
      gpuTimingEnabled: options.gpuTimingEnabled,
      labelCount: options.labelCount,
      labelSet: options.labelSet,
      minimumSegmentDurationMs: MIN_ORBIT_SEGMENT_DURATION_MS,
      postReleaseMs: options.postReleaseMs,
      profileEnabled: options.profileEnabled,
      radiusXRatio: options.radiusXRatio,
      radiusYRatio: options.radiusYRatio,
      revolutionsPerSegment: options.revolutionsPerSegment,
      route: url,
      scenarioElapsedMs,
      scenarioPlan,
      segmentCount: options.segmentCount,
      segmentDurationMs: options.segmentDurationMs,
      segmentGapMs: options.segmentGapMs,
      samplingIntervalUs: options.samplingIntervalUs,
      stageMode: options.stageMode,
      stepIntervalMs: options.stepIntervalMs,
      topFunctionCount: options.topFunctionCount,
      traceEnabled: options.traceEnabled,
      warmupSegments: options.warmupSegments,
      warmupSegmentDurationMs: options.warmupSegmentDurationMs,
    },
    cpuProfile: cpuProfileSummary,
    perf: {
      after: afterPerf,
      before: beforePerf,
      delta: {
        cpuDrawLastMs: afterPerf.cpuDrawLastMs - beforePerf.cpuDrawLastMs,
        cpuFrameLastMs: afterPerf.cpuFrameLastMs - beforePerf.cpuFrameLastMs,
        cpuLineLastMs: afterPerf.cpuLineLastMs - beforePerf.cpuLineLastMs,
        cpuTextLastMs: afterPerf.cpuTextLastMs - beforePerf.cpuTextLastMs,
      },
    },
    phases: phaseSummaries,
    status: failures.length === 0 ? 'passed' : 'failed',
    thresholds,
  };

  if (cpuProfile) {
    await writeFile(cpuProfilePath, `${JSON.stringify(cpuProfile, null, 2)}\n`, 'utf8');
  }
  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));

  if (options.assertEnabled && failures.length > 0) {
    throw new Error(`Orbit stutter regression detected: ${failures.join('; ')}`);
  }
} finally {
  if (browser) {
    await browser.close();
  }

  await server.close();
}

function buildUrl(options: OrbitStutterOptions): string {
  const url = new URL(`http://127.0.0.1:${SERVER_PORT}/`);

  url.searchParams.set('stageMode', options.stageMode);
  url.searchParams.set('labelSet', options.labelSet);
  url.searchParams.set('gpuTiming', options.gpuTimingEnabled ? '1' : '0');

  if (options.labelSet === 'benchmark') {
    url.searchParams.set('labelCount', String(options.labelCount));
  }

  return url.toString();
}

async function waitForReady(page: Page, stageMode: OrbitStutterOptions['stageMode']): Promise<void> {
  await page.waitForFunction(
    (expectedStageMode: string) =>
      document.body.dataset.appState === 'ready' &&
      (document.body.dataset.stageMode ?? '') === expectedStageMode,
    {timeout: 20_000},
    stageMode,
  );
  await page.waitForFunction(
    () => (document.body.dataset.cameraAnimating ?? 'false') === 'false',
    {timeout: 20_000},
  );
}

async function runOrbitScenario(
  page: Page,
  options: OrbitStutterOptions,
): Promise<OrbitScenarioPlan> {
  const canvas = await page.$('[data-testid="gpu-canvas"]');

  if (!canvas) {
    throw new Error('Missing GPU canvas for orbit stutter test.');
  }

  const box = await canvas.boundingBox();

  if (!box) {
    throw new Error('Expected the GPU canvas to have a visible bounding box.');
  }

  const centerX = box.x + box.width * 0.5;
  const centerY = box.y + box.height * 0.5;
  const maxSweepWidth = box.width * options.radiusXRatio * 2;
  const requestedSweepWidth =
    (FULL_ORBIT_RADIANS * options.revolutionsPerSegment) /
    STACK_CAMERA_DRAG_RADIANS_PER_PIXEL;
  const sweepWidth = Math.min(maxSweepWidth, requestedSweepWidth);
  const verticalAmplitude = box.height * options.radiusYRatio;
  const stepCount = Math.max(2, Math.ceil(options.segmentDurationMs / options.stepIntervalMs));
  const startX = centerX + sweepWidth * 0.5;
  const startY = centerY;

  for (let segmentIndex = 0; segmentIndex < options.segmentCount; segmentIndex += 1) {
    await page.mouse.move(startX, startY);
    await markOrbitMonitor(page, `segment-${segmentIndex}-start`);
    await page.mouse.down();
    const segmentStartedAt = performance.now();

    for (let stepIndex = 1; stepIndex <= stepCount; stepIndex += 1) {
      const progress = stepIndex / stepCount;
      const x = startX - sweepWidth * progress;
      const y = centerY + Math.sin(progress * Math.PI * 2) * verticalAmplitude;

      await page.mouse.move(x, y);
      await sleepUntil(segmentStartedAt + stepIndex * options.stepIntervalMs);
    }

    await page.mouse.up();
    await markOrbitMonitor(page, `segment-${segmentIndex}-end`);

    if (segmentIndex < options.segmentCount - 1 && options.segmentGapMs > 0) {
      await sleep(options.segmentGapMs);
    }
  }

  if (options.postReleaseMs > 0) {
    await sleep(options.postReleaseMs);
  }

  return {
    plannedSegmentAzimuthDeltaRadians: sweepWidth * STACK_CAMERA_DRAG_RADIANS_PER_PIXEL,
    plannedTotalAzimuthDeltaRadians:
      sweepWidth * STACK_CAMERA_DRAG_RADIANS_PER_PIXEL * options.segmentCount,
    sweepWidthPx: sweepWidth,
    verticalAmplitudePx: verticalAmplitude,
  };
}

async function installOrbitMonitor(page: Page): Promise<void> {
  await page.evaluate(`
    (() => {
      const frames = [];
      const longTasks = [];
      const marks = {};
      const startedAt = performance.now();
      let animationFrameId = 0;
      let lastFrameAt = null;
      let longTaskObserver = null;

      const loop = (timestamp) => {
        frames.push({
          azimuthRadians: Number(document.body.dataset.stackCameraAzimuth ?? '0'),
          deltaMs: lastFrameAt === null ? 0 : timestamp - lastFrameAt,
          timeMs: timestamp - startedAt,
        });
        lastFrameAt = timestamp;
        animationFrameId = requestAnimationFrame(loop);
      };

      if (typeof PerformanceObserver === 'function') {
        try {
          longTaskObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTasks.push({
                durationMs: entry.duration,
                startTimeMs: entry.startTime - startedAt,
              });
            }
          });
          longTaskObserver.observe({type: 'longtask', buffered: true});
        } catch {
          longTaskObserver = null;
        }
      }

      animationFrameId = requestAnimationFrame(loop);
      marks['monitor-start'] = 0;
      window.__LINKER_ORBIT_MONITOR__ = {
        mark(name) {
          marks[name] = performance.now() - startedAt;
        },
        stop() {
          cancelAnimationFrame(animationFrameId);
          if (longTaskObserver) {
            longTaskObserver.disconnect();
          }
          return {
            durationMs: performance.now() - startedAt,
            frames,
            longTasks,
            marks,
          };
        },
      };
    })();
  `);
}

async function markOrbitMonitor(page: Page, name: string): Promise<void> {
  await page.evaluate(`
    (() => {
      window.__LINKER_ORBIT_MONITOR__?.mark(${JSON.stringify(name)});
    })();
  `);
}

async function stopOrbitMonitor(page: Page): Promise<OrbitMonitorResult> {
  return page.evaluate(`
    (() => {
      const monitor = window.__LINKER_ORBIT_MONITOR__;

      if (!monitor) {
        throw new Error('Missing orbit monitor while collecting frame metrics.');
      }

      return monitor.stop();
    })();
  `) as Promise<OrbitMonitorResult>;
}

function summarizePhases(
  monitor: OrbitMonitorResult,
  options: OrbitStutterOptions,
): PhaseSummary[] {
  const phaseSummaries: PhaseSummary[] = [];
  const segmentRanges = buildSegmentRanges(monitor, options.segmentCount);
  const activeDragFrames = collectFramesForRanges(monitor.frames, segmentRanges);
  const activeDragLongTasks = collectLongTasksForRanges(monitor.longTasks, segmentRanges);

  phaseSummaries.push(
    summarizePhase(
      'drag-all-segments',
      activeDragFrames,
      activeDragLongTasks,
      getRangesDuration(segmentRanges),
      options.stutterCadenceMultiplier,
      options.stutterThresholdMs,
    ),
  );

  for (const range of segmentRanges) {
    const frames = collectFramesForRange(monitor.frames, range.startMs, range.endMs);
    const longTasks = collectLongTasksForRange(monitor.longTasks, range.startMs, range.endMs);

    phaseSummaries.push(
      summarizePhase(
        range.name,
        frames,
        longTasks,
        range.endMs - range.startMs,
        options.stutterCadenceMultiplier,
        options.stutterThresholdMs,
      ),
    );
  }

  const lastSegmentEndMs = segmentRanges[segmentRanges.length - 1]?.endMs ?? 0;

  if (options.postReleaseMs > 0) {
    const settleStartMs = lastSegmentEndMs;
    const settleEndMs = Math.min(monitor.durationMs, settleStartMs + options.postReleaseMs);

    phaseSummaries.push(
      summarizePhase(
        'post-release',
        collectFramesForRange(monitor.frames, settleStartMs, settleEndMs),
        collectLongTasksForRange(monitor.longTasks, settleStartMs, settleEndMs),
        Math.max(0, settleEndMs - settleStartMs),
        options.stutterCadenceMultiplier,
        options.stutterThresholdMs,
      ),
    );
  }

  phaseSummaries.push(
    summarizePhase(
      'scenario-total',
      monitor.frames.filter((frame) => frame.deltaMs > 0),
      monitor.longTasks,
      monitor.durationMs,
      options.stutterCadenceMultiplier,
      options.stutterThresholdMs,
    ),
  );

  return phaseSummaries;
}

function summarizeDragPhase(phaseSummaries: PhaseSummary[]): PhaseSummary {
  const dragSummary = phaseSummaries.find((phase) => phase.name === 'drag-all-segments');

  if (!dragSummary) {
    throw new Error('Missing aggregated drag phase summary.');
  }

  return dragSummary;
}

function buildSegmentRanges(
  monitor: OrbitMonitorResult,
  segmentCount: number,
): Array<{endMs: number; name: string; startMs: number}> {
  const ranges: Array<{endMs: number; name: string; startMs: number}> = [];

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const startMs = monitor.marks[`segment-${segmentIndex}-start`];
    const endMs = monitor.marks[`segment-${segmentIndex}-end`];

    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      continue;
    }

    ranges.push({
      endMs,
      name: `segment-${segmentIndex}`,
      startMs,
    });
  }

  return ranges;
}

function collectFramesForRanges(
  frames: OrbitMonitorFrame[],
  ranges: Array<{endMs: number; startMs: number}>,
): OrbitMonitorFrame[] {
  if (ranges.length === 0) {
    return [];
  }

  return frames.filter(
    (frame) =>
      frame.deltaMs > 0 &&
      ranges.some((range) => frame.timeMs >= range.startMs && frame.timeMs <= range.endMs),
  );
}

function collectFramesForRange(
  frames: OrbitMonitorFrame[],
  startMs: number,
  endMs: number,
): OrbitMonitorFrame[] {
  return frames.filter(
    (frame) => frame.deltaMs > 0 && frame.timeMs >= startMs && frame.timeMs <= endMs,
  );
}

function collectLongTasksForRanges(
  longTasks: OrbitMonitorLongTask[],
  ranges: Array<{endMs: number; startMs: number}>,
): OrbitMonitorLongTask[] {
  if (ranges.length === 0) {
    return [];
  }

  return longTasks.filter((task) =>
    ranges.some((range) => overlaps(task.startTimeMs, task.durationMs, range.startMs, range.endMs)),
  );
}

function collectLongTasksForRange(
  longTasks: OrbitMonitorLongTask[],
  startMs: number,
  endMs: number,
): OrbitMonitorLongTask[] {
  return longTasks.filter((task) => overlaps(task.startTimeMs, task.durationMs, startMs, endMs));
}

function summarizePhase(
  name: string,
  frames: OrbitMonitorFrame[],
  longTasks: OrbitMonitorLongTask[],
  durationMs: number,
  stutterCadenceMultiplier: number,
  stutterThresholdMs: number,
): PhaseSummary {
  const frameDeltas = frames.map((frame) => frame.deltaMs);
  const frameDeltaSummary = summarizeMetric(frameDeltas);
  const longTaskDurations = longTasks.map((task) => task.durationMs);
  const effectiveStutterThresholdMs = Math.max(
    stutterThresholdMs,
    frameDeltaSummary.median * stutterCadenceMultiplier,
  );

  return {
    azimuthDeltaRadians: getAzimuthDeltaRadians(frames),
    durationMs,
    frameCount: frameDeltas.length,
    frameDeltaMs: frameDeltaSummary,
    longTaskCount: longTaskDurations.length,
    longTaskDurationMs: summarizeMetric(longTaskDurations),
    name,
    stutterFrameCount: frameDeltas.filter((deltaMs) => deltaMs >= effectiveStutterThresholdMs).length,
    stutterFrameThresholdMs: effectiveStutterThresholdMs,
  };
}

function collectFailures(
  dragSummary: PhaseSummary,
  thresholds: {
    maxFrameJitterMs: number;
    maxLongTaskMs: number;
    maxP95FrameJitterMs: number;
    maxStutterFrameCount: number;
    minDragDurationMs: number;
    minOrbitDeltaRadians: number;
    stutterCadenceMultiplier: number;
    stutterThresholdMs: number;
  },
): string[] {
  const failures: string[] = [];
  const p95FrameJitterMs = dragSummary.frameDeltaMs.p95 - dragSummary.frameDeltaMs.median;
  const maxFrameJitterMs = dragSummary.frameDeltaMs.max - dragSummary.frameDeltaMs.median;

  if (p95FrameJitterMs > thresholds.maxP95FrameJitterMs) {
    failures.push(
      `drag p95 frame jitter ${p95FrameJitterMs.toFixed(2)}ms > ${thresholds.maxP95FrameJitterMs.toFixed(2)}ms above ${dragSummary.frameDeltaMs.median.toFixed(2)}ms cadence`,
    );
  }

  if (maxFrameJitterMs > thresholds.maxFrameJitterMs) {
    failures.push(
      `drag max frame jitter ${maxFrameJitterMs.toFixed(2)}ms > ${thresholds.maxFrameJitterMs.toFixed(2)}ms above ${dragSummary.frameDeltaMs.median.toFixed(2)}ms cadence`,
    );
  }

  if (dragSummary.stutterFrameCount > thresholds.maxStutterFrameCount) {
    failures.push(
      `drag stutter frames ${dragSummary.stutterFrameCount} > ${thresholds.maxStutterFrameCount} at ${dragSummary.stutterFrameThresholdMs.toFixed(2)}ms dynamic threshold`,
    );
  }

  if (dragSummary.longTaskDurationMs.max > thresholds.maxLongTaskMs) {
    failures.push(
      `drag max long task ${dragSummary.longTaskDurationMs.max.toFixed(2)}ms > ${thresholds.maxLongTaskMs.toFixed(2)}ms`,
    );
  }

  if (dragSummary.durationMs < thresholds.minDragDurationMs) {
    failures.push(
      `drag duration ${dragSummary.durationMs.toFixed(2)}ms < ${thresholds.minDragDurationMs.toFixed(2)}ms`,
    );
  }

  if (dragSummary.azimuthDeltaRadians < thresholds.minOrbitDeltaRadians) {
    failures.push(
      `drag orbit delta ${dragSummary.azimuthDeltaRadians.toFixed(3)}rad < ${thresholds.minOrbitDeltaRadians.toFixed(3)}rad`,
    );
  }

  return failures;
}

function summarizeCpuProfile(
  profile: CpuProfile,
  topFunctionCount: number,
): {
  durationMs: number;
  topApplicationFunctions: CpuProfileFunctionSummary[];
  topFunctions: CpuProfileFunctionSummary[];
} {
  const selfMsByNode = new Map<number, number>();
  const samples = profile.samples ?? [];
  const timeDeltas = profile.timeDeltas ?? [];

  for (let index = 0; index < samples.length; index += 1) {
    const nodeId = samples[index];
    const deltaUs = timeDeltas[index] ?? 0;

    if (nodeId === undefined) {
      continue;
    }

    selfMsByNode.set(nodeId, (selfMsByNode.get(nodeId) ?? 0) + deltaUs / 1000);
  }

  const summaries = profile.nodes
    .map((node) => ({
      column: node.callFrame.columnNumber + 1,
      functionName: node.callFrame.functionName || '(anonymous)',
      line: node.callFrame.lineNumber + 1,
      selfMs: selfMsByNode.get(node.id) ?? 0,
      url: node.callFrame.url,
    }))
    .filter((summary) => summary.selfMs > 0)
    .sort((left, right) => right.selfMs - left.selfMs);

  return {
    durationMs: (profile.endTime - profile.startTime) / 1000,
    topApplicationFunctions: summaries
      .filter((summary) => isApplicationProfileUrl(summary.url))
      .slice(0, topFunctionCount),
    topFunctions: summaries.slice(0, topFunctionCount),
  };
}

function isApplicationProfileUrl(url: string): boolean {
  return url.includes('/src/') || url.includes('/scripts/');
}

function getRangesDuration(ranges: Array<{endMs: number; startMs: number}>): number {
  return ranges.reduce((total, range) => total + Math.max(0, range.endMs - range.startMs), 0);
}

function overlaps(
  taskStartMs: number,
  taskDurationMs: number,
  rangeStartMs: number,
  rangeEndMs: number,
): boolean {
  const taskEndMs = taskStartMs + taskDurationMs;

  return taskStartMs < rangeEndMs && taskEndMs > rangeStartMs;
}

function summarizeMetric(values: number[]): MetricSummary {
  if (values.length === 0) {
    return {
      avg: 0,
      max: 0,
      median: 0,
      min: 0,
      p95: 0,
      p99: 0,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const sum = values.reduce((total, value) => total + value, 0);

  return {
    avg: sum / values.length,
    max: sorted[sorted.length - 1] ?? 0,
    median: percentile(sorted, 0.5),
    min: sorted[0] ?? 0,
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function getAzimuthDeltaRadians(frames: OrbitMonitorFrame[]): number {
  if (frames.length <= 1) {
    return 0;
  }

  let totalDeltaRadians = 0;

  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const currentFrame = frames[index];

    if (!previousFrame || !currentFrame) {
      continue;
    }

    totalDeltaRadians += unwrapAzimuthDelta(
      currentFrame.azimuthRadians - previousFrame.azimuthRadians,
    );
  }

  return Math.abs(totalDeltaRadians);
}

function unwrapAzimuthDelta(deltaRadians: number): number {
  if (deltaRadians > Math.PI) {
    return deltaRadians - Math.PI * 2;
  }

  if (deltaRadians < -Math.PI) {
    return deltaRadians + Math.PI * 2;
  }

  return deltaRadians;
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

async function waitForQuiet(page: Page, durationMs: number): Promise<void> {
  await page.waitForFunction(
    () => (document.body.dataset.cameraAnimating ?? 'false') === 'false',
    {timeout: 20_000},
  );
  if (durationMs > 0) {
    await sleep(durationMs);
  }
}

async function sleepUntil(targetAtMs: number): Promise<void> {
  const remainingMs = targetAtMs - performance.now();

  if (remainingMs > 0) {
    await sleep(remainingMs);
  }
}

async function sleep(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function parseArgs(args: string[]): OrbitStutterOptions {
  const options = {...DEFAULT_OPTIONS};

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (!flag?.startsWith('--')) {
      continue;
    }

    switch (flag) {
      case '--assert':
        options.assertEnabled = value !== '0';
        index += 1;
        break;
      case '--gpu-timing':
        options.gpuTimingEnabled = value !== '0';
        index += 1;
        break;
      case '--headless':
        options.headless = value !== '0';
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
      case '--max-frame-jitter-ms':
      case '--max-frame-ms':
        options.maxFrameJitterMs = parsePositiveFloat(value, options.maxFrameJitterMs);
        index += 1;
        break;
      case '--max-long-task-ms':
        options.maxLongTaskMs = parsePositiveFloat(value, options.maxLongTaskMs);
        index += 1;
        break;
      case '--max-p95-frame-jitter-ms':
      case '--max-p95-frame-ms':
        options.maxP95FrameJitterMs = parsePositiveFloat(
          value,
          options.maxP95FrameJitterMs,
        );
        index += 1;
        break;
      case '--max-stutter-frames':
        options.maxStutterFrameCount = parsePositiveInteger(value, options.maxStutterFrameCount);
        index += 1;
        break;
      case '--post-release-ms':
        options.postReleaseMs = parseNonNegativeInteger(value, options.postReleaseMs);
        index += 1;
        break;
      case '--profile':
        options.profileEnabled = value !== '0';
        index += 1;
        break;
      case '--radius-x-ratio':
        options.radiusXRatio = parsePositiveFloat(value, options.radiusXRatio);
        index += 1;
        break;
      case '--radius-y-ratio':
        options.radiusYRatio = parsePositiveFloat(value, options.radiusYRatio);
        index += 1;
        break;
      case '--revolutions-per-segment':
        options.revolutionsPerSegment = parsePositiveFloat(value, options.revolutionsPerSegment);
        index += 1;
        break;
      case '--segment-count':
        options.segmentCount = parsePositiveInteger(value, options.segmentCount);
        index += 1;
        break;
      case '--segment-duration-ms':
        options.segmentDurationMs = Math.max(
          MIN_ORBIT_SEGMENT_DURATION_MS,
          parsePositiveInteger(value, options.segmentDurationMs),
        );
        index += 1;
        break;
      case '--segment-gap-ms':
        options.segmentGapMs = parseNonNegativeInteger(value, options.segmentGapMs);
        index += 1;
        break;
      case '--sampling-interval-us':
        options.samplingIntervalUs = parsePositiveInteger(value, options.samplingIntervalUs);
        index += 1;
        break;
      case '--step-interval-ms':
        options.stepIntervalMs = parsePositiveInteger(value, options.stepIntervalMs);
        index += 1;
        break;
      case '--stutter-cadence-multiplier':
        options.stutterCadenceMultiplier = parsePositiveFloat(
          value,
          options.stutterCadenceMultiplier,
        );
        index += 1;
        break;
      case '--stutter-threshold-ms':
        options.stutterThresholdMs = parsePositiveFloat(value, options.stutterThresholdMs);
        index += 1;
        break;
      case '--top-functions':
        options.topFunctionCount = parsePositiveInteger(value, options.topFunctionCount);
        index += 1;
        break;
      case '--trace':
        options.traceEnabled = value !== '0';
        index += 1;
        break;
      case '--warmup-segments':
        options.warmupSegments = parseNonNegativeInteger(value, options.warmupSegments);
        index += 1;
        break;
      case '--warmup-segment-duration-ms':
        options.warmupSegmentDurationMs = parsePositiveInteger(
          value,
          options.warmupSegmentDurationMs,
        );
        index += 1;
        break;
      default:
        break;
    }
  }

  options.segmentDurationMs = Math.max(
    MIN_ORBIT_SEGMENT_DURATION_MS,
    options.segmentDurationMs,
  );

  return options;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseFloat(value) : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

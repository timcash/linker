import assert from 'node:assert/strict';

import {
  clickControl,
  flushPerformanceTelemetry,
  getCameraState,
  getHistoryState,
  getPerformanceSnapshot,
  getTextState,
  openRoute,
  resetPerformanceTelemetry,
  seedPersistedStageSessionRecord,
  waitForCameraLabel,
  type BrowserTestContext,
} from './shared';
import {createPreparedHighZoomPlaneFocusSessionRecord} from './fixtures';
import {
  createPlaneFocusPanPerformanceSample,
  formatPlaneFocusPanPerformanceSummary,
  type PlaneFocusPanPerformanceSample,
  type TestPerformanceCollector,
} from './performance';

type PlaneFocusTraceStep = {
  control: 'pan-down' | 'pan-left' | 'pan-right' | 'pan-up';
  expectedLabel: string;
};

const PLANE_FOCUS_HIGH_ZOOM_START_LABEL = '1:9:3';
const PLANE_FOCUS_HIGH_ZOOM_IDLE_AFTER_STEP_MS = 900;
const PLANE_FOCUS_HIGH_ZOOM_TRACE: PlaneFocusTraceStep[] = [
  {control: 'pan-right', expectedLabel: '2:9:3'},
  {control: 'pan-right', expectedLabel: '3:9:3'},
  {control: 'pan-down', expectedLabel: '3:10:3'},
  {control: 'pan-down', expectedLabel: '3:11:3'},
  {control: 'pan-left', expectedLabel: '2:11:3'},
  {control: 'pan-left', expectedLabel: '1:11:3'},
  {control: 'pan-up', expectedLabel: '1:10:3'},
  {control: 'pan-up', expectedLabel: PLANE_FOCUS_HIGH_ZOOM_START_LABEL},
];

export async function runPlaneFocusHighZoomPerformanceFlow(
  context: BrowserTestContext,
  collector: TestPerformanceCollector,
): Promise<void> {
  const historyOnSample = await runPlaneFocusHighZoomScenario(context, {
    historyTrackingEnabled: true,
    name: 'plane-focus-high-zoom.history-on',
    sessionToken: 'stk-plane-focus-high-zoom-history-on',
  });
  const historyOffSample = await runPlaneFocusHighZoomScenario(context, {
    historyTrackingEnabled: false,
    name: 'plane-focus-high-zoom.history-off',
    sessionToken: 'stk-plane-focus-high-zoom-history-off',
  });

  assert.equal(
    historyOnSample.stageMode,
    '2d-mode',
    'High-zoom plane-focus perf should record in 2d mode when history tracking is on.',
  );
  assert.equal(
    historyOffSample.stageMode,
    '2d-mode',
    'High-zoom plane-focus perf should record in 2d mode when history tracking is off.',
  );
  assert.equal(
    historyOnSample.planeCount,
    1,
    'High-zoom plane-focus perf should stay on a single workplane when history tracking is on.',
  );
  assert.equal(
    historyOffSample.planeCount,
    1,
    'High-zoom plane-focus perf should stay on a single workplane when history tracking is off.',
  );
  assert.ok(
    historyOnSample.frameGapSamples > 0,
    'High-zoom plane-focus perf should capture frame-gap samples when history tracking is on.',
  );
  assert.ok(
    historyOffSample.frameGapSamples > 0,
    'High-zoom plane-focus perf should capture frame-gap samples when history tracking is off.',
  );
  assert.ok(
    historyOnSample.historyHeadStepDelta > 0,
    'High-zoom plane-focus perf should advance history steps when history tracking is on.',
  );
  assert.equal(
    historyOffSample.historyHeadStepDelta,
    0,
    'High-zoom plane-focus perf should not advance history steps when history tracking is off.',
  );

  collector.recordPlaneFocusPan(historyOnSample);
  collector.recordPlaneFocusPan(historyOffSample);
  context.addBrowserLog('perf.sample', formatPlaneFocusPanPerformanceSummary(historyOnSample));
  context.addBrowserLog('perf.sample', formatPlaneFocusPanPerformanceSummary(historyOffSample));
}

async function runPlaneFocusHighZoomScenario(
  context: BrowserTestContext,
  options: {
    historyTrackingEnabled: boolean;
    name: string;
    sessionToken: string;
  },
): Promise<PlaneFocusPanPerformanceSample> {
  const seededSession = createPreparedHighZoomPlaneFocusSessionRecord(options.sessionToken);

  await seedPersistedStageSessionRecord(context.page, seededSession);
  await openRoute(context.page, buildScenarioUrl(context.url, options).toString());
  await waitForCameraLabel(context.page, PLANE_FOCUS_HIGH_ZOOM_START_LABEL);

  const initialCamera = await getCameraState(context.page);
  const initialText = await getTextState(context.page);

  assert.equal(
    initialCamera.label,
    PLANE_FOCUS_HIGH_ZOOM_START_LABEL,
    `${options.name} should start from the seeded high-zoom label.`,
  );
  assert.ok(
    initialText.visibleLabelCount > 0,
    `${options.name} should keep at least one label visible before panning.`,
  );

  await resetPerformanceTelemetry(context.page);
  const beforeHistory = await getHistoryState(context.page);
  const startedAt = Date.now();
  const stepDurationsMs: number[] = [];

  for (const [stepIndex, step] of PLANE_FOCUS_HIGH_ZOOM_TRACE.entries()) {
    const stepStartedAt = Date.now();

    await clickControl(context.page, step.control);
    await waitForCameraLabel(context.page, step.expectedLabel);
    stepDurationsMs.push(Date.now() - stepStartedAt);

    if (stepIndex < PLANE_FOCUS_HIGH_ZOOM_TRACE.length - 1) {
      await waitForMilliseconds(PLANE_FOCUS_HIGH_ZOOM_IDLE_AFTER_STEP_MS);
    }
  }

  await flushPerformanceTelemetry(context.page);

  const durationMs = Date.now() - startedAt;
  const afterHistory = await getHistoryState(context.page);
  const afterPerformance = await getPerformanceSnapshot(context.page);
  const finalCamera = await getCameraState(context.page);

  assert.equal(
    finalCamera.label,
    PLANE_FOCUS_HIGH_ZOOM_START_LABEL,
    `${options.name} should end back at the seeded high-zoom label after the pan loop.`,
  );

  return createPlaneFocusPanPerformanceSample({
    durationMs,
    historyHeadStepDelta: Math.max(0, afterHistory.headStep - beforeHistory.headStep),
    historyTrackingEnabled: options.historyTrackingEnabled,
    idleAfterStepMs: PLANE_FOCUS_HIGH_ZOOM_IDLE_AFTER_STEP_MS,
    name: options.name,
    snapshot: afterPerformance,
    stepDurationsMs,
  });
}

function buildScenarioUrl(
  baseUrl: string,
  options: {
    historyTrackingEnabled: boolean;
    sessionToken: string;
  },
): URL {
  const url = new URL(baseUrl);

  url.searchParams.set('session', options.sessionToken);
  url.searchParams.set('cameraLabel', PLANE_FOCUS_HIGH_ZOOM_START_LABEL);

  if (options.historyTrackingEnabled) {
    url.searchParams.set('historyTracking', '1');
  } else {
    url.searchParams.set('historyTracking', '0');
  }

  return url;
}

async function waitForMilliseconds(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

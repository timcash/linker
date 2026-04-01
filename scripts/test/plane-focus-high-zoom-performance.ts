import assert from 'node:assert/strict';

import {
  clickControl,
  flushPerformanceTelemetry,
  getCameraState,
  getPerformanceSnapshot,
  getTextState,
  openRoute,
  resetPerformanceTelemetry,
  waitForCameraLabel,
  type BrowserTestContext,
} from './shared';
import {
  createPlaneFocusPanPerformanceSample,
  formatPlaneFocusPanPerformanceSummary,
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
  const sample = await runPlaneFocusHighZoomScenario(context, {
    name: 'plane-focus-high-zoom',
  });

  assert.equal(
    sample.stageMode,
    '2d-mode',
    'High-zoom plane-focus perf should record in 2d mode.',
  );
  assert.equal(
    sample.planeCount,
    1,
    'High-zoom plane-focus perf should stay on a single workplane.',
  );
  assert.ok(
    sample.frameGapSamples > 0,
    'High-zoom plane-focus perf should capture frame-gap samples.',
  );

  collector.recordPlaneFocusPan(sample);
  context.addBrowserLog('perf.sample', formatPlaneFocusPanPerformanceSummary(sample));
}

async function runPlaneFocusHighZoomScenario(
  context: BrowserTestContext,
  options: {
    name: string;
  },
){
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
  const afterPerformance = await getPerformanceSnapshot(context.page);
  const finalCamera = await getCameraState(context.page);

  assert.equal(
    finalCamera.label,
    PLANE_FOCUS_HIGH_ZOOM_START_LABEL,
    `${options.name} should end back at the seeded high-zoom label after the pan loop.`,
  );

  return createPlaneFocusPanPerformanceSample({
    durationMs,
    idleAfterStepMs: PLANE_FOCUS_HIGH_ZOOM_IDLE_AFTER_STEP_MS,
    name: options.name,
    snapshot: afterPerformance,
    stepDurationsMs,
  });
}

function buildScenarioUrl(
  baseUrl: string,
  options: {
    name: string;
  },
): URL {
  const url = new URL(baseUrl);

  url.searchParams.set('cameraLabel', PLANE_FOCUS_HIGH_ZOOM_START_LABEL);
  void options;

  return url;
}

async function waitForMilliseconds(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

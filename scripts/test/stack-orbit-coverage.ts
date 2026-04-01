import assert from 'node:assert/strict';

import {
  getPerformanceSnapshot,
  dragStackCameraFullOrbit,
  getLineState,
  getStageState,
  getTextState,
  openRouteWithBootState,
  pressStageModeKey,
  type BrowserTestContext,
} from './shared';
import {createPreparedFiveWorkplaneState} from './fixtures';
import {
  createOrbitPerformanceSample,
  formatOrbitPerformanceSummary,
  type TestPerformanceCollector,
} from './performance';

export async function runStackOrbitCoverageFlow(
  context: BrowserTestContext,
  collector: TestPerformanceCollector,
): Promise<void> {
  await openRouteWithBootState(context.page, context.url, {
    initialState: createPreparedFiveWorkplaneState(),
    strategyPanelMode: 'label-edit',
  });

  await pressStageModeKey(context.page);
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );

  const initialStage = await getStageState(context.page);
  const initialText = await getTextState(context.page);
  const initialLines = await getLineState(context.page);

  assert.equal(
    initialStage.planeCount,
    5,
    'Stack orbit coverage should build a five-workplane plane-stack.',
  );
  assert.equal(
    initialStage.activeWorkplaneId,
    'wp-5',
    'Stack orbit coverage should keep the newest workplane active.',
  );
  assert.ok(
    initialText.visibleLabelCount > 0,
    'Five-workplane stack view should keep labels visible before orbit.',
  );
  assert.ok(
    initialLines.lineVisibleLinkCount > 0,
    'Five-workplane stack view should keep links visible before orbit.',
  );

  const beforePerf = await getPerformanceSnapshot(context.page);

  await dragStackCameraFullOrbit(context.page, {
    durationMs: 2400,
    revolutions: 1,
  });

  const afterPerf = await getPerformanceSnapshot(context.page);
  const orbitedText = await getTextState(context.page);
  const orbitedLines = await getLineState(context.page);

  assert.ok(
    orbitedText.visibleLabelCount > 0,
    'Five-workplane stack view should keep labels visible through a full orbit.',
  );
  assert.ok(
    orbitedLines.lineVisibleLinkCount > 0,
    'Five-workplane stack view should keep links visible through a full orbit.',
  );

  const orbitPerformance = createOrbitPerformanceSample({
    after: afterPerf,
    before: beforePerf,
    durationMs: 2400,
    name: 'stack-orbit-coverage',
  });

  assert.ok(
    orbitPerformance.cpuFrameSamples > 0,
    'Stack orbit coverage should collect at least one CPU frame sample during the orbit.',
  );
  assert.ok(
    orbitPerformance.cpuFrameAvgMs > 0,
    'Stack orbit coverage should report a positive CPU frame average during the orbit.',
  );
  assert.ok(
    orbitPerformance.cpuTextAvgMs > 0,
    'Stack orbit coverage should report a positive CPU text average during the orbit.',
  );
  assert.ok(
    orbitPerformance.cpuDrawAvgMs > 0,
    'Stack orbit coverage should report a positive CPU draw average during the orbit.',
  );
  assert.equal(
    orbitPerformance.stageMode,
    '3d-mode',
    'Stack orbit coverage should record performance in stack view.',
  );
  assert.equal(
    orbitPerformance.planeCount,
    5,
    'Stack orbit coverage should record performance for the five-workplane stack.',
  );

  if (orbitPerformance.gpuTimingEnabled && orbitPerformance.gpuSupported) {
    assert.ok(
      orbitPerformance.gpuFrameSamples > 0,
      'Stack orbit coverage should collect GPU frame samples when GPU timing is supported.',
    );
    assert.ok(
      orbitPerformance.gpuFrameAvgMs !== null,
      'Stack orbit coverage should report a GPU frame average when GPU timing is supported.',
    );
  }

  collector.recordOrbit(orbitPerformance);
  context.addBrowserLog('perf.sample', formatOrbitPerformanceSummary(orbitPerformance));
}

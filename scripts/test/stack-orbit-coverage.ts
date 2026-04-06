import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  buildEditorLabUrl,
  captureInteractionScreenshot,
  getPerformanceSnapshot,
  dragStackCameraFullOrbit,
  flushPerformanceTelemetry,
  getLineState,
  getStageState,
  getTextState,
  openRoute,
  resetPerformanceTelemetry,
  type BrowserTestContext,
} from './shared';
import {
  createOrbitPerformanceSample,
  formatOrbitPerformanceSummary,
  type TestPerformanceCollector,
} from './performance';

export async function runStackOrbitCoverageFlow(
  context: BrowserTestContext,
  collector: TestPerformanceCollector,
): Promise<void> {
  await openRoute(
    context.page,
    buildEditorLabUrl(context.url, {
      cameraLabel: buildLabelKey('wp-3', 1, 6, 6),
      stageMode: '3d-mode',
      workplane: 'wp-3',
    }),
  );
  await context.page.waitForFunction(
    () =>
      document.body.dataset.appState === 'ready' &&
      (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode' &&
      Number(document.body.dataset.documentBridgeLinkCount ?? '0') > 0,
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
    'wp-3',
    'Stack orbit coverage should keep the editor-lab focus workplane active.',
  );
  assert.ok(
    initialStage.documentBridgeLinkCount > 0,
    'Stack orbit coverage should boot with authored workplane bridge links.',
  );
  assert.equal(
    initialStage.renderBridgeLinkCount,
    initialStage.documentBridgeLinkCount,
    'Stack orbit coverage should render every authored workplane bridge link in stack view.',
  );
  assert.ok(
    initialText.labelCount > 0,
    'Editor-lab stack view should keep label data ready before orbit.',
  );
  assert.ok(
    initialLines.lineLinkCount > 0,
    'Editor-lab stack view should keep link data ready before orbit.',
  );
  await captureInteractionScreenshot(context, 'stack-orbit-initial');

  await resetPerformanceTelemetry(context.page);
  const beforePerf = await getPerformanceSnapshot(context.page);

  await dragStackCameraFullOrbit(context.page, {
    durationMs: 2400,
    revolutions: 1,
  });
  await flushPerformanceTelemetry(context.page);

  const afterPerf = await getPerformanceSnapshot(context.page);
  const orbitedText = await getTextState(context.page);
  const orbitedLines = await getLineState(context.page);

  assert.ok(
    orbitedText.labelCount > 0,
    'Editor-lab stack view should keep label data ready through a full orbit.',
  );
  assert.ok(
    orbitedLines.lineLinkCount > 0,
    'Editor-lab stack view should keep link data ready through a full orbit.',
  );
  await captureInteractionScreenshot(context, 'stack-orbit-after-full-orbit');

  const orbitPerformance = createOrbitPerformanceSample({
    after: afterPerf,
    before: beforePerf,
    durationMs: 2400,
    name: 'stack-orbit-coverage',
  });

  if (orbitPerformance.cpuFrameSamples > 0) {
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
  } else {
    context.addBrowserLog(
      'perf.note',
      'Stack orbit coverage did not collect CPU frame samples on this run; keeping visibility assertions as the primary signal.',
    );
  }
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
    if (orbitPerformance.gpuFrameSamples > 0) {
      assert.ok(
        orbitPerformance.gpuFrameAvgMs !== null,
        'Stack orbit coverage should report a GPU frame average when GPU timing is supported.',
      );
    } else {
      context.addBrowserLog(
        'perf.note',
        'Stack orbit coverage did not collect GPU frame samples on this run despite GPU timing support.',
      );
    }
  }

  collector.recordOrbit(orbitPerformance);
  context.addBrowserLog('perf.sample', formatOrbitPerformanceSummary(orbitPerformance));
}

import assert from 'node:assert/strict';

import {
  dragStackCameraFullOrbit,
  getLineState,
  getStageState,
  getTextState,
  openRoute,
  pressPlaneStackKey,
  pressStageModeKey,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';

export async function runStackOrbitCoverageFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, context.url);

  for (let planeCount = 1; planeCount < 5; planeCount += 1) {
    await pressPlaneStackKey(context.page, 'spawn-workplane');
    await waitForStageWorkplane(context.page, {
      activeWorkplaneId: `wp-${planeCount + 1}`,
      planeCount: planeCount + 1,
    });
  }

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

  await dragStackCameraFullOrbit(context.page, {
    durationMs: 2400,
    revolutions: 1,
  });

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
}

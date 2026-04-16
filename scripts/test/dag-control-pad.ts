import assert from 'node:assert/strict';

import {
  buildEmptyDagUrl,
  clickDagButton,
  clickStageModeButton,
  clickWorkplaneButton,
  getStageRouteState,
  getStageState,
  openRoute,
  pressDagKey,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';

const DAG_CONTROL_LAYOUT_FINGERPRINT =
  'wp-1:0:0:0|wp-2:3:1:1|wp-3:1:0:1|wp-4:2:1:1';

export async function runDagControlPadFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, buildEmptyDagUrl(context.url));

  const initialStage = await getStageState(context.page);
  assert.equal(initialStage.stageMode, '2d-mode', 'The DAG control-pad flow should boot in 2d mode.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-1', 'The DAG control-pad flow should boot on the root workplane.');
  assert.equal(initialStage.planeCount, 1, 'The DAG control-pad flow should boot with one root workplane.');
  assert.equal(initialStage.dagRootWorkplaneId, 'wp-1', 'The DAG control-pad flow should export the root DAG workplane.');
  assert.equal(initialStage.dagNodeCount, 1, 'The DAG control-pad flow should start with one DAG node.');
  assert.equal(initialStage.dagEdgeCount, 0, 'The DAG control-pad flow should start with zero DAG edges.');
  assert.deepEqual(
    {
      column: initialStage.dagActiveWorkplaneColumn,
      layer: initialStage.dagActiveWorkplaneLayer,
      row: initialStage.dagActiveWorkplaneRow,
    },
    {column: 0, layer: 0, row: 0},
    'The root workplane should start at rank 0 lane 0 depth 0.',
  );
  assert.equal(initialStage.dagCanSpawnChild, true, 'The empty-root DAG should allow child creation immediately.');
  assert.equal(initialStage.dagCanInsertParent, true, 'The empty-root DAG should allow parent insertion immediately.');
  assert.equal(initialStage.dagCanFocusRoot, false, 'The root workplane should not advertise focus-root while already active.');

  await clickDagButton(context.page, 'spawn-child-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});

  const firstChildStage = await getStageState(context.page);
  assert.equal(firstChildStage.dagNodeCount, 2, 'Spawning a DAG child should add a second workplane node.');
  assert.equal(firstChildStage.dagEdgeCount, 1, 'Spawning a DAG child should add one dependency edge.');
  assert.deepEqual(
    {
      column: firstChildStage.dagActiveWorkplaneColumn,
      layer: firstChildStage.dagActiveWorkplaneLayer,
      row: firstChildStage.dagActiveWorkplaneRow,
    },
    {column: 1, layer: 0, row: 0},
    'The first DAG child should land in the next rank at the first lane.',
  );
  assert.equal(firstChildStage.dagCanFocusRoot, true, 'Selecting a child should enable focus-root.');

  await clickDagButton(context.page, 'focus-root');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 2});
  await pressDagKey(context.page, 'spawn-child-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 3});

  const secondChildStage = await getStageState(context.page);
  assert.equal(secondChildStage.dagNodeCount, 3, 'A second child should add a third DAG node.');
  assert.equal(secondChildStage.dagEdgeCount, 2, 'A second child should add a second dependency edge.');
  assert.deepEqual(
    {
      column: secondChildStage.dagActiveWorkplaneColumn,
      layer: secondChildStage.dagActiveWorkplaneLayer,
      row: secondChildStage.dagActiveWorkplaneRow,
    },
    {column: 1, layer: 1, row: 0},
    'The second root child should fan across the next depth slot of the same rank slice.',
  );

  await clickWorkplaneButton(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 3});

  const selectedChildStage = await getStageState(context.page);
  assert.equal(selectedChildStage.dagCanMoveRankForward, true, 'The first child should be able to move forward into a later rank.');
  assert.equal(selectedChildStage.dagCanMoveRankBackward, false, 'The first child should not move backward onto its parent rank.');

  await clickDagButton(context.page, 'move-rank-forward');
  await clickDagButton(context.page, 'move-lane-down');
  await pressDagKey(context.page, 'move-depth-in');

  const movedChildStage = await getStageState(context.page);
  assert.deepEqual(
    {
      column: movedChildStage.dagActiveWorkplaneColumn,
      layer: movedChildStage.dagActiveWorkplaneLayer,
      row: movedChildStage.dagActiveWorkplaneRow,
    },
    {column: 2, layer: 1, row: 1},
    'Rank, lane, and depth controls should move the active DAG workplane through the rank slice.',
  );
  assert.equal(movedChildStage.dagCanMoveDepthOut, true, 'Moving deeper should enable depth-out.');
  assert.equal(movedChildStage.dagCanMoveLaneUp, true, 'Moving downward should enable lane-up.');

  await clickDagButton(context.page, 'insert-parent-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-4', planeCount: 4});

  const insertedParentStage = await getStageState(context.page);
  assert.equal(insertedParentStage.dagNodeCount, 4, 'Inserting a DAG parent should add a fourth node.');
  assert.equal(insertedParentStage.dagEdgeCount, 3, 'Inserting a DAG parent should replace one incoming edge with a two-edge chain.');
  assert.equal(
    insertedParentStage.dagLayoutFingerprint,
    DAG_CONTROL_LAYOUT_FINGERPRINT,
    'The DAG control-pad flow should export a stable authored layout fingerprint.',
  );
  assert.deepEqual(
    {
      column: insertedParentStage.dagActiveWorkplaneColumn,
      layer: insertedParentStage.dagActiveWorkplaneLayer,
      row: insertedParentStage.dagActiveWorkplaneRow,
    },
    {column: 2, layer: 1, row: 1},
    'The inserted parent should occupy the moved child slot.',
  );

  await pressDagKey(context.page, 'focus-root');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 4});
  assert.deepEqual(
    await getStageRouteState(context.page),
    {
      stageMode: '2d-mode',
      workplaneId: 'wp-1',
    },
    'Focusing the root should keep the route pinned to the root workplane in 2d mode.',
  );

  await clickStageModeButton(context.page, '3d-mode');
  await context.page.waitForFunction(
    () => Number(document.body.dataset.renderBridgeLinkCount ?? '0') === 3,
  );

  const stackStage = await getStageState(context.page);
  const stackRoute = await getStageRouteState(context.page);
  assert.equal(stackStage.stageMode, '3d-mode', 'The DAG control-pad flow should enter 3d mode.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'The DAG control-pad flow should mirror 3d mode into the route.');
  assert.equal(stackRoute.workplaneId, 'wp-1', 'The DAG control-pad flow should keep the root active when entering 3d mode.');
  assert.equal(stackStage.dagVisibleEdgeCount, 3, 'The authored DAG should render the three dependency edges in 3d mode.');
  assert.equal(stackStage.renderBridgeLinkCount, 3, 'Rendered DAG bridge links should match the authored dependency count.');
}

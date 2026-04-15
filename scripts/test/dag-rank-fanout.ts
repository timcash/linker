import assert from 'node:assert/strict';

import {
  buildEmptyDagUrl,
  clickControlRepeatedly,
  clickDagButton,
  clickStageModeButton,
  clickWorkplaneButton,
  getStageRouteState,
  getStageState,
  openRoute,
  pressDagKey,
  pressPlaneStackKey,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';

const RANK_ONE_LAYOUT_FINGERPRINT = [
  'wp-1:0:0:0',
  'wp-2:1:0:0',
  'wp-3:1:1:0',
  'wp-4:1:2:0',
  'wp-5:1:3:0',
].join('|');

const RANK_TWO_LAYOUT_FINGERPRINT = [
  RANK_ONE_LAYOUT_FINGERPRINT,
  'wp-6:2:0:0',
  'wp-7:2:1:0',
  'wp-8:2:2:0',
  'wp-9:2:3:0',
].join('|');

const TWELVE_WORKPLANE_LAYOUT_FINGERPRINT = [
  RANK_TWO_LAYOUT_FINGERPRINT,
  'wp-10:3:0:0',
  'wp-11:3:1:0',
  'wp-12:3:2:0',
].join('|');

export async function runDagRankFanoutFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, buildEmptyDagUrl(context.url));

  const initialStage = await getStageState(context.page);
  assert.equal(initialStage.stageMode, '2d-mode', 'The rank-fanout flow should boot in 2d mode.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-1', 'The rank-fanout flow should boot on the root workplane.');
  assert.equal(initialStage.planeCount, 1, 'The rank-fanout flow should boot with one root workplane.');
  assert.equal(initialStage.dagNodeCount, 1, 'The rank-fanout flow should boot with one DAG node.');
  assert.equal(initialStage.dagEdgeCount, 0, 'The rank-fanout flow should boot with zero DAG edges.');

  for (const step of [
    {spawn: 'button', targetWorkplaneId: 'wp-2', planeCount: 2, position: {column: 1, row: 0, layer: 0}},
    {spawn: 'key', targetWorkplaneId: 'wp-3', planeCount: 3, position: {column: 1, row: 1, layer: 0}},
    {spawn: 'button', targetWorkplaneId: 'wp-4', planeCount: 4, position: {column: 1, row: 2, layer: 0}},
    {spawn: 'key', targetWorkplaneId: 'wp-5', planeCount: 5, position: {column: 1, row: 3, layer: 0}},
  ] as const) {
    await focusRootWorkplane(context.page, step.planeCount - 1);

    if (step.spawn === 'button') {
      await clickDagButton(context.page, 'spawn-child-workplane');
    } else {
      await pressDagKey(context.page, 'spawn-child-workplane');
    }

    await waitForStageWorkplane(context.page, {
      activeWorkplaneId: step.targetWorkplaneId,
      planeCount: step.planeCount,
    });

    assertActiveDagPosition(
      await getStageState(context.page),
      step.position,
      `Root child ${step.targetWorkplaneId} should land in the next open lane of rank 1.`,
    );
  }

  const rankOneStage = await getStageState(context.page);
  assert.equal(rankOneStage.dagNodeCount, 5, 'The rank-fanout flow should build five workplanes after the first fanout.');
  assert.equal(rankOneStage.dagEdgeCount, 4, 'The first fanout should create four root dependency edges.');
  assert.equal(
    rankOneStage.dagLayoutFingerprint,
    RANK_ONE_LAYOUT_FINGERPRINT,
    'The first fanout should fill one downstream rank slice in deterministic lane order.',
  );

  for (const step of [
    {nextCountFromRoot: 1, parentWorkplaneId: 'wp-2', spawn: 'button', targetWorkplaneId: 'wp-6', planeCount: 6, position: {column: 2, row: 0, layer: 0}},
    {nextCountFromRoot: 2, parentWorkplaneId: 'wp-3', spawn: 'key', targetWorkplaneId: 'wp-7', planeCount: 7, position: {column: 2, row: 1, layer: 0}},
    {nextCountFromRoot: 3, parentWorkplaneId: 'wp-4', spawn: 'button', targetWorkplaneId: 'wp-8', planeCount: 8, position: {column: 2, row: 2, layer: 0}},
    {nextCountFromRoot: 4, parentWorkplaneId: 'wp-5', spawn: 'key', targetWorkplaneId: 'wp-9', planeCount: 9, position: {column: 2, row: 3, layer: 0}},
  ] as const) {
    await navigateFromRootToWorkplane(
      context.page,
      step.parentWorkplaneId,
      step.nextCountFromRoot,
      step.planeCount - 1,
    );

    if (step.spawn === 'button') {
      await clickDagButton(context.page, 'spawn-child-workplane');
    } else {
      await pressDagKey(context.page, 'spawn-child-workplane');
    }

    await waitForStageWorkplane(context.page, {
      activeWorkplaneId: step.targetWorkplaneId,
      planeCount: step.planeCount,
    });

    assertActiveDagPosition(
      await getStageState(context.page),
      step.position,
      `${step.parentWorkplaneId} should fan out into the matching lane of rank 2.`,
    );
  }

  const rankTwoStage = await getStageState(context.page);
  assert.equal(rankTwoStage.dagNodeCount, 9, 'The rank-fanout flow should build nine workplanes after the second fanout.');
  assert.equal(rankTwoStage.dagEdgeCount, 8, 'The second fanout should add four more dependency edges.');
  assert.equal(
    rankTwoStage.dagLayoutFingerprint,
    RANK_TWO_LAYOUT_FINGERPRINT,
    'The second fanout should keep the new child fanout aligned across the next rank slice.',
  );

  for (const step of [
    {nextCountFromRoot: 5, parentWorkplaneId: 'wp-6', spawn: 'button', targetWorkplaneId: 'wp-10', planeCount: 10, position: {column: 3, row: 0, layer: 0}},
    {nextCountFromRoot: 6, parentWorkplaneId: 'wp-7', spawn: 'key', targetWorkplaneId: 'wp-11', planeCount: 11, position: {column: 3, row: 1, layer: 0}},
    {nextCountFromRoot: 7, parentWorkplaneId: 'wp-8', spawn: 'button', targetWorkplaneId: 'wp-12', planeCount: 12, position: {column: 3, row: 2, layer: 0}},
  ] as const) {
    await navigateFromRootToWorkplane(
      context.page,
      step.parentWorkplaneId,
      step.nextCountFromRoot,
      step.planeCount - 1,
    );

    if (step.spawn === 'button') {
      await clickDagButton(context.page, 'spawn-child-workplane');
    } else {
      await pressDagKey(context.page, 'spawn-child-workplane');
    }

    await waitForStageWorkplane(context.page, {
      activeWorkplaneId: step.targetWorkplaneId,
      planeCount: step.planeCount,
    });

    assertActiveDagPosition(
      await getStageState(context.page),
      step.position,
      `${step.parentWorkplaneId} should add the third-rank child fanout in deterministic lane order.`,
    );
  }

  const authoredStage = await getStageState(context.page);
  assert.equal(authoredStage.planeCount, 12, 'The rank-fanout flow should reach the full twelve-workplane authoring target.');
  assert.equal(authoredStage.dagNodeCount, 12, 'The rank-fanout flow should export all twelve authored DAG nodes.');
  assert.equal(authoredStage.dagEdgeCount, 11, 'The 1-4-4-3 authored DAG should export eleven dependency edges.');
  assert.equal(
    authoredStage.dagLayoutFingerprint,
    TWELVE_WORKPLANE_LAYOUT_FINGERPRINT,
    'The twelve-workplane build should keep a stable deterministic rank/lane/depth layout fingerprint.',
  );
  assert.equal(authoredStage.dagCanSpawnChild, false, 'Reaching the twelve-workplane cap should disable further child creation.');
  assert.equal(authoredStage.dagCanInsertParent, false, 'Reaching the twelve-workplane cap should disable parent insertion.');

  await pressDagKey(context.page, 'focus-root');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 12});
  await clickStageModeButton(context.page, '3d-mode');
  await clickControlRepeatedly(context.page, 'zoom-out', 1);
  await context.page.waitForFunction(
    () => Number(document.body.dataset.renderBridgeLinkCount ?? '0') === 11,
  );

  const stackStage = await getStageState(context.page);
  const stackRoute = await getStageRouteState(context.page);
  assert.equal(stackStage.stageMode, '3d-mode', 'The rank-fanout flow should enter 3d mode.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'The rank-fanout flow should mirror 3d mode into the route.');
  assert.equal(stackRoute.workplaneId, 'wp-1', 'The rank-fanout flow should keep the root active when entering 3d mode.');
  assert.equal(stackStage.dagVisibleEdgeCount, 11, 'The authored rank-fanout DAG should render all eleven dependency edges in 3d mode.');
  assert.equal(stackStage.renderBridgeLinkCount, 11, 'Rendered DAG bridge links should match the authored dependency count.');
  assert.equal(
    stackStage.dagLayoutFingerprint,
    TWELVE_WORKPLANE_LAYOUT_FINGERPRINT,
    'The 3d authored view should keep the same twelve-workplane layout fingerprint.',
  );
}

async function focusRootWorkplane(
  page: BrowserTestContext['page'],
  planeCount: number,
): Promise<void> {
  const stage = await getStageState(page);

  if (stage.activeWorkplaneId === 'wp-1') {
    return;
  }

  await clickDagButton(page, 'focus-root');
  await waitForStageWorkplane(page, {activeWorkplaneId: 'wp-1', planeCount});
}

async function navigateFromRootToWorkplane(
  page: BrowserTestContext['page'],
  targetWorkplaneId: string,
  nextCountFromRoot: number,
  planeCount: number,
): Promise<void> {
  await focusRootWorkplane(page, planeCount);

  for (let stepIndex = 0; stepIndex < nextCountFromRoot; stepIndex += 1) {
    if (stepIndex % 2 === 0) {
      await clickWorkplaneButton(page, 'select-next-workplane');
    } else {
      await pressPlaneStackKey(page, 'select-next-workplane');
    }
  }

  await waitForStageWorkplane(page, {activeWorkplaneId: targetWorkplaneId, planeCount});
}

function assertActiveDagPosition(
  stage: Awaited<ReturnType<typeof getStageState>>,
  expected: {column: number; layer: number; row: number},
  message: string,
): void {
  assert.deepEqual(
    {
      column: stage.dagActiveWorkplaneColumn,
      layer: stage.dagActiveWorkplaneLayer,
      row: stage.dagActiveWorkplaneRow,
    },
    expected,
    message,
  );
}

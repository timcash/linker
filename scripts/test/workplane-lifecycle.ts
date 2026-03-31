import assert from 'node:assert/strict';

import {
  getCameraState,
  getStageState,
  openPersistedSessionRoute,
  pressPlaneStackKey,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createPreparedSingleWorkplaneSessionRecord} from './fixtures';

type LabelEditInputState = {
  value: string;
  visible: boolean;
};

export async function runWorkplaneLifecycleFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openPersistedSessionRoute(
    context.page,
    context.url,
    createPreparedSingleWorkplaneSessionRecord('stk-workplane-lifecycle'),
  );

  const initialStage = await getStageState(context.page);
  assert.equal(initialStage.stageMode, '2d-mode', 'Workplane lifecycle should begin in plane-focus view.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-1', 'Workplane lifecycle should begin on wp-1.');
  assert.equal(initialStage.planeCount, 1, 'Workplane lifecycle should begin with one workplane.');

  await pressPlaneStackKey(context.page, 'spawn-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});

  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'Spawning should clone the active workplane camera memory into the new workplane.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Spawning should clone the active workplane label edit into the new workplane.',
  );

  await pressPlaneStackKey(context.page, 'delete-active-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 1});
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'Deleting the active trailing workplane should activate the nearest surviving neighbor.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Deleting wp-2 should preserve wp-1 edits.',
  );
}

async function readLabelEditInputState(
  context: BrowserTestContext,
): Promise<LabelEditInputState> {
  return context.page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="label-edit-panel"]');
    const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');

    return {
      value: input?.value ?? '',
      visible:
        panel instanceof HTMLElement &&
        !panel.hidden &&
        window.getComputedStyle(panel).display !== 'none',
    };
  });
}

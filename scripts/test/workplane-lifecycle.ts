import assert from 'node:assert/strict';

import {
  getCameraState,
  getStageState,
  openRouteWithBootState,
  pressPlaneStackKey,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createPreparedSingleWorkplaneState} from './fixtures';

type LabelEditInputState = {
  disabled: boolean;
  value: string;
  visible: boolean;
};

export async function runWorkplaneLifecycleFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRouteWithBootState(context.page, context.url, {
    initialState: createPreparedSingleWorkplaneState(),
    strategyPanelMode: 'label-edit',
  });

  const initialStage = await getStageState(context.page);
  assert.equal(initialStage.stageMode, '2d-mode', 'Workplane lifecycle should begin in plane-focus view.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-1', 'Workplane lifecycle should begin on wp-1.');
  assert.equal(initialStage.planeCount, 1, 'Workplane lifecycle should begin with one workplane.');

  await pressPlaneStackKey(context.page, 'spawn-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});

  assert.equal(
    (await getCameraState(context.page)).label,
    '',
    'Spawning should start the new workplane without a focused demo label.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    '',
    'Spawning should start the new workplane with an empty label-edit input.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).disabled,
    true,
    'Spawning should leave the label editor disabled on an empty workplane.',
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
    const submitButton = document.querySelector<HTMLButtonElement>('[data-testid="label-input-submit"]');

    return {
      disabled:
        !(input instanceof HTMLInputElement) ||
        !(submitButton instanceof HTMLButtonElement) ||
        input.disabled ||
        submitButton.disabled,
      value: input?.value ?? '',
      visible:
        panel instanceof HTMLElement &&
        !panel.hidden &&
        window.getComputedStyle(panel).display !== 'none',
    };
  });
}

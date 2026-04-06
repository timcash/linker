import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  captureInteractionScreenshot,
  clickWorkplaneButton,
  getCameraState,
  getStageState,
  openRouteWithBootState,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createPreparedSingleWorkplaneState} from './fixtures';

type LabelEditInputState = {
  disabled: boolean;
  value: string;
  visible: boolean;
};

type WorkplanePanelState = {
  deleteDisabled: boolean;
  nextDisabled: boolean;
  previousDisabled: boolean;
  spawnDisabled: boolean;
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
  assert.deepEqual(
    await readWorkplanePanelState(context),
    {
      deleteDisabled: true,
      nextDisabled: true,
      previousDisabled: true,
      spawnDisabled: false,
    },
    'The workplane panel should reflect a single active workplane at startup.',
  );
  await captureInteractionScreenshot(context, 'workplane-lifecycle-initial');

  await clickWorkplaneButton(context.page, 'spawn-workplane');
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
  assert.deepEqual(
    await readWorkplanePanelState(context),
    {
      deleteDisabled: false,
      nextDisabled: true,
      previousDisabled: false,
      spawnDisabled: false,
    },
    'The workplane panel should advance focus and update button states after spawning.',
  );
  await captureInteractionScreenshot(context, 'workplane-lifecycle-spawned');

  await clickWorkplaneButton(context.page, 'delete-active-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 1});
  assert.equal(
    (await getCameraState(context.page)).label,
    buildLabelKey('wp-1', 1, 2, 2),
    'Deleting the active trailing workplane should activate the nearest surviving neighbor.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Deleting wp-2 should preserve wp-1 edits.',
  );
  assert.deepEqual(
    await readWorkplanePanelState(context),
    {
      deleteDisabled: true,
      nextDisabled: true,
      previousDisabled: true,
      spawnDisabled: false,
    },
    'Deleting the extra plane should restore the single-workplane control state.',
  );
  await captureInteractionScreenshot(context, 'workplane-lifecycle-deleted');
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

async function readWorkplanePanelState(
  context: BrowserTestContext,
): Promise<WorkplanePanelState> {
  return context.page.evaluate(() => ({
    deleteDisabled:
      document.querySelector<HTMLButtonElement>(
        'button[data-workplane-action="delete-active-workplane"]',
      )?.disabled ?? true,
    nextDisabled:
      document.querySelector<HTMLButtonElement>(
        'button[data-workplane-action="select-next-workplane"]',
      )?.disabled ?? true,
    previousDisabled:
      document.querySelector<HTMLButtonElement>(
        'button[data-workplane-action="select-previous-workplane"]',
      )?.disabled ?? true,
    spawnDisabled:
      document.querySelector<HTMLButtonElement>(
        'button[data-workplane-action="spawn-workplane"]',
      )?.disabled ?? true,
  }));
}

import assert from 'node:assert/strict';

import {
  clickControl,
  getCameraState,
  getStageRouteState,
  getStageState,
  openRoute,
  pressPlaneStackKey,
  showStrategyPanelMode,
  submitFocusedLabelInput,
  waitForCameraLabel,
  waitForPersistedStageSession,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';

type LabelEditInputState = {
  value: string;
  visible: boolean;
};

export async function runSessionRestoreFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, context.url);

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, '2:1:1');
  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '2:2:1');

  await showStrategyPanelMode(context.page, 'label-edit');
  await submitFocusedLabelInput(context.page, 'Alpha');

  await pressPlaneStackKey(context.page, 'spawn-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});

  await clickControl(context.page, 'pan-right');
  await waitForCameraLabel(context.page, '3:2:1');
  await clickControl(context.page, 'pan-down');
  await waitForCameraLabel(context.page, '3:3:1');
  await submitFocusedLabelInput(context.page, 'Vector');

  const routeState = await getStageRouteState(context.page);
  assert.ok(routeState.sessionToken, 'Session restore should expose a persisted session token in the route.');
  assert.equal(routeState.workplaneId, 'wp-2', 'The route should mirror the active workplane before reload.');

  await waitForPersistedStageSession(context.page, routeState.sessionToken);

  const persistedUrl = await context.page.evaluate(() => window.location.href);
  await openRoute(context.page, persistedUrl);

  assert.equal(
    (await getStageState(context.page)).planeCount,
    2,
    'Reloading the persisted route should restore the full workplane count.',
  );
  assert.equal(
    (await getStageState(context.page)).activeWorkplaneId,
    'wp-2',
    'Reloading the persisted route should restore the active workplane.',
  );
  assert.equal(
    (await getCameraState(context.page)).label,
    '3:3:1',
    'Reloading the persisted route should restore active workplane camera memory.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).visible,
    true,
    'Reloading the persisted route should keep the label-edit panel mounted.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Vector',
    'Reloading the persisted route should restore active workplane label edits.',
  );

  await pressPlaneStackKey(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 2});
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'Switching after reload should restore wp-1 camera memory.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Switching after reload should restore wp-1 edits.',
  );

  const workplaneOverrideUrl = new URL(persistedUrl);
  workplaneOverrideUrl.searchParams.set('workplane', 'wp-1');
  await openRoute(context.page, workplaneOverrideUrl.toString());
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 2});
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'A persisted session route should still honor an explicit workplane override.',
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

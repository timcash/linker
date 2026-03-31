import assert from 'node:assert/strict';

import {
  getCameraState,
  getStageRouteState,
  getStageState,
  openPersistedSessionRoute,
  waitForPersistedStageSession,
  type BrowserTestContext,
} from './shared';
import {createPreparedTwoWorkplaneSessionRecord} from './fixtures';

type LabelEditInputState = {
  value: string;
  visible: boolean;
};

export async function runSessionRestoreFlow(
  context: BrowserTestContext,
): Promise<void> {
  const seededSession = createPreparedTwoWorkplaneSessionRecord('stk-session-restore');
  await openPersistedSessionRoute(context.page, context.url, seededSession);

  const routeState = await getStageRouteState(context.page);
  assert.equal(
    routeState.sessionToken,
    seededSession.sessionToken,
    'Session restore should expose the seeded session token in the route.',
  );
  assert.ok(routeState.historyStep !== null, 'Session restore should expose a persisted history step in the route.');
  assert.equal(routeState.workplaneId, 'wp-2', 'The route should mirror the active workplane before reload.');

  await waitForPersistedStageSession(context.page, seededSession.sessionToken);

  const persistedUrl = await context.page.evaluate(() => window.location.href);
  await openPersistedSessionRoute(context.page, persistedUrl, seededSession);

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

  const historyOverrideUrl = new URL(persistedUrl);
  historyOverrideUrl.searchParams.set('history', '0');
  await openPersistedSessionRoute(context.page, historyOverrideUrl.toString(), seededSession, {
    historyStep: 0,
  });
  assert.equal(
    (await getCameraState(context.page)).label,
    '1:1:1',
    'A persisted history route should restore the requested opening history step.',
  );

  const workplaneOverrideUrl = new URL(persistedUrl);
  workplaneOverrideUrl.searchParams.delete('history');
  workplaneOverrideUrl.searchParams.set('workplane', 'wp-1');
  await openPersistedSessionRoute(context.page, workplaneOverrideUrl.toString(), seededSession, {
    historyStep: null,
    workplaneId: 'wp-1',
  });
  assert.equal(
    (await getCameraState(context.page)).label,
    '2:2:1',
    'A persisted session route should still honor an explicit workplane override.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'A persisted session route should restore the overridden workplane label edits.',
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

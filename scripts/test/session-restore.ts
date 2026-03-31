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
  await openPersistedSessionRoute(context.page, context.url, seededSession, {
    historyTrackingEnabled: true,
  });

  const routeState = await getStageRouteState(context.page);
  assert.equal(
    routeState.sessionToken,
    seededSession.sessionToken,
    'Session restore should expose the seeded session token in the route.',
  );
  assert.ok(routeState.historyStep !== null, 'Session restore should expose a persisted history step in the route.');
  assert.equal(routeState.workplaneId, null, 'The route should keep workplane selection out of the URL.');
  assert.equal(routeState.stageMode, null, 'The route should keep stage mode out of the URL.');

  await waitForPersistedStageSession(context.page, seededSession.sessionToken);

  const persistedUrl = await context.page.evaluate(() => window.location.href);
  await openPersistedSessionRoute(context.page, persistedUrl, seededSession, {
    historyTrackingEnabled: true,
  });

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
    historyTrackingEnabled: true,
    historyStep: 0,
  });
  assert.equal(
    (await getCameraState(context.page)).label,
    '1:1:1',
    'A persisted history route should restore the requested opening history step.',
  );

  const latestRoute = await getStageRouteState(context.page);
  assert.equal(latestRoute.workplaneId, null, 'Reloaded session routes should continue to omit workplane state.');
  assert.equal(latestRoute.stageMode, null, 'Reloaded session routes should continue to omit stage mode state.');
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

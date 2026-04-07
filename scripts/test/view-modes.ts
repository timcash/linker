import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  assertOverlayShellPinned,
  captureInteractionScreenshot,
  clickStageModeButton,
  clickWorkplaneButton,
  getCameraState,
  getStageRouteState,
  getStageState,
  getTextState,
  openRouteWithBootState,
  submitFocusedLabelInput,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createPreparedTwoWorkplaneState} from './fixtures';

type LabelEditPanelState = {
  disabled: boolean;
  visible: boolean;
};

type SelectionBoxState = {
  label: string;
  visible: boolean;
};

type StageNavigationPanelState = {
  deleteDisabled: boolean;
  nextDisabled: boolean;
  previousDisabled: boolean;
  spawnDisabled: boolean;
  threeDPressed: boolean;
  twoDPressed: boolean;
};

export async function runViewModesFlow(
  context: BrowserTestContext,
): Promise<void> {
  const seededState = createPreparedTwoWorkplaneState({
    activeWorkplaneId: 'wp-1',
  });
  await openRouteWithBootState(context.page, context.url, {
    initialState: seededState,
    strategyPanelMode: 'label-edit',
  });

  const planeFocusStage = await getStageState(context.page);
  const planeFocusText = await getTextState(context.page);

  assert.equal(planeFocusStage.stageMode, '2d-mode', 'View mode flow should begin in plane-focus view.');
  assert.equal(
    (await readSelectionBoxState(context)).visible,
    true,
    'Plane-focus view should show the selection box.',
  );
  assert.equal(
    (await readLabelEditPanelState(context)).disabled,
    false,
    'Plane-focus view should keep label editing enabled.',
  );
  assert.deepEqual(
    await readStageNavigationPanelState(context),
    {
      deleteDisabled: false,
      nextDisabled: false,
      previousDisabled: true,
      spawnDisabled: false,
      threeDPressed: false,
      twoDPressed: true,
    },
    'The stage panel should reflect a focused 2D view on the first workplane.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'view modes initial',
  });
  await captureInteractionScreenshot(context, 'view-modes-2d-initial');

  await clickStageModeButton(context.page, '3d-mode');
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );

  const stackStage = await getStageState(context.page);
  const stackRoute = await getStageRouteState(context.page);
  const stackCamera = await getCameraState(context.page);
  const stackText = await getTextState(context.page);

  assert.equal(stackStage.stageMode, '3d-mode', 'Slash should enter stack view.');
  assert.equal(stackStage.activeWorkplaneId, 'wp-1', 'Entering stack view should keep the active workplane stable.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'Stack view should mirror stage mode into the route.');
  assert.equal(stackRoute.workplaneId, 'wp-1', 'Stack view should mirror the active workplane into the route.');
  assert.equal(
    stackText.labelCount,
    planeFocusText.labelCount * 2,
    'Plane-focus view should keep rendering limited to the active workplane, while stack view should combine both workplanes.',
  );
  assert.ok(
    stackText.labelCount > planeFocusText.labelCount,
    'Stack view should render more label content than the single-plane view.',
  );
  assert.equal(
    (await readSelectionBoxState(context)).visible,
    false,
    'Stack view should hide the plane-focus selection box.',
  );
  assert.equal(
    (await readLabelEditPanelState(context)).disabled,
    true,
    'Stack view should disable label editing.',
  );
  assert.equal(stackCamera.canMoveLeft, true, 'Stack view should allow orbiting left.');
  assert.equal(stackCamera.canMoveRight, true, 'Stack view should allow orbiting right.');
  assert.equal(stackCamera.canMoveUp, true, 'Stack view should allow orbiting upward.');
  assert.equal(stackCamera.canMoveDown, true, 'Stack view should allow orbiting downward.');
  assert.equal(stackCamera.canZoomIn, true, 'Stack view should allow stack-camera zoom in.');
  assert.equal(stackCamera.canZoomOut, true, 'Stack view should allow stack-camera zoom out.');
  assert.equal(stackCamera.canReset, false, 'Fresh stack view should begin at the default stack-camera orbit.');
  assert.equal(
    (await readStageNavigationPanelState(context)).threeDPressed,
    true,
    'The stage panel should show 3D mode as the active mode.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'view modes 3d',
  });
  await captureInteractionScreenshot(context, 'view-modes-3d-stack');

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});
  const selectedNextWorkplaneRoute = await getStageRouteState(context.page);
  const selectedNextWorkplaneCamera = await getCameraState(context.page);
  assert.equal(
    selectedNextWorkplaneCamera.label,
    buildLabelKey('wp-2', 1, 3, 3),
    'Selecting the next workplane in stack view should restore that workplane camera memory.',
  );
  assert.equal(
    selectedNextWorkplaneCamera.stackCameraAzimuth,
    stackCamera.stackCameraAzimuth,
    'Changing the active workplane should preserve the shared default stack-camera orbit.',
  );
  assert.equal(
    selectedNextWorkplaneCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'Changing the active workplane should preserve the shared default stack-camera elevation.',
  );
  assert.equal(
    selectedNextWorkplaneRoute.workplaneId,
    'wp-2',
    'Selecting a non-default workplane should mirror it into the route.',
  );
  assert.equal(
    (await readStageNavigationPanelState(context)).nextDisabled,
    true,
    'The stage panel should disable moving forward when the last workplane is active.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'view modes next workplane',
  });
  await captureInteractionScreenshot(context, 'view-modes-next-workplane');

  await clickWorkplaneButton(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 2});
  const selectedPreviousWorkplaneCamera = await getCameraState(context.page);
  assert.equal(
    selectedPreviousWorkplaneCamera.label,
    buildLabelKey('wp-1', 1, 2, 2),
    'Selecting the previous workplane in stack view should restore that workplane camera memory.',
  );
  assert.equal(
    selectedPreviousWorkplaneCamera.stackCameraAzimuth,
    stackCamera.stackCameraAzimuth,
    'Changing the active workplane should preserve the shared default stack-camera orbit.',
  );
  assert.equal(
    selectedPreviousWorkplaneCamera.stackCameraElevation,
    stackCamera.stackCameraElevation,
    'Changing the active workplane should preserve the shared default stack-camera elevation.',
  );
  assert.equal(
    (await readStageNavigationPanelState(context)).previousDisabled,
    true,
    'The stage panel should disable moving backward when the first workplane is active again.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'view modes previous workplane',
  });
  await captureInteractionScreenshot(context, 'view-modes-return-first-workplane');

  await clickStageModeButton(context.page, '2d-mode');
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '2d-mode',
  );

  const returnedPlaneFocusStage = await getStageState(context.page);
  const returnedPlaneFocusRoute = await getStageRouteState(context.page);

  assert.equal(returnedPlaneFocusStage.stageMode, '2d-mode', 'Slash should return from stack view to plane-focus view.');
  assert.equal(returnedPlaneFocusStage.activeWorkplaneId, 'wp-1', 'Returning to plane-focus view should keep the selected workplane active.');
  assert.equal(returnedPlaneFocusRoute.stageMode, '2d-mode', 'Plane-focus view should mirror stage mode into the route.');
  assert.equal(returnedPlaneFocusRoute.workplaneId, 'wp-1', 'Plane-focus view should mirror the active workplane into the route.');
  assert.equal(
    (await getCameraState(context.page)).label,
    buildLabelKey('wp-1', 1, 2, 2),
    'Returning to plane-focus view should restore the selected workplane camera target.',
  );
  assert.equal(
    (await readSelectionBoxState(context)).visible,
    true,
    'Returning to plane-focus view should restore the selection box.',
  );
  assert.equal(
    (await readLabelEditPanelState(context)).disabled,
    false,
    'Returning to plane-focus view should re-enable label editing.',
  );

  await submitFocusedLabelInput(context.page, 'Alpha replay');
  assert.equal(
    await readLabelEditInputValue(context),
    'Alpha replay',
    'Editing the focused label should update the label-edit input.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'edit',
    label: 'view modes back to 2d',
  });
  await captureInteractionScreenshot(context, 'view-modes-back-to-2d');
}

async function readLabelEditPanelState(
  context: BrowserTestContext,
): Promise<LabelEditPanelState> {
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
      visible:
        panel instanceof HTMLElement &&
        !panel.hidden &&
        window.getComputedStyle(panel).display !== 'none',
    };
  });
}

async function readLabelEditInputValue(
  context: BrowserTestContext,
): Promise<string> {
  return context.page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
    return input?.value ?? '';
  });
}

async function readSelectionBoxState(
  context: BrowserTestContext,
): Promise<SelectionBoxState> {
  return context.page.evaluate(() => {
    const selectionBox = document.querySelector<HTMLElement>('[data-testid="selection-box"]');

    return {
      label: selectionBox?.dataset.label ?? '',
      visible:
        selectionBox instanceof HTMLElement &&
        !selectionBox.hidden &&
        window.getComputedStyle(selectionBox).display !== 'none',
    };
  });
}

async function readStageNavigationPanelState(
  context: BrowserTestContext,
): Promise<StageNavigationPanelState> {
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
    threeDPressed:
      document
        .querySelector<HTMLButtonElement>('button[data-stage-mode-action="set-3d-mode"]')
        ?.getAttribute('aria-pressed') === 'true',
    twoDPressed:
      document
        .querySelector<HTMLButtonElement>('button[data-stage-mode-action="set-2d-mode"]')
        ?.getAttribute('aria-pressed') === 'true',
  }));
}

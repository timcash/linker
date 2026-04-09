import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  assertOverlayShellPinned,
  captureInteractionScreenshot,
  clickLineStrategyButton,
  clickStageModeButton,
  clickTextStrategyButton,
  clickWorkplaneButton,
  getCameraState,
  getLineState,
  getStageRouteState,
  getStageState,
  getTextState,
  openRouteWithBootState,
  pressNavigationKey,
  pressStrategyKey,
  submitFocusedLabelInput,
  waitForCameraLabel,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createBridgeLinkedFiveWorkplaneState} from './fixtures';

const WP3_CHANGED = buildLabelKey('wp-3', 1, 7, 7);
const WP4_MEMORY = buildLabelKey('wp-4', 1, 3, 10);

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
  const seededState = createBridgeLinkedFiveWorkplaneState();
  await openRouteWithBootState(context.page, context.url, {
    initialState: seededState,
    strategyPanelMode: 'label-edit',
  });

  const planeFocusStage = await getStageState(context.page);
  const planeFocusText = await getTextState(context.page);

  assert.equal(planeFocusStage.stageMode, '2d-mode', 'View mode flow should begin in plane-focus view.');
  assert.equal(
    planeFocusStage.activeWorkplaneId,
    'wp-3',
    'View mode flow should begin on the center workplane.',
  );
  assert.equal(planeFocusStage.planeCount, 5, 'View mode flow should begin with five workplanes.');
  assert.equal(
    planeFocusStage.documentBridgeLinkCount,
    8,
    'The bridge-linked fixture should expose eight document bridge links.',
  );
  assert.equal(
    planeFocusStage.renderBridgeLinkCount,
    0,
    'Plane-focus view should render only the active workplane links.',
  );
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
      previousDisabled: false,
      spawnDisabled: false,
      threeDPressed: false,
      twoDPressed: true,
    },
    'The stage panel should reflect a focused 2D view on the middle workplane.',
  );
  assert.equal(
    (await readLabelEditInputValue(context)),
    'Pivot',
    'The bridge-linked fixture should seed a named focus label for strategy testing.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'view modes initial',
  });
  await captureInteractionScreenshot(context, 'view-modes-2d-initial');

  await clickTextStrategyButton(context.page, 'sdf-soft');
  const softText = await getTextState(context.page);
  assert.equal(softText.textStrategy, 'sdf-soft', 'The text strategy button should switch to the soft text profile.');
  assert.equal(
    (await readStrategyRouteState(context.page)).textStrategy,
    'sdf-soft',
    'Changing the text strategy should persist the selected text mode into the route.',
  );

  await pressStrategyKey(context.page, 'text');
  const restoredText = await getTextState(context.page);
  assert.equal(
    restoredText.textStrategy,
    'sdf-instanced',
    'Shift+T should cycle the text strategy back to the default profile.',
  );
  assert.equal(
    (await readStrategyRouteState(context.page)).textStrategy,
    'sdf-instanced',
    'Cycling back to the default text strategy should also restore the route state.',
  );

  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForCameraLabel(context.page, buildLabelKey('wp-3', 1, 6, 7));
  await pressNavigationKey(context.page, 'ArrowDown');
  await waitForCameraLabel(context.page, WP3_CHANGED);
  assert.equal(
    (await getCameraState(context.page)).label,
    WP3_CHANGED,
    'Changing the plane-focus view should move the active workplane camera target before entering 3D.',
  );

  await clickStageModeButton(context.page, '3d-mode');
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );

  const stackStage = await getStageState(context.page);
  const stackRoute = await getStageRouteState(context.page);
  const stackCamera = await getCameraState(context.page);
  const stackText = await getTextState(context.page);
  const stackLine = await getLineState(context.page);

  assert.equal(stackStage.stageMode, '3d-mode', 'Slash should enter stack view.');
  assert.equal(stackStage.activeWorkplaneId, 'wp-3', 'Entering stack view should keep the active workplane stable.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'Stack view should mirror stage mode into the route.');
  assert.equal(stackRoute.workplaneId, 'wp-3', 'Stack view should mirror the active workplane into the route.');
  assert.equal(
    stackText.labelCount,
    planeFocusText.labelCount * 5,
    'Plane-focus view should keep rendering limited to the active workplane, while stack view should combine all five workplanes.',
  );
  assert.ok(
    stackText.labelCount > planeFocusText.labelCount,
    'Stack view should render more label content than the single-plane view.',
  );
  assert.equal(
    stackStage.renderBridgeLinkCount,
    8,
    'Stack view should render the bridge links between workplanes.',
  );
  assert.ok(
    stackLine.lineLinkCount > stackStage.renderBridgeLinkCount,
    'Stack view should render both local links and bridge links.',
  );
  assert.equal(
    stackCamera.label,
    WP3_CHANGED,
    'Zooming out to 3D mode should preserve the changed workplane view memory.',
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

  await clickLineStrategyButton(context.page, 'arc-links');
  const arcLine = await getLineState(context.page);
  assert.equal(
    arcLine.lineStrategy,
    'arc-links',
    'The line strategy button should switch the rendered link curve style in stack view.',
  );
  assert.equal(
    arcLine.lineLinkCount,
    stackLine.lineLinkCount,
    'Changing the line strategy should not change the number of rendered links.',
  );
  assert.notEqual(
    arcLine.curveFingerprint,
    stackLine.curveFingerprint,
    'Changing the line strategy should alter the rendered bridge-link geometry.',
  );
  assert.equal(
    (await readStrategyRouteState(context.page)).lineStrategy,
    'arc-links',
    'Changing the line strategy should persist the selected line mode into the route.',
  );

  await pressStrategyKey(context.page, 'line');
  const orbitLine = await getLineState(context.page);
  assert.equal(
    orbitLine.lineStrategy,
    'orbit-links',
    'Shift+L should cycle the line strategy to the orbit profile.',
  );
  assert.notEqual(
    orbitLine.curveFingerprint,
    arcLine.curveFingerprint,
    'Cycling the line strategy should continue to update the rendered bridge-link geometry.',
  );
  assert.equal(
    (await readStrategyRouteState(context.page)).lineStrategy,
    'orbit-links',
    'Cycling the line strategy should keep the route synchronized with the active line mode.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'edit',
    label: 'view modes orbit links',
  });
  await captureInteractionScreenshot(context, 'view-modes-3d-orbit-links');

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-4', planeCount: 5});
  const selectedNextWorkplaneRoute = await getStageRouteState(context.page);
  const selectedNextWorkplaneCamera = await getCameraState(context.page);
  assert.equal(
    selectedNextWorkplaneCamera.label,
    WP4_MEMORY,
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
    'wp-4',
    'Selecting a non-default workplane should mirror it into the route.',
  );
  assert.equal(
    (await readStageNavigationPanelState(context)).nextDisabled,
    false,
    'The stage panel should keep forward navigation available while there are later workplanes.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'view modes next workplane',
  });
  await captureInteractionScreenshot(context, 'view-modes-next-workplane');

  await clickWorkplaneButton(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 5});
  const selectedPreviousWorkplaneCamera = await getCameraState(context.page);
  assert.equal(
    selectedPreviousWorkplaneCamera.label,
    WP3_CHANGED,
    'Returning to the active workplane in stack view should restore the changed workplane camera memory.',
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
    false,
    'The stage panel should keep backward navigation available while earlier workplanes remain.',
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
  assert.equal(returnedPlaneFocusStage.activeWorkplaneId, 'wp-3', 'Returning to plane-focus view should keep the selected workplane active.');
  assert.equal(returnedPlaneFocusRoute.stageMode, '2d-mode', 'Plane-focus view should mirror stage mode into the route.');
  assert.equal(returnedPlaneFocusRoute.workplaneId, 'wp-3', 'Plane-focus view should mirror the active workplane into the route.');
  assert.equal(
    (await getCameraState(context.page)).label,
    WP3_CHANGED,
    'Returning to plane-focus view should restore the changed workplane camera target.',
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

  await submitFocusedLabelInput(context.page, 'Pivot replay');
  assert.equal(
    await readLabelEditInputValue(context),
    'Pivot replay',
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

async function readStrategyRouteState(
  page: BrowserTestContext['page'],
): Promise<{lineStrategy: string | null; textStrategy: string | null}> {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    return {
      lineStrategy: url.searchParams.get('lineStrategy'),
      textStrategy: url.searchParams.get('textStrategy'),
    };
  });
}

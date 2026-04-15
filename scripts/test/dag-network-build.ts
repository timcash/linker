import assert from 'node:assert/strict';

import {
  buildEmptyDagUrl,
  captureInteractionScreenshot,
  clickControlRepeatedly,
  clickDagButton,
  clickEditorAction,
  clickEditorShortcut,
  clickLineStrategyButton,
  clickStageModeButton,
  clickTextStrategyButton,
  clickWorkplaneButton,
  getCameraState,
  getEditorState,
  getLineState,
  getStageRouteState,
  getStageState,
  getTextState,
  openRoute,
  pressDagKey,
  pressEditorKey,
  pressNavigationKey,
  pressPlaneStackKey,
  pressStageModeKey,
  pressStrategyKey,
  submitFocusedLabelInput,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';

const ROOT_NAME = 'Root Router';
const FIREWALL_NAME = 'Firewall';
const CHILD_NAME = 'DMZ';
const CORE_NAME = 'Core Router';
const STORAGE_NAME = 'Storage';

export async function runDagNetworkBuildFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(context.page, buildEmptyDagUrl(context.url));

  const initialStage = await getStageState(context.page);
  const initialEditor = await getEditorState(context.page);
  assert.equal(initialStage.stageMode, '2d-mode', 'The canonical DAG build should start in 2d mode.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-1', 'The canonical DAG build should start on the root workplane.');
  assert.equal(initialStage.planeCount, 1, 'The canonical DAG build should start with one root workplane.');
  assert.equal(initialStage.dagNodeCount, 1, 'The canonical DAG build should start with one DAG node.');
  assert.equal(initialStage.dagEdgeCount, 0, 'The canonical DAG build should start with zero DAG edges.');
  assert.equal(initialStage.workplaneCanDelete, false, 'The root workplane should not be deletable.');
  assert.equal(initialEditor.cursorKind, 'ghost', 'The empty root workplane should begin on a ghost cursor.');
  assert.equal(initialEditor.documentLabelCount, 0, 'The empty root workplane should begin without labels.');
  assert.equal(initialEditor.documentLinkCount, 0, 'The empty root workplane should begin without links.');
  await captureInteractionScreenshot(context, 'dag-network-build-empty-root');

  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  let editor = await getEditorState(context.page);
  assert.equal(editor.cursorKind, 'label', 'Creating from the ghost cursor should focus the new label stack.');
  assert.equal(editor.cursorKey, 'wp-1:1:1:1', 'The first created root label should occupy wp-1:1:1:1.');
  assert.equal(editor.documentLabelCount, 5, 'Creating one label stack should add five local labels.');

  await submitFocusedLabelInput(context.page, ROOT_NAME);
  assert.equal(
    await readLabelInputValue(context.page),
    ROOT_NAME,
    'Renaming the focused root label should update the label input value.',
  );

  await pressNavigationKey(context.page, 'ArrowRight');
  editor = await getEditorState(context.page);
  assert.equal(editor.cursorKind, 'ghost', 'Moving right from the first root label should land on a ghost slot.');
  assert.equal(editor.cursorKey, 'wp-1:1:1:2', 'The next empty slot should be the adjacent root cell.');

  await pressEditorKey(context.page, 'Enter');
  editor = await getEditorState(context.page);
  assert.equal(editor.cursorKind, 'label', 'Enter on a ghost slot should create the new label stack.');
  assert.equal(editor.cursorKey, 'wp-1:1:1:2', 'The new adjacent label should become the focused label.');
  assert.equal(editor.documentLabelCount, 10, 'Creating a second label stack should double the root workplane label count.');

  await submitFocusedLabelInput(context.page, FIREWALL_NAME);
  assert.equal(
    await readLabelInputValue(context.page),
    FIREWALL_NAME,
    'The adjacent root label should accept typed text through the label input.',
  );

  await pressEditorKey(context.page, 'Enter');
  editor = await getEditorState(context.page);
  assert.equal(editor.selectedLabelCount, 1, 'Enter on a focused label should add it to the ranked selection.');

  await pressNavigationKey(context.page, 'ArrowLeft');
  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  editor = await getEditorState(context.page);
  assert.equal(editor.selectedLabelCount, 2, 'The button path should add the second root label to the ranked selection.');

  await clickEditorAction(context.page, 'link-selection');
  editor = await getEditorState(context.page);
  assert.equal(editor.documentLinkCount, 1, 'Link should create a local workplane link between the selected labels.');

  await pressEditorKey(context.page, 'Delete', {shift: true});
  editor = await getEditorState(context.page);
  assert.equal(editor.documentLinkCount, 0, 'Shift+Delete should remove the selected local link.');

  await pressEditorKey(context.page, 'Enter', {shift: true});
  editor = await getEditorState(context.page);
  assert.equal(editor.documentLinkCount, 1, 'Shift+Enter should relink the selected labels.');

  await pressEditorKey(context.page, 'Escape');
  editor = await getEditorState(context.page);
  assert.equal(editor.selectedLabelCount, 0, 'Escape should clear the ranked label selection.');

  await pressNavigationKey(context.page, 'ArrowRight');
  await clickEditorAction(context.page, 'remove-label');
  editor = await getEditorState(context.page);
  assert.equal(editor.cursorKind, 'ghost', 'Removing a label stack should return focus to the ghost slot.');
  assert.equal(editor.cursorKey, 'wp-1:1:1:2', 'Removing the adjacent root label should leave the same cell as a ghost.');
  assert.equal(editor.documentLabelCount, 5, 'Removing a label stack should remove all five local layers for that cell.');
  assert.equal(editor.documentLinkCount, 0, 'Removing a linked label stack should remove its local links.');
  await captureInteractionScreenshot(context, 'dag-network-build-root-2d-crud');

  await clickDagButton(context.page, 'spawn-child-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});
  let stage = await getStageState(context.page);
  assert.equal(stage.dagEdgeCount, 1, 'Spawning a child should add the first DAG dependency.');
  assert.equal(stage.workplaneCanDelete, true, 'A leaf DAG child should be deletable.');

  await pressEditorKey(context.page, 'Enter');
  editor = await getEditorState(context.page);
  assert.equal(editor.cursorKey, 'wp-2:1:1:1', 'The child workplane should also start from an empty root ghost slot.');
  await submitFocusedLabelInput(context.page, CHILD_NAME);

  await clickWorkplaneButton(context.page, 'delete-active-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 1});
  stage = await getStageState(context.page);
  editor = await getEditorState(context.page);
  assert.equal(stage.dagNodeCount, 1, 'Deleting the leaf child should return the DAG to one node.');
  assert.equal(stage.dagEdgeCount, 0, 'Deleting the leaf child should remove its dependency edge.');
  assert.equal(stage.workplaneCanDelete, false, 'The root should remain non-deletable after the leaf child is removed.');
  assert.equal(editor.documentLabelCount, 5, 'Deleting the child should remove its local labels from the document totals.');
  assert.equal(
    await readLabelInputValue(context.page),
    ROOT_NAME,
    'Returning to the root after child deletion should preserve the root label text.',
  );

  await pressDagKey(context.page, 'spawn-child-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});
  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await submitFocusedLabelInput(context.page, CORE_NAME);

  await clickDagButton(context.page, 'focus-root');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 2});

  await clickDagButton(context.page, 'spawn-child-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 3});
  stage = await getStageState(context.page);
  assert.deepEqual(
    {
      column: stage.dagActiveWorkplaneColumn,
      layer: stage.dagActiveWorkplaneLayer,
      row: stage.dagActiveWorkplaneRow,
    },
    {column: 1, layer: 0, row: 1},
    'The second root child should occupy the next lane of rank 1.',
  );

  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await submitFocusedLabelInput(context.page, STORAGE_NAME);

  await pressPlaneStackKey(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 3});
  assert.equal(
    await readLabelInputValue(context.page),
    CORE_NAME,
    'Workplane navigation should restore the child workplane label text when returning to wp-2.',
  );

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 3});
  assert.equal(
    await readLabelInputValue(context.page),
    STORAGE_NAME,
    'Workplane navigation should restore the child workplane label text when returning to wp-3.',
  );

  await clickDagButton(context.page, 'move-rank-forward');
  await pressDagKey(context.page, 'move-lane-down');
  await pressDagKey(context.page, 'move-depth-in');
  stage = await getStageState(context.page);
  assert.deepEqual(
    {
      column: stage.dagActiveWorkplaneColumn,
      layer: stage.dagActiveWorkplaneLayer,
      row: stage.dagActiveWorkplaneRow,
    },
    {column: 2, layer: 1, row: 2},
    'Rank, lane, and depth controls should reposition the active child inside the DAG rails.',
  );

  await clickDagButton(context.page, 'insert-parent-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-4', planeCount: 4});
  stage = await getStageState(context.page);
  assert.equal(stage.dagNodeCount, 4, 'Insert parent should add a fourth workplane node.');
  assert.equal(stage.dagEdgeCount, 3, 'Insert parent should convert the active child edge into a two-edge chain.');
  assert.equal(stage.workplaneCanDelete, false, 'The inserted parent should not be deletable while it still has a child.');

  await pressDagKey(context.page, 'focus-root');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 4});
  await clickStageModeButton(context.page, '3d-mode');
  await context.page.waitForFunction(
    () =>
      document.body.dataset.stageMode === '3d-mode' &&
      Number(document.body.dataset.renderBridgeLinkCount ?? '0') === 3,
  );
  stage = await getStageState(context.page);
  assert.equal(stage.dagVisibleEdgeCount, 3, 'The authored DAG should render all three dependency edges in 3d mode.');
  assert.equal(stage.renderBridgeLinkCount, 3, 'Rendered bridge links should match the authored DAG dependency count.');
  await captureInteractionScreenshot(context, 'dag-network-build-3d-overview');

  const cameraBeforeOrbit = await getCameraState(context.page);
  await clickControlRepeatedly(context.page, 'zoom-out', 1);
  await clickControlRepeatedly(context.page, 'pan-right', 1);
  await pressNavigationKey(context.page, 'ArrowUp');
  const cameraAfterOrbit = await getCameraState(context.page);
  assert.ok(
    cameraAfterOrbit.stackCameraAzimuth !== cameraBeforeOrbit.stackCameraAzimuth ||
      cameraAfterOrbit.stackCameraElevation !== cameraBeforeOrbit.stackCameraElevation,
    '3d camera controls should change the DAG camera azimuth or elevation.',
  );

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  stage = await getStageState(context.page);
  assert.notEqual(
    stage.activeWorkplaneId,
    'wp-1',
    '3d workplane navigation should move selection away from the root.',
  );

  await clickLineStrategyButton(context.page, 'arc-links');
  assert.equal(
    (await getLineState(context.page)).lineStrategy,
    'arc-links',
    'The edit-page line strategy buttons should work while viewing the DAG in 3d mode.',
  );
  await pressStrategyKey(context.page, 'line');
  assert.equal(
    (await getLineState(context.page)).lineStrategy,
    'orbit-links',
    'Shift+L should cycle to the next line strategy.',
  );

  await clickTextStrategyButton(context.page, 'sdf-soft');
  assert.equal(
    (await getTextState(context.page)).textStrategy,
    'sdf-soft',
    'The edit-page text strategy buttons should work while viewing the DAG in 3d mode.',
  );
  await pressStrategyKey(context.page, 'text');
  assert.equal(
    (await getTextState(context.page)).textStrategy,
    'sdf-instanced',
    'Shift+T should cycle back to the default text strategy.',
  );

  await pressDagKey(context.page, 'focus-root');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 4});
  await pressStageModeKey(context.page);
  await context.page.waitForFunction(
    () => document.body.dataset.stageMode === '2d-mode' && document.body.dataset.activeWorkplaneId === 'wp-1',
  );
  stage = await getStageState(context.page);
  const finalEditor = await getEditorState(context.page);
  const finalRoute = await getStageRouteState(context.page);
  assert.equal(stage.stageMode, '2d-mode', 'The canonical DAG build should return to 2d mode.');
  assert.equal(stage.activeWorkplaneId, 'wp-1', 'Returning to 2d mode should restore the root workplane.');
  assert.equal(
    await readLabelInputValue(context.page),
    ROOT_NAME,
    'Returning to the root workplane should restore the edited root label text.',
  );
  assert.equal(finalEditor.documentLabelCount, 15, 'The final zero-data build should persist three authored workplane label stacks.');
  assert.equal(finalEditor.documentLinkCount, 0, 'The final zero-data build should end with no local links after the root cleanup.');
  assert.deepEqual(
    finalRoute,
    {
      stageMode: '2d-mode',
      workplaneId: 'wp-1',
    },
    'Returning to 2d mode should mirror the restored root workplane into the route.',
  );
  await captureInteractionScreenshot(context, 'dag-network-build-return-to-root');
}

async function readLabelInputValue(
  page: BrowserTestContext['page'],
): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]')?.value ?? '';
  });
}

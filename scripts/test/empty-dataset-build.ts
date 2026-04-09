import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  assertOverlayShellPinned,
  buildClassicDemoUrl,
  captureInteractionScreenshot,
  clickLineStrategyButton,
  clickControl,
  clickControlPadToggle,
  clickEditorAction,
  clickEditorShortcut,
  clickStageModeButton,
  clickTextStrategyButton,
  clickWorkplaneButton,
  getCameraState,
  getEditorState,
  getLineState,
  getStageRouteState,
  getStageState,
  getTextState,
  openRouteWithBootState,
  pressEditorKey,
  pressNavigationKey,
  pressPlaneStackKey,
  pressStageModeKey,
  pressStrategyKey,
  submitFocusedLabelInput,
  waitForCameraLabel,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createEmptySingleWorkplaneState} from './fixtures';

const WP1_A = buildLabelKey('wp-1', 1, 1, 1);
const WP1_A_LAYER_2 = buildLabelKey('wp-1', 2, 1, 1);
const WP1_B = buildLabelKey('wp-1', 1, 1, 2);
const WP1_C = buildLabelKey('wp-1', 1, 2, 2);
const WP1_D = buildLabelKey('wp-1', 1, 2, 1);
const WP2_A = buildLabelKey('wp-2', 1, 1, 1);
const WP2_B = buildLabelKey('wp-2', 1, 1, 2);
const WP3_A = buildLabelKey('wp-3', 1, 1, 1);

type LabelEditInputState = {
  disabled: boolean;
  value: string;
  visible: boolean;
};

type EditorActionStates = {
  clearSelectionDisabled: boolean;
  linkSelectionDisabled: boolean;
  removeLabelDisabled: boolean;
  removeLinksDisabled: boolean;
  selectOrCreateDisabled: boolean;
};

export async function runEmptyDatasetBuildFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRouteWithBootState(
    context.page,
    buildClassicDemoUrl(context.url),
    {
      initialState: createEmptySingleWorkplaneState(),
      strategyPanelMode: 'label-edit',
    },
  );

  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'navigate',
    'The empty dataset flow should begin on the navigation control page.',
  );
  assert.equal(
    (await getStageState(context.page)).stageMode,
    '2d-mode',
    'The empty dataset flow should begin in plane-focus view.',
  );
  assert.equal(
    (await getStageState(context.page)).activeWorkplaneId,
    'wp-1',
    'The empty dataset flow should begin on wp-1.',
  );
  assert.equal(
    (await getStageState(context.page)).planeCount,
    1,
    'The empty dataset flow should begin with one workplane.',
  );
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 0,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 0,
  });
  assert.deepEqual(
    await getEditorState(context.page),
    {
      cursorColumn: 1,
      cursorKey: WP1_A,
      cursorKind: 'ghost',
      cursorLayer: 1,
      cursorRow: 1,
      documentLabelCount: 0,
      documentLinkCount: 0,
      selectedLabelCount: 0,
      selectedLabelKeys: '',
    },
    'The empty dataset flow should begin with the editor focused on the first ghost slot.',
  );
  assert.deepEqual(
    await readLabelEditInputState(context),
    {
      disabled: true,
      value: '',
      visible: true,
    },
    'The label editor should stay disabled until the first label exists.',
  );
  assert.deepEqual(
    await getEditorActionStates(context),
    {
      clearSelectionDisabled: true,
      linkSelectionDisabled: true,
      removeLabelDisabled: true,
      removeLinksDisabled: true,
      selectOrCreateDisabled: false,
    },
    'The empty dataset flow should begin with only the create shortcut enabled.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'navigate',
    label: 'empty dataset initial',
  });
  await captureInteractionScreenshot(context, 'empty-dataset-initial');

  await clickControlPadToggle(context.page);
  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'stage',
    'The toggle button should advance from navigate to stage on the empty dataset flow.',
  );
  await clickControlPadToggle(context.page);
  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'edit',
    'The toggle button should advance from stage to edit on the empty dataset flow.',
  );
  await clickControlPadToggle(context.page);
  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'navigate',
    'The toggle button should wrap back to navigate on the empty dataset flow.',
  );

  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 5,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 5,
  });
  assert.deepEqual(
    await readLabelEditInputState(context),
    {
      disabled: false,
      value: WP1_A,
      visible: true,
    },
    'Creating the first label stack should enable the label editor for the focused label.',
  );
  await captureInteractionScreenshot(context, 'empty-dataset-first-stack');

  await submitFocusedLabelInput(context.page, 'Alpha');
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Saving through the label form should persist the edited text.',
  );

  await clickControl(context.page, 'zoom-in');
  await waitForCameraLabel(context.page, WP1_A_LAYER_2);
  await waitForEditorCursor(context, {key: WP1_A_LAYER_2, kind: 'label'});

  await pressNavigationKey(context.page, 'ArrowDown', {shift: true});
  await waitForCameraLabel(context.page, WP1_A);
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});

  await pressNavigationKey(context.page, 'ArrowUp', {shift: true});
  await waitForCameraLabel(context.page, WP1_A_LAYER_2);
  await waitForEditorCursor(context, {key: WP1_A_LAYER_2, kind: 'label'});

  await clickControl(context.page, 'zoom-out');
  await waitForCameraLabel(context.page, WP1_A);
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});

  await clickControl(context.page, 'pan-right');
  await waitForEditorCursor(context, {key: WP1_B, kind: 'ghost'});

  await pressEditorKey(context.page, 'Enter');
  await waitForEditorCursor(context, {key: WP1_B, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 10,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 10,
  });

  await pressNavigationKey(context.page, 'ArrowDown');
  await waitForEditorCursor(context, {key: WP1_C, kind: 'ghost'});

  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await waitForEditorCursor(context, {key: WP1_C, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 15,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 15,
  });

  await clickControl(context.page, 'pan-left');
  await waitForEditorCursor(context, {key: WP1_D, kind: 'ghost'});

  await pressEditorKey(context.page, 'Enter');
  await waitForEditorCursor(context, {key: WP1_D, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 20,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 20,
  });
  await captureInteractionScreenshot(context, 'empty-dataset-four-cells');

  await pressNavigationKey(context.page, 'ArrowUp');
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});

  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForEditorCursor(context, {key: WP1_B, kind: 'label'});

  await clickControl(context.page, 'pan-down');
  await waitForEditorCursor(context, {key: WP1_C, kind: 'label'});

  await clickControl(context.page, 'reset-camera');
  await waitForCameraLabel(context.page, WP1_A);
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Reset should return focus to the original edited label.',
  );

  await pressEditorKey(context.page, 'Enter');
  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    1,
    'Enter should select the focused root label in the no-reset flow.',
  );

  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForEditorCursor(context, {key: WP1_B, kind: 'label'});
  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    2,
    'The select/create button should add a second label to the ranked selection.',
  );

  await clickEditorAction(context.page, 'link-selection');
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 20,
    documentLinkCount: 1,
    lineLinkCount: 1,
    planeCount: 1,
    renderedLabelCount: 20,
  });

  await pressEditorKey(context.page, 'Delete', {shift: true});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 20,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 20,
  });

  await clickEditorAction(context.page, 'clear-selection');
  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    0,
    'The clear button should remove the ranked selection without resetting the page.',
  );

  await pressNavigationKey(context.page, 'ArrowLeft');
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});
  await pressEditorKey(context.page, 'Enter');
  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForEditorCursor(context, {key: WP1_B, kind: 'label'});
  await pressEditorKey(context.page, 'Enter');
  await clickControl(context.page, 'pan-down');
  await waitForEditorCursor(context, {key: WP1_C, kind: 'label'});
  await clickEditorShortcut(context.page, 'toggle-selection-or-create');

  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    3,
    'The no-reset flow should support growing the ranked selection across multiple creation steps.',
  );

  await pressEditorKey(context.page, 'Enter', {shift: true});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 20,
    documentLinkCount: 2,
    lineLinkCount: 2,
    planeCount: 1,
    renderedLabelCount: 20,
  });

  await clickEditorAction(context.page, 'remove-links');
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 20,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 20,
  });

  await pressEditorKey(context.page, 'Escape');
  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    0,
    'Escape should still clear selection after the button-driven unlink step.',
  );

  await clickControl(context.page, 'pan-left');
  await waitForEditorCursor(context, {key: WP1_D, kind: 'label'});

  await clickEditorAction(context.page, 'remove-label');
  await waitForEditorCursor(context, {key: WP1_D, kind: 'ghost'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 15,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 15,
  });

  await clickControl(context.page, 'pan-up');
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});

  await clickGhostSlot(context, WP1_D);
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 20,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 20,
  });

  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForEditorCursor(context, {key: WP1_C, kind: 'label'});

  await pressEditorKey(context.page, 'Delete');
  await waitForEditorCursor(context, {key: WP1_C, kind: 'ghost'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 15,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 15,
  });

  await clickControl(context.page, 'reset-camera');
  await waitForCameraLabel(context.page, WP1_A);
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Reset should still restore the edited root label after keyboard deletes.',
  );

  await clickWorkplaneButton(context.page, 'spawn-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-2',
    documentLabelCount: 15,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 2,
    renderedLabelCount: 0,
  });
  assert.deepEqual(
    await readLabelEditInputState(context),
    {
      disabled: true,
      value: '',
      visible: true,
    },
    'A button-spawned workplane should still begin empty in the shared flow.',
  );
  await waitForEditorCursor(context, {key: WP2_A, kind: 'ghost'});

  await pressPlaneStackKey(context.page, 'spawn-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 3});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-3',
    documentLabelCount: 15,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 3,
    renderedLabelCount: 0,
  });
  await waitForEditorCursor(context, {key: WP3_A, kind: 'ghost'});

  await clickWorkplaneButton(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 3});
  await waitForEditorCursor(context, {key: WP2_A, kind: 'ghost'});

  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await waitForEditorCursor(context, {key: WP2_A, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-2',
    documentLabelCount: 20,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 3,
    renderedLabelCount: 5,
  });

  await submitFocusedLabelInput(context.page, 'Beta');
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Beta',
    'The shared flow should allow saving edits on later workplanes without reloading.',
  );

  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForEditorCursor(context, {key: WP2_B, kind: 'ghost'});
  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await waitForEditorCursor(context, {key: WP2_B, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-2',
    documentLabelCount: 25,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 3,
    renderedLabelCount: 10,
  });
  await submitFocusedLabelInput(context.page, 'Gamma');
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Gamma',
    'The shared flow should support authoring a second label stack on wp-2.',
  );

  await pressNavigationKey(context.page, 'ArrowLeft');
  await waitForEditorCursor(context, {key: WP2_A, kind: 'label'});
  await pressEditorKey(context.page, 'Enter');
  await pressNavigationKey(context.page, 'ArrowRight');
  await waitForEditorCursor(context, {key: WP2_B, kind: 'label'});
  await clickEditorShortcut(context.page, 'toggle-selection-or-create');
  await pressEditorKey(context.page, 'Enter', {shift: true});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-2',
    documentLabelCount: 25,
    documentLinkCount: 1,
    lineLinkCount: 1,
    planeCount: 3,
    renderedLabelCount: 10,
  });

  await pressStrategyKey(context.page, 'text');
  assert.equal(
    (await getTextState(context.page)).textStrategy,
    'sdf-soft',
    'Shift+T should cycle the authored zero-data flow onto the soft text strategy.',
  );
  await clickTextStrategyButton(context.page, 'sdf-instanced');
  assert.equal(
    (await getTextState(context.page)).textStrategy,
    'sdf-instanced',
    'The text strategy button should restore the default text profile in the zero-data flow.',
  );

  await pressPlaneStackKey(context.page, 'select-previous-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 3});
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Switching back with the keyboard should restore wp-1 state from the same browser context.',
  );

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 3});
  await waitForEditorCursor(context, {key: WP2_B, kind: 'label'});
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Gamma',
    'Switching forward with the stage button should restore the latest wp-2 edits from the shared context.',
  );

  await pressPlaneStackKey(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-3', planeCount: 3});
  await waitForEditorCursor(context, {key: WP3_A, kind: 'ghost'});
  assert.equal(
    (await readLabelEditInputState(context)).disabled,
    true,
    'Keyboard navigation to wp-3 should preserve the empty-workplane editing lockout.',
  );

  await clickWorkplaneButton(context.page, 'delete-active-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 2});
  await waitForEditorCursor(context, {key: WP2_B, kind: 'label'});
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Gamma',
    'Deleting wp-3 by button should keep the nearest surviving workplane active.',
  );

  await waitForCameraLabel(context.page, WP2_B);

  await clickStageModeButton(context.page, '3d-mode');
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-2',
    documentLabelCount: 25,
    documentLinkCount: 1,
    lineLinkCount: 1,
    planeCount: 2,
    renderedLabelCount: 25,
  });
  assert.equal(
    (await readLabelEditInputState(context)).disabled,
    true,
    '3D mode should disable label editing even after building data across multiple workplanes.',
  );
  assert.equal(
    (await getCameraState(context.page)).label,
    WP2_B,
    'Entering 3D should keep the changed wp-2 view memory active.',
  );
  const initialStackLine = await getLineState(context.page);
  await clickLineStrategyButton(context.page, 'arc-links');
  const arcStackLine = await getLineState(context.page);
  assert.equal(
    arcStackLine.lineStrategy,
    'arc-links',
    'The line strategy button should restyle the authored wp-2 link in stack view.',
  );
  assert.notEqual(
    arcStackLine.curveFingerprint,
    initialStackLine.curveFingerprint,
    'Changing the line strategy should alter the stack-view line geometry for the authored link.',
  );
  await pressStrategyKey(context.page, 'line');
  assert.equal(
    (await getLineState(context.page)).lineStrategy,
    'orbit-links',
    'Shift+L should cycle the line strategy again inside the zero-data stack view.',
  );
  await captureInteractionScreenshot(context, 'empty-dataset-stack-view');

  await pressStageModeKey(context.page);
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '2d-mode',
  );
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-2',
    documentLabelCount: 25,
    documentLinkCount: 1,
    lineLinkCount: 1,
    planeCount: 2,
    renderedLabelCount: 10,
  });
  assert.equal(
    (await getCameraState(context.page)).label,
    WP2_B,
    'Returning to 2D with the hotkey should restore the changed wp-2 camera target.',
  );
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Gamma',
    'Returning to 2D with the hotkey should restore the focused wp-2 editing state.',
  );

  await pressStageModeKey(context.page);
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );
  await clickStageModeButton(context.page, '2d-mode');
  await context.page.waitForFunction(
    () => (document.body.dataset.stageMode ?? '2d-mode') === '2d-mode',
  );

  await pressPlaneStackKey(context.page, 'delete-active-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-1', planeCount: 1});
  await waitForEditorCursor(context, {key: WP1_A, kind: 'label'});
  await assertSceneCounts(context, {
    activeWorkplaneId: 'wp-1',
    documentLabelCount: 15,
    documentLinkCount: 0,
    lineLinkCount: 0,
    planeCount: 1,
    renderedLabelCount: 15,
  });
  assert.equal(
    (await readLabelEditInputState(context)).value,
    'Alpha',
    'Deleting wp-2 with the hotkey should restore the surviving wp-1 edit history.',
  );
  assert.deepEqual(
    await getStageRouteState(context.page),
    {
      stageMode: '2d-mode',
      workplaneId: 'wp-1',
    },
    'The final shared-state route should point back at wp-1 in plane-focus view.',
  );
  assert.equal(
    (await getCameraState(context.page)).label,
    WP1_A,
    'The final shared-state route should restore the original root label focus.',
  );
  await assertOverlayShellPinned(context.page, {
    expectedPage: 'stage',
    label: 'empty dataset final',
  });
  await captureInteractionScreenshot(context, 'empty-dataset-final');
}

async function assertSceneCounts(
  context: BrowserTestContext,
  expected: {
    activeWorkplaneId: string;
    documentLabelCount: number;
    documentLinkCount: number;
    lineLinkCount: number;
    planeCount: number;
    renderedLabelCount: number;
  },
): Promise<void> {
  const [editor, line, stage, text] = await Promise.all([
    getEditorState(context.page),
    getLineState(context.page),
    getStageState(context.page),
    getTextState(context.page),
  ]);

  assert.equal(
    stage.activeWorkplaneId,
    expected.activeWorkplaneId,
    `Expected the active workplane to be ${expected.activeWorkplaneId}.`,
  );
  assert.equal(stage.planeCount, expected.planeCount, 'Unexpected workplane count.');
  assert.equal(
    editor.documentLabelCount,
    expected.documentLabelCount,
    'Unexpected document label count.',
  );
  assert.equal(
    editor.documentLinkCount,
    expected.documentLinkCount,
    'Unexpected document link count.',
  );
  assert.equal(text.labelCount, expected.renderedLabelCount, 'Unexpected rendered label count.');
  assert.equal(line.lineLinkCount, expected.lineLinkCount, 'Unexpected rendered link count.');
}

async function waitForEditorCursor(
  context: BrowserTestContext,
  expected: {key: string; kind: 'ghost' | 'label'},
): Promise<void> {
  await context.page.waitForFunction(
    ({expectedKey, expectedKind}) =>
      document.body.dataset.editorCursorKey === expectedKey &&
      document.body.dataset.editorCursorKind === expectedKind,
    {},
    {
      expectedKey: expected.key,
      expectedKind: expected.kind,
    },
  );
}

async function clickGhostSlot(
  context: BrowserTestContext,
  ghostKey: string,
): Promise<void> {
  await context.page.waitForSelector(`[data-ghost-key="${ghostKey}"]`);
  await context.page.evaluate((expectedGhostKey) => {
    const button = document.querySelector<HTMLButtonElement>(
      `[data-ghost-key="${expectedGhostKey}"]`,
    );

    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Missing ghost slot ${expectedGhostKey}.`);
    }

    button.click();
  }, ghostKey);
  await waitForEditorCursor(context, {key: ghostKey, kind: 'label'});
}

async function getEditorActionStates(
  context: BrowserTestContext,
): Promise<EditorActionStates> {
  return context.page.evaluate(() => ({
    clearSelectionDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="clear-selection"]')?.disabled ?? true,
    linkSelectionDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="link-selection"]')?.disabled ?? true,
    removeLabelDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="remove-label"]')?.disabled ?? true,
    removeLinksDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="remove-links"]')?.disabled ?? true,
    selectOrCreateDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-shortcut="toggle-selection-or-create"]')?.disabled ?? true,
  }));
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

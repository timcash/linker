import assert from 'node:assert/strict';

import {buildLabelKey} from '../../src/label-key';
import {
  buildEditorLabUrl,
  captureInteractionScreenshot,
  clickControlPadToggle,
  clickEditorAction,
  clickEditorShortcut,
  getEditorState,
  getLineState,
  getStageState,
  getTextState,
  openRoute,
  pressEditorKey,
  pressNavigationKey,
  type BrowserTestContext,
} from './shared';

const EDITOR_LAB_START_LABEL = buildLabelKey('wp-3', 1, 6, 12);
const EDITOR_LAB_NEW_LABEL = buildLabelKey('wp-3', 1, 6, 13);
const EDITOR_LAB_GHOST_CLICK_LABEL = buildLabelKey('wp-3', 1, 6, 14);

export async function runEditorInteractionsFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRoute(
    context.page,
    buildEditorLabUrl(context.url, {
      cameraLabel: EDITOR_LAB_START_LABEL,
    }),
  );

  const initialStage = await getStageState(context.page);
  const initialText = await getTextState(context.page);
  const initialEditor = await getEditorState(context.page);
  const initialLines = await getLineState(context.page);

  assert.equal(initialStage.stageMode, '2d-mode', 'Editor lab should boot in 2d mode.');
  assert.equal(initialStage.controlPadPage, 'navigate', 'Editor lab should boot on the navigation page.');
  assert.equal(initialStage.planeCount, 5, 'Editor lab should expose five workplanes.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-3', 'Editor lab should focus wp-3 by default.');
  assert.equal(
    initialEditor.documentLabelCount >= 1000,
    true,
    'Editor lab should carry at least 1000 labels across the workplane stack.',
  );
  assert.equal(
    initialEditor.cursorKey,
    EDITOR_LAB_START_LABEL,
    'Editor lab should focus the seeded demo label.',
  );
  assert.equal(initialEditor.cursorKind, 'label', 'Editor lab should begin on a real label.');
  assert.equal(initialEditor.selectedLabelCount, 0, 'Editor lab should begin with no selection.');
  assert.deepEqual(
    await getEditorActionStates(context),
    {
      clearSelectionDisabled: true,
      linkSelectionDisabled: true,
      removeLabelDisabled: false,
      selectOrCreateDisabled: false,
      removeLinksDisabled: false,
    },
    'The editor should expose label-focused actions before selection begins.',
  );
  await captureInteractionScreenshot(context, 'editor-initial');

  await clickControlPadToggle(context.page);
  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'stage',
    'The toggle should advance from the navigation page to the stage page.',
  );

  await clickControlPadToggle(context.page);
  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'edit',
    'The toggle should advance from the stage page to the edit page.',
  );

  await clickControlPadToggle(context.page);
  assert.equal(
    (await getStageState(context.page)).controlPadPage,
    'navigate',
    'The toggle should wrap back to the navigation page after the edit page.',
  );

  await pressEditorKey(context.page, 'Enter');

  const selectedRoot = await getEditorState(context.page);
  assert.equal(selectedRoot.selectedLabelCount, 1, 'Enter should select the focused label.');
  assert.equal(
    selectedRoot.selectedLabelKeys,
    EDITOR_LAB_START_LABEL,
    'The first selected label should keep rank 1.',
  );
  assert.equal(
    await countGhostSlots(context),
    4,
    'Selecting a label should show four directional ghost slots.',
  );
  assert.equal(
    (await getEditorActionStates(context)).clearSelectionDisabled,
    false,
    'Selecting a label should enable the clear-selection action.',
  );
  await captureInteractionScreenshot(context, 'editor-selected-root');

  await pressEditorKey(context.page, 'Escape');

  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    0,
    'Escape should clear the ranked selection.',
  );

  await pressEditorKey(context.page, 'Enter');
  await pressNavigationKey(context.page, 'ArrowRight');

  const focusedGhost = await getEditorState(context.page);
  assert.equal(focusedGhost.cursorKind, 'ghost', 'Moving into an empty cell should focus a ghost slot.');
  assert.equal(
    focusedGhost.cursorKey,
    EDITOR_LAB_NEW_LABEL,
    'The rightward ghost should target the next column outside the 12x12 grid.',
  );
  assert.deepEqual(
    await getEditorActionStates(context),
    {
      clearSelectionDisabled: false,
      linkSelectionDisabled: true,
      removeLabelDisabled: true,
      selectOrCreateDisabled: false,
      removeLinksDisabled: true,
    },
    'Ghost focus should switch the panel into creation mode.',
  );
  await captureInteractionScreenshot(context, 'editor-focused-ghost');

  await clickEditorShortcut(context.page, 'toggle-selection-or-create');

  const afterCreateText = await getTextState(context.page);
  const afterCreateEditor = await getEditorState(context.page);
  assert.equal(
    afterCreateText.labelCount,
    initialText.labelCount + 12,
    'Add Label should create a full 12-layer stack on the active workplane.',
  );
  assert.equal(
    afterCreateEditor.cursorKey,
    EDITOR_LAB_NEW_LABEL,
    'Creating from a ghost should focus the new label.',
  );
  assert.equal(afterCreateEditor.cursorKind, 'label', 'Creating from a ghost should produce a real label.');
  await captureInteractionScreenshot(context, 'editor-created-stack');

  await pressEditorKey(context.page, 'Enter');

  const selectedChain = await getEditorState(context.page);
  assert.equal(
    selectedChain.selectedLabelCount,
    2,
    'Selecting the created label should add it to the ranked selection chain.',
  );
  assert.equal(
    selectedChain.selectedLabelKeys,
    `${EDITOR_LAB_START_LABEL}|${EDITOR_LAB_NEW_LABEL}`,
    'Selection order should preserve rank for subsequent linking.',
  );
  assert.equal(
    (await getEditorActionStates(context)).linkSelectionDisabled,
    false,
    'Selecting two labels should enable link-selection in the panel.',
  );
  await captureInteractionScreenshot(context, 'editor-ranked-selection');

  await pressEditorKey(context.page, 'Enter', {shift: true});

  const afterKeyboardLinkLines = await getLineState(context.page);
  assert.equal(
    afterKeyboardLinkLines.lineLinkCount,
    initialLines.lineLinkCount + 1,
    'Shift+Enter should create a directed link across the ranked selection.',
  );
  await captureInteractionScreenshot(context, 'editor-linked-selection');

  await clickEditorAction(context.page, 'remove-links');

  const afterRemoveLinks = await getLineState(context.page);
  assert.equal(
    afterRemoveLinks.lineLinkCount,
    initialLines.lineLinkCount,
    'Remove Links should remove the freshly created selection link.',
  );

  await clickEditorAction(context.page, 'clear-selection');

  assert.equal(
    (await getEditorState(context.page)).selectedLabelCount,
    0,
    'Clear Selection should clear the ranked selection from the panel.',
  );

  assert.equal(
    (await getEditorState(context.page)).cursorKey,
    EDITOR_LAB_NEW_LABEL,
    'The interaction flow should keep the created outer-column label focused before the next ghost click.',
  );

  await clickGhostSlot(context, EDITOR_LAB_GHOST_CLICK_LABEL);

  const afterGhostClickText = await getTextState(context.page);
  const afterGhostClickEditor = await getEditorState(context.page);
  assert.equal(
    afterGhostClickText.labelCount,
    initialText.labelCount + 24,
    'Clicking a ghost slot should create another full 12-layer stack.',
  );
  assert.equal(
    afterGhostClickEditor.cursorKey,
    EDITOR_LAB_GHOST_CLICK_LABEL,
    'Ghost-slot clicks should focus the created label.',
  );
  assert.equal(
    afterGhostClickEditor.cursorKind,
    'label',
    'Ghost-slot clicks should leave the cursor on a real label.',
  );
  await captureInteractionScreenshot(context, 'editor-ghost-click-created');

  await pressNavigationKey(context.page, 'ArrowLeft');
  await pressNavigationKey(context.page, 'ArrowLeft');

  assert.equal(
    (await getEditorState(context.page)).cursorKey,
    EDITOR_LAB_START_LABEL,
    'The interaction flow should navigate back to the original root label.',
  );

  await pressEditorKey(context.page, 'Enter');
  await pressNavigationKey(context.page, 'ArrowRight');
  await pressEditorKey(context.page, 'Enter');
  await pressNavigationKey(context.page, 'ArrowRight');
  await pressEditorKey(context.page, 'Enter');

  const selectedThreeChain = await getEditorState(context.page);
  assert.equal(
    selectedThreeChain.selectedLabelCount,
    3,
    'The editor should support a three-label ranked selection for button-driven linking.',
  );

  await clickEditorAction(context.page, 'link-selection');

  const afterButtonLinkLines = await getLineState(context.page);
  assert.equal(
    afterButtonLinkLines.lineLinkCount,
    initialLines.lineLinkCount + 2,
    'Link Selection should connect the ranked selection in order.',
  );
  await captureInteractionScreenshot(context, 'editor-button-link');

  await pressEditorKey(context.page, 'Delete', {shift: true});

  const afterShiftDeleteLines = await getLineState(context.page);
  assert.equal(
    afterShiftDeleteLines.lineLinkCount,
    initialLines.lineLinkCount,
    'Shift+Delete should remove the ranked-selection links.',
  );

  await pressEditorKey(context.page, 'Delete');

  const afterKeyboardDeleteText = await getTextState(context.page);
  const afterKeyboardDeleteEditor = await getEditorState(context.page);
  assert.equal(
    afterKeyboardDeleteText.labelCount,
    initialText.labelCount + 12,
    'Delete should remove the focused label stack while preserving the earlier created stack.',
  );
  assert.equal(
    afterKeyboardDeleteEditor.cursorKind,
    'ghost',
    'Delete should leave the cursor on the removed label ghost slot.',
  );
  assert.equal(
    afterKeyboardDeleteEditor.cursorKey,
    EDITOR_LAB_GHOST_CLICK_LABEL,
    'Delete should leave the cursor at the removed label coordinate.',
  );

  await pressNavigationKey(context.page, 'ArrowLeft');

  assert.equal(
    (await getEditorState(context.page)).cursorKey,
    EDITOR_LAB_NEW_LABEL,
    'The interaction flow should return to the button-created label before removing it.',
  );

  await clickEditorAction(context.page, 'remove-label');

  const afterButtonDeleteText = await getTextState(context.page);
  const afterButtonDeleteEditor = await getEditorState(context.page);
  assert.equal(
    afterButtonDeleteText.labelCount,
    initialText.labelCount,
    'Remove Label should return the active workplane label count to baseline.',
  );
  assert.equal(
    afterButtonDeleteEditor.cursorKind,
    'ghost',
    'Remove Label should leave the cursor on the removed label ghost slot.',
  );
  assert.equal(
    afterButtonDeleteEditor.selectedLabelCount,
    1,
    'Removing a selected label should prune it from the ranked selection chain.',
  );
  await captureInteractionScreenshot(context, 'editor-final-state');
}

async function countGhostSlots(
  context: BrowserTestContext,
): Promise<number> {
  return context.page.evaluate(
    () => document.querySelectorAll('[data-ghost-key]').length,
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
  await context.page.waitForFunction(
    (expectedGhostKey) =>
      document.body.dataset.editorCursorKey === expectedGhostKey &&
      document.body.dataset.editorCursorKind === 'label',
    {},
    ghostKey,
  );
}

async function getEditorActionStates(
  context: BrowserTestContext,
): Promise<{
  clearSelectionDisabled: boolean;
  linkSelectionDisabled: boolean;
  removeLabelDisabled: boolean;
  selectOrCreateDisabled: boolean;
  removeLinksDisabled: boolean;
}> {
  return context.page.evaluate(() => ({
    clearSelectionDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="clear-selection"]')?.disabled ?? true,
    linkSelectionDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="link-selection"]')?.disabled ?? true,
    removeLabelDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="remove-label"]')?.disabled ?? true,
    selectOrCreateDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-shortcut="toggle-selection-or-create"]')?.disabled ?? true,
    removeLinksDisabled:
      document.querySelector<HTMLButtonElement>('[data-editor-action="remove-links"]')?.disabled ?? true,
  }));
}

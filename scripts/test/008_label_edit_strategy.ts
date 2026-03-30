import assert from 'node:assert/strict';

import {
  FIRST_ROOT_LABEL,
  getCameraState,
  getTextState,
  pressNavigationKey,
  showStrategyPanelMode,
  submitFocusedLabelInput,
  type BrowserTestContext,
} from './shared';

type LabelEditPanelState = {
  hint: string;
  submitDisabled: boolean;
  value: string;
  visible: boolean;
};

export async function runLabelEditStep(context: BrowserTestContext): Promise<void> {
  const beforeCamera = await getCameraState(context.page);
  const beforeText = await getTextState(context.page);

  assert.equal(beforeCamera.label, FIRST_ROOT_LABEL, 'Label edit test should start on the default demo label.');

  await showStrategyPanelMode(context.page, 'label-edit');

  const initialLabelEditPanelState = await readLabelEditPanelState(context);
  assert.equal(initialLabelEditPanelState.visible, true, 'Label edit panel should be visible when selected.');
  assert.equal(initialLabelEditPanelState.submitDisabled, false, 'Label edit form should be enabled in demo mode.');
  assert.equal(initialLabelEditPanelState.hint, `Focused label ${FIRST_ROOT_LABEL}`, 'Label edit form should identify the focused label.');
  assert.equal(initialLabelEditPanelState.value, FIRST_ROOT_LABEL, 'Label edit form should preload the focused label text.');

  await context.page.click('[data-testid="label-input-field"]');
  await pressNavigationKey(context.page, 'ArrowRight');
  assert.equal(
    (await getCameraState(context.page)).label,
    beforeCamera.label,
    'Arrow keys should stay inside the label input while editing text.',
  );

  const nextText = 'Signal';

  await submitFocusedLabelInput(context.page, nextText);

  const afterCamera = await getCameraState(context.page);
  const afterText = await getTextState(context.page);
  const finalLabelEditPanelState = await readLabelEditPanelState(context);

  assert.equal(afterCamera.label, beforeCamera.label, 'Editing the label text should preserve the focused label key.');
  assert.equal(afterText.strategyPanelMode, 'label-edit', 'The label edit panel should stay active after submitting the form.');
  assert.equal(afterText.labelCount, beforeText.labelCount, 'Editing one label should not change the label count.');
  assert.equal(
    afterText.glyphCount,
    beforeText.glyphCount - FIRST_ROOT_LABEL.length + nextText.length,
    'Editing a label should rebuild glyph data for the new text.',
  );
  assert.match(afterText.visibleLabels, /Signal/, 'The edited label text should appear in the visible label sample.');
  assert.equal(finalLabelEditPanelState.value, nextText, 'The label edit form should retain the submitted label text.');
  assert.equal(finalLabelEditPanelState.submitDisabled, false, 'The label edit form should re-enable after rebuilding text.');
  assert.equal(finalLabelEditPanelState.hint, `Focused label ${FIRST_ROOT_LABEL}`, 'The focused label hint should stay aligned with the active demo label.');

  await submitFocusedLabelInput(context.page, FIRST_ROOT_LABEL);
  await showStrategyPanelMode(context.page, 'text');
}

async function readLabelEditPanelState(context: BrowserTestContext): Promise<LabelEditPanelState> {
  return context.page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('[data-testid="label-edit-panel"]');
    const hint = document.querySelector<HTMLElement>('[data-testid="label-input-hint"]');
    const input = document.querySelector<HTMLInputElement>('[data-testid="label-input-field"]');
    const submitButton =
      document.querySelector<HTMLButtonElement>('[data-testid="label-input-submit"]');

    return {
      hint: hint?.textContent ?? '',
      submitDisabled: submitButton?.disabled ?? true,
      value: input?.value ?? '',
      visible:
        panel instanceof HTMLElement &&
        !panel.hidden &&
        window.getComputedStyle(panel).display !== 'none',
    };
  });
}

import assert from 'node:assert/strict';

import {
  type BrowserTestContext,
  getCameraState,
  waitForBrowserUpdate,
} from './shared';

export async function runInputGuardsStep(
  context: BrowserTestContext,
): Promise<void> {
  const baselineCamera = await getCameraState(context.page);

  await context.page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gpu-canvas"]');

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Expected a canvas element.');
    }

    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 12,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await waitForBrowserUpdate(context.page);

  const afterWheel = await getCameraState(context.page);
  assert.equal(
    afterWheel.centerX,
    baselineCamera.centerX,
    'Wheel input should not pan when button-only controls are enabled.',
  );
  assert.equal(
    afterWheel.centerY,
    baselineCamera.centerY,
    'Wheel input should not move the camera when button-only controls are enabled.',
  );
  assert.equal(
    afterWheel.zoom,
    baselineCamera.zoom,
    'Wheel input should not zoom when button-only controls are enabled.',
  );

  await context.page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gpu-canvas"]');

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Expected a canvas element.');
    }

    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 96,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  await waitForBrowserUpdate(context.page);

  const afterCtrlWheel = await getCameraState(context.page);
  assert.equal(
    afterCtrlWheel.zoom,
    baselineCamera.zoom,
    'Ctrl-wheel input should not zoom when button-only controls are enabled.',
  );

  await context.page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="gpu-canvas"]');

    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('Expected a canvas element.');
    }

    canvas.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        clientX: 120,
        clientY: 120,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        clientX: 240,
        clientY: 240,
        bubbles: true,
      }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', {
        pointerId: 1,
        clientX: 240,
        clientY: 240,
        bubbles: true,
      }),
    );
  });

  await waitForBrowserUpdate(context.page);

  const afterDragAttempt = await getCameraState(context.page);
  assert.equal(
    afterDragAttempt.centerX,
    baselineCamera.centerX,
    'Pointer drag should not pan when button-only controls are enabled.',
  );
  assert.equal(
    afterDragAttempt.centerY,
    baselineCamera.centerY,
    'Pointer drag should not move the camera when button-only controls are enabled.',
  );
  assert.equal(
    afterDragAttempt.zoom,
    baselineCamera.zoom,
    'Pointer drag should not affect zoom when button-only controls are enabled.',
  );
}

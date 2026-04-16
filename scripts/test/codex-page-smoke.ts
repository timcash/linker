import assert from 'node:assert/strict';
import type {HTTPRequest} from 'puppeteer';

import type {BrowserTestContext} from './shared';

export async function runCodexPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const codexUrl = new URL('codex/', context.url).toString();
  const {page, pageErrors} = context;
  const bridgeRequests: string[] = [];
  const requestListener = (request: HTTPRequest) => {
    const url = request.url();
    if (url.includes('/api/codex/') || url.includes('/codex-bridge')) {
      bridgeRequests.push(`${request.method()} ${url}`);
    }
  };

  await page.goto(context.url, {waitUntil: 'load'});
  await page.evaluate(() => {
    sessionStorage.removeItem('linker.codex.auth');
    localStorage.removeItem('linker.codex.bridge-mode');
  });

  try {
    page.on('request', requestListener);
    await page.goto(codexUrl, {waitUntil: 'load'});
    await page.waitForSelector('.codex-page-shell');
    await page.waitForSelector('[data-codex-unlock-form]');
    await page.waitForSelector('.site-nav');

    assert.deepEqual(
      pageErrors,
      [],
      `Codex route should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
    );

    const state = await page.evaluate(() => ({
      authText: document.querySelector<HTMLElement>('[data-codex-auth]')?.textContent?.trim() ?? '',
      bridgeText: document.querySelector<HTMLElement>('[data-codex-bridge]')?.textContent?.trim() ?? '',
      hasAppNav: Array.from(document.querySelectorAll('.site-nav a')).some(
        (link) => link.textContent?.trim() === 'Codex',
      ),
      hasAuthLink: Boolean(document.querySelector('.codex-lede a[href="../auth/"]')),
      healthText:
        document.querySelector<HTMLElement>('[data-codex-health]')?.textContent?.trim() ?? '',
      lockMessage:
        document.querySelector<HTMLElement>('[data-codex-unlock-message]')?.textContent?.trim() ?? '',
      modeSummary:
        document.querySelector<HTMLElement>('[data-codex-mode]')?.textContent?.trim() ?? '',
      restartDisabled:
        document.querySelector<HTMLButtonElement>('[data-codex-restart]')?.disabled ?? true,
      statusText:
        document.querySelector<HTMLElement>('[data-codex-status]')?.textContent?.trim() ?? '',
      title: document.title,
      unlockVisible:
        document.querySelector('[data-codex-unlock-form]') instanceof HTMLFormElement,
    }));

    assert.equal(state.title, 'Codex Terminal - Linker', 'The Codex route should set a Linker-specific document title.');
    assert.equal(state.unlockVisible, true, 'The Codex route should render the unlock form.');
    assert.equal(state.hasAppNav, true, 'The Codex route should stay reachable from the shared docs navigation.');
    assert.equal(state.hasAuthLink, true, 'The Codex route should point users to the Auth page for Cloudflare Access.');
    assert.match(state.modeSummary, /auto/i, 'The Codex route should explain the default bridge mode.');
    assert.match(state.authText, /locked/i, 'The Codex route should begin locked.');
    assert.match(state.bridgeText, /127\.0\.0\.1:4173/i, 'The Codex route should expose the current local bridge target while locked.');
    assert.match(state.healthText, /after unlock/i, 'The Codex route should defer bridge health checks until unlock.');
    assert.match(state.lockMessage, /password/i, 'The Codex route should explain the unlock step.');
    assert.equal(state.restartDisabled, true, 'The Codex route should keep restart disabled until unlock.');
    assert.ok(state.statusText.length > 0, 'The Codex route should show connection status copy.');
    assert.deepEqual(
      bridgeRequests,
      [],
      `The locked Codex route should not probe bridge endpoints before unlock: ${bridgeRequests.join('\n')}`,
    );

    await page.click('[data-codex-mode-button="bridge"]');

    const bridgeModeState = await page.evaluate(() => ({
      bridgeText: document.querySelector<HTMLElement>('[data-codex-bridge]')?.textContent?.trim() ?? '',
      modeSummary:
        document.querySelector<HTMLElement>('[data-codex-mode]')?.textContent?.trim() ?? '',
    }));

    assert.match(
      bridgeModeState.modeSummary,
      /local bridge on this computer/i,
      'Bridge mode copy should explain the direct local-bridge path.',
    );
    assert.match(
      bridgeModeState.bridgeText,
      /localhost:4186/i,
      'Bridge mode should target the direct local Codex bridge endpoint.',
    );
  } finally {
    page.off('request', requestListener);
  }
}

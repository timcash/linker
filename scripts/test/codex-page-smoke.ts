import assert from 'node:assert/strict';
import {resolve} from 'node:path';

import type {BrowserTestContext} from './shared';
import {CodexBridgeServer} from '../../server/codex/CodexBridgeServer';

export async function runCodexPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const codexUrl = new URL('codex/', context.url).toString();
  const {page, pageErrors} = context;
  process.env.CODEX_BRIDGE_PASSWORD = 'test-browser-password';
  process.env.CODEX_PUBLIC_ORIGIN = 'https://linker.dialtone.earth';
  const bridgeServer = new CodexBridgeServer({
    host: '127.0.0.1',
    port: 4186,
    publicOrigin: 'https://linker.dialtone.earth',
    staticRoot: resolve(process.cwd(), 'dist'),
    workspaceRoot: process.cwd(),
  });

  await bridgeServer.listen();

  try {
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
    assert.match(state.lockMessage, /password/i, 'The Codex route should explain the unlock step.');
    assert.equal(state.restartDisabled, true, 'The Codex route should keep restart disabled until unlock.');
    assert.ok(state.statusText.length > 0, 'The Codex route should show connection status copy.');
    assert.ok(state.bridgeText.length > 0, 'The Codex route should expose the current bridge origin.');
  } finally {
    await bridgeServer.close();
  }
}

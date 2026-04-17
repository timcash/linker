import path from 'node:path';

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

  try {
    page.on('request', requestListener);
    await page.goto(codexUrl, {waitUntil: 'load'});
    await page.waitForSelector('.codex-page-shell');
    await page.waitForSelector('[data-codex-unlock-button]');
    await page.waitForSelector('.site-nav');

    assert.deepEqual(
      pageErrors,
      [],
      `Codex route should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
    );

    const lockedState = await page.evaluate(() => {
      const metaGrid = document.querySelector<HTMLElement>('.codex-meta-grid');
      const shell = document.querySelector<HTMLElement>('.codex-page-shell');
      const terminalFrame = document.querySelector<HTMLElement>('.codex-terminal-frame');
      return {
        accessText: document.querySelector<HTMLElement>('[data-codex-auth]')?.textContent?.trim() ?? '',
        bridgeText: document.querySelector<HTMLElement>('[data-codex-bridge]')?.textContent?.trim() ?? '',
        codexViewMode: document.body.dataset.codexViewMode ?? '',
        hasAppNav: Array.from(document.querySelectorAll('.site-nav a')).some(
          (link) => link.textContent?.trim() === 'Codex',
        ),
        healthText:
          document.querySelector<HTMLElement>('[data-codex-health]')?.textContent?.trim() ?? '',
        ledeText: document.querySelector<HTMLElement>('.codex-lede')?.textContent?.trim() ?? '',
        lockMessage:
          document.querySelector<HTMLElement>('[data-codex-unlock-message]')?.textContent?.trim() ?? '',
        metaGridColumns: metaGrid ? window.getComputedStyle(metaGrid).gridTemplateColumns.split(' ').length : 0,
        overflowPx: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        restartDisabled:
          document.querySelector<HTMLButtonElement>('[data-codex-restart]')?.disabled ?? true,
        shellHeight: shell?.getBoundingClientRect().height ?? 0,
        statusText:
          document.querySelector<HTMLElement>('[data-codex-status]')?.textContent?.trim() ?? '',
        terminalHeight: terminalFrame?.getBoundingClientRect().height ?? 0,
        title: document.title,
        unlockLabel:
          document.querySelector<HTMLButtonElement>('[data-codex-unlock-button]')?.textContent?.trim() ?? '',
        viewportHeight: window.innerHeight,
        unlockVisible:
          document.querySelector('[data-codex-unlock-button]') instanceof HTMLButtonElement,
      };
    });

    assert.equal(lockedState.title, 'Codex Terminal - Linker', 'The Codex route should set a Linker-specific document title.');
    assert.equal(lockedState.unlockVisible, true, 'The Codex route should render a single Cloudflare unlock button.');
    assert.equal(lockedState.hasAppNav, true, 'The Codex route should stay reachable from the shared docs navigation.');
    assert.match(lockedState.accessText, /cloudflare access required/i, 'The Codex route should explain the single unlock requirement.');
    assert.match(lockedState.unlockLabel, /cloudflare access/i, 'The unlock button should use Cloudflare Access language.');
    assert.match(lockedState.ledeText, /fullscreen xterm terminal/i, 'The Codex route should explain the compact mobile-to-terminal flow.');
    assert.match(lockedState.healthText, /cloudflare access unlock/i, 'The Codex route should defer bridge health checks until Cloudflare Access unlock.');
    assert.match(lockedState.lockMessage, /cloudflare access/i, 'The Codex route should explain the unlock step.');
    assert.equal(lockedState.restartDisabled, true, 'The Codex route should keep restart disabled until unlock.');
    assert.ok(lockedState.statusText.length > 0, 'The Codex route should show connection status copy.');
    assert.equal(lockedState.metaGridColumns, 1, 'The Codex meta cards should collapse to a single column on the mobile smoke viewport.');
    assert.match(lockedState.bridgeText, /127\.0\.0\.1:4173/i, 'The Codex route should expose the current bridge target while locked.');
    assert.equal(lockedState.codexViewMode, 'locked', 'The locked Codex route should expose the locked mobile view mode.');
    assert.ok(lockedState.overflowPx <= 1, `The locked mobile Codex page should fit on one screen. overflow=${lockedState.overflowPx}`);
    assert.ok(lockedState.terminalHeight > lockedState.viewportHeight * 0.45, 'The locked mobile Codex view should preserve a meaningful terminal area.');
    assert.deepEqual(
      bridgeRequests,
      [],
      `The locked Codex route should not probe bridge endpoints before unlock: ${bridgeRequests.join('\n')}`,
    );

    await saveCodexScreenshot(context, 'codex-mobile-locked');

    await page.evaluate(() => {
      const shell = document.querySelector('.codex-page-shell');
      shell?.classList.remove('codex-page-shell--locked');
      shell?.classList.add('codex-page-shell--terminal');
      document.body.dataset.codexViewMode = 'terminal';
      const status = document.querySelector('[data-codex-status]');
      if (status) {
        status.textContent = 'Codex session ready in C:\\Users\\timca\\linker.';
      }
      const auth = document.querySelector('[data-codex-auth]');
      if (auth) {
        auth.textContent = 'Cloudflare Access active.';
      }
      const overlay = document.querySelector<HTMLElement>('[data-codex-lock]');
      if (overlay) {
        overlay.setAttribute('aria-hidden', 'true');
      }
      for (const selector of [
        '[data-codex-connect]',
        '[data-codex-restart]',
        '[data-codex-interrupt]',
        '[data-codex-clear]',
        '[data-codex-lock]',
      ]) {
        const button = document.querySelector<HTMLButtonElement>(selector);
        if (button) {
          button.disabled = false;
        }
      }
    });

    const unlockedState = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.codex-page-shell');
      const topbar = document.querySelector<HTMLElement>('.codex-topbar');
      const metaGrid = document.querySelector<HTMLElement>('.codex-meta-grid');
      const actions = document.querySelector<HTMLElement>('.codex-actions');
      const terminalFrame = document.querySelector<HTMLElement>('.codex-terminal-frame');
      return {
        actionColumns: actions ? window.getComputedStyle(actions).gridTemplateColumns.split(' ').length : 0,
        codexViewMode: document.body.dataset.codexViewMode ?? '',
        metaDisplay: metaGrid ? window.getComputedStyle(metaGrid).display : '',
        overflowPx: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        shellTerminal: shell?.classList.contains('codex-page-shell--terminal') ?? false,
        terminalHeight: terminalFrame?.getBoundingClientRect().height ?? 0,
        topbarDisplay: topbar ? window.getComputedStyle(topbar).display : '',
        viewportHeight: window.innerHeight,
      };
    });

    assert.equal(unlockedState.codexViewMode, 'terminal', 'The unlocked Codex route should expose terminal view mode.');
    assert.equal(unlockedState.shellTerminal, true, 'The unlocked Codex route should enter fullscreen terminal mode.');
    assert.equal(unlockedState.topbarDisplay, 'none', 'The unlocked Codex route should hide the topbar in terminal mode.');
    assert.equal(unlockedState.metaDisplay, 'none', 'The unlocked Codex route should hide the meta grid in terminal mode.');
    assert.equal(unlockedState.actionColumns, 5, 'The unlocked mobile Codex route should float a compact five-button control row.');
    assert.ok(unlockedState.overflowPx <= 1, `The unlocked mobile Codex page should stay within one viewport. overflow=${unlockedState.overflowPx}`);
    assert.ok(unlockedState.terminalHeight >= unlockedState.viewportHeight - 1, 'The unlocked Codex route should let the terminal take the full mobile viewport.');

    await saveCodexScreenshot(context, 'codex-mobile-terminal');
  } finally {
    page.off('request', requestListener);
  }
}

async function saveCodexScreenshot(
  context: BrowserTestContext,
  name: string,
): Promise<void> {
  context.interactionScreenshotCounter += 1;
  const filename = `${String(context.interactionScreenshotCounter).padStart(2, '0')}-${name}.png`;
  const screenshotPath = path.join(context.interactionScreenshotDir, filename);

  await context.page.screenshot({
    fullPage: true,
    path: screenshotPath,
  });
  context.addBrowserLog('artifact.step', `Saved interaction screenshot to ${screenshotPath}`);
}

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {mkdir} from 'node:fs/promises';

import type {Page} from 'puppeteer';

import {DEFAULT_LIVE_SITE_URL} from '../src/remote-config';
import {appendLogEvent, initializeUnifiedLog, resolveUnifiedLogPath} from './logging';
import {launchSmokeBrowser} from './test/smoke';

const args = new Map<string, string | boolean>();

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];

  if (!argument?.startsWith('--')) {
    continue;
  }

  const [key, value] = argument.slice(2).split('=', 2);

  if (value !== undefined) {
    args.set(key, value);
    continue;
  }

  const nextValue = process.argv[index + 1];
  if (nextValue && !nextValue.startsWith('--')) {
    args.set(key, nextValue);
    index += 1;
    continue;
  }

  args.set(key, true);
}

const liveCodexUrl =
  (typeof args.get('url') === 'string' ? String(args.get('url')) : '') ||
  process.env.LINKER_LIVE_CODEX_URL ||
  new URL('codex/', await resolveLiveSiteUrl()).toString();

await initializeUnifiedLog({
  append: process.env.LINKER_APPEND_TEST_LOG === '1',
  cwd: process.cwd(),
  sessionLabel: `Starting live codex smoke test for ${liveCodexUrl}.`,
});

const browser = await launchSmokeBrowser({
  headless: process.env.LINKER_LIVE_TEST_HEADED === '1' ? false : true,
});

try {
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(String(message.text()));
    }
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  });

  await appendLogEvent('test.live.codex.goto', liveCodexUrl, {logPath: resolveUnifiedLogPath()});
  await page.goto(liveCodexUrl, {waitUntil: 'load'});
  await page.waitForSelector('.codex-mail-shell');
  await page.waitForSelector('[data-codex-unlock-button]');
  await page.click('[data-codex-unlock-button]');
  await page.waitForFunction(
    () => (document.body.dataset.codexViewMode ?? '') === 'mailboard',
    {timeout: 120_000},
  );

  await page.waitForFunction(() => {
    const mailbox = document.querySelector('[data-codex-mailbox]')?.textContent ?? '';
    return /@/.test(mailbox);
  }, {timeout: 120_000});
  await page.waitForFunction(
    () => document.querySelectorAll('.codex-thread-row').length > 0,
    {timeout: 120_000},
  );
  await clickElement(page, '.codex-thread-row');
  await page.waitForFunction(() => {
    const title = document.querySelector('.codex-thread-detail-title')?.textContent?.trim() ?? '';
    return title.length > 0;
  }, {timeout: 120_000});

  const initialState = await page.evaluate(() => ({
    authText: document.querySelector('[data-codex-auth]')?.textContent?.trim() ?? '',
    currentView: document.querySelector('[data-codex-view]')?.textContent?.trim() ?? '',
    mailboxText: document.querySelector('[data-codex-mailbox]')?.textContent?.trim() ?? '',
    statusText: document.querySelector('[data-codex-status]')?.textContent?.trim() ?? '',
    threadCount: document.querySelectorAll('.codex-thread-row').length,
  }));

  assert.match(initialState.mailboxText, /@/i, 'The hosted codex page should show a live mailbox address.');
  assert.match(initialState.currentView, /^Codex$/i, 'The hosted codex page should unlock into Codex.');
  assert.match(initialState.authText, /cloudflare access ready|connected to this computer/i, 'The hosted codex page should report an unlocked auth state.');
  assert.ok(initialState.threadCount >= 1, 'The hosted codex page should render at least one thread row.');

  await clickElement(page, '[data-codex-view-button="done"]');
  await page.waitForFunction(() => {
    return (document.querySelector('[data-codex-view]')?.textContent?.trim() ?? '') === 'Done';
  }, {timeout: 60_000});

  await clickElement(page, '[data-codex-view-button="codex"]');
  await page.waitForFunction(() => {
    return (document.querySelector('[data-codex-view]')?.textContent?.trim() ?? '') === 'Codex';
  }, {timeout: 60_000});
  await page.waitForFunction(
    () => document.querySelectorAll('.codex-thread-row').length > 0,
    {timeout: 120_000},
  );
  await page.waitForFunction(() => {
    const title = document.querySelector('.codex-thread-detail-title')?.textContent?.trim() ?? '';
    return title.length > 0;
  }, {timeout: 120_000});

  const liveQuery = await pickLiveSearchQuery(page);
  if (liveQuery) {
    await page.click('[data-codex-search-input]', {clickCount: 3});
    await page.type('[data-codex-search-input]', liveQuery);
    await clickElement(page, '[data-codex-search-submit]');
    await page.waitForFunction(
      (expectedQuery) => {
        const input = document.querySelector<HTMLInputElement>('[data-codex-search-input]');
        const status = document.querySelector('[data-codex-status]')?.textContent ?? '';
        return input?.value === expectedQuery && /matching thread|loaded|search/i.test(status);
      },
      {timeout: 60_000},
      liveQuery,
    );

    await clickElement(page, '[data-codex-clear-search]');
    await page.waitForFunction(() => {
      const input = document.querySelector<HTMLInputElement>('[data-codex-search-input]');
      return input?.value === '';
    }, {timeout: 60_000});
    await page.waitForFunction(
      () => document.querySelectorAll('.codex-thread-row').length > 0,
      {timeout: 120_000},
    );
    await page.waitForFunction(() => {
      const title = document.querySelector('.codex-thread-detail-title')?.textContent?.trim() ?? '';
      return title.length > 0;
    }, {timeout: 120_000});
  }

  const finalState = await page.evaluate(() => ({
    currentView: document.querySelector('[data-codex-view]')?.textContent?.trim() ?? '',
    detailTitle: document.querySelector('.codex-thread-detail-title')?.textContent?.trim() ?? '',
    statusText: document.querySelector('[data-codex-status]')?.textContent?.trim() ?? '',
    threadCount: document.querySelectorAll('.codex-thread-row').length,
  }));

  assert.match(finalState.currentView, /^Codex$/i, 'The hosted codex page should return to Codex after the view smoke.');
  assert.ok(finalState.detailTitle.length > 0, 'The hosted codex page should load a thread detail after selecting a row.');
  assert.ok(finalState.threadCount >= 1, 'The hosted codex page should still have codex rows after the smoke interactions.');

  const screenshotDir = path.resolve(process.cwd(), 'artifacts', 'test-screenshots');
  await mkdir(screenshotDir, {recursive: true});
  const screenshotPath = path.join(screenshotDir, 'live-codex-smoke.png');
  await page.screenshot({
    path: screenshotPath,
    fullPage: true,
  });
  await appendLogEvent('test.live.codex.artifact', `Saved live codex screenshot to ${screenshotPath}`, {
    logPath: resolveUnifiedLogPath(),
  });

  assert.deepEqual(consoleErrors, [], `Unexpected console errors on hosted codex page:\n${consoleErrors.join('\n')}`);
  assert.deepEqual(pageErrors, [], `Unexpected page errors on hosted codex page:\n${pageErrors.join('\n')}`);

  console.log('Live hosted codex smoke test passed.');
  console.log(`URL: ${liveCodexUrl}`);
  console.log(`Mailbox: ${initialState.mailboxText}`);
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  await appendLogEvent('test.live.codex.failure', message, {logPath: resolveUnifiedLogPath()});
  throw error;
} finally {
  await browser.close();
}

async function pickLiveSearchQuery(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const threadText = document.querySelector('.codex-thread-row')?.textContent ?? '';
    const tokens = threadText
      .split(/[^A-Za-z0-9@._-]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4);

    const preferred = tokens.find((token) => /@/.test(token))
      ?? tokens.find((token) => /^[A-Za-z][A-Za-z0-9._-]+$/u.test(token))
      ?? '';

    return preferred;
  });
}

async function clickElement(page: Page, selector: string): Promise<void> {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!(target instanceof HTMLElement)) {
      throw new Error(`Missing element for selector ${targetSelector}`);
    }

    target.click();
  }, selector);
}

async function resolveLiveSiteUrl(): Promise<string> {
  if (process.env.LINKER_LIVE_URL) {
    return normalizeBaseUrl(process.env.LINKER_LIVE_URL);
  }

  const remoteUrl = await readGitRemoteUrl().catch(() => '');
  const derivedUrl = deriveGitHubPagesUrl(remoteUrl);
  if (derivedUrl) {
    return normalizeBaseUrl(derivedUrl);
  }

  return normalizeBaseUrl(DEFAULT_LIVE_SITE_URL);
}

async function readGitRemoteUrl(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('git', ['config', '--get', 'remote.origin.url'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error((stderr || stdout || `git exited with status ${code}`).trim()));
    });
  });
}

function deriveGitHubPagesUrl(remoteUrl: string): string {
  const match = String(remoteUrl || '').trim().match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/i);
  if (!match) {
    return '';
  }

  const owner = match[1];
  const repo = match[2];
  if (!owner || !repo) {
    return '';
  }

  return `https://${owner}.github.io/${repo}/`;
}

function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/?$/u, '/');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

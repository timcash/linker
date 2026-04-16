import assert from 'node:assert/strict';

import type {BrowserTestContext} from './shared';

export async function runLogsPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const appUrl = new URL(context.url);
  appUrl.search = '';
  appUrl.searchParams.set('onboarding', '0');

  await context.page.goto(appUrl.toString(), {waitUntil: 'load'});
  await context.page.waitForFunction(
    () => document.body.dataset.appState === 'ready',
    {timeout: 30_000},
  );

  await context.page.evaluate(() => {
    const store = window.__LINKER_BROWSER_LOG_STORE__;

    if (!store) {
      throw new Error('Missing browser log store.');
    }

    store.record('info', 'logs-smoke info row', {stack: new Error().stack});
    store.record('warn', 'logs-smoke warn row', {stack: new Error().stack});
  });

  const logsUrl = new URL('logs/', context.url).toString();
  context.addBrowserLog('test', `Opening logs route ${logsUrl}.`);
  await context.page.goto(logsUrl, {waitUntil: 'load'});
  await context.page.waitForSelector('[data-testid="logs-page"]');
  await context.page.waitForFunction(
    () => document.body.dataset.logsReady === 'true',
    {timeout: 20_000},
  );
  await context.page.waitForSelector('.site-nav');

  const initialState = await context.page.evaluate(() => ({
    commandHistoryCount: Number(document.body.dataset.logsCommandHistoryCount ?? '0'),
    entryCount: Number(document.body.dataset.logsEntryCount ?? '0'),
    followEnabled: document.body.dataset.logsFollowEnabled === 'true',
    hasLogsNav: Array.from(document.querySelectorAll('.site-nav a')).some(
      (link) => link.textContent?.trim() === 'Logs',
    ),
    title: document.title,
    visibleCount: Number(document.body.dataset.logsVisibleCount ?? '0'),
  }));

  assert.equal(initialState.title, 'Linker Logs', 'The logs route should set a Linker-specific document title.');
  assert.equal(initialState.hasLogsNav, true, 'The logs route should stay reachable from the shared docs navigation.');
  assert.ok(initialState.entryCount >= 3, 'The logs route should load stored browser history, not an empty terminal.');
  assert.ok(initialState.visibleCount >= 3, 'The logs route should show matching rows on first load.');
  assert.equal(initialState.followEnabled, false, 'The logs route should begin with follow mode turned off.');
  assert.equal(initialState.commandHistoryCount, 0, 'The logs route should begin before any CLI commands are entered.');

  await runLogsCommand(context, 'source main.ts');
  await context.page.waitForFunction(
    () =>
      document.body.dataset.logsFilterSource === 'main.ts' &&
      Number(document.body.dataset.logsVisibleCount ?? '0') >= 1,
    {timeout: 10_000},
  );

  await runLogsCommand(context, 'reset');
  await context.page.waitForFunction(
    () =>
      document.body.dataset.logsFilterSource === '' &&
      document.body.dataset.logsFilterQuery === '' &&
      document.body.dataset.logsFilterLevel === 'all',
    {timeout: 10_000},
  );

  await runLogsCommand(context, 'grep logs-smoke');
  await context.page.waitForFunction(
    () =>
      document.body.dataset.logsFilterQuery === 'logs-smoke' &&
      Number(document.body.dataset.logsVisibleCount ?? '0') === 2,
    {timeout: 10_000},
  );

  await runLogsCommand(context, 'level warn');
  await context.page.waitForFunction(
    () =>
      document.body.dataset.logsFilterLevel === 'warn' &&
      Number(document.body.dataset.logsVisibleCount ?? '0') === 1,
    {timeout: 10_000},
  );

  await runLogsCommand(context, 'follow on');
  await context.page.waitForFunction(
    () => document.body.dataset.logsFollowEnabled === 'true',
    {timeout: 10_000},
  );

  await context.page.evaluate(() => {
    const store = window.__LINKER_BROWSER_LOG_STORE__;

    if (!store) {
      throw new Error('Missing browser log store.');
    }

    store.record('warn', 'logs-smoke follow row', {stack: new Error().stack});
  });
  await context.page.waitForFunction(
    () =>
      Number(document.body.dataset.logsEntryCount ?? '0') >= 4 &&
      Number(document.body.dataset.logsVisibleCount ?? '0') === 2,
    {timeout: 10_000},
  );

  const finalState = await context.page.evaluate(() => ({
    commandHistoryCount: Number(document.body.dataset.logsCommandHistoryCount ?? '0'),
    entryCount: Number(document.body.dataset.logsEntryCount ?? '0'),
    filterLevel: document.body.dataset.logsFilterLevel ?? '',
    filterQuery: document.body.dataset.logsFilterQuery ?? '',
    filterSource: document.body.dataset.logsFilterSource ?? '',
    followEnabled: document.body.dataset.logsFollowEnabled === 'true',
    lastCommand: document.body.dataset.logsLastCommand ?? '',
    visibleCount: Number(document.body.dataset.logsVisibleCount ?? '0'),
  }));

  assert.equal(finalState.filterSource, '', 'The logs route should clear the source filter after reset.');
  assert.equal(finalState.filterQuery, 'logs-smoke', 'The logs route should keep the grep filter active.');
  assert.equal(finalState.filterLevel, 'warn', 'The logs route should keep the warn-level filter active.');
  assert.equal(finalState.followEnabled, true, 'The logs route should remember the follow toggle.');
  assert.equal(finalState.lastCommand, 'follow on', 'The logs route should expose the latest CLI command.');
  assert.ok(finalState.commandHistoryCount >= 4, 'The logs route should preserve command history for CLI recall.');
  assert.ok(finalState.entryCount >= 4, 'The logs route should append newly recorded rows into history.');
  assert.equal(finalState.visibleCount, 2, 'The logs route should keep the warn-only filtered rows visible after follow mode streams in a new warning.');
}

async function runLogsCommand(
  context: BrowserTestContext,
  command: string,
): Promise<void> {
  await context.page.click('[data-testid="logs-terminal"]');
  await context.page.keyboard.type(command);
  await context.page.keyboard.press('Enter');
}

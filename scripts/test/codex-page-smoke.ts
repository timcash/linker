import path from 'node:path';

import assert from 'node:assert/strict';
import type {HTTPRequest} from 'puppeteer';

import type {BrowserTestContext} from './shared';

export async function runCodexPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const codexUrl = new URL('codex/', context.url).toString();
  const {page, pageErrors} = context;
  const seenRequests: string[] = [];
  const replyBodies: Array<{body: string; messageId: string | null}> = [];
  const composeBodies: Array<{to: string; subject: string; body: string}> = [];
  const markReadCalls: string[] = [];
  const requestListener = (request: HTTPRequest) => {
    void requestHandler(request);
  };
  const respondJson = async (request: HTTPRequest, payload: unknown, status = 200) => {
    await request.respond({
      status,
      headers: {
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  };

  const workingThread = {
    threadId: 'thread-working',
    subject: 'codex keep working on logs',
    updatedAt: '2026-04-17T18:10:00.000Z',
    workspaceKey: 'linker',
    workspacePath: 'C:/Users/timca/linker',
    status: 'working',
    triage: null,
    taskCount: 1,
    latestTaskId: 'task-0002',
    excerpt: 'Continue the logs route cleanup and reply with the final diff summary.',
    badges: ['working', 'green'],
  };
  const needsReplyThread = {
    threadId: 'thread-needs-reply',
    subject: 'Quick question about next week',
    updatedAt: '2026-04-17T19:00:00.000Z',
    workspaceKey: null,
    workspacePath: null,
    status: null,
    triage: 'needs-reply',
    taskCount: 0,
    latestTaskId: null,
    excerpt: 'Are you free Tuesday afternoon?',
    badges: ['needs-reply'],
  };

  const requestHandler = async (request: HTTPRequest) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/mail/')) {
      await request.continue();
      return;
    }

    if (request.method() === 'OPTIONS') {
      await request.respond({
        status: 204,
        headers: {
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
        },
      });
      return;
    }

    const pathname = url.pathname;
    seenRequests.push(`${request.method()} ${pathname}${url.search}`);

    if (pathname === '/api/mail/public-config') {
      await respondJson(request, {
        ok: true,
        authRequired: true,
        publicOrigin: 'https://codex.dialtone.earth',
      });
      return;
    }

    if (pathname === '/api/mail/health') {
      await respondJson(request, {
        ok: true,
        mailbox: {
          displayName: 'Repo Owner',
          emailAddress: 'owner@example.com',
        },
        runtime: {
          publicOrigin: 'https://codex.dialtone.earth',
        },
        counts: {
          threads: 2,
          tasks: 1,
          queueDepth: 1,
          activeTaskId: 'task-0002',
          events: 12,
        },
        views: buildViews(),
      });
      return;
    }

    if (pathname === '/api/mail/views') {
      await respondJson(request, {
        ok: true,
        views: buildViews(),
      });
      return;
    }

    if (pathname === '/api/mail/threads') {
      const view = url.searchParams.get('view') ?? 'inbox';
      const threads =
        view === 'needs-reply'
          ? [needsReplyThread]
          : view === 'working'
            ? [workingThread]
            : view === 'done' || view === 'queued' || view === 'waiting'
              ? []
              : [needsReplyThread, workingThread];
      await respondJson(request, {
        ok: true,
        view,
        threads,
      });
      return;
    }

    if (pathname === '/api/mail/thread/thread-needs-reply') {
      await respondJson(request, {
        ok: true,
        thread: {
          summary: needsReplyThread,
          latestReplyToMessageId: 'msg-human-1',
          loadError: null,
          tasks: [],
          messages: [
            {
              id: 'msg-human-1',
              from: 'Jane <jane@example.com>',
              to: ['Repo Owner <owner@example.com>'],
              sentAt: '2026-04-17T19:00:00.000Z',
              snippet: 'Are you free Tuesday afternoon?',
              bodyText: 'Are you free Tuesday afternoon?',
              labelIds: ['INBOX'],
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/mail/thread/thread-working') {
      await respondJson(request, {
        ok: true,
        thread: {
          summary: workingThread,
          latestReplyToMessageId: 'msg-work-2',
          loadError: null,
          tasks: [
            {
              id: 'task-0002',
              status: 'working',
              requestedAt: '2026-04-17T18:00:00.000Z',
              completedAt: null,
              workflowStage: 'green',
              requestText: 'Continue the logs route cleanup and reply with the final diff summary.',
              workerSummary: 'Focused on the logs route and browser smoke.',
            },
          ],
          messages: [
            {
              id: 'msg-work-1',
              from: 'Repo Owner <owner@example.com>',
              to: ['Repo Owner <owner@example.com>'],
              sentAt: '2026-04-17T18:02:00.000Z',
              snippet: 'The logs route is almost done.',
              bodyText: 'The logs route is almost done.',
              labelIds: ['INBOX'],
            },
            {
              id: 'msg-work-2',
              from: 'Repo Owner <owner@example.com>',
              to: ['Repo Owner <owner@example.com>'],
              sentAt: '2026-04-17T18:05:00.000Z',
              snippet: 'Please keep going and finish the smoke test.',
              bodyText: 'Please keep going and finish the smoke test.',
              labelIds: ['INBOX'],
            },
          ],
        },
      });
      return;
    }

    if (pathname === '/api/mail/thread/thread-needs-reply/read' && request.method() === 'POST') {
      markReadCalls.push('thread-needs-reply');
      await respondJson(request, {ok: true, threadId: 'thread-needs-reply'});
      return;
    }

    if (pathname === '/api/mail/thread/thread-needs-reply/reply' && request.method() === 'POST') {
      const payload = parseRequestJson<{body?: string; messageId?: string | null}>(request);
      replyBodies.push({
        body: payload.body ?? '',
        messageId: payload.messageId ?? null,
      });
      await respondJson(request, {ok: true, responseId: 'reply-1'});
      return;
    }

    if (pathname === '/api/mail/compose' && request.method() === 'POST') {
      const payload = parseRequestJson<{to?: string; subject?: string; body?: string}>(request);
      composeBodies.push({
        to: payload.to ?? '',
        subject: payload.subject ?? '',
        body: payload.body ?? '',
      });
      await respondJson(request, {ok: true, id: 'sent-1'});
      return;
    }

    throw new Error(`Unexpected mail API route in codex smoke: ${request.method()} ${request.url()}`);
  };

  try {
    await page.setRequestInterception(true);
    page.on('request', requestListener);
    await page.goto(codexUrl, {waitUntil: 'load'});
    await page.waitForSelector('.codex-mail-shell');
    await page.waitForSelector('[data-codex-unlock-button]');
    await page.waitForSelector('.site-nav');

    assert.deepEqual(
      pageErrors,
      [],
      `Codex route should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
    );

    const lockedState = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.codex-mail-shell');
      const pad = document.querySelector<HTMLElement>('.codex-mail-pad');
      return {
        activeNavLabel: document.querySelector('.site-nav a[aria-current="page"]')?.textContent?.trim() ?? '',
        authText: document.querySelector<HTMLElement>('[data-codex-auth]')?.textContent?.trim() ?? '',
        buttonCount: document.querySelectorAll('.codex-mail-pad-button').length,
        codexViewMode: document.body.dataset.codexViewMode ?? '',
        padColumns: pad ? window.getComputedStyle(pad).gridTemplateColumns.split(' ').length : 0,
        shellLocked: shell?.classList.contains('codex-mail-shell--locked') ?? false,
        statusText: document.querySelector<HTMLElement>('[data-codex-status]')?.textContent?.trim() ?? '',
        title: document.title,
        unlockLabel:
          document.querySelector<HTMLButtonElement>('[data-codex-unlock-button]')?.textContent?.trim() ?? '',
      };
    });

    assert.equal(lockedState.title, 'Codex Mailboard - Linker', 'The codex route should set the new mailboard title.');
    assert.equal(lockedState.activeNavLabel, 'Codex', 'The shared docs nav should still mark the codex route.');
    assert.equal(lockedState.shellLocked, true, 'The mailboard should begin in the locked state.');
    assert.equal(lockedState.buttonCount, 9, 'The mailboard should expose one 3x3 bottom pad.');
    assert.equal(lockedState.padColumns, 3, 'The mailboard pad should stay in a 3x3 grid.');
    assert.equal(lockedState.codexViewMode, 'locked', 'The locked mailboard should expose the locked view mode.');
    assert.match(lockedState.authText, /cloudflare access required/i, 'The locked mailboard should explain the single unlock requirement.');
    assert.match(lockedState.unlockLabel, /cloudflare access/i, 'The unlock button should keep the Cloudflare Access copy.');
    assert.equal(seenRequests.length, 0, 'The locked mailboard should not fetch the mailbox before unlock.');

    await saveCodexScreenshot(context, 'codex-mailboard-locked');

    await page.click('[data-codex-unlock-button]');
    await page.waitForFunction(() => (document.body.dataset.codexViewMode ?? '') === 'mailboard');
    await page.waitForSelector('.codex-thread-row');

    const unlockedState = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.codex-mail-shell');
      const main = document.querySelector<HTMLElement>('.codex-mail-main');
      return {
        authText: document.querySelector<HTMLElement>('[data-codex-auth]')?.textContent?.trim() ?? '',
        composeVisible:
          document.querySelector<HTMLElement>('[data-codex-compose-panel]')?.classList.contains('codex-compose-panel--open') ?? false,
        currentView: document.querySelector<HTMLElement>('[data-codex-view]')?.textContent?.trim() ?? '',
        mailboxText: document.querySelector<HTMLElement>('[data-codex-mailbox]')?.textContent?.trim() ?? '',
        mainColumns: main ? window.getComputedStyle(main).gridTemplateColumns.split(' ').length : 0,
        shellLocked: shell?.classList.contains('codex-mail-shell--locked') ?? false,
        statusText: document.querySelector<HTMLElement>('[data-codex-status]')?.textContent?.trim() ?? '',
        threadCount: document.querySelectorAll('.codex-thread-row').length,
      };
    });

    assert.equal(unlockedState.shellLocked, false, 'The mailboard should unlock after the Access check succeeds.');
    assert.equal(unlockedState.currentView, 'Inbox', 'The unlocked mailboard should default to the Inbox view.');
    assert.equal(unlockedState.threadCount, 2, 'The unlocked mailboard should show the mocked inbox threads.');
    assert.equal(unlockedState.mainColumns, 1, 'The mobile mailboard should stay in a single column.');
    assert.equal(unlockedState.composeVisible, false, 'Compose should stay closed until the user opens it.');
    assert.match(unlockedState.mailboxText, /owner@example\.com/i, 'The mailbox card should show the shared daemon mailbox.');
    assert.match(unlockedState.authText, /cloudflare access ready/i, 'The auth card should show the unlocked state.');
    assert.match(unlockedState.statusText, /loaded 2 threads/i, 'The status card should confirm the mailbox load.');

    await page.click('[data-codex-view-button="needs-reply"]');
    await page.waitForFunction(() => {
      const currentView = document.querySelector('[data-codex-view]')?.textContent?.trim() ?? '';
      const threadRows = document.querySelectorAll('.codex-thread-row');
      return currentView === 'Needs Reply' && threadRows.length === 1;
    });

    const needsReplyState = await page.evaluate(() => {
      return {
        currentView: document.querySelector<HTMLElement>('[data-codex-view]')?.textContent?.trim() ?? '',
        messageText: document.querySelector('.codex-message-row pre')?.textContent?.trim() ?? '',
        threadCount: document.querySelectorAll('.codex-thread-row').length,
      };
    });

    assert.equal(needsReplyState.currentView, 'Needs Reply', 'The view card should follow the selected bottom-pad view.');
    assert.equal(needsReplyState.threadCount, 1, 'The needs-reply view should filter the thread list.');
    assert.match(needsReplyState.messageText, /tuesday afternoon/i, 'Selecting the needs-reply thread should load the email text.');

    await page.click('[data-codex-action-button="mark-read"]');
    await waitFor(() => markReadCalls.length === 1);
    await page.waitForFunction(() => {
      return (document.querySelector('[data-codex-status]')?.textContent ?? '').includes('Loaded 1 thread');
    });
    assert.deepEqual(markReadCalls, ['thread-needs-reply'], 'The mailboard should post mark-read for the selected thread.');

    await page.type('[data-codex-reply-body]', 'Tuesday afternoon works for me.');
    await page.click('[data-codex-reply-send]');
    await waitFor(() => replyBodies.length === 1);
    await page.waitForFunction(() => {
      return (document.querySelector('[data-codex-status]')?.textContent ?? '').includes('Loaded 1 thread');
    });
    assert.deepEqual(
      replyBodies,
      [{body: 'Tuesday afternoon works for me.', messageId: 'msg-human-1'}],
      'The mailboard should post the reply body plus the latest reply target message id.',
    );

    await page.click('[data-codex-action-button="compose"]');
    await page.waitForFunction(() => {
      return document.querySelector('[data-codex-compose-panel]')?.classList.contains('codex-compose-panel--open') ?? false;
    });
    await page.type('[data-codex-compose-to]', 'jane@example.com');
    await page.type('[data-codex-compose-subject]', 'Follow-up');
    await page.type('[data-codex-compose-body]', 'Happy to chat Tuesday afternoon.');
    await page.click('[data-codex-compose-send]');
    await waitFor(() => composeBodies.length === 1);
    assert.deepEqual(
      composeBodies,
      [{to: 'jane@example.com', subject: 'Follow-up', body: 'Happy to chat Tuesday afternoon.'}],
      'The mailboard should send new compose payloads through the shared daemon API.',
    );

    await saveCodexScreenshot(context, 'codex-mailboard-unlocked');
  } finally {
    page.off('request', requestListener);
    await page.setRequestInterception(false);
  }
}

function buildViews() {
  return [
    {id: 'inbox', label: 'Inbox', description: 'All tracked threads in the shared mailbox.', kind: 'mail', count: 2},
    {id: 'needs-reply', label: 'Needs Reply', description: 'Human mail waiting for a response.', kind: 'triage', count: 1},
    {id: 'waiting', label: 'Waiting', description: 'Threads waiting on someone else.', kind: 'triage', count: 0},
    {id: 'queued', label: 'Queued', description: 'Codex requests queued for the worker.', kind: 'status', count: 0},
    {id: 'working', label: 'Working', description: 'The worker is actively handling these threads.', kind: 'status', count: 1},
    {id: 'done', label: 'Done', description: 'Completed codex work threads.', kind: 'status', count: 0},
  ];
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

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error('Timed out waiting for codex mailboard condition.');
}

function parseRequestJson<T>(request: HTTPRequest): T {
  const body = request.postData() ?? '{}';
  return JSON.parse(body) as T;
}

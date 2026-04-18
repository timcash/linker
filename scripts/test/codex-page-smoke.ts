import path from 'node:path';

import assert from 'node:assert/strict';
import type {HTTPRequest} from 'puppeteer';

import {DEFAULT_LOCAL_MAIL_ORIGIN} from '../../src/remote-config';
import type {BrowserTestContext} from './shared';

type MockThread = {
  threadId: string;
  latestMessageId: string | null;
  subject: string;
  updatedAt: string | null;
  workspaceKey: string | null;
  workspacePath: string | null;
  status: string | null;
  triage: string | null;
  taskCount: number;
  latestTaskId: string | null;
  from: string;
  to: string[];
  excerpt: string;
  labelIds: string[];
  labelNames: string[];
  unread: boolean;
  starred: boolean;
  inInbox: boolean;
  inSent: boolean;
  badges: string[];
};

export async function runCodexPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const codexUrl = new URL('codex/', context.url).toString();
  const {page, pageErrors} = context;
  const seenRequests: string[] = [];
  const replyBodies: Array<{body: string; messageId: string | null}> = [];
  const composeBodies: Array<{to: string; subject: string; body: string}> = [];
  const actionCalls: Array<{threadId: string; action: string}> = [];
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

  const humanThread: MockThread = {
    threadId: 'thread-human',
    latestMessageId: 'msg-human-1',
    subject: 'Quick question about next week',
    updatedAt: '2026-04-17T19:00:00.000Z',
    workspaceKey: null,
    workspacePath: null,
    status: null,
    triage: 'needs-reply',
    taskCount: 0,
    latestTaskId: null,
    from: 'Jane <jane@example.com>',
    to: ['Repo Owner <owner@example.com>'],
    excerpt: 'Are you free Tuesday afternoon?',
    labelIds: ['INBOX', 'UNREAD', 'Label_reply'],
    labelNames: ['Inbox', 'Unread', 'Needs Reply'],
    unread: true,
    starred: false,
    inInbox: true,
    inSent: false,
    badges: ['Unread', 'needs-reply'],
  };
  const codexThread: MockThread = {
    threadId: 'thread-codex',
    latestMessageId: 'msg-work-2',
    subject: 'codex keep working on logs',
    updatedAt: '2026-04-17T18:10:00.000Z',
    workspaceKey: 'linker',
    workspacePath: 'C:/Users/timca/linker',
    status: 'working',
    triage: null,
    taskCount: 1,
    latestTaskId: 'task-0002',
    from: 'Repo Owner <owner@example.com>',
    to: ['Repo Owner <owner@example.com>'],
    excerpt: 'Continue the logs route cleanup and reply with the final diff summary.',
    labelIds: ['INBOX', 'STARRED', 'Label_codex'],
    labelNames: ['Inbox', 'Starred', 'Codex/Working'],
    unread: false,
    starred: true,
    inInbox: true,
    inSent: false,
    badges: ['Starred', 'working', 'green'],
  };
  const sentThread: MockThread = {
    threadId: 'thread-sent',
    latestMessageId: 'msg-sent-1',
    subject: 'Tuesday follow-up',
    updatedAt: '2026-04-17T17:20:00.000Z',
    workspaceKey: null,
    workspacePath: null,
    status: null,
    triage: null,
    taskCount: 0,
    latestTaskId: null,
    from: 'Repo Owner <owner@example.com>',
    to: ['Jane <jane@example.com>'],
    excerpt: 'Tuesday afternoon works for me.',
    labelIds: ['SENT'],
    labelNames: ['Sent'],
    unread: false,
    starred: false,
    inInbox: false,
    inSent: true,
    badges: ['Sent'],
  };
  const threadStore = new Map<string, MockThread>([
    [humanThread.threadId, humanThread],
    [codexThread.threadId, codexThread],
    [sentThread.threadId, sentThread],
  ]);

  const buildViews = () => [
    {id: 'inbox', label: 'Inbox', description: 'Recent inbox threads.', kind: 'mail', count: countThreads('inbox')},
    {id: 'unread', label: 'Unread', description: 'Unread inbox threads.', kind: 'mail', count: countThreads('unread')},
    {id: 'starred', label: 'Starred', description: 'Starred threads.', kind: 'mail', count: countThreads('starred')},
    {id: 'sent', label: 'Sent', description: 'Recently sent mail.', kind: 'mail', count: countThreads('sent')},
    {id: 'all-mail', label: 'All Mail', description: 'Recent mail across the mailbox.', kind: 'mail', count: countThreads('all-mail')},
    {id: 'codex', label: 'Codex', description: 'Codex-related conversations.', kind: 'status', count: countThreads('codex')},
  ];

  const filterThreads = (view: string, query = ''): MockThread[] => {
    const loweredQuery = query.trim().toLowerCase();
    const allThreads = Array.from(threadStore.values())
      .filter((thread) => {
        switch (view) {
          case 'unread':
            return thread.unread && thread.inInbox;
          case 'starred':
            return thread.starred;
          case 'sent':
            return thread.inSent;
          case 'all-mail':
            return true;
          case 'codex':
            return /codex/i.test(thread.subject);
          case 'inbox':
          default:
            return thread.inInbox;
        }
      })
      .sort((left, right) => String(right.updatedAt ?? '').localeCompare(String(left.updatedAt ?? '')));

    if (!loweredQuery) {
      return allThreads;
    }

    return allThreads.filter((thread) => {
      const haystack = [
        thread.subject,
        thread.from,
        thread.excerpt,
        ...thread.labelNames,
      ].join(' ').toLowerCase();
      return haystack.includes(loweredQuery);
    });
  };

  const countThreads = (view: string) => filterThreads(view).length;

  const buildActions = (thread: MockThread) => ({
    canMarkRead: thread.unread,
    canMarkUnread: !thread.unread,
    canStar: !thread.starred,
    canUnstar: thread.starred,
    canArchive: thread.inInbox,
    canMoveToInbox: !thread.inInbox,
  });

  const buildDetail = (thread: MockThread) => ({
    summary: thread,
    latestReplyToMessageId: thread.latestMessageId,
    loadError: null,
    actions: buildActions(thread),
    tasks: thread.threadId === 'thread-codex'
      ? [{
          id: 'task-0002',
          status: 'working',
          requestedAt: '2026-04-17T18:00:00.000Z',
          completedAt: null,
          workflowStage: 'green',
          requestText: 'Continue the logs route cleanup and reply with the final diff summary.',
          workerSummary: 'Focused on the logs route and browser smoke.',
        }]
      : [],
    messages: thread.threadId === 'thread-codex'
      ? [
          {
            id: 'msg-work-1',
            from: 'Repo Owner <owner@example.com>',
            to: ['Repo Owner <owner@example.com>'],
            sentAt: '2026-04-17T18:02:00.000Z',
            snippet: 'The logs route is almost done.',
            bodyText: 'The logs route is almost done.',
            labelIds: ['INBOX', 'STARRED', 'Label_codex'],
            labelNames: ['Inbox', 'Starred', 'Codex/Working'],
          },
          {
            id: 'msg-work-2',
            from: 'Repo Owner <owner@example.com>',
            to: ['Repo Owner <owner@example.com>'],
            sentAt: '2026-04-17T18:05:00.000Z',
            snippet: 'Please keep going and finish the smoke test.',
            bodyText: 'Please keep going and finish the smoke test.',
            labelIds: ['INBOX', 'STARRED', 'Label_codex'],
            labelNames: ['Inbox', 'Starred', 'Codex/Working'],
          },
        ]
      : [
          {
            id: thread.latestMessageId,
            from: thread.from,
            to: thread.to,
            sentAt: thread.updatedAt,
            snippet: thread.excerpt,
            bodyText: thread.excerpt,
            labelIds: thread.labelIds,
            labelNames: thread.labelNames,
          },
        ],
  });

  const updateThreadForAction = (threadId: string, action: string) => {
    const thread = threadStore.get(threadId);
    if (!thread) {
      return;
    }

    switch (action) {
      case 'mark-read':
        thread.unread = false;
        thread.labelNames = thread.labelNames.filter((label) => label !== 'Unread');
        thread.labelIds = thread.labelIds.filter((label) => label !== 'UNREAD');
        thread.badges = thread.badges.filter((badge) => badge !== 'Unread');
        break;
      case 'mark-unread':
        thread.unread = true;
        if (!thread.labelNames.includes('Unread')) {
          thread.labelNames.unshift('Unread');
        }
        if (!thread.labelIds.includes('UNREAD')) {
          thread.labelIds.unshift('UNREAD');
        }
        if (!thread.badges.includes('Unread')) {
          thread.badges.unshift('Unread');
        }
        break;
      case 'star':
        thread.starred = true;
        if (!thread.labelNames.includes('Starred')) {
          thread.labelNames.push('Starred');
        }
        if (!thread.labelIds.includes('STARRED')) {
          thread.labelIds.push('STARRED');
        }
        if (!thread.badges.includes('Starred')) {
          thread.badges.unshift('Starred');
        }
        break;
      case 'unstar':
        thread.starred = false;
        thread.labelNames = thread.labelNames.filter((label) => label !== 'Starred');
        thread.labelIds = thread.labelIds.filter((label) => label !== 'STARRED');
        thread.badges = thread.badges.filter((badge) => badge !== 'Starred');
        break;
      case 'archive':
        thread.inInbox = false;
        thread.labelNames = thread.labelNames.filter((label) => label !== 'Inbox');
        thread.labelIds = thread.labelIds.filter((label) => label !== 'INBOX');
        break;
      case 'move-to-inbox':
        thread.inInbox = true;
        if (!thread.labelNames.includes('Inbox')) {
          thread.labelNames.unshift('Inbox');
        }
        if (!thread.labelIds.includes('INBOX')) {
          thread.labelIds.unshift('INBOX');
        }
        break;
    }
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
        publicOrigin: DEFAULT_LOCAL_MAIL_ORIGIN,
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
          publicOrigin: DEFAULT_LOCAL_MAIL_ORIGIN,
        },
        counts: {
          threads: countThreads('all-mail'),
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
      const q = url.searchParams.get('q') ?? '';
      await respondJson(request, {
        ok: true,
        view,
        searchQuery: q,
        threads: filterThreads(view, q),
      });
      return;
    }

    const threadMatch = pathname.match(/^\/api\/mail\/thread\/([^/]+)$/);
    const threadReadMatch = pathname.match(/^\/api\/mail\/thread\/([^/]+)\/read$/);
    const threadReplyMatch = pathname.match(/^\/api\/mail\/thread\/([^/]+)\/reply$/);
    const threadActionMatch = pathname.match(/^\/api\/mail\/thread\/([^/]+)\/action$/);

    if (threadMatch && request.method() === 'GET') {
      const threadId = decodeURIComponent(threadMatch[1]);
      const thread = threadStore.get(threadId);
      if (!thread) {
        throw new Error(`Unknown thread ${threadId}`);
      }

      await respondJson(request, {
        ok: true,
        thread: buildDetail(thread),
      });
      return;
    }

    if (threadReadMatch && request.method() === 'POST') {
      const threadId = decodeURIComponent(threadReadMatch[1]);
      actionCalls.push({threadId, action: 'mark-read'});
      updateThreadForAction(threadId, 'mark-read');
      await respondJson(request, {ok: true, threadId, action: 'mark-read'});
      return;
    }

    if (threadActionMatch && request.method() === 'POST') {
      const threadId = decodeURIComponent(threadActionMatch[1]);
      const payload = parseRequestJson<{action?: string}>(request);
      const action = payload.action ?? '';
      actionCalls.push({threadId, action});
      updateThreadForAction(threadId, action);
      await respondJson(request, {ok: true, threadId, action});
      return;
    }

    if (threadReplyMatch && request.method() === 'POST') {
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
    await page.waitForSelector('[data-site-menu-toggle]');
    await page.click('[data-site-menu-toggle]');
    await page.waitForSelector('[data-site-menu-overlay]:not([hidden])');

    assert.deepEqual(
      pageErrors,
      [],
      `Codex route should not capture unexpected browser errors: ${pageErrors.join('\n\n')}`,
    );

    const menuState = await page.evaluate(() => {
      const pad = document.querySelector<HTMLElement>('.codex-mail-pad');
      const lockActions = document.querySelector<HTMLElement>('[data-codex-lock-actions]');
      const authorizeLink = document.querySelector<HTMLAnchorElement>('[data-codex-authorize-link]');
      return {
        activeNavLabel:
          document.querySelector('[data-site-menu-link][aria-current="page"]')?.textContent?.trim() ?? '',
        authorizeHref: authorizeLink?.href ?? '',
        authorizeLabel: authorizeLink?.textContent?.trim() ?? '',
        buttonCount: document.querySelectorAll('.codex-mail-pad-button').length,
        lockActionsColumns: lockActions ? window.getComputedStyle(lockActions).gridTemplateColumns.split(' ').length : 0,
        lockActionsDisplay: lockActions ? window.getComputedStyle(lockActions).display : '',
        navLabels: Array.from(document.querySelectorAll<HTMLElement>('[data-site-menu-link]')).map(
          (link) => link.textContent?.trim() ?? '',
        ),
        padColumns: pad ? window.getComputedStyle(pad).gridTemplateColumns.split(' ').length : 0,
        title: document.title,
      };
    });

    assert.equal(menuState.title, 'Codex Mailboard - Linker', 'The codex route should set the new mailboard title.');
    assert.match(menuState.activeNavLabel, /Codex/i, 'The shared fullscreen menu should still mark the codex route.');
    assert.equal(menuState.buttonCount, 9, 'The mailboard should expose one 3x3 bottom pad.');
    assert.equal(menuState.padColumns, 3, 'The mailboard pad should stay in a 3x3 grid.');
    assert.equal(menuState.lockActionsDisplay, 'grid', 'The lock actions should live inside a CSS grid.');
    assert.equal(menuState.lockActionsColumns, 2, 'The lock action grid should give the primary and secondary actions their own cells.');
    assert.ok(menuState.navLabels.some((label) => /App/i.test(label)), 'The fullscreen menu should include the app route.');
    assert.ok(menuState.navLabels.some((label) => /Logs/i.test(label)), 'The fullscreen menu should include the logs route.');
    assert.match(menuState.authorizeLabel, /custom host/i, 'The local-first codex page should keep the custom-host fallback visible.');
    assert.match(menuState.authorizeHref, /\/new-user\/$/i, 'The custom-host fallback should point at the setup page.');

    await page.click('[data-site-menu-toggle]');
    await page.waitForSelector('[data-site-menu-overlay][hidden]');

    await page.waitForFunction(() => (document.body.dataset.codexViewMode ?? '') === 'mailboard');
    await page.waitForSelector('.codex-thread-row');

    const unlockedState = await page.evaluate(() => {
      const shell = document.querySelector<HTMLElement>('.codex-mail-shell');
      const pad = document.querySelector<HTMLElement>('.codex-mail-pad');
      const main = document.querySelector<HTMLElement>('.codex-mail-main');
      return {
        authText: document.querySelector<HTMLElement>('[data-codex-auth]')?.textContent?.trim() ?? '',
        codexViewMode: document.body.dataset.codexViewMode ?? '',
        composeVisible:
          document.querySelector<HTMLElement>('[data-codex-compose-panel]')?.classList.contains('codex-compose-panel--open') ?? false,
        currentView: document.querySelector<HTMLElement>('[data-codex-view]')?.textContent?.trim() ?? '',
        mailboxText: document.querySelector<HTMLElement>('[data-codex-mailbox]')?.textContent?.trim() ?? '',
        mainColumns: main ? window.getComputedStyle(main).gridTemplateColumns.split(' ').length : 0,
        padColumns: pad ? window.getComputedStyle(pad).gridTemplateColumns.split(' ').length : 0,
        shellLocked: shell?.classList.contains('codex-mail-shell--locked') ?? false,
        statusText: document.querySelector<HTMLElement>('[data-codex-status]')?.textContent?.trim() ?? '',
        searchPlaceholder:
          document.querySelector<HTMLInputElement>('[data-codex-search-input]')?.placeholder ?? '',
        unlockLabel:
          document.querySelector<HTMLButtonElement>('[data-codex-unlock-button]')?.textContent?.trim() ?? '',
        threadCount: document.querySelectorAll('.codex-thread-row').length,
      };
    });

    assert.equal(unlockedState.shellLocked, false, 'The local-first mailboard should unlock automatically when this computer responds.');
    assert.equal(unlockedState.currentView, 'Inbox', 'The unlocked mailboard should default to the Inbox view.');
    assert.equal(unlockedState.threadCount, 2, 'The unlocked mailboard should show the mocked inbox threads.');
    assert.equal(unlockedState.mainColumns, 1, 'The mobile mailboard should stay in a single column.');
    assert.equal(unlockedState.padColumns, 3, 'The bottom pad should remain a 3x3 grid after auto-connect.');
    assert.equal(unlockedState.composeVisible, false, 'Compose should stay closed until the user opens it.');
    assert.match(unlockedState.mailboxText, /owner@example\.com/i, 'The mailbox card should show the shared daemon mailbox.');
    assert.match(unlockedState.authText, /connected to this computer/i, 'The auth card should show the local unlocked state.');
    assert.match(unlockedState.statusText, /loaded 2 threads/i, 'The status card should confirm the mailbox load.');
    assert.match(unlockedState.searchPlaceholder, /search the mailbox/i, 'The unlocked mailboard should expose a mailbox search input.');
    assert.match(unlockedState.unlockLabel, /connected/i, 'The primary lock action should collapse into the connected state.');
    assert.equal(unlockedState.codexViewMode, 'mailboard', 'The unlocked mailboard should expose the mailboard view mode.');
    assert.ok(
      seenRequests.some((request) => request.includes('GET /api/mail/public-config')),
      'The local-first codex page should probe the local public-config route on load.',
    );
    assert.ok(
      seenRequests.some((request) => request.includes('GET /api/mail/health')),
      'The local-first codex page should load the local mailbox health on connect.',
    );

    await saveCodexScreenshot(context, 'codex-mailboard-local');

    await page.type('[data-codex-search-input]', 'Tuesday');
    await page.click('[data-codex-search-submit]');
    await page.waitForFunction(() => {
      return (
        document.querySelectorAll('.codex-thread-row').length === 1
        && (document.querySelector('[data-codex-status]')?.textContent ?? '').includes('matching thread')
      );
    });

    const searchState = await page.evaluate(() => {
      return {
        threadCount: document.querySelectorAll('.codex-thread-row').length,
        threadTitle: document.querySelector('.codex-thread-detail-title')?.textContent?.trim() ?? '',
        statusText: document.querySelector('[data-codex-status]')?.textContent?.trim() ?? '',
      };
    });

    assert.equal(searchState.threadCount, 1, 'Searching the mailbox should filter the visible threads.');
    assert.match(searchState.threadTitle, /quick question/i, 'The filtered search result should load the matching human thread.');
    assert.match(searchState.statusText, /matching thread/i, 'The status text should acknowledge the filtered search.');

    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-codex-thread-action="mark-read"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await page.$eval('[data-codex-thread-action="mark-read"]', (button) => {
      (button as HTMLButtonElement).click();
    });
    await waitFor(() => actionCalls.some((call) => call.action === 'mark-read'));
    await page.waitForFunction(() => {
      return document.querySelector('[data-codex-thread-action="mark-unread"]') instanceof HTMLElement;
    });

    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-codex-thread-action="star"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await page.$eval('[data-codex-thread-action="star"]', (button) => {
      (button as HTMLButtonElement).click();
    });
    await waitFor(() => actionCalls.some((call) => call.action === 'star'));

    await page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-codex-thread-action="archive"]');
      return button instanceof HTMLButtonElement && !button.disabled;
    });
    await page.$eval('[data-codex-thread-action="archive"]', (button) => {
      (button as HTMLButtonElement).click();
    });
    await waitFor(() => actionCalls.some((call) => call.action === 'archive'));

    await page.click('[data-codex-clear-search]');
    await page.waitForFunction(() => {
      return document.querySelectorAll('.codex-thread-row').length === 1;
    });

    await page.click('[data-codex-view-button="codex"]');
    await page.waitForFunction(() => {
      return (
        (document.querySelector('[data-codex-view]')?.textContent?.trim() ?? '') === 'Codex'
        && document.querySelectorAll('.codex-thread-row').length === 1
      );
    });

    const codexState = await page.evaluate(() => {
      return {
        currentView: document.querySelector<HTMLElement>('[data-codex-view]')?.textContent?.trim() ?? '',
        messageText: Array.from(document.querySelectorAll('.codex-message-row pre'))
          .map((node) => node.textContent?.trim() ?? '')
          .join(' '),
        taskText: Array.from(document.querySelectorAll('.codex-task-row p'))
          .map((node) => node.textContent?.trim() ?? '')
          .join(' '),
      };
    });

    assert.equal(codexState.currentView, 'Codex', 'The view card should follow the selected mailbox view.');
    assert.match(codexState.messageText, /finish the smoke test/i, 'Selecting the codex view should load the codex thread messages.');
    assert.match(codexState.taskText, /logs route cleanup/i, 'The codex view should still surface linked codex task context.');

    await page.type('[data-codex-reply-body]', 'I cleaned up the logs route and I am rerunning the smoke now.');
    await page.$eval('[data-codex-reply-send]', (button) => {
      (button as HTMLButtonElement).click();
    });
    await waitFor(() => replyBodies.length === 1);
    assert.deepEqual(
      replyBodies,
      [{body: 'I cleaned up the logs route and I am rerunning the smoke now.', messageId: 'msg-work-2'}],
      'The mailboard should post the reply body plus the latest reply target message id.',
    );
    await page.waitForFunction(() => {
      const statusText = document.querySelector('[data-codex-status]')?.textContent ?? '';
      const replyValue = document.querySelector<HTMLTextAreaElement>('[data-codex-reply-body]')?.value ?? '';
      return /loaded 1 thread/i.test(statusText) && replyValue === '';
    });

    await page.click('[data-codex-action-button="compose"]');
    await page.waitForFunction(() => {
      return document.querySelector('[data-codex-compose-panel]')?.classList.contains('codex-compose-panel--open') ?? false;
    });
    await page.type('[data-codex-compose-to]', 'jane@example.com');
    await page.type('[data-codex-compose-subject]', 'Follow-up');
    await page.type('[data-codex-compose-body]', 'Happy to chat Tuesday afternoon.');
    await page.$eval('[data-codex-compose-send]', (button) => {
      (button as HTMLButtonElement).click();
    });
    await waitFor(() => composeBodies.length === 1);
    assert.deepEqual(
      composeBodies,
      [{to: 'jane@example.com', subject: 'Follow-up', body: 'Happy to chat Tuesday afternoon.'}],
      'The mailboard should send new compose payloads through the shared daemon API.',
    );

    assert.deepEqual(
      actionCalls,
      [
        {threadId: 'thread-human', action: 'mark-read'},
        {threadId: 'thread-human', action: 'star'},
        {threadId: 'thread-human', action: 'archive'},
      ],
      'The mailboard should issue the expected inbox action sequence for the selected thread.',
    );

    await saveCodexScreenshot(context, 'codex-mailboard-unlocked');
  } finally {
    page.off('request', requestListener);
    await page.setRequestInterception(false);
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

import path from 'node:path';

import assert from 'node:assert/strict';

import {DEFAULT_LOCAL_MAIL_ORIGIN, DEFAULT_REMOTE_AUTH_ORIGIN} from '../../src/remote-config';
import {openRoute, type BrowserTestContext} from './shared';

type AuthTestHooks = {
  fetchCalls: string[];
  openCalls: string[];
  sessionChecks: number;
};

export async function runAuthPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const authUrl = new URL('auth/?mode=auth', context.url).toString();
  const script = await context.page.evaluateOnNewDocument(() => {
    const hooks: AuthTestHooks = {
      fetchCalls: [],
      openCalls: [],
      sessionChecks: 0,
    };
    (window as Window & {__LINKER_AUTH_TEST_HOOKS__?: AuthTestHooks}).__LINKER_AUTH_TEST_HOOKS__ =
      hooks;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
      const resolvedUrl = new URL(requestUrl, window.location.origin);
      hooks.fetchCalls.push(resolvedUrl.toString());

      if (resolvedUrl.pathname === '/api/auth/public-config') {
        return new Response(JSON.stringify({ok: false}), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 404,
        });
      }

      if (resolvedUrl.pathname === '/api/mail/public-config') {
        return new Response(
          JSON.stringify({
            ok: true,
            publicOrigin: resolvedUrl.origin,
            authRequired: true,
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        );
      }

      if (resolvedUrl.pathname === '/api/mail/health') {
        hooks.sessionChecks += 1;
        return new Response(
          JSON.stringify({
            ok: true,
            mailbox: {
              emailAddress: 'worker@example.com',
            },
            counts: {
              threads: 42,
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
            },
            status: 200,
          },
        );
      }

      if (resolvedUrl.pathname === '/cdn-cgi/access/logout') {
        return new Response(JSON.stringify({ok: true}), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        });
      }

      return originalFetch(input, init);
    };

    window.open = ((url?: string | URL) => {
      hooks.openCalls.push(String(url ?? ''));
      return null;
    }) as typeof window.open;
  });

  try {
    context.addBrowserLog('test', `Opening auth route ${authUrl}.`);
    await context.page.setViewport({width: 393, height: 852, isMobile: true, hasTouch: true});
    await context.page.goto(authUrl, {waitUntil: 'load'});
    await context.page.waitForFunction(() => document.body.classList.contains('auth-route'));
    await context.page.waitForSelector('[data-site-menu-toggle]');
    await context.page.click('[data-site-menu-toggle]');
    await context.page.waitForSelector('[data-site-menu-overlay]:not([hidden])');
    await context.page.waitForFunction(() => {
      const heading = document.querySelector('h1');
      return heading?.textContent?.includes('Connect Linker to this computer') ?? false;
    });
    await context.page.waitForFunction(() => {
      const health = document.querySelector('[data-auth-health]');
      return health?.textContent?.includes('Reachable') ?? false;
    });
    await context.page.click('[data-site-menu-toggle]');
    await context.page.waitForSelector('[data-site-menu-overlay][hidden]');

    await context.page.$eval(
      '[data-auth-authorize]',
      (element) => (element as HTMLButtonElement).click(),
    );
    await context.page.waitForFunction(
      () =>
        (
          window as Window & {
            __LINKER_AUTH_TEST_HOOKS__?: AuthTestHooks;
          }
        ).__LINKER_AUTH_TEST_HOOKS__?.openCalls.length === 1,
    );

    await context.page.$eval(
      '[data-auth-check-session]',
      (element) => (element as HTMLButtonElement).click(),
    );
    await context.page.waitForFunction(() => {
      const state = document.querySelector('[data-auth-status]');
      return state?.textContent?.includes('Authorized.') ?? false;
    });
    const authorizedStateText = await context.page.$eval(
      '[data-auth-status]',
      (element) => element.textContent?.trim() ?? '',
    );

    await context.page.$eval(
      '[data-auth-sign-out]',
      (element) => (element as HTMLButtonElement).click(),
    );
    await context.page.waitForFunction(
      () =>
        (
          window as Window & {
            __LINKER_AUTH_TEST_HOOKS__?: AuthTestHooks;
          }
        ).__LINKER_AUTH_TEST_HOOKS__?.openCalls.length === 2,
    );

    await context.page.$eval(
      '[data-auth-mode-button="dev"]',
      (element) => (element as HTMLButtonElement).click(),
    );
    await context.page.waitForFunction(() => {
      const origin = document.querySelector('[data-auth-origin]');
      return origin?.textContent?.includes(window.location.origin) ?? false;
    });
    await context.page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-auth-authorize]');
      return button?.textContent?.includes('Open Codex') ?? false;
    });
    await context.page.waitForFunction(() => {
      const health = document.querySelector('[data-auth-health]');
      return health?.textContent?.includes('This computer is reachable.') ?? false;
    });

    await context.page.$eval(
      '[data-auth-mode-button="auth"]',
      (element) => (element as HTMLButtonElement).click(),
    );
    await context.page.waitForFunction(() => {
      const origin = document.querySelector('[data-auth-origin]');
      return origin?.textContent?.includes('https://auth.example.com') ?? false;
    });
    await context.page.waitForFunction(() => {
      const health = document.querySelector('[data-auth-health]');
      return health?.textContent?.includes('Hosted mail API reachable.') ?? false;
    });
    await context.page.waitForFunction(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-auth-authorize]');
      return button instanceof HTMLButtonElement && !button.hidden;
    });

    const pageState = await context.page.evaluate(() => {
      const hooks =
        (
          window as Window & {
            __LINKER_AUTH_TEST_HOOKS__?: AuthTestHooks;
          }
        ).__LINKER_AUTH_TEST_HOOKS__ ?? {
          fetchCalls: [],
          openCalls: [],
          sessionChecks: 0,
        };
      const logHost = document.querySelector<HTMLElement>('.auth-log');

      return {
        bodyFontFamily: window.getComputedStyle(document.body).fontFamily,
        bodyText: document.body.innerText,
        currentNavLabel:
          document.querySelector('[data-site-menu-link][aria-current="page"]')?.textContent?.trim() ?? '',
        fetchCalls: hooks.fetchCalls,
        healthText: document.querySelector('[data-auth-health]')?.textContent?.trim() ?? '',
        logEntryCount: document.querySelectorAll('.auth-log-entry').length,
        logFontFamily: logHost ? window.getComputedStyle(logHost).fontFamily : '',
        overflowY: window.getComputedStyle(document.querySelector('#app') as HTMLElement).overflowY,
        navLabels: Array.from(document.querySelectorAll<HTMLElement>('[data-site-menu-link]')).map(
          (link) => link.textContent?.trim() ?? '',
        ),
        openCalls: hooks.openCalls,
        originText: document.querySelector('[data-auth-origin]')?.textContent?.trim() ?? '',
        toolbarColumns:
          window.getComputedStyle(document.querySelector('.auth-toolbar') as HTMLElement).gridTemplateColumns,
        sessionChecks: hooks.sessionChecks,
        title: document.title,
      };
    });

    assert.equal(pageState.title, 'Linker Auth', 'The /auth route should set a dedicated page title.');
    assert.match(pageState.currentNavLabel, /Auth/i, 'The fullscreen menu should mark the auth route as active.');
    assert.ok(pageState.navLabels.some((label) => /App/i.test(label)), 'The fullscreen menu should include the app route.');
    assert.ok(pageState.navLabels.some((label) => /README/i.test(label)), 'The fullscreen menu should include the README route.');
    assert.match(
      pageState.bodyText,
      /Use This Computer for the shared local daemon\./u,
      'The /auth route should keep the copy short and focused.',
    );
    assert.match(
      pageState.bodyFontFamily,
      /Space Grotesk/u,
      'The auth route should use the shared cad-pga-inspired body font.',
    );
    assert.match(
      pageState.logFontFamily,
      /Space Mono/u,
      'The auth log should use the shared mono font.',
    );
    assert.ok(pageState.logEntryCount >= 2, 'The auth route should record a visible auth event log.');
    assert.equal(pageState.overflowY, 'auto', 'The auth route should stay scrollable inside the fixed app shell.');
    assert.equal(pageState.toolbarColumns.split(' ').length, 1, 'The auth actions should stack into one column on mobile.');
    assert.ok(
      pageState.fetchCalls.some((call) => call.includes('/api/auth/public-config')),
      'The auth route should probe the dedicated auth config route first.',
    );
    assert.ok(
      pageState.fetchCalls.some((call) => call.includes('/api/mail/public-config')),
      'The auth route should fall back to the hosted mail config route when no dedicated auth config exists.',
    );
    assert.ok(
      pageState.fetchCalls.some((call) => call.includes('/api/mail/health')),
      'The auth route should check the hosted mail health route as its session proof when it falls back to the mail surface.',
    );
    assert.equal(pageState.sessionChecks, 1, 'The auth smoke test should perform one explicit session check.');
    assert.match(
      authorizedStateText,
      /Authorized\..*worker@example\.com/u,
      'The auth route should surface the hosted mailbox identity after Cloudflare Access succeeds.',
    );
    assert.match(
      pageState.healthText,
      /Hosted mail API reachable\./u,
      'The auth route should report the saved-host mail access health when it falls back to the mail surface.',
    );
    assert.match(
      pageState.originText,
      new RegExp(DEFAULT_REMOTE_AUTH_ORIGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      'The auth route should return to the remote Cloudflare origin in auth mode.',
    );
    assert.equal(pageState.openCalls.length, 2, 'The auth route should open both authorize and sign-out targets.');
    assert.match(
      pageState.openCalls[0] ?? '',
      new RegExp(`${DEFAULT_REMOTE_AUTH_ORIGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/codex/`, 'u'),
      'Authorize should open the hosted mailboard route when the auth page falls back to the mail surface.',
    );
    assert.match(
      pageState.openCalls[1] ?? '',
      new RegExp(`${DEFAULT_REMOTE_AUTH_ORIGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}/cdn-cgi/access/logout`, 'u'),
      'Sign out should open the standard Cloudflare Access logout target.',
    );
    assert.equal(
      new RegExp(DEFAULT_LOCAL_MAIL_ORIGIN.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u').test(pageState.originText),
      false,
      'Returning to Saved Host mode should move back off the local loopback origin.',
    );
    await saveAuthScreenshot(context, 'auth-page');
    await openRoute(context.page, context.url);
  } finally {
    await context.page.removeScriptToEvaluateOnNewDocument(
      (script as {identifier: string}).identifier,
    );
  }
}

async function saveAuthScreenshot(
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

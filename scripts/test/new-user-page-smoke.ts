import path from 'node:path';

import assert from 'node:assert/strict';

import {openRoute, type BrowserTestContext} from './shared';
import {
  DEFAULT_REPO_URL,
} from '../../src/remote-config';

export async function runNewUserPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const routeUrl = new URL('new-user/', context.url).toString();

  context.addBrowserLog('test', `Opening new-user route ${routeUrl}.`);
  await context.page.setViewport({width: 393, height: 852, isMobile: true, hasTouch: true});
  await context.page.goto(routeUrl, {waitUntil: 'load'});
  await context.page.waitForFunction(() => document.body.classList.contains('new-user-route'));
  await context.page.waitForSelector('[data-testid="new-user-page"]');
  await context.page.waitForSelector('[data-site-menu-toggle]');

  const initialState = await context.page.evaluate(() => ({
    authValue: document.querySelector('[data-new-user-effective-auth]')?.textContent?.trim() ?? '',
    mailValue: document.querySelector('[data-new-user-effective-mail]')?.textContent?.trim() ?? '',
    repoValue: document.querySelector('[data-new-user-effective-repo]')?.textContent?.trim() ?? '',
    title: document.title,
  }));

  assert.equal(initialState.title, 'Linker New User', 'The new-user route should set a dedicated page title.');
  assert.equal(
    initialState.authValue,
    'This Computer',
    'The new-user route should default auth to this computer when no custom host is saved.',
  );
  assert.equal(
    initialState.mailValue,
    'This Computer',
    'The new-user route should default mail to this computer when no custom host is saved.',
  );
  assert.equal(
    initialState.repoValue,
    DEFAULT_REPO_URL,
    'The new-user route should surface the generic repo default.',
  );

  await context.page.click('[data-new-user-repo-input]', {clickCount: 3});
  await context.page.type('[data-new-user-repo-input]', 'https://github.com/acme/linker-private');
  await context.page.click('[data-new-user-auth-input]', {clickCount: 3});
  await context.page.type('[data-new-user-auth-input]', 'https://auth.acme.test');
  await context.page.click('[data-new-user-mail-input]', {clickCount: 3});
  await context.page.type('[data-new-user-mail-input]', 'https://mail.acme.test');
  await context.page.click('button[type="submit"]');

  await context.page.waitForFunction(() => {
    const status = document.querySelector('[data-new-user-status]');
    return status?.textContent?.includes('Saved custom host settings') ?? false;
  });

  await context.page.click('[data-site-menu-toggle]');
  await context.page.waitForSelector('[data-site-menu-overlay]:not([hidden])');

  const savedState = await context.page.evaluate(() => ({
    authValue: document.querySelector('[data-new-user-effective-auth]')?.textContent?.trim() ?? '',
    bodyText: document.body.innerText,
    currentNavLabel:
      document.querySelector('[data-site-menu-link][aria-current="page"]')?.textContent?.trim() ?? '',
    githubHref:
      document.querySelector<HTMLAnchorElement>('[data-site-menu-link="GitHub"]')?.href ?? '',
    mailValue: document.querySelector('[data-new-user-effective-mail]')?.textContent?.trim() ?? '',
    navLabels: Array.from(document.querySelectorAll<HTMLElement>('[data-site-menu-link]')).map(
      (link) => link.textContent?.trim() ?? '',
    ),
    overflowY: window.getComputedStyle(document.querySelector('#app') as HTMLElement).overflowY,
    repoValue: document.querySelector('[data-new-user-effective-repo]')?.textContent?.trim() ?? '',
    rootOnboardingHref:
      document.querySelector<HTMLAnchorElement>('a[href*="?onboarding=1"]')?.href ?? '',
    actionColumns:
      window.getComputedStyle(document.querySelector('.new-user-action-row') as HTMLElement).gridTemplateColumns,
  }));

  assert.match(savedState.currentNavLabel, /New User/i, 'The fullscreen menu should mark the new-user route as active.');
  assert.ok(savedState.navLabels.some((label) => /Auth/i.test(label)), 'The fullscreen menu should include the auth route.');
  assert.ok(savedState.navLabels.some((label) => /Codex/i.test(label)), 'The fullscreen menu should include the codex route.');
  assert.match(savedState.bodyText, /Leave Auth and Mail blank to use This Computer\./u, 'The new-user route should keep the setup copy short.');
  assert.match(savedState.repoValue, /https:\/\/github\.com\/acme\/linker-private/u, 'Saving the repo URL should update the effective value.');
  assert.match(savedState.authValue, /https:\/\/auth\.acme\.test/u, 'Saving the auth origin should update the effective value.');
  assert.match(savedState.mailValue, /https:\/\/mail\.acme\.test/u, 'Saving the mail origin should update the effective value.');
  assert.match(savedState.githubHref, /https:\/\/github\.com\/acme\/linker-private/u, 'Saving the repo URL should update the shared menu GitHub target too.');
  assert.match(savedState.rootOnboardingHref, /\?onboarding=1/u, 'The new-user page should link back to the DAG onboarding replay.');
  assert.equal(savedState.overflowY, 'auto', 'The new-user route should stay scrollable inside the fixed app shell.');
  assert.equal(savedState.actionColumns.split(' ').length, 1, 'The new-user actions should stack into one column on mobile.');

  await context.page.click('[data-site-menu-toggle]');
  await context.page.waitForSelector('[data-site-menu-overlay][hidden]');

  await context.page.click('[data-new-user-reset]');
  await context.page.waitForFunction(() => {
    const status = document.querySelector('[data-new-user-status]');
    const auth = document.querySelector('[data-new-user-effective-auth]');
    return (
      (status?.textContent?.includes('Cleared custom host settings') ?? false) &&
      (auth?.textContent?.includes('This Computer') ?? false)
    );
  });

  await saveNewUserScreenshot(context, 'new-user-page');
  await openRoute(context.page, context.url);
}

async function saveNewUserScreenshot(
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

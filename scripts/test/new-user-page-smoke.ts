import path from 'node:path';

import assert from 'node:assert/strict';

import {openRoute, type BrowserTestContext} from './shared';
import {
  DEFAULT_REMOTE_AUTH_ORIGIN,
  DEFAULT_REMOTE_MAIL_ORIGIN,
  DEFAULT_REPO_URL,
} from '../../src/remote-config';

export async function runNewUserPageSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const routeUrl = new URL('new-user/', context.url).toString();

  context.addBrowserLog('test', `Opening new-user route ${routeUrl}.`);
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
    DEFAULT_REMOTE_AUTH_ORIGIN,
    'The new-user route should surface the generic hosted auth default.',
  );
  assert.equal(
    initialState.mailValue,
    DEFAULT_REMOTE_MAIL_ORIGIN,
    'The new-user route should surface the generic hosted mail default.',
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
    return status?.textContent?.includes('Saved local private-host settings') ?? false;
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
    repoValue: document.querySelector('[data-new-user-effective-repo]')?.textContent?.trim() ?? '',
    rootOnboardingHref:
      document.querySelector<HTMLAnchorElement>('a[href*="?onboarding=1"]')?.href ?? '',
  }));

  assert.match(savedState.currentNavLabel, /New User/i, 'The fullscreen menu should mark the new-user route as active.');
  assert.ok(savedState.navLabels.some((label) => /Auth/i.test(label)), 'The fullscreen menu should include the auth route.');
  assert.ok(savedState.navLabels.some((label) => /Codex/i.test(label)), 'The fullscreen menu should include the codex route.');
  assert.match(savedState.bodyText, /3D DAG first/u, 'The new-user route should explain the DAG onboarding strategy.');
  assert.match(savedState.bodyText, /One sign-in path/u, 'The new-user route should explain the sign-in onboarding strategy.');
  assert.match(savedState.repoValue, /https:\/\/github\.com\/acme\/linker-private/u, 'Saving the repo URL should update the effective value.');
  assert.match(savedState.authValue, /https:\/\/auth\.acme\.test/u, 'Saving the auth origin should update the effective value.');
  assert.match(savedState.mailValue, /https:\/\/mail\.acme\.test/u, 'Saving the mail origin should update the effective value.');
  assert.match(savedState.githubHref, /https:\/\/github\.com\/acme\/linker-private/u, 'Saving the repo URL should update the shared menu GitHub target too.');
  assert.match(savedState.rootOnboardingHref, /\?onboarding=1/u, 'The new-user page should link back to the DAG onboarding replay.');

  await context.page.click('[data-site-menu-toggle]');
  await context.page.waitForSelector('[data-site-menu-overlay][hidden]');

  await context.page.click('[data-new-user-reset]');
  await context.page.waitForFunction(() => {
    const status = document.querySelector('[data-new-user-status]');
    const auth = document.querySelector('[data-new-user-effective-auth]');
    return (
      (status?.textContent?.includes('Cleared local overrides') ?? false) &&
      (auth?.textContent?.includes('https://auth.example.com') ?? false)
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

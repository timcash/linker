import path from 'node:path';

import assert from 'node:assert/strict';

import {openRoute, type BrowserTestContext} from './shared';

export async function runReadmePreviewSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const readmeUrl = new URL('readme/', context.url).toString();

  context.addBrowserLog('test', `Opening README preview route ${readmeUrl}.`);
  await context.page.goto(readmeUrl, {waitUntil: 'load'});
  await context.page.waitForFunction(() => document.body.classList.contains('readme-route'));
  await context.page.waitForFunction(() => {
    const preview = document.querySelector('.markdown-preview');
    return preview?.textContent?.includes('Live Onboarding') ?? false;
  });

  const previewState = await context.page.evaluate(() => {
    const codeElement =
      document.querySelector<HTMLElement>('.markdown-preview pre') ??
      document.querySelector<HTMLElement>('.markdown-preview code');

    return {
      bodyFontFamily: window.getComputedStyle(document.body).fontFamily,
      currentNavLabel:
        document.querySelector('.site-nav a[aria-current="page"]')?.textContent?.trim() ?? '',
      headingCount: document.querySelectorAll('.markdown-preview h2').length,
      imageCount: document.querySelectorAll('.markdown-preview img').length,
      previewText: document.querySelector('.markdown-preview')?.textContent ?? '',
      title: document.title,
      codeFontFamily: codeElement ? window.getComputedStyle(codeElement).fontFamily : '',
    };
  });

  assert.equal(previewState.title, 'Linker README', 'The /readme route should set a dedicated page title.');
  assert.equal(previewState.currentNavLabel, 'README', 'The README preview nav should mark the active route.');
  assert.match(previewState.previewText, /Live Onboarding/u, 'The README preview should render the hosted onboarding section.');
  assert.match(previewState.previewText, /CLI Workflow/u, 'The README preview should render markdown sections into HTML.');
  assert.match(previewState.previewText, /Domain Language/u, 'The README preview should keep the domain language section visible.');
  assert.match(previewState.previewText, /UI Panels/u, 'The README preview should keep the UI panels section visible.');
  assert.match(previewState.previewText, /Code Index/u, 'The README preview should keep the code index section visible.');
  assert.ok(previewState.headingCount >= 4, 'The README preview should render multiple markdown headings.');
  assert.ok(previewState.imageCount >= 1, 'The README preview should render bundled README images.');
  assert.match(previewState.bodyFontFamily, /Space Grotesk/u, 'The docs shell should use the cad-pga body font.');
  assert.match(previewState.codeFontFamily, /Space Mono/u, 'The preview code blocks should use the cad-pga mono font.');

  await saveReadmePreviewScreenshot(context, 'readme-preview');
  await openRoute(context.page, context.url);
}

async function saveReadmePreviewScreenshot(
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

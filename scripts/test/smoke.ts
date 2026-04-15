import {mkdir} from 'node:fs/promises';
import path from 'node:path';

import assert from 'node:assert/strict';

import puppeteer, {type Browser, type Page} from 'puppeteer';

import {appendLogEvent, resolveUnifiedLogPath} from '../logging';

type BrowserLaunchOptions = {
  headless?: boolean;
  preferSystemChrome?: boolean;
};

type SmokeTestOptions = {
  allowUnsupported?: boolean;
  expectOnboarding?: boolean;
  screenshotName: string;
  timeoutMs?: number;
  url: string;
};

type SmokeDiagnostics = {
  appMessage: string;
  appState: string;
  bootPhase: string;
  activeWorkplaneId: string;
  dagEdgeCount: number;
  dagNodeCount: number;
  onboardingPanelVisible: boolean;
  onboardingState: string;
  onboardingStepId: string;
  planeCount: number;
  renderBridgeLinkCount: number;
  stageMode: string;
};

export async function launchSmokeBrowser(
  options: BrowserLaunchOptions = {},
): Promise<Browser> {
  const launchArgs = [
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ];
  const headless = options.headless ?? false;

  if (options.preferSystemChrome ?? true) {
    try {
      const browser = await puppeteer.launch({
        headless,
        channel: 'chrome',
        defaultViewport: {
          width: 393,
          height: 852,
          deviceScaleFactor: 2,
        },
        args: launchArgs,
      });
      await appendLogEvent('smoke.browser', 'Launched system Chrome for smoke coverage.', {
        logPath: resolveUnifiedLogPath(),
      });
      return browser;
    } catch {
      // Fall back to Puppeteer's bundled browser below.
      await appendLogEvent('smoke.browser', 'Falling back to the bundled Puppeteer browser.', {
        logPath: resolveUnifiedLogPath(),
      });
    }
  }

  const browser = await puppeteer.launch({
    headless,
    defaultViewport: {
      width: 393,
      height: 852,
      deviceScaleFactor: 2,
    },
    args: launchArgs,
  });
  await appendLogEvent('smoke.browser', 'Launched bundled Puppeteer browser.', {
    logPath: resolveUnifiedLogPath(),
  });
  return browser;
}

export async function runSmokeTest(
  page: Page,
  options: SmokeTestOptions,
): Promise<SmokeDiagnostics> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const responseErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      const text = String(message.text());
      consoleErrors.push(text);
      void appendLogEvent('smoke.console.error', text, {
        logPath: resolveUnifiedLogPath(),
      });
      return;
    }

    void appendLogEvent(`smoke.console.${message.type()}`, String(message.text()), {
      logPath: resolveUnifiedLogPath(),
    });
  });
  page.on('pageerror', (error) => {
    const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
    pageErrors.push(text);
    void appendLogEvent('smoke.pageerror', text, {
      logPath: resolveUnifiedLogPath(),
    });
  });
  page.on('error', (error) => {
    const text = error.stack ?? error.message;
    void appendLogEvent('smoke.error', text, {
      logPath: resolveUnifiedLogPath(),
    });
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure();
    const text = `${request.method()} ${request.url()}${failure ? ` :: ${failure.errorText}` : ''}`;
    requestFailures.push(text);
    void appendLogEvent('smoke.requestfailed', text, {
      logPath: resolveUnifiedLogPath(),
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      const text = `${response.status()} ${response.url()}`;
      responseErrors.push(text);
      void appendLogEvent('smoke.response.error', text, {
        logPath: resolveUnifiedLogPath(),
      });
    }
  });

  await appendLogEvent('smoke.goto', options.url, {logPath: resolveUnifiedLogPath()});
  await page.goto(options.url, {waitUntil: 'load'});
  try {
    await page.waitForFunction(
      () => {
        const appState = document.body.dataset.appState;
        return appState === 'ready' || appState === 'unsupported' || appState === 'error';
      },
      {timeout: options.timeoutMs ?? 20_000},
    );
  } catch (error) {
    const lastKnownState = await page.evaluate(() => ({
      appMessage:
        document.querySelector('[data-testid="app-message"]')?.textContent?.trim() ?? '',
      appState: document.body.dataset.appState ?? 'missing',
      bootPhase: document.body.dataset.bootPhase ?? 'missing',
    }));
    throw new Error(
      `Timed out waiting for a terminal app state at ${options.url}. ` +
        `Last state=${lastKnownState.appState}, bootPhase=${lastKnownState.bootPhase}, ` +
        `message=${JSON.stringify(lastKnownState.appMessage)}`,
      {cause: error},
    );
  }

  const diagnostics = await page.evaluate(() => ({
    appMessage:
      document.querySelector('[data-testid="app-message"]')?.textContent?.trim() ?? '',
    appState: document.body.dataset.appState ?? 'missing',
    bootPhase: document.body.dataset.bootPhase ?? 'missing',
    activeWorkplaneId: document.body.dataset.activeWorkplaneId ?? '',
    dagEdgeCount: Number(document.body.dataset.dagEdgeCount ?? '0'),
    dagNodeCount: Number(document.body.dataset.dagNodeCount ?? '0'),
    onboardingPanelVisible: document.body.dataset.onboardingPanelVisible === 'true',
    onboardingState: document.body.dataset.onboardingState ?? '',
    onboardingStepId: document.body.dataset.onboardingStepId ?? '',
    planeCount: Number(document.body.dataset.planeCount ?? '0'),
    renderBridgeLinkCount: Number(document.body.dataset.renderBridgeLinkCount ?? '0'),
    stageMode: document.body.dataset.stageMode ?? '',
  }));

  const screenshotDir = path.resolve(process.cwd(), 'artifacts', 'test-screenshots');
  await mkdir(screenshotDir, {recursive: true});
  await page.screenshot({
    path: path.join(screenshotDir, `${options.screenshotName}.png`),
    fullPage: true,
  });
  await appendLogEvent(
    'smoke.artifact',
    `Saved smoke screenshot to ${path.join(screenshotDir, `${options.screenshotName}.png`)}`,
    {logPath: resolveUnifiedLogPath()},
  );

  assert.deepEqual(
    consoleErrors,
    [],
    `Unexpected browser console errors for ${options.url}:\n${consoleErrors.join('\n')}`,
  );
  assert.deepEqual(
    pageErrors,
    [],
    `Unexpected page errors for ${options.url}:\n${pageErrors.join('\n')}`,
  );
  assert.deepEqual(
    requestFailures,
    [],
    `Unexpected failed requests for ${options.url}:\n${requestFailures.join('\n')}`,
  );
  assert.deepEqual(
    responseErrors,
    [],
    `Unexpected error responses for ${options.url}:\n${responseErrors.join('\n')}`,
  );
  assert.notEqual(
    diagnostics.appState,
    'error',
    `App entered error state for ${options.url}: ${diagnostics.appMessage}`,
  );

  if (options.allowUnsupported) {
    assert.match(
      diagnostics.appState,
      /^(ready|unsupported)$/,
      `Expected ready or unsupported state for ${options.url}, received ${diagnostics.appState}.`,
    );
    if (diagnostics.appState === 'unsupported') {
      assert.match(
        diagnostics.appMessage,
        /webgpu/i,
        `Unsupported live-page message should explain the WebGPU requirement for ${options.url}.`,
      );
    }
  } else {
    assert.equal(diagnostics.appState, 'ready', `Expected ready state for ${options.url}.`);
    assert.equal(diagnostics.bootPhase, 'ready', `Expected boot phase ready for ${options.url}.`);
  }

  if (options.expectOnboarding && diagnostics.appState === 'ready') {
    await page.waitForFunction(
      () =>
        document.body.dataset.onboardingState === 'complete' &&
        document.body.dataset.onboardingStepId === 'complete' &&
        document.body.dataset.stageMode === '3d-mode' &&
        document.body.dataset.activeWorkplaneId === 'wp-1' &&
        Number(document.body.dataset.planeCount ?? '0') === 12 &&
        Number(document.body.dataset.dagNodeCount ?? '0') === 12 &&
        Number(document.body.dataset.dagEdgeCount ?? '0') === 11 &&
        Number(document.body.dataset.renderBridgeLinkCount ?? '0') === 11,
      {timeout: options.timeoutMs ?? 120_000},
    );

    const finalOnboardingDiagnostics = await page.evaluate(() => ({
      activeWorkplaneId: document.body.dataset.activeWorkplaneId ?? '',
      dagEdgeCount: Number(document.body.dataset.dagEdgeCount ?? '0'),
      dagNodeCount: Number(document.body.dataset.dagNodeCount ?? '0'),
      onboardingPanelVisible: document.body.dataset.onboardingPanelVisible === 'true',
      onboardingState: document.body.dataset.onboardingState ?? '',
      onboardingStepId: document.body.dataset.onboardingStepId ?? '',
      planeCount: Number(document.body.dataset.planeCount ?? '0'),
      renderBridgeLinkCount: Number(document.body.dataset.renderBridgeLinkCount ?? '0'),
      stageMode: document.body.dataset.stageMode ?? '',
    }));

    diagnostics.activeWorkplaneId = finalOnboardingDiagnostics.activeWorkplaneId;
    diagnostics.dagEdgeCount = finalOnboardingDiagnostics.dagEdgeCount;
    diagnostics.dagNodeCount = finalOnboardingDiagnostics.dagNodeCount;
    diagnostics.onboardingPanelVisible = finalOnboardingDiagnostics.onboardingPanelVisible;
    diagnostics.onboardingState = finalOnboardingDiagnostics.onboardingState;
    diagnostics.onboardingStepId = finalOnboardingDiagnostics.onboardingStepId;
    diagnostics.planeCount = finalOnboardingDiagnostics.planeCount;
    diagnostics.renderBridgeLinkCount = finalOnboardingDiagnostics.renderBridgeLinkCount;
    diagnostics.stageMode = finalOnboardingDiagnostics.stageMode;
  }

  return diagnostics;
}

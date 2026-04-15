import {mkdir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import puppeteer, {
  type ConsoleMessage,
  type HTTPRequest,
  type HTTPResponse,
} from 'puppeteer';
import {createServer} from 'vite';

import {
  appendLogEvent,
  appendRawLogLines,
  createUnifiedViteLogger,
  initializeUnifiedLog,
  resolveUnifiedLogPath,
} from '../logging';
import {runStaticUnitTests} from './unit';
import {
  ERROR_PING_TOKEN,
  INTENTIONAL_ERROR_MARKER,
  type BrowserTestContext,
} from './types';

const screenshotPath = path.resolve(process.cwd(), 'browser.png');
const interactionScreenshotDir = path.resolve(process.cwd(), 'artifacts', 'test-screenshots');
const MOBILE_VIEWPORT = {
  width: 393,
  height: 852,
  deviceScaleFactor: 2,
};

export {runStaticUnitTests};

export async function createBrowserTestContext(): Promise<BrowserTestContext> {
  const logPath = await initializeUnifiedLog({
    append: process.env.LINKER_APPEND_TEST_LOG === '1',
    cwd: process.cwd(),
    sessionLabel: 'Starting browser test context.',
  });
  await rm(interactionScreenshotDir, {force: true, recursive: true});
  await mkdir(interactionScreenshotDir, {recursive: true});

  const browserLogLines: string[] = [];
  let flushedLineCount = 0;
  const addBrowserLog = (kind: string, message: string): void => {
    const timestamp = new Date().toISOString();
    const resolvedKind = kind.startsWith('browser.') ? kind : `browser.${kind}`;
    browserLogLines.push(`[${timestamp}] [${resolvedKind}] ${message}`);
  };
  const addErrorLog = (kind: string, message: string): void => {
    addBrowserLog(kind, formatErrorLogMessage(message));
  };
  const flushBrowserLog = async (): Promise<void> => {
    const pendingLines = browserLogLines.slice(flushedLineCount);

    if (pendingLines.length === 0) {
      return;
    }

    await appendRawLogLines(pendingLines.join('\n'), {logPath});
    flushedLineCount = browserLogLines.length;
  };
  const flushErrorLog = async (): Promise<void> => {
    await flushBrowserLog();
  };

  const server = await createServer({
    customLogger: createUnifiedViteLogger('dev-server'),
    logLevel: 'info',
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
  });

  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4173/';

  await appendLogEvent('vite.dev-server.url', `Listening at ${url}`, {logPath: resolveUnifiedLogPath()});
  addBrowserLog('test', `Starting browser test for ${url}`);

  const browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    defaultViewport: MOBILE_VIEWPORT,
    args: [
      '--enable-unsafe-webgpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport(MOBILE_VIEWPORT);
  const pageErrors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    const location = message.location();
    const suffix = location.url
      ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
      : '';
    const fullMessage = `${message.text()}${suffix}`;
    const kind = `console.${message.type()}`;
    addBrowserLog(kind, fullMessage);
    if (message.type() === 'error') {
      addErrorLog(kind, fullMessage);
    }
  });

  page.on('pageerror', (error) => {
    const pageErrorValue = error instanceof Error ? error : new Error(String(error));
    const message = pageErrorValue.stack ?? pageErrorValue.message;
    pageErrors.push(message);
    if (message.includes(ERROR_PING_TOKEN)) {
      const intentionalMessage = `${INTENTIONAL_ERROR_MARKER} ${message}`;
      addBrowserLog('pageerror.intentional', intentionalMessage);
      addErrorLog('pageerror.intentional', intentionalMessage);
      return;
    }

    addBrowserLog('pageerror', message);
    addErrorLog('pageerror', message);
  });

  page.on('error', (error) => {
    const message = error.stack ?? error.message;
    addBrowserLog('error', message);
    addErrorLog('error', message);
  });

  page.on('requestfailed', (request: HTTPRequest) => {
    const failure = request.failure();
    const message = `${request.method()} ${request.url()}${failure ? ` :: ${failure.errorText}` : ''}`;
    addBrowserLog('requestfailed', message);
    addErrorLog('requestfailed', message);
  });

  page.on('response', (response: HTTPResponse) => {
    if (response.status() >= 400) {
      const message = `${response.status()} ${response.url()}`;
      addBrowserLog('response.error', message);
      addErrorLog('response.error', message);
    }
  });

  return {
    addBrowserLog,
    addErrorLog,
    browser,
    flushBrowserLog,
    flushErrorLog,
    interactionScreenshotCounter: 0,
    interactionScreenshotDir,
    logPath,
    page,
    pageErrors,
    screenshotPath,
    server,
    url,
  };
}

export async function destroyBrowserTestContext(
  context: BrowserTestContext,
  options?: {
    close?: boolean;
  },
): Promise<void> {
  try {
    await ensureScreenshotUsesStackView(context);

    const screenshot = await context.page.screenshot({
      fullPage: true,
    });

    await writeFile(context.screenshotPath, screenshot);
    context.addBrowserLog('artifact', `Saved screenshot to ${context.screenshotPath}`);
  } catch (error) {
    const message = `Failed to save screenshot: ${error instanceof Error ? error.message : String(error)}`;
    context.addBrowserLog('artifact.error', message);
    context.addErrorLog('artifact.error', message);
  }

  try {
    await context.flushBrowserLog();
  } catch (error) {
    console.error(
      `Failed to write browser log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    await context.flushErrorLog();
  } catch (error) {
    console.error(
      `Failed to write error log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (options?.close === false) {
    return;
  }

  await context.browser.close();
  await context.server.close();
}

async function ensureScreenshotUsesStackView(
  context: BrowserTestContext,
): Promise<void> {
  const shouldKeepCurrentRoute = await context.page.evaluate(() => {
    return (
      document.querySelector('.codex-page-shell') instanceof HTMLElement ||
      document.querySelector('[data-testid="auth-page"]') instanceof HTMLElement ||
      document.querySelector('[data-testid="readme-preview"]') instanceof HTMLElement ||
      document.querySelector('[data-testid="tasks-dashboard"]') instanceof HTMLElement
    );
  }).catch(() => false);

  if (shouldKeepCurrentRoute) {
    return;
  }

  const alreadyReadyInStackView = await context.page.evaluate(() => {
    return (
      document.body.dataset.appState === 'ready' &&
      (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode'
    );
  }).catch(() => false);

  if (alreadyReadyInStackView) {
    await context.page.waitForFunction(() => document.body.dataset.cameraAnimating !== 'true');
    return;
  }

  const currentUrl = new URL(context.page.url() || context.url);
  currentUrl.searchParams.set('stageMode', '3d-mode');

  await context.page.goto(currentUrl.toString(), {waitUntil: 'load'});
  await context.page.waitForFunction(
    () =>
      document.body.dataset.appState === 'ready' &&
      (document.body.dataset.stageMode ?? '2d-mode') === '3d-mode',
  );
  await context.page.waitForFunction(() => document.body.dataset.cameraAnimating !== 'true');
}

function formatErrorLogMessage(message: string): string {
  return message.replace(/\r?\n/g, '\\n');
}

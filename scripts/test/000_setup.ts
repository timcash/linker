import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import puppeteer, {
  type ConsoleMessage,
  type HTTPRequest,
  type HTTPResponse,
} from 'puppeteer';
import {createServer} from 'vite';

import {
  ERROR_PING_TOKEN,
  INTENTIONAL_ERROR_MARKER,
  type BrowserTestContext,
  runCameraUnitTests,
  runCanonicalLabelIdUnitTests,
  runLinkPointUnitTests,
  runLayoutStrategyUnitTests,
  runZoomBandUnitTests,
} from './shared';

const logPath = path.resolve(process.cwd(), 'browser.log');
const screenshotPath = path.resolve(process.cwd(), 'browser.png');

export function runStaticUnitTests(): void {
  runCameraUnitTests();
  runCanonicalLabelIdUnitTests();
  runLinkPointUnitTests();
  runLayoutStrategyUnitTests();
  runZoomBandUnitTests();
}

export async function createBrowserTestContext(): Promise<BrowserTestContext> {
  await writeFile(logPath, '', 'utf8');

  const browserLogLines: string[] = [];
  const addBrowserLog = (kind: string, message: string): void => {
    const timestamp = new Date().toISOString();
    browserLogLines.push(`[${timestamp}] [${kind}] ${message}`);
  };
  const flushBrowserLog = async (): Promise<void> => {
    await writeFile(logPath, `${browserLogLines.join('\n')}\n`, 'utf8');
  };

  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
  });

  await server.listen();
  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4173/';

  addBrowserLog('test', `Starting browser test for ${url}`);

  const browser = await puppeteer.launch({
    headless: false,
    channel: 'chrome',
    defaultViewport: {width: 1280, height: 800},
    args: [
      '--enable-unsafe-webgpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const page = await browser.newPage();
  const pageErrors: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    const location = message.location();
    const suffix = location.url
      ? ` (${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0})`
      : '';
    addBrowserLog(`console.${message.type()}`, `${message.text()}${suffix}`);
  });

  page.on('pageerror', (error) => {
    const pageErrorValue = error instanceof Error ? error : new Error(String(error));
    const message = pageErrorValue.stack ?? pageErrorValue.message;
    pageErrors.push(message);
    if (message.includes(ERROR_PING_TOKEN)) {
      addBrowserLog('pageerror.intentional', `${INTENTIONAL_ERROR_MARKER} ${message}`);
      return;
    }

    addBrowserLog('pageerror', message);
  });

  page.on('error', (error) => {
    addBrowserLog('error', error.stack ?? error.message);
  });

  page.on('requestfailed', (request: HTTPRequest) => {
    const failure = request.failure();
    addBrowserLog(
      'requestfailed',
      `${request.method()} ${request.url()}${failure ? ` :: ${failure.errorText}` : ''}`,
    );
  });

  page.on('response', (response: HTTPResponse) => {
    if (response.status() >= 400) {
      addBrowserLog('response.error', `${response.status()} ${response.url()}`);
    }
  });

  return {
    addBrowserLog,
    browser,
    flushBrowserLog,
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
): Promise<void> {
  try {
    const screenshot = await context.page.screenshot({
      fullPage: true,
    });

    await writeFile(context.screenshotPath, screenshot);
    context.addBrowserLog('artifact', `Saved screenshot to ${context.screenshotPath}`);
  } catch (error) {
    context.addBrowserLog(
      'artifact.error',
      `Failed to save screenshot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    await context.flushBrowserLog();
  } catch (error) {
    console.error(
      `Failed to write browser log: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await context.browser.close();
  await context.server.close();
}

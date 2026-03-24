import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { createServer } from 'vite';

const server = await createServer({
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});

let browser;

try {
  await server.listen();

  const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:4173/';

  browser = await puppeteer.launch({
    headless: true,
  });

  const page = await browser.newPage();
  let pageError;

  page.on('pageerror', (error) => {
    pageError = error;
  });

  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');

  assert.equal(pageError, undefined, `Page error: ${pageError?.message ?? 'unknown error'}`);

  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');

    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();

    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });

  assert(metrics, 'Expected a canvas element to be rendered.');
  assert.equal(metrics.width, metrics.innerWidth, 'Canvas should fill the viewport width.');
  assert.equal(metrics.height, metrics.innerHeight, 'Canvas should fill the viewport height.');

  console.log('Puppeteer test passed.');
} finally {
  await browser?.close();
  await server.close();
}

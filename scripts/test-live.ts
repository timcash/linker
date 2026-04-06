import assert from 'node:assert/strict';

import {launchSmokeBrowser, runSmokeTest} from './test/smoke';

const args = new Map<string, string | boolean>();

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];

  if (!argument?.startsWith('--')) {
    continue;
  }

  const [key, value] = argument.slice(2).split('=', 2);

  if (value !== undefined) {
    args.set(key, value);
    continue;
  }

  const nextValue = process.argv[index + 1];

  if (nextValue && !nextValue.startsWith('--')) {
    args.set(key, nextValue);
    index += 1;
    continue;
  }

  args.set(key, true);
}

const liveUrl =
  (typeof args.get('url') === 'string' ? String(args.get('url')) : '') ||
  process.env.LINKER_LIVE_URL ||
  'https://timcash.github.io/linker/';
const allowUnsupported = args.has('allow-unsupported') || process.env.LINKER_ALLOW_UNSUPPORTED === '1';
const browser = await launchSmokeBrowser({
  headless: process.env.LINKER_LIVE_TEST_HEADED === '1' ? false : true,
});

try {
  const page = await browser.newPage();
  const diagnostics = await runSmokeTest(page, {
    allowUnsupported,
    screenshotName: 'live-smoke',
    timeoutMs: 30_000,
    url: liveUrl,
  });

  if (!allowUnsupported) {
    assert.ok(
      diagnostics.planeCount >= 1,
      `Live page should report at least one workplane after booting ${liveUrl}.`,
    );
  }
} finally {
  await browser.close();
}

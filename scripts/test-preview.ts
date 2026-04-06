import assert from 'node:assert/strict';

import {build, preview} from 'vite';

import {launchSmokeBrowser, runSmokeTest} from './test/smoke';

const browser = await launchSmokeBrowser();

let previewServer:
  | Awaited<ReturnType<typeof preview>>
  | undefined;

try {
  await build({
    logLevel: 'error',
  });
  previewServer = await preview({
    logLevel: 'error',
    preview: {
      host: '127.0.0.1',
      port: 4176,
      strictPort: false,
    },
  });
  const baseUrl = previewServer.resolvedUrls?.local[0];

  assert.ok(baseUrl, 'Expected a local preview URL for the production smoke test.');

  const page = await browser.newPage();
  const diagnostics = await runSmokeTest(page, {
    screenshotName: 'preview-smoke',
    url: baseUrl,
  });

  assert.equal(diagnostics.stageMode, '3d-mode', 'Production preview should boot into stack view.');
  assert.equal(diagnostics.activeWorkplaneId, 'wp-3', 'Production preview should boot on wp-3.');
  assert.equal(diagnostics.planeCount, 5, 'Production preview should keep five workplanes loaded.');
} finally {
  await browser.close();
  await previewServer?.close();
}

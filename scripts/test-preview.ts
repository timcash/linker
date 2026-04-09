import assert from 'node:assert/strict';

import {build, preview} from 'vite';

import {
  appendLogEvent,
  createUnifiedViteLogger,
  initializeUnifiedLog,
} from './logging';
import {launchSmokeBrowser, runSmokeTest} from './test/smoke';

await initializeUnifiedLog({
  append: process.env.LINKER_APPEND_TEST_LOG === '1',
  cwd: process.cwd(),
  sessionLabel: 'Starting production preview smoke test.',
});

const browser = await launchSmokeBrowser();

let previewServer:
  | Awaited<ReturnType<typeof preview>>
  | undefined;

try {
  await build({
    customLogger: createUnifiedViteLogger('build'),
    logLevel: 'info',
  });
  previewServer = await preview({
    customLogger: createUnifiedViteLogger('preview'),
    logLevel: 'info',
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
  await appendLogEvent('test.preview.pass', `Preview smoke test passed for ${baseUrl}.`);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await appendLogEvent('test.preview.failure', message);
  throw error;
} finally {
  await browser.close();
  await previewServer?.close();
}

import assert from 'node:assert/strict';

import {DEFAULT_LIVE_SITE_URL} from '../src/remote-config';
import {appendLogEvent, initializeUnifiedLog} from './logging';
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
  DEFAULT_LIVE_SITE_URL;
const allowUnsupported = args.has('allow-unsupported') || process.env.LINKER_ALLOW_UNSUPPORTED === '1';
const expectOnboarding = args.has('expect-onboarding');

await initializeUnifiedLog({
  append: process.env.LINKER_APPEND_TEST_LOG === '1',
  cwd: process.cwd(),
  sessionLabel: `Starting live smoke test for ${liveUrl}.`,
});
const browser = await launchSmokeBrowser({
  headless: process.env.LINKER_LIVE_TEST_HEADED === '1' ? false : true,
});

try {
  const page = await browser.newPage();
  const diagnostics = await runSmokeTest(page, {
    allowUnsupported,
    expectOnboarding,
    screenshotName: 'live-smoke',
    timeoutMs: expectOnboarding ? 120_000 : 30_000,
    url: liveUrl,
  });

  if (!allowUnsupported) {
    if (expectOnboarding) {
      assert.equal(
        diagnostics.onboardingState,
        'complete',
        `Live onboarding should complete on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.onboardingStepId,
        'complete',
        `Live onboarding should finish on the completion step for ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.onboardingPanelVisible,
        true,
        `Live onboarding should leave the summary panel visible on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.activeWorkplaneId,
        'wp-1',
        `Live onboarding should refocus the root workplane on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.stageMode,
        '3d-mode',
        `Live onboarding should end in the 3D DAG overview on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.planeCount,
        5,
        `Live onboarding should end with five workplanes on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.dagNodeCount,
        5,
        `Live onboarding should export five DAG nodes on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.dagEdgeCount,
        4,
        `Live onboarding should export the current four DAG edges on ${liveUrl}.`,
      );
      assert.equal(
        diagnostics.renderBridgeLinkCount,
        4,
        `Live onboarding should render the four DAG edges on ${liveUrl}.`,
      );
    } else {
      assert.ok(
        diagnostics.planeCount >= 1,
        `Live page should report at least one workplane after booting ${liveUrl}.`,
      );
    }
  }
  await appendLogEvent('test.live.pass', `Live smoke test passed for ${liveUrl}.`);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await appendLogEvent('test.live.failure', message);
  throw error;
} finally {
  await browser.close();
}

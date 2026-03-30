import assert from 'node:assert/strict';
import {appendFile, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  createBrowserTestContext,
  destroyBrowserTestContext,
  runStaticUnitTests,
} from './test/000_setup';
import {runReadyStep} from './test/001_ready';
import {runPanelsStep} from './test/002_panels';
import {runLayoutStrategiesStep} from './test/003_layout_strategies';
import {runCameraControlsStep} from './test/004_camera_controls';
import {runInputGuardsStep} from './test/005_input_guards';
import {runLineStrategiesStep} from './test/006_line_strategies';
import {runDeepZoomCubeStep} from './test/007_deep_zoom_cube';
import {runLabelEditStep} from './test/008_label_edit_strategy';
import {runExtendedMatrixStep} from './test/900_extended_matrix';
import {
  getLineState,
  INTENTIONAL_ERROR_MARKER,
  RUN_EXTENDED_TEST_MATRIX,
  openRoute,
  switchLineStrategy,
  type BrowserTestContext,
} from './test/shared';

const logPath = path.resolve(process.cwd(), 'test.log');
const errorLogPath = path.resolve(process.cwd(), 'error.log');

let context: BrowserTestContext | undefined;
let testError: Error | undefined;

try {
  if (process.env.LINKER_APPEND_TEST_LOG !== '1') {
    await writeFile(logPath, '', 'utf8');
  }
  if (process.env.LINKER_APPEND_ERROR_LOG !== '1') {
    await writeFile(errorLogPath, '', 'utf8');
  }

  runStaticUnitTests();
  context = await createBrowserTestContext();

  const readyResult = await runReadyStep(context);

  if (readyResult !== null) {
    await runLabelEditStep(context);
    await runPanelsStep(context);
    await runLineStrategiesStep(context);
    await runLayoutStrategiesStep(context);
    await runCameraControlsStep(context);
    await runDeepZoomCubeStep(context);
    await runInputGuardsStep(context);

    if (RUN_EXTENDED_TEST_MATRIX) {
      await runExtendedMatrixStep(context);
    }

    await prepareBrowserArtifactState(context);
  }

  if (context) {
    await context.flushErrorLog();
  }
  if (await hasUnexpectedErrorLogEntries()) {
    throw new Error('error.log contains unexpected entries. See error.log for details.');
  }

  context.addBrowserLog('test', 'Browser test passed.');
  console.log('Browser test passed.');
} catch (error) {
  testError = error instanceof Error ? error : new Error(String(error));

  if (context) {
    context.addBrowserLog('test.failure', testError.stack ?? testError.message);
    context.addErrorLog('test.failure', testError.stack ?? testError.message);
  } else {
    await appendFile(errorLogPath, `${formatErrorLogLine(testError.stack ?? testError.message)}\n`, 'utf8');
  }
} finally {
  if (context) {
    await destroyBrowserTestContext(context);
  }
}

if (testError) {
  throw testError;
}

async function hasUnexpectedErrorLogEntries(): Promise<boolean> {
  try {
    const contents = await readFile(errorLogPath, 'utf8');
    return getUnexpectedErrorLogLines(contents).length > 0;
  } catch {
    return false;
  }
}

function getUnexpectedErrorLogLines(contents: string): string[] {
  return contents
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes(INTENTIONAL_ERROR_MARKER));
}

function formatErrorLogLine(message: string): string {
  return message.replace(/\r?\n/g, '\\n');
}

async function prepareBrowserArtifactState(context: BrowserTestContext): Promise<void> {
  const artifactUrl = new URL(context.url);
  artifactUrl.searchParams.set('lineStrategy', 'rounded-step-links');

  await openRoute(context.page, artifactUrl.toString());
  await switchLineStrategy(context.page, 'rounded-step-links');

  const lineState = await getLineState(context.page);
  assert.equal(
    lineState.lineStrategy,
    'rounded-step-links',
    'Final browser screenshot should use rounded-step-links.',
  );
  assert.equal(
    lineState.strategyPanelMode,
    'line',
    'Final browser screenshot should keep the line strategy panel visible.',
  );

  context.addBrowserLog(
    'artifact.state',
    `Prepared browser.png with lineStrategy=${lineState.lineStrategy} and strategyPanelMode=${lineState.strategyPanelMode}.`,
  );
}

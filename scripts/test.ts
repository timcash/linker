import {appendFile, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  createBrowserTestContext,
  destroyBrowserTestContext,
  runStaticUnitTests,
} from './test/setup';
import {runBootFlow} from './test/boot';
import {runSessionRestoreFlow} from './test/session-restore';
import {runStackOrbitCoverageFlow} from './test/stack-orbit-coverage';
import {runViewModesFlow} from './test/view-modes';
import {runWorkplaneLifecycleFlow} from './test/workplane-lifecycle';
import {
  INTENTIONAL_ERROR_MARKER,
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

  const bootResult = await runBootFlow(context);

  if (bootResult !== null) {
    await runWorkplaneLifecycleFlow(context);
    await runSessionRestoreFlow(context);
    await runViewModesFlow(context);
    await runStackOrbitCoverageFlow(context);
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

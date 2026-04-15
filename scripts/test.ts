import {
  createBrowserTestContext,
  destroyBrowserTestContext,
  runStaticUnitTests,
} from './test/setup';
import {
  appendLogEvent,
  getUnexpectedStructuredErrorLines,
  initializeUnifiedLog,
  readUnifiedLog,
  resolveUnifiedLogPath,
} from './logging';
import {createTestPerformanceCollector} from './test/performance';
import {runAuthPageSmokeFlow} from './test/auth-page-smoke';
import {runBootFlow} from './test/boot';
import {runCodexPageSmokeFlow} from './test/codex-page-smoke';
import {runDagControlPadFlow} from './test/dag-control-pad';
import {runDagRankFanoutFlow} from './test/dag-rank-fanout';
import {runDagViewSmokeFlow} from './test/dag-view-smoke';
import {runDagZoomJourneyFlow} from './test/dag-zoom-journey';
import {runReadmePreviewSmokeFlow} from './test/readme-preview-smoke';
import {runTasksDashboardSmokeFlow} from './test/tasks-dashboard-smoke';
import {
  INTENTIONAL_ERROR_MARKER,
  type BrowserTestContext,
} from './test/shared';

type BrowserFlowName =
  | 'auth-page-smoke'
  | 'boot'
  | 'codex-page-smoke'
  | 'dag-control-pad'
  | 'dag-rank-fanout'
  | 'dag-view-smoke'
  | 'dag-zoom-journey'
  | 'full'
  | 'readme-preview-smoke'
  | 'tasks-dashboard-smoke';
type CliOptions = {
  flow: BrowserFlowName;
  keepOpen: boolean;
};

const performanceCollector = createTestPerformanceCollector();
const cliOptions = parseCliOptions(process.argv.slice(2));

let context: BrowserTestContext | undefined;
let testError: Error | undefined;
let performanceSummaryReported = false;

try {
  const logPath = await initializeUnifiedLog({
    append: process.env.LINKER_APPEND_TEST_LOG === '1',
    cwd: process.cwd(),
    sessionLabel: `Starting browser test flow ${cliOptions.flow}.`,
  });
  const sessionLogStartOffset = (await readUnifiedLog(logPath)).length;

  if (cliOptions.flow === 'full') {
    await appendLogEvent('test.static.start', 'Running static unit tests before browser flows.', {logPath});
    runStaticUnitTests();
    await appendLogEvent('test.static.pass', 'Static unit tests passed.', {logPath});
  }
  context = await createBrowserTestContext();
  await runSelectedBrowserFlows(context, cliOptions);

  if (context) {
    reportPerformanceSummary(context);
    await context.flushErrorLog();
  }
  if (await hasUnexpectedErrorLogEntries(sessionLogStartOffset)) {
    throw new Error(`test.log contains unexpected structured error entries. See ${resolveUnifiedLogPath()} for details.`);
  }

  context.addBrowserLog('test', 'Browser test passed.');
  console.log('Browser test passed.');

  if (cliOptions.keepOpen) {
    await destroyBrowserTestContext(context, {close: false});
    const keptOpenContext = context;
    context = undefined;
    console.log('Browser left open at the final DAG overview. Press Ctrl+C in this terminal to close it.');
    await waitForKeepOpenShutdown(keptOpenContext);
  }
} catch (error) {
  testError = error instanceof Error ? error : new Error(String(error));

  if (context) {
    context.addBrowserLog('test.failure', testError.stack ?? testError.message);
    context.addErrorLog('test.failure', testError.stack ?? testError.message);
  } else {
    await appendLogEvent('test.failure', testError.stack ?? testError.message, {
      logPath: resolveUnifiedLogPath(),
    });
  }
} finally {
  if (context && testError) {
    reportPerformanceSummary(context);
  }
  if (context) {
    await destroyBrowserTestContext(context);
  }
}

if (testError) {
  throw testError;
}

async function hasUnexpectedErrorLogEntries(startOffset: number): Promise<boolean> {
  const contents = await readUnifiedLog(resolveUnifiedLogPath());
  const sessionContents = contents.slice(startOffset);
  return getUnexpectedStructuredErrorLines(sessionContents).filter(
    (line) => !line.includes(INTENTIONAL_ERROR_MARKER),
  ).length > 0;
}

function reportPerformanceSummary(context: BrowserTestContext): void {
  if (performanceSummaryReported) {
    return;
  }

  performanceSummaryReported = true;

  if (performanceCollector.hasEntries()) {
    context.addBrowserLog('perf.report', 'Collected orbit performance summary.');
  }

  for (const line of performanceCollector.formatReportLines()) {
    console.log(line);
    context.addBrowserLog('perf.report', line);
  }
}

async function runSelectedBrowserFlows(
  context: BrowserTestContext,
  options: CliOptions,
): Promise<void> {
  if (options.flow === 'boot') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runBootFlow(context);
    return;
  }

  if (options.flow === 'codex-page-smoke') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runCodexPageSmokeFlow(context);
    return;
  }

  if (options.flow === 'dag-view-smoke') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runDagViewSmokeFlow(context);
    return;
  }

  if (options.flow === 'dag-control-pad') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runDagControlPadFlow(context);
    return;
  }

  if (options.flow === 'dag-rank-fanout') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runDagRankFanoutFlow(context);
    return;
  }

  if (options.flow === 'dag-zoom-journey') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runDagZoomJourneyFlow(context);
    return;
  }

  if (options.flow === 'tasks-dashboard-smoke') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runTasksDashboardSmokeFlow(context);
    return;
  }

  if (options.flow === 'readme-preview-smoke') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runReadmePreviewSmokeFlow(context);
    return;
  }

  if (options.flow === 'auth-page-smoke') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runAuthPageSmokeFlow(context);
    return;
  }

  const bootResult = await runBootFlow(context);

  if (bootResult === null) {
    return;
  }

  await runDagViewSmokeFlow(context);
  await runDagControlPadFlow(context);
  await runDagRankFanoutFlow(context);
  await runDagZoomJourneyFlow(context);
  await runCodexPageSmokeFlow(context);
  await runAuthPageSmokeFlow(context);
  await runTasksDashboardSmokeFlow(context);
  await runReadmePreviewSmokeFlow(context);
}

function parseCliOptions(args: string[]): CliOptions {
  let flow: BrowserFlowName = 'full';
  let keepOpen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--keep-open') {
      keepOpen = true;
      continue;
    }

    if (argument === '--flow' || argument === '-f') {
      const requestedFlow = args[index + 1];

      if (
        requestedFlow === 'boot' ||
        requestedFlow === 'codex-page-smoke' ||
        requestedFlow === 'dag-control-pad' ||
        requestedFlow === 'dag-rank-fanout' ||
        requestedFlow === 'dag-view-smoke' ||
        requestedFlow === 'dag-zoom-journey' ||
        requestedFlow === 'full' ||
        requestedFlow === 'auth-page-smoke' ||
        requestedFlow === 'readme-preview-smoke' ||
        requestedFlow === 'tasks-dashboard-smoke'
      ) {
        flow = requestedFlow;
        index += 1;
        continue;
      }

      throw new Error(
        `Unsupported --flow value "${requestedFlow ?? ''}". Expected one of: full, boot, codex-page-smoke, dag-view-smoke, dag-control-pad, dag-rank-fanout, dag-zoom-journey, auth-page-smoke, tasks-dashboard-smoke, readme-preview-smoke.`,
      );
    }

    throw new Error(`Unsupported test argument "${argument}".`);
  }

  return {flow, keepOpen};
}

async function waitForKeepOpenShutdown(
  context: BrowserTestContext,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = async (closeBrowser: boolean): Promise<void> => {
      if (settled) {
        return;
      }

      settled = true;
      process.off('SIGINT', handleSignal);
      process.off('SIGTERM', handleSignal);
      context.browser.off('disconnected', handleDisconnect);

      try {
        if (closeBrowser) {
          await context.browser.close().catch(() => undefined);
        }

        await context.server.close();
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    const handleSignal = (): void => {
      void finish(true);
    };
    const handleDisconnect = (): void => {
      void finish(false);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);
    context.browser.on('disconnected', handleDisconnect);
  });
}

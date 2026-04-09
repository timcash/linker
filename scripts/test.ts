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
import {runBootFlow} from './test/boot';
import {runDagViewSmokeFlow} from './test/dag-view-smoke';
import {runEmptyDatasetBuildFlow} from './test/empty-dataset-build';
import {runEditorInteractionsFlow} from './test/editor-interactions';
import {runPlaneFocusControlsFlow} from './test/plane-focus-controls';
import {runPlaneFocusHighZoomPerformanceFlow} from './test/plane-focus-high-zoom-performance';
import {runReadmePreviewSmokeFlow} from './test/readme-preview-smoke';
import {publishReadmeShowcase} from './test/readme-showcase';
import {runStackOrbitCoverageFlow} from './test/stack-orbit-coverage';
import {runTasksDashboardSmokeFlow} from './test/tasks-dashboard-smoke';
import {runViewModesFlow} from './test/view-modes';
import {runWorkplaneLifecycleFlow} from './test/workplane-lifecycle';
import {
  INTENTIONAL_ERROR_MARKER,
  type BrowserTestContext,
} from './test/shared';

type BrowserFlowName =
  | 'dag-view-smoke'
  | 'empty-dataset-build'
  | 'full'
  | 'readme-preview-smoke'
  | 'tasks-dashboard-smoke';
type CliOptions = {
  flow: BrowserFlowName;
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
  if (options.flow === 'empty-dataset-build') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runEmptyDatasetBuildFlow(context);
    return;
  }

  if (options.flow === 'dag-view-smoke') {
    context.addBrowserLog('test', `Running focused browser flow ${options.flow}.`);
    await runDagViewSmokeFlow(context);
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

  const bootResult = await runBootFlow(context);

  if (bootResult === null) {
    return;
  }

  await runPlaneFocusControlsFlow(context);
  await runPlaneFocusHighZoomPerformanceFlow(context, performanceCollector);
  await runEditorInteractionsFlow(context);
  await runEmptyDatasetBuildFlow(context);
  await runWorkplaneLifecycleFlow(context);
  await runViewModesFlow(context);
  await runStackOrbitCoverageFlow(context, performanceCollector);
  await publishReadmeShowcase(context);
  await runTasksDashboardSmokeFlow(context);
  await runReadmePreviewSmokeFlow(context);
}

function parseCliOptions(args: string[]): CliOptions {
  let flow: BrowserFlowName = 'full';

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--flow' || argument === '-f') {
      const requestedFlow = args[index + 1];

      if (
        requestedFlow === 'dag-view-smoke' ||
        requestedFlow === 'empty-dataset-build' ||
        requestedFlow === 'full' ||
        requestedFlow === 'readme-preview-smoke' ||
        requestedFlow === 'tasks-dashboard-smoke'
      ) {
        flow = requestedFlow;
        index += 1;
        continue;
      }

      throw new Error(
        `Unsupported --flow value "${requestedFlow ?? ''}". Expected one of: full, empty-dataset-build, dag-view-smoke, tasks-dashboard-smoke, readme-preview-smoke.`,
      );
    }

    throw new Error(`Unsupported test argument "${argument}".`);
  }

  return {flow};
}

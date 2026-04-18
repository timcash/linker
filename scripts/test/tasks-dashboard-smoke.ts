import path from 'node:path';

import assert from 'node:assert/strict';

import {writeTasksDashboard} from '../agent-loop/write-tasks-dashboard';
import {openRoute, type BrowserTestContext} from './shared';

export async function runTasksDashboardSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  const data = await writeTasksDashboard(process.cwd());
  const tasksUrl = new URL('tasks/', context.url).toString();
  const script = await context.page.evaluateOnNewDocument(() => {
    (
      window as Window & {
        __LINKER_TASKS_TEST_HOOKS__?: {
          refreshIntervalMs?: number;
        };
      }
    ).__LINKER_TASKS_TEST_HOOKS__ = {
      refreshIntervalMs: 250,
    };
  });

  try {
    context.addBrowserLog('test', `Opening tasks dashboard route ${tasksUrl}.`);
    await context.page.goto(tasksUrl, {waitUntil: 'load'});
    await context.page.waitForFunction(() => document.body.classList.contains('tasks-route'));
    await context.page.waitForFunction(() => {
      const heading = document.querySelector('h1');
      return heading?.textContent?.includes('Agent Loop Tasks') ?? false;
    });

    if (data.currentTask) {
      await context.page.waitForFunction(
        (taskId) => document.body.innerText.includes(taskId),
        {},
        data.currentTask.id,
      );
    }

    if (data.loopSummary.lastRunId) {
      await context.page.waitForFunction(
        (runId) => document.body.innerText.includes(runId),
        {},
        data.loopSummary.lastRunId,
      );
    }

    await context.page.evaluate(() => {
      (
        window as Window & {
          __LINKER_TASKS_HERO__?: Element | null;
        }
      ).__LINKER_TASKS_HERO__ = document.querySelector('.tasks-hero');
    });
    await context.page.waitForFunction(
      () => {
        const appRoot = document.querySelector<HTMLElement>('#app');
        return Number(appRoot?.dataset.tasksRefreshCount ?? '0') >= 2;
      },
      {timeout: 5000},
    );

    const pageState = await context.page.evaluate(() => {
      const refreshNote = document.querySelector('.tasks-refresh-note');
      const appRoot = document.querySelector<HTMLElement>('#app');

      return {
        bodyText: document.body.innerText,
        heroPreserved:
          (
            window as Window & {
              __LINKER_TASKS_HERO__?: Element | null;
            }
          ).__LINKER_TASKS_HERO__ === document.querySelector('.tasks-hero'),
        refreshCount: Number(appRoot?.dataset.tasksRefreshCount ?? '0'),
        refreshNoteText: refreshNote?.textContent?.trim() ?? '',
        sectionTitles: Array.from(document.querySelectorAll<HTMLElement>('.tasks-section-title')).map(
          (element) => element.textContent?.trim() ?? '',
        ),
        tableCount: document.querySelectorAll('table').length,
        title: document.title,
      };
    });

    assert.equal(pageState.title, 'Linker Tasks', 'The /tasks route should set a dedicated page title.');
    assert.ok(pageState.tableCount >= 5, 'The /tasks route should render multiple status tables.');
    assert.ok(pageState.refreshCount >= 2, 'The /tasks route should background-refresh in place.');
    assert.equal(pageState.heroPreserved, true, 'The /tasks route should preserve the page shell during background refreshes.');
    assert.match(
      pageState.refreshNoteText,
      /Last updated/u,
      'The /tasks route should show a background-refresh status note after data loads.',
    );
    assert.doesNotMatch(
      pageState.bodyText,
      /Loading tasks dashboard\.\.\./u,
      'The /tasks route should not flash the loading state again after the initial render.',
    );
    assert.deepEqual(
      pageState.sectionTitles,
      ['Loop Summary', 'Current Task', 'Next Tasks', 'Task Ladder', 'Run History', 'Review Steps'],
      'The /tasks route should render the expected dashboard sections in order.',
    );

    if (data.currentTask) {
      assert.match(
        pageState.bodyText,
        new RegExp(escapeRegExp(data.currentTask.id)),
        'The /tasks route should show the active task id.',
      );
    }

    if (data.loopSummary.lastRunId) {
      assert.match(
        pageState.bodyText,
        new RegExp(escapeRegExp(data.loopSummary.lastRunId)),
        'The /tasks route should show the latest run id.',
      );
    }

    if (data.reviewSteps.length > 0 && data.reviewSteps[0]?.stepId) {
      assert.match(
        pageState.bodyText,
        new RegExp(escapeRegExp(data.reviewSteps[0].stepId)),
        'The /tasks route should show monitor review step ids.',
      );
    }

    assert.match(
      pageState.bodyText,
      /npm run test:browser -- --flow dag-view-smoke/u,
      'The /tasks route should show per-run command results in the run history table.',
    );

    await saveTasksDashboardScreenshot(context, 'tasks-dashboard');
    await openRoute(context.page, context.url);
  } finally {
    await context.page.removeScriptToEvaluateOnNewDocument(
      (script as {identifier: string}).identifier,
    );
  }
}

async function saveTasksDashboardScreenshot(
  context: BrowserTestContext,
  name: string,
): Promise<void> {
  context.interactionScreenshotCounter += 1;
  const filename = `${String(context.interactionScreenshotCounter).padStart(2, '0')}-${name}.png`;
  const screenshotPath = path.join(context.interactionScreenshotDir, filename);

  await context.page.screenshot({
    fullPage: true,
    path: screenshotPath,
  });
  context.addBrowserLog('artifact.step', `Saved interaction screenshot to ${screenshotPath}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

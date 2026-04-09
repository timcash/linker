import type {
  TasksDashboardData,
  TasksDashboardRun,
  TasksDashboardTask,
} from './tasks-dashboard-types';
import { createDocsNav } from './docs-shell';

const DEFAULT_REFRESH_INTERVAL_MS = 5000;

type TasksPageFrame = {
  currentTaskContent: HTMLElement;
  errorBanner: HTMLElement;
  heroCurrentTaskValue: HTMLElement;
  heroLastDecisionValue: HTMLElement;
  heroLastRunValue: HTMLElement;
  heroLiveSiteValue: HTMLElement;
  loopSummaryContent: HTMLElement;
  nextTasksContent: HTMLElement;
  refreshNote: HTMLElement;
  reviewStepsContent: HTMLElement;
  runHistoryContent: HTMLElement;
  shell: HTMLElement;
  taskLadderContent: HTMLElement;
};

type TasksSectionFrame = {
  content: HTMLElement;
  section: HTMLElement;
};

export type TasksPageHandle = {
  destroy: () => void;
};

export async function startTasksPage(root: HTMLElement): Promise<TasksPageHandle> {
  document.title = 'Linker Tasks';
  document.body.classList.add('docs-route', 'tasks-route');
  root.classList.add('tasks-page-root');

  const frame = createTasksPageFrame();
  root.replaceChildren(frame.shell);
  root.dataset.tasksRefreshCount = '0';

  const refreshIntervalMs = resolveRefreshIntervalMs();
  let disposed = false;
  let hasLoaded = false;
  let refreshCount = 0;
  let refreshInFlight = false;

  const render = async (): Promise<void> => {
    if (disposed || refreshInFlight) {
      return;
    }

    refreshInFlight = true;

    if (!hasLoaded) {
      frame.refreshNote.textContent = 'Loading tasks dashboard...';
      frame.refreshNote.dataset.state = 'loading';
    } else {
      frame.refreshNote.textContent = 'Refreshing tasks dashboard in the background...';
      frame.refreshNote.dataset.state = 'refreshing';
    }

    try {
      const data = await loadTasksDashboardData();

      if (disposed) {
        return;
      }

      applyTasksPageData(frame, data);
      hasLoaded = true;
      refreshCount += 1;
      root.dataset.tasksRefreshCount = String(refreshCount);
      frame.errorBanner.hidden = true;
      frame.refreshNote.dataset.state = 'ready';
      frame.refreshNote.textContent = `Last updated ${formatDateTime(data.loopSummary.generatedAt)}. Auto-refresh every ${formatRefreshInterval(
        refreshIntervalMs,
      )}.`;
    } catch (error) {
      if (disposed) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      frame.errorBanner.hidden = false;
      frame.errorBanner.textContent = hasLoaded
        ? `Background refresh failed. Showing the last successful snapshot. ${message}`
        : message;
      frame.refreshNote.dataset.state = 'error';
      frame.refreshNote.textContent = hasLoaded
        ? 'Background refresh failed. Keeping the last successful dashboard snapshot visible.'
        : 'Unable to load tasks dashboard.';
    } finally {
      refreshInFlight = false;
    }
  };

  await render();
  const intervalId = window.setInterval(() => {
    void render();
  }, refreshIntervalMs);

  return {
    destroy: () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.body.classList.remove('docs-route', 'tasks-route');
      delete root.dataset.tasksRefreshCount;
      root.replaceChildren();
    },
  };
}

async function loadTasksDashboardData(): Promise<TasksDashboardData> {
  const baseUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
  const dataUrl = new URL('tasks-data.json', baseUrl);
  dataUrl.searchParams.set('ts', Date.now().toString());

  const response = await fetch(dataUrl, {cache: 'no-store'});

  if (!response.ok) {
    throw new Error(`Failed to load tasks data (${response.status}). Run the agent loop once to generate /public/tasks-data.json.`);
  }

  return (await response.json()) as TasksDashboardData;
}

function createTasksPageFrame(): TasksPageFrame {
  const shell = document.createElement('main');
  shell.className = 'page-shell docs-page tasks-page';
  shell.append(createDocsNav('tasks'));

  const hero = document.createElement('header');
  hero.className = 'hero tasks-hero';

  const title = document.createElement('h1');
  title.textContent = 'Agent Loop Tasks';

  const subtitle = document.createElement('p');
  subtitle.textContent =
    'Live task packet, worker and monitor progress, required command results, and review steps from the supervised loop.';

  const meta = document.createElement('div');
  meta.className = 'tasks-hero-meta';

  const currentTaskBadge = createMetaBadge('Current Task');
  const lastRunBadge = createMetaBadge('Last Run');
  const lastDecisionBadge = createMetaBadge('Last Decision');
  const liveSiteBadge = createMetaBadge('Live Site');

  meta.append(
    currentTaskBadge.badge,
    lastRunBadge.badge,
    lastDecisionBadge.badge,
    liveSiteBadge.badge,
  );

  const refreshNote = document.createElement('p');
  refreshNote.className = 'tasks-refresh-note';
  refreshNote.dataset.state = 'loading';
  refreshNote.setAttribute('aria-live', 'polite');
  refreshNote.textContent = 'Loading tasks dashboard...';

  hero.append(title, subtitle, meta, refreshNote);

  const errorBanner = document.createElement('div');
  errorBanner.className = 'tasks-state tasks-state-error tasks-refresh-banner';
  errorBanner.hidden = true;

  const loopSummary = createSectionFrame('Loop Summary');
  const currentTask = createSectionFrame('Current Task');
  const nextTasks = createSectionFrame('Next Tasks');
  const taskLadder = createSectionFrame('Task Ladder');
  const runHistory = createSectionFrame('Run History');
  const reviewSteps = createSectionFrame('Review Steps');

  shell.append(
    hero,
    errorBanner,
    loopSummary.section,
    currentTask.section,
    nextTasks.section,
    taskLadder.section,
    runHistory.section,
    reviewSteps.section,
  );

  return {
    currentTaskContent: currentTask.content,
    errorBanner,
    heroCurrentTaskValue: currentTaskBadge.value,
    heroLastDecisionValue: lastDecisionBadge.value,
    heroLastRunValue: lastRunBadge.value,
    heroLiveSiteValue: liveSiteBadge.value,
    loopSummaryContent: loopSummary.content,
    nextTasksContent: nextTasks.content,
    refreshNote,
    reviewStepsContent: reviewSteps.content,
    runHistoryContent: runHistory.content,
    shell,
    taskLadderContent: taskLadder.content,
  };
}

function applyTasksPageData(frame: TasksPageFrame, data: TasksDashboardData): void {
  frame.heroCurrentTaskValue.textContent = data.currentTask?.id ?? 'none';
  frame.heroLastRunValue.textContent = data.loopSummary.lastRunId ?? 'none';
  frame.heroLastDecisionValue.textContent = data.loopSummary.lastDecision ?? 'none';
  frame.heroLiveSiteValue.textContent = summarizeLatestLiveStatus(data.runs);

  frame.loopSummaryContent.replaceChildren(
    buildKeyValueTable([
      ['Generated', formatDateTime(data.loopSummary.generatedAt)],
      ['Current Slice', String(data.loopSummary.currentSlice)],
      ['Current Task', data.currentTask ? `${data.currentTask.id} (${data.currentTask.title})` : 'none'],
      ['Loop Status', data.loopSummary.status],
      ['Iteration', String(data.loopSummary.iteration)],
      ['Last Decision', data.loopSummary.lastDecision ?? 'none'],
      ['Last Run', data.loopSummary.lastRunId ?? 'none'],
      ['Workspace Mode', data.loopSummary.workerWorkspaceMode],
    ]),
  );
  frame.currentTaskContent.replaceChildren(
    data.currentTask
      ? buildCurrentTaskTable(data.currentTask)
      : createEmptyState('No current task is available yet. Run the loop to prepare a task packet.'),
  );
  frame.nextTasksContent.replaceChildren(
    data.nextTaskIdeas.length > 0
      ? buildTaskIdeasTable(data.nextTaskIdeas)
      : createEmptyState('No next task ideas are available yet.'),
  );
  frame.taskLadderContent.replaceChildren(buildTaskTable(data.tasks));
  frame.runHistoryContent.replaceChildren(buildRunTable(data.runs));
  frame.reviewStepsContent.replaceChildren(buildReviewStepsTable(data));
}

function createMetaBadge(label: string): {
  badge: HTMLElement;
  value: HTMLElement;
} {
  const item = document.createElement('div');
  item.className = 'tasks-meta-badge';

  const itemLabel = document.createElement('span');
  itemLabel.className = 'tasks-meta-label';
  itemLabel.textContent = label;

  const itemValue = document.createElement('span');
  itemValue.className = 'tasks-meta-value';
  itemValue.textContent = '...';

  item.append(itemLabel, itemValue);

  return {
    badge: item,
    value: itemValue,
  };
}

function createSectionFrame(title: string): TasksSectionFrame {
  const section = document.createElement('section');
  section.className = 'tasks-section';

  const heading = document.createElement('h2');
  heading.className = 'tasks-section-title';
  heading.textContent = title;

  const content = document.createElement('div');
  content.className = 'tasks-section-content';
  content.append(createEmptyState('Waiting for tasks dashboard data...'));

  section.append(heading, content);

  return {
    content,
    section,
  };
}

function buildKeyValueTable(rows: Array<[string, string]>): HTMLElement {
  return buildTable(
    ['Field', 'Value'],
    rows.map(([label, value]) => [label, value]),
  );
}

function buildCurrentTaskTable(task: TasksDashboardTask): HTMLElement {
  return buildTable(
    ['Field', 'Value'],
    [
      ['Task', `${task.id} (${task.title})`],
      ['Role', task.role],
      ['Status', task.status],
      ['Verify', `${task.verifyCommand} => ${task.expectedResult}`],
      ['Intent', task.intent],
      ['Allowed Files', task.allowedFiles.join('\n')],
      ['Context Files', task.contextFiles.join('\n')],
      ['Done When', task.doneWhen.join('\n')],
      ['Notes', task.notes.join('\n')],
    ],
  );
}

function buildTaskIdeasTable(tasks: TasksDashboardTask[]): HTMLElement {
  return buildTable(
    ['Task', 'Role', 'Verify', 'Status', 'Intent'],
    tasks.map((task) => [
      `${task.id}\n${task.title}`,
      task.role,
      `${task.verifyCommand}\nexpects ${task.expectedResult}`,
      task.status,
      task.intent,
    ]),
  );
}

function buildTaskTable(tasks: TasksDashboardTask[]): HTMLElement {
  return buildTable(
    ['Slice', 'Task', 'Role', 'Status', 'Last Decision', 'Last Run', 'Verify'],
    tasks.map((task) => [
      String(task.slice),
      `${task.id}\n${task.title}`,
      task.role,
      task.status,
      task.decision ?? 'none',
      task.lastRunId ?? 'none',
      `${task.verifyCommand}\nexpects ${task.expectedResult}`,
    ]),
  );
}

function buildRunTable(runs: TasksDashboardRun[]): HTMLElement {
  if (runs.length === 0) {
    return createEmptyState('No loop runs have been recorded yet.');
  }

  return buildTable(
    [
      'Run',
      'When',
      'Task',
      'Worker',
      'Monitor',
      'Docs',
      'Commands',
      'Changed Files',
      'Local Browser',
      'Live Site',
      'Scope',
      'Promote',
    ],
    runs.map((run) => [
      run.runId,
      formatDateTime(run.createdAt),
      run.taskId ? `${run.taskId}\n${run.taskTitle ?? ''}` : 'none',
      `${run.workerStatus ?? 'none'}\n${run.workerSummary ?? ''}`,
      `${run.decision ?? 'none'}\n${run.monitorSummary ?? ''}`,
      run.docsPresent.join('\n') || 'none',
      run.commandStatuses.join('\n') || 'none',
      run.changedFiles.join('\n') || 'none',
      run.localBrowserStatus,
      run.liveStatus,
      `slice: ${run.scopeStatus}\ntask: ${run.taskScopeStatus}`,
      `ready: ${run.reviewReady ? 'yes' : 'no'}\n${run.promotionStatus ?? 'not-promoted'}`,
    ]),
  );
}

function buildReviewStepsTable(data: TasksDashboardData): HTMLElement {
  if (data.reviewSteps.length === 0) {
    return createEmptyState('No monitor review steps are available yet.');
  }

  return buildTable(
    ['Run', 'Task', 'Step', 'Status', 'Title', 'Evidence'],
    data.reviewSteps.map((step) => [
      step.runId,
      step.taskId ?? 'none',
      step.stepId,
      step.status,
      step.title,
      step.evidence,
    ]),
  );
}

function buildTable(headers: string[], rows: string[][]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'tasks-table-wrap';

  const table = document.createElement('table');
  table.className = 'tasks-table';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');

  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headRow.append(th);
  }

  thead.append(headRow);

  const tbody = document.createElement('tbody');

  for (const row of rows) {
    const tr = document.createElement('tr');

    for (const value of row) {
      const td = document.createElement('td');
      td.append(createCellContent(value));
      tr.append(td);
    }

    tbody.append(tr);
  }

  table.append(thead, tbody);
  wrapper.append(table);
  return wrapper;
}

function createCellContent(value: string): HTMLElement {
  const container = document.createElement('div');
  container.className = 'tasks-cell';

  const lines = value.split('\n').filter((line) => line.length > 0);

  for (const line of lines.length > 0 ? lines : ['']) {
    const div = document.createElement('div');
    div.textContent = line;
    container.append(div);
  }

  return container;
}

function createEmptyState(message: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'tasks-state';
  element.textContent = message;
  return element;
}

function summarizeLatestLiveStatus(runs: TasksDashboardRun[]): string {
  const latestRun = runs[0];
  return latestRun?.liveStatus ?? 'not-run';
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatRefreshInterval(refreshIntervalMs: number): string {
  if (refreshIntervalMs >= 1000) {
    return `${(refreshIntervalMs / 1000).toFixed(refreshIntervalMs % 1000 === 0 ? 0 : 1)}s`;
  }

  return `${refreshIntervalMs}ms`;
}

function resolveRefreshIntervalMs(): number {
  const hookedValue = (window as Window & {
    __LINKER_TASKS_TEST_HOOKS__?: {
      refreshIntervalMs?: number;
    };
  }).__LINKER_TASKS_TEST_HOOKS__?.refreshIntervalMs;

  if (typeof hookedValue === 'number' && Number.isFinite(hookedValue) && hookedValue >= 100) {
    return Math.trunc(hookedValue);
  }

  return DEFAULT_REFRESH_INTERVAL_MS;
}

import {mkdir, readdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {
  TasksDashboardData,
  TasksDashboardLoopSummary,
  TasksDashboardReviewStep,
  TasksDashboardRun,
  TasksDashboardTask,
} from '../../src/tasks-dashboard-types';
import {
  createLoopPaths,
  readJsonFile,
  resolveCurrentSliceTask,
  resolveNextSliceTasks,
  type CheckResults,
  type LoopConfig,
  type LoopState,
  type MonitorReview,
  type PreparedSlice,
  type PromotionManifest,
  type PromotionResult,
  type SliceTask,
  type WorkerReport,
} from './shared';

export async function writeTasksDashboard(root: string): Promise<TasksDashboardData> {
  const paths = createLoopPaths(root);
  const config = await readJsonFile<LoopConfig>(paths.configPath);
  const state = await readJsonFile<LoopState>(paths.statePath);
  const currentSliceDefinition = config.slices.find((slice) => slice.slice === state.currentSlice) ?? null;
  const runDirs = await listRunDirectories(paths.runRoot);
  const runRows: TasksDashboardRun[] = [];
  const reviewSteps: TasksDashboardReviewStep[] = [];
  const taskRunIndex = new Map<string, TasksDashboardRun[]>();

  for (const runDir of runDirs) {
    const run = await readRunDashboardData(runDir);
    if (!run) {
      continue;
    }

    runRows.push(run.runRow);
    reviewSteps.push(...run.reviewSteps);

    if (run.runRow.taskId) {
      const taskRuns = taskRunIndex.get(run.runRow.taskId) ?? [];
      taskRuns.push(run.runRow);
      taskRunIndex.set(run.runRow.taskId, taskRuns);
    }
  }

  const tasks = config.slices
    .flatMap((slice) =>
      (slice.taskQueue ?? []).map((task) =>
        toDashboardTask(task, slice.slice, state, taskRunIndex.get(task.id) ?? []),
      ),
    )
    .filter((task): task is TasksDashboardTask => task !== null);
  const currentTaskDefinition = currentSliceDefinition
    ? resolveCurrentSliceTask(currentSliceDefinition, state.currentTaskId ?? null)
    : null;
  const currentTask =
    currentTaskDefinition === null
      ? null
      : tasks.find((task) => task.id === currentTaskDefinition.id) ?? null;
  const nextTaskIdeas =
    currentSliceDefinition === null
      ? []
      : resolveNextSliceTasks(currentSliceDefinition, state.currentTaskId ?? null, 4)
          .map((task) => tasks.find((candidate) => candidate.id === task.id) ?? null)
          .filter((task): task is TasksDashboardTask => task !== null);

  const data: TasksDashboardData = {
    currentTask,
    loopSummary: createLoopSummary(state, currentTask),
    nextTaskIdeas,
    reviewSteps,
    runs: runRows,
    tasks,
  };

  const publicDir = path.join(root, 'public');
  await mkdir(publicDir, {recursive: true});
  await writeFile(path.join(publicDir, 'tasks-data.json'), `${JSON.stringify(data, null, 2)}\n`, 'utf8');

  return data;
}

async function listRunDirectories(runRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(runRoot, {withFileTypes: true});
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runRoot, entry.name))
      .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
  } catch {
    return [];
  }
}

async function readRunDashboardData(runDir: string): Promise<{
  reviewSteps: TasksDashboardReviewStep[];
  runRow: TasksDashboardRun;
} | null> {
  const runId = path.basename(runDir);
  const task = await readOptionalJson<SliceTask | null>(path.join(runDir, 'current-task.json'));
  const preparedSlice = await readOptionalJson<PreparedSlice>(path.join(runDir, 'current-slice.json'));
  const workerReport = await readOptionalJson<WorkerReport>(path.join(runDir, 'worker-report.json'));
  const review = await readOptionalJson<MonitorReview>(path.join(runDir, 'supervisor-review.json'));
  const checks = await readOptionalJson<CheckResults>(path.join(runDir, 'check-results.json'));
  const promotionManifest = await readOptionalJson<PromotionManifest>(path.join(runDir, 'promotion-manifest.json'));
  const promotionResult = await readOptionalJson<PromotionResult>(path.join(runDir, 'promotion-result.json'));
  const createdAt = await inferRunCreatedAt(runDir, runId, promotionManifest?.createdAt ?? null);

  if (!workerReport && !review && !checks && !task && !preparedSlice) {
    return null;
  }

  const runRow: TasksDashboardRun = {
    changedFiles: checks?.changedFiles.map((entry) => entry.path) ?? workerReport?.changedFiles ?? [],
    commandStatuses: (checks?.commands ?? []).map((entry) => {
      return `${entry.success ? 'pass' : 'fail'} ${entry.command}`;
    }),
    createdAt,
    decision: review?.decision ?? null,
    docsPresent: checks?.requiredDocUpdatesPresent ?? [],
    liveStatus: readCommandStatus(checks, 'live-site'),
    localBrowserStatus: readCommandStatus(checks, 'dag-view-smoke'),
    monitorSummary: review?.summary ?? null,
    promotionStatus: promotionResult?.status ?? null,
    reviewReady: promotionManifest?.reviewReady ?? false,
    runId,
    scopeStatus: checks && checks.scopeViolations.length > 0 ? 'fail' : 'pass',
    slice: preparedSlice?.slice ?? null,
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? null,
    taskScopeStatus: (checks?.taskScopeViolations?.length ?? 0) > 0 ? 'fail' : 'pass',
    workerStatus: workerReport?.status ?? null,
    workerSummary: workerReport?.summary ?? null,
  };

  const reviewSteps: TasksDashboardReviewStep[] = (review?.steps ?? []).map((step) => ({
    evidence: step.evidence,
    runId,
    status: step.status,
    stepId: step.id,
    taskId: task?.id ?? null,
    title: step.title,
  }));

  return {reviewSteps, runRow};
}

function readCommandStatus(
  checks: CheckResults | null,
  id: 'dag-view-smoke' | 'live-site',
): 'fail' | 'not-run' | 'pass' {
  const command =
    id === 'dag-view-smoke'
      ? 'npm run test:browser -- --flow dag-view-smoke'
      : 'npm run test:live -- --url https://timcash.github.io/linker/';
  const matched = checks?.commands.find((entry) => entry.command === command);

  if (!matched) {
    return 'not-run';
  }

  return matched.success ? 'pass' : 'fail';
}

function createLoopSummary(
  state: LoopState,
  currentTask: TasksDashboardTask | null,
): TasksDashboardLoopSummary {
  return {
    currentSlice: state.currentSlice,
    currentTaskId: state.currentTaskId ?? null,
    currentTaskTitle: currentTask?.title ?? null,
    generatedAt: new Date().toISOString(),
    iteration: state.iteration,
    lastDecision: state.lastDecision,
    lastRunId: state.lastRunId,
    status: state.status,
    workerWorkspaceMode: state.workerWorkspaceMode,
  };
}

function toDashboardTask(
  task: SliceTask | null,
  slice: number,
  state: LoopState,
  relatedRuns: TasksDashboardRun[],
): TasksDashboardTask | null {
  if (!task) {
    return null;
  }

  const latestRun = [...relatedRuns].sort((left, right) => right.runId.localeCompare(left.runId))[0] ?? null;
  const status = resolveTaskStatus(task, state, latestRun);

  return {
    allowedFiles: [...task.allowedFiles],
    contextFiles: [...task.contextFiles],
    decision: latestRun?.decision ?? null,
    doneWhen: [...task.doneWhen],
    expectedResult: task.expectedResult,
    id: task.id,
    intent: task.intent,
    lastRunId: latestRun?.runId ?? null,
    notes: [...task.notes],
    role: task.role,
    slice,
    status,
    title: task.title,
    verifyCommand: task.verifyCommand,
    workerStatus: latestRun?.workerStatus ?? null,
  };
}

function resolveTaskStatus(
  task: SliceTask,
  state: LoopState,
  latestRun: TasksDashboardRun | null,
): TasksDashboardTask['status'] {
  if (state.currentTaskId === task.id) {
    return latestRun?.decision === 'accept' ? 'accepted' : 'current';
  }

  if (latestRun?.decision === 'accept') {
    return 'accepted';
  }

  if (latestRun && latestRun.decision !== null) {
    return 'needs-revision';
  }

  return 'pending';
}

async function inferRunCreatedAt(
  runDir: string,
  runId: string,
  manifestCreatedAt: string | null,
): Promise<string> {
  if (manifestCreatedAt) {
    return manifestCreatedAt;
  }

  try {
    const info = await stat(runDir);
    return info.mtime.toISOString();
  } catch {
    const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/u.exec(runId);
    if (!match) {
      return new Date().toISOString();
    }

    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    ).toISOString();
  }
}

async function readOptionalJson<T>(filePath: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(filePath);
  } catch {
    return null;
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  await writeTasksDashboard(root);
  console.log('Wrote public/tasks-data.json');
}

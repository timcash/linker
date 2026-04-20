import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {appendLogEvent, initializeUnifiedLog, readUnifiedLogTail, resolveUnifiedLogPath} from '../logging';
import {advanceLoop} from './advance-loop';
import {prepareBrief} from './prepare-brief';
import {runChecks} from './run-checks';
import {
  buildMonitorStepsMarkdown,
  createLoopPaths,
  ensureLoopRuntime,
  ensureWorkerWorkspace,
  ensureRunDirectory,
  formatCommandBlock,
  formatListBlock,
  formatMonitorStepLines,
  looksLikeGitWorkspace,
  parseLoopCliOptions,
  printSection,
  readJsonFile,
  readTextFile,
  resolveCodexBinary,
  promoteRunChanges,
  runCodexExec,
  workerWorkspaceLabel,
  writePromotionArtifacts,
  writeJsonFile,
  writeMarkdownFile,
  type LoopConfig,
  type LoopState,
  type MonitorReview,
  type PreparedSlice,
  type ResolvedWorkerWorkspace,
} from './shared';
import {writeReviewPrompt} from './write-review-prompt';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cliOptions = parseLoopCliOptions(process.argv.slice(2));

await initializeUnifiedLog({
  append: false,
  cwd: root,
  sessionLabel: 'Starting agent loop run.',
});

await ensureLoopRuntime(root);

const paths = createLoopPaths(root);
const config = await readJsonFile<LoopConfig>(paths.configPath);
const codexPath = resolveCodexBinary(config);
let state = await readJsonFile<LoopState>(paths.statePath);
let iterationCount = 0;

while (iterationCount < cliOptions.maxIterations) {
  iterationCount += 1;

  if (cliOptions.sliceOverride !== null && state.currentSlice !== cliOptions.sliceOverride) {
    state = {
      ...state,
      currentSlice: cliOptions.sliceOverride,
    };
    await writeJsonFile(paths.statePath, state);
  }

  const workerWorkspace = await ensureWorkerWorkspace(root, config, {
    ...cliOptions,
    resume: cliOptions.resume || iterationCount > 1,
  });
  const {runDir, runId} = await ensureRunDirectory(paths.runRoot);
  const preparedSlice = await prepareBrief(root, cliOptions);

  printSection(
    'Starting Run',
    [
      `run id: ${runId}`,
      `workspace: ${workerWorkspaceLabel(root, workerWorkspace.path, workerWorkspace.mode)}`,
      `slice: ${preparedSlice.slice} (${preparedSlice.name})`,
      preparedSlice.currentTask
        ? `task: ${preparedSlice.currentTask.id} (${preparedSlice.currentTask.title})`
        : 'task: none',
      `commands:\n${formatCommandBlock(preparedSlice.commandsToRun)}`,
    ].join('\n'),
  );
  await appendLogEvent(
    'agent-loop.section',
    `Starting run ${runId} in ${workerWorkspace.path} for slice ${preparedSlice.slice} (${preparedSlice.name}).`,
    {logPath: resolveUnifiedLogPath(root)},
  );

  state = {
    ...state,
    lastRunId: runId,
    status: 'running',
    workerWorkspaceMode: workerWorkspace.mode,
  };
  await writeJsonFile(paths.statePath, state);

  await writeMarkdownFile(
    path.join(runDir, 'brief.md'),
    await buildWorkerPrompt(root, preparedSlice, workerWorkspace),
  );
  await writeJsonFile(path.join(runDir, 'current-slice.json'), preparedSlice);
  await writeMarkdownFile(
    path.join(runDir, 'current-slice.md'),
    await readTextFile(paths.currentSliceMarkdownPath),
  );
  await writeJsonFile(path.join(runDir, 'current-task.json'), preparedSlice.currentTask);
  await writeMarkdownFile(
    path.join(runDir, 'current-task.md'),
    await readTextFile(paths.currentTaskMarkdownPath),
  );
  await writeMarkdownFile(
    path.join(runDir, 'next-task-ideas.md'),
    await readTextFile(paths.nextTaskIdeasPath),
  );

  if (!cliOptions.reviewOnly) {
    await runCodexExec({
      codexPath,
      cwd: workerWorkspace.path,
      logLabel: 'agent-loop.worker',
      outputLastMessagePath: path.join(runDir, 'worker-report.json'),
      outputSchemaPath: paths.workerSchemaPath,
      prompt: await buildWorkerPrompt(root, preparedSlice, workerWorkspace),
      skipGitRepoCheck: !looksLikeGitWorkspace(workerWorkspace.path),
      stderrLogPath: path.join(runDir, 'worker-stderr.log'),
      stdoutLogPath: path.join(runDir, 'worker-stdout.log'),
    });
  } else {
    await writeMarkdownFile(path.join(runDir, 'worker-stdout.log'), '');
    await writeMarkdownFile(path.join(runDir, 'worker-stderr.log'), '');
    await writeJsonFile(path.join(runDir, 'worker-report.json'), {
      changedFiles: [],
      commandsRun: [],
      docsReviewed: [],
      implementationFilesUsedByTests: [],
      logsReviewed: [],
      newInvariant: 'Review-only mode did not run a worker step.',
      openRisks: ['Worker execution was skipped because --review-only was set.'],
      screenshotsReviewed: ['not-applicable'],
      status: 'blocked',
      summary: 'Review-only mode skipped the worker step.',
      testsTouched: [],
    });
  }

  state = {
    ...state,
    status: cliOptions.reviewOnly ? 'reviewing' : 'reviewing',
  };
  await writeJsonFile(paths.statePath, state);

  const checkResults = await runChecks(root, workerWorkspace.path, runDir, {
    enforceRequiredDocUpdates: !cliOptions.reviewOnly,
  });
  const reviewPrompt = await writeReviewPrompt(root, runDir);

  await runCodexExec({
    addDirs: [runDir],
    codexPath,
    cwd: workerWorkspace.path,
    logLabel: 'agent-loop.monitor',
    outputLastMessagePath: path.join(runDir, 'supervisor-review.json'),
    outputSchemaPath: paths.monitorSchemaPath,
    prompt: reviewPrompt,
    skipGitRepoCheck: !looksLikeGitWorkspace(workerWorkspace.path),
    stderrLogPath: path.join(runDir, 'monitor-stderr.log'),
    stdoutLogPath: path.join(runDir, 'monitor-stdout.log'),
  });

  const review = await readJsonFile<MonitorReview>(
    path.join(runDir, 'supervisor-review.json'),
  );
  const promotionManifest = await writePromotionArtifacts({
    checkResults,
    decision: review.decision,
    root,
    runDir,
    runId,
    workerWorkspace,
  });
  await writeMarkdownFile(
    path.join(runDir, 'monitor-steps.md'),
    buildMonitorStepsMarkdown(runId, review.steps),
  );
  state = await advanceLoop(root, runId);

  printSection(
    'Monitor Decision',
    [
      `decision: ${review.decision}`,
      `summary: ${review.summary}`,
      `invariant assessment: ${review.newInvariantAssessment}`,
      `review artifact: ${path.join(runDir, 'review-worker-changes.md')}`,
      checkResults.scopeViolations.length === 0
        ? 'scope: clean'
        : `scope violations:\n${formatListBlock(checkResults.scopeViolations.map((entry) => `\`${entry}\``))}`,
    ].join('\n'),
  );

  printSection('Monitor Steps', formatMonitorStepLines(review.steps));
  printSection(
    'Review And Promote',
    [
      `review ready: ${promotionManifest.reviewReady}`,
      `manifest: ${path.join(runDir, 'promotion-manifest.json')}`,
      `review notes: ${path.join(runDir, 'review-worker-changes.md')}`,
      `apply command: .\\agent.ps1 -PromoteRun ${runId}`,
    ].join('\n'),
  );
  await appendLogEvent(
    'agent-loop.section',
    `Monitor decision for ${runId}: ${review.decision}.`,
    {logPath: resolveUnifiedLogPath(root)},
  );
  await writeMarkdownFile(
    path.join(runDir, 'test-log-tail.md'),
    `# Unified Log Tail

\`\`\`
${await readUnifiedLogTail(resolveUnifiedLogPath(root))}
\`\`\`
`,
  );

  if (cliOptions.promoteAccepted && review.decision === 'accept') {
    const promotionResult = await promoteRunChanges(root, runId);
    printSection(
      'Promotion',
      [
        `status: ${promotionResult.status}`,
        `applied files: ${promotionResult.appliedFiles.length}`,
        `result: ${path.join(runDir, 'promotion-result.md')}`,
      ].join('\n'),
    );
  }

  if (
    cliOptions.once ||
    review.decision === 'accept' ||
    review.decision === 'ask-user' ||
    review.decision === 'stop'
  ) {
    break;
  }
}

async function buildWorkerPrompt(
  repoRoot: string,
  preparedSlice: PreparedSlice,
  workerWorkspace: ResolvedWorkerWorkspace,
): Promise<string> {
  const paths = createLoopPaths(repoRoot);
  const workerSystemPrompt = await readTextFile(paths.workerSystemPromptPath);
  const currentSliceMarkdown = await readTextFile(paths.currentSliceMarkdownPath);
  const currentTaskMarkdown = await readTextFile(paths.currentTaskMarkdownPath);
  const nextTaskIdeasMarkdown = await readTextFile(paths.nextTaskIdeasPath);

  return `${workerSystemPrompt.trim()}

You are working inside ${workerWorkspaceLabel(repoRoot, workerWorkspace.path, workerWorkspace.mode)}.

Read these documents in the workspace before making changes:

${formatListBlock(preparedSlice.docsToReview.map((entry) => `\`${entry}\``))}

Stay inside these owned files first:

${formatListBlock(preparedSlice.ownedFiles.map((entry) => `\`${entry}\``))}

Only touch these conditional files if the narrowest smoke assertion truly needs them:

${formatListBlock(preparedSlice.conditionalOwnedFiles.map((entry) => `\`${entry}\``))}

Do not touch these files:

${formatListBlock(preparedSlice.mustNotTouch.map((entry) => `\`${entry}\``))}

Commands to run in this worker cycle:

${formatCommandBlock(preparedSlice.commandsToRun)}

Tests to write or tighten first:

${formatListBlock(preparedSlice.testsToWrite)}

Datasets and alignment notes:

${formatListBlock(preparedSlice.datasets)}

Here is the current task packet:

${currentTaskMarkdown}

Here are the next task ideas after this one:

${nextTaskIdeasMarkdown}

Here is the current slice brief:

${currentSliceMarkdown}
`;
}

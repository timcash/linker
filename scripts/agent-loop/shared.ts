import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {appendLogChunk, appendLogEvent, resolveUnifiedLogPath} from '../logging';

export type CommandKind = 'browser' | 'lint' | 'live' | 'static';

export type SliceCommand = {
  command: string;
  id: string;
  kind: CommandKind;
};

export type SliceDefinition = {
  artifactsExpected: boolean;
  commands: SliceCommand[];
  conditionalOwnedFiles: string[];
  datasets: string[];
  intent: string;
  monitorFocus: string[];
  mustNotTouch: string[];
  name: string;
  ownedFiles: string[];
  slice: number;
  taskQueue?: SliceTask[];
  testsToWrite: string[];
};

export type SliceTask = {
  allowedFiles: string[];
  contextFiles: string[];
  doneWhen: string[];
  expectedResult: 'fail' | 'pass';
  id: string;
  intent: string;
  notes: string[];
  role: string;
  title: string;
  verifyCommand: string;
};

export type LoopConfig = {
  codexBinaryCandidates: string[];
  copyIgnoreNames: string[];
  copyIgnoreRelativePaths: string[];
  defaultSlice: number;
  focusDocs: string[];
  runRootRelativePath: string;
  slices: SliceDefinition[];
  workerWorkspaceRelativePath: string;
  workerWorktreeBranch: string;
  workerWorktreeRelativePath: string;
};

export type WorkerWorkspaceMode = 'git-worktree' | 'in-place' | 'snapshot-copy';

export type LoopState = {
  currentSlice: number;
  currentTaskId?: string | null;
  iteration: number;
  lastDecision: string | null;
  lastRunId: string | null;
  status: 'accepted' | 'idle' | 'needs-user' | 'reviewing' | 'running';
  workerWorkspaceMode: WorkerWorkspaceMode;
};

export type LoopMode = 'browser' | 'static-only';

export type PreparedSlice = {
  artifactsExpected: boolean;
  commandsToRun: SliceCommand[];
  conditionalOwnedFiles: string[];
  currentTask: SliceTask | null;
  datasets: string[];
  docsToReview: string[];
  intent: string;
  monitorFocus: string[];
  mustNotTouch: string[];
  name: string;
  nextTaskIdeas: SliceTask[];
  ownedFiles: string[];
  rubricMarkdown: string;
  slice: number;
  testsToWrite: string[];
};

export type LoopPaths = {
  configPath: string;
  currentSliceJsonPath: string;
  currentSliceMarkdownPath: string;
  currentTaskJsonPath: string;
  currentTaskMarkdownPath: string;
  loopDir: string;
  monitorSchemaPath: string;
  monitorSystemPromptPath: string;
  nextTaskIdeasPath: string;
  rubricPath: string;
  runRoot: string;
  statePath: string;
  workerSchemaPath: string;
  workerSystemPromptPath: string;
  workerWorkspace: string;
};

export type ChangedFile = {
  kind: 'added' | 'deleted' | 'modified';
  path: string;
};

export type ChangedFileDetail = ChangedFile & {
  sourceAbsolutePath: string;
  sourceHash: string | null;
  workerAbsolutePath: string;
  workerHash: string | null;
};

export type CommandRunResult = {
  command: string;
  exitCode: number;
  outputTail: string;
  success: boolean;
};

export type CheckResults = {
  changedFiles: ChangedFile[];
  changedImageFiles: string[];
  commands: CommandRunResult[];
  requiredDocUpdatesMissing: string[];
  requiredDocUpdatesPresent: string[];
  scopeViolations: string[];
  taskScopeViolations: string[];
};

export type PromotionManifest = {
  changedFiles: ChangedFileDetail[];
  createdAt: string;
  decision: MonitorReview['decision'] | 'not-reviewed';
  requiredDocUpdatesMissing: string[];
  requiredDocUpdatesPresent: string[];
  reviewReady: boolean;
  rootPath: string;
  runId: string;
  scopeViolations: string[];
  workerWorkspaceMode: WorkerWorkspaceMode;
  workerWorkspacePath: string;
};

export type PromotionResult = {
  appliedAt: string;
  appliedFiles: string[];
  conflicts: string[];
  notes: string[];
  runId: string;
  status: 'applied' | 'blocked';
};

export type WorkerReport = {
  changedFiles: string[];
  commandsRun: string[];
  docsReviewed: string[];
  implementationFilesUsedByTests: string[];
  logsReviewed: string[];
  newInvariant: string;
  openRisks: string[];
  screenshotsReviewed: string[];
  status: 'blocked' | 'done' | 'needs-clarification';
  summary: string;
  testsTouched: string[];
};

export type MonitorStepStatus = 'fail' | 'not-applicable' | 'pass';

export type MonitorStep = {
  evidence: string;
  id:
    | 'code-used-in-test'
    | 'commands-reviewed'
    | 'logs-reviewed'
    | 'plan-review'
    | 'readme-review'
    | 'scope-review'
    | 'screenshot-review'
    | 'test-written';
  status: MonitorStepStatus;
  title: string;
};

export type MonitorReview = {
  decision: 'accept' | 'ask-user' | 'revise' | 'stop' | 'tighten-test';
  newInvariantAssessment: string;
  nextBrief: string;
  questions: string[];
  steps: MonitorStep[];
  summary: string;
};

export type LoopCliOptions = {
  browser: boolean;
  inPlace: boolean;
  maxIterations: number;
  once: boolean;
  promoteAccepted: boolean;
  resume: boolean;
  reviewOnly: boolean;
  sliceOverride: number | null;
  staticOnly: boolean;
  worktree: boolean;
};

export type ResolvedWorkerWorkspace = {
  mode: WorkerWorkspaceMode;
  path: string;
};

export function parseLoopCliOptions(args: string[]): LoopCliOptions {
  let browser = false;
  let inPlace = false;
  let maxIterations = 25;
  let once = false;
  let promoteAccepted = false;
  let resume = false;
  let reviewOnly = false;
  let sliceOverride: number | null = null;
  let staticOnly = false;
  let worktree = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case '--browser':
        browser = true;
        break;
      case '--in-place':
        inPlace = true;
        break;
      case '--max-iterations':
        maxIterations = Number(args[index + 1] ?? '25');
        index += 1;
        break;
      case '--once':
        once = true;
        break;
      case '--promote-accepted':
        promoteAccepted = true;
        break;
      case '--resume':
        resume = true;
        break;
      case '--review-only':
        reviewOnly = true;
        break;
      case '--slice':
        sliceOverride = Number(args[index + 1] ?? '0');
        index += 1;
        break;
      case '--static-only':
        staticOnly = true;
        break;
      case '--worktree':
        worktree = true;
        break;
      default:
        throw new Error(`Unsupported agent-loop argument "${argument}".`);
    }
  }

  if (!browser && !staticOnly) {
    staticOnly = true;
  }

  if (browser && staticOnly) {
    browser = false;
  }

  if (!Number.isFinite(maxIterations) || maxIterations <= 0) {
    throw new Error(`Invalid --max-iterations value "${maxIterations}".`);
  }

  if (sliceOverride !== null && (!Number.isInteger(sliceOverride) || sliceOverride <= 0)) {
    throw new Error(`Invalid --slice value "${sliceOverride}".`);
  }

  return {
    browser,
    inPlace,
    maxIterations,
    once,
    promoteAccepted,
    resume,
    reviewOnly,
    sliceOverride,
    staticOnly,
    worktree,
  };
}

export function createLoopPaths(root: string): LoopPaths {
  const loopDir = path.resolve(root, '.codex-loop');

  return {
    configPath: path.join(loopDir, 'config.json'),
    currentSliceJsonPath: path.join(loopDir, 'current-slice.json'),
    currentSliceMarkdownPath: path.join(loopDir, 'current-slice.md'),
    currentTaskJsonPath: path.join(loopDir, 'current-task.json'),
    currentTaskMarkdownPath: path.join(loopDir, 'current-task.md'),
    loopDir,
    monitorSchemaPath: path.join(loopDir, 'prompts', 'monitor-output-schema.json'),
    monitorSystemPromptPath: path.join(loopDir, 'prompts', 'monitor-system.md'),
    nextTaskIdeasPath: path.join(loopDir, 'next-task-ideas.md'),
    rubricPath: path.join(loopDir, 'rubric.md'),
    runRoot: path.join(loopDir, 'runs'),
    statePath: path.join(loopDir, 'state.json'),
    workerSchemaPath: path.join(loopDir, 'prompts', 'worker-output-schema.json'),
    workerSystemPromptPath: path.join(loopDir, 'prompts', 'worker-system.md'),
    workerWorkspace: path.join(loopDir, 'workspaces', 'worker'),
  };
}

export async function ensureLoopRuntime(root: string): Promise<void> {
  const paths = createLoopPaths(root);

  await mkdir(paths.runRoot, {recursive: true});
  await mkdir(path.join(paths.loopDir, 'inbox'), {recursive: true});
  await mkdir(path.join(paths.loopDir, 'workspaces'), {recursive: true});
  await mkdir(path.join(paths.loopDir, 'worktrees'), {recursive: true});

  if (!existsSync(paths.statePath)) {
    const config = await readJsonFile<LoopConfig>(paths.configPath);
    const defaultState: LoopState = {
      currentSlice: config.defaultSlice,
      currentTaskId: null,
      iteration: 0,
      lastDecision: null,
      lastRunId: null,
      status: 'idle',
      workerWorkspaceMode: 'snapshot-copy',
    };
    await writeJsonFile(paths.statePath, defaultState);
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function readTextFile(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}

export async function writeMarkdownFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), {recursive: true});
  await writeFile(filePath, content, 'utf8');
}

export function resolveLoopMode(options: LoopCliOptions): LoopMode {
  return options.browser ? 'browser' : 'static-only';
}

export function selectSliceDefinition(
  config: LoopConfig,
  state: LoopState,
  options: LoopCliOptions,
): SliceDefinition {
  const sliceNumber = options.sliceOverride ?? state.currentSlice;
  const slice = config.slices.find((candidate) => candidate.slice === sliceNumber);

  if (!slice) {
    throw new Error(`No slice definition found for slice ${sliceNumber}.`);
  }

  return slice;
}

export function selectCommandsForMode(
  slice: SliceDefinition,
  mode: LoopMode,
): SliceCommand[] {
  return slice.commands.filter((command) => {
    if (mode === 'static-only' && (command.kind === 'browser' || command.kind === 'live')) {
      return false;
    }
    return true;
  });
}

export function buildPreparedSlice(
  config: LoopConfig,
  slice: SliceDefinition,
  state: LoopState,
  rubricMarkdown: string,
  mode: LoopMode,
): PreparedSlice {
  const currentTask = resolveCurrentSliceTask(slice, state.currentTaskId ?? null);
  const nextTaskIdeas = resolveNextSliceTasks(slice, currentTask?.id ?? null, 3);

  return {
    artifactsExpected: slice.artifactsExpected,
    commandsToRun: selectCommandsForMode(slice, mode),
    conditionalOwnedFiles: slice.conditionalOwnedFiles,
    currentTask,
    datasets: slice.datasets,
    docsToReview: config.focusDocs,
    intent: slice.intent,
    monitorFocus: slice.monitorFocus,
    mustNotTouch: slice.mustNotTouch,
    name: slice.name,
    nextTaskIdeas,
    ownedFiles: slice.ownedFiles,
    rubricMarkdown,
    slice: slice.slice,
    testsToWrite: slice.testsToWrite,
  };
}

export function resolveCurrentSliceTask(
  slice: SliceDefinition,
  currentTaskId: string | null,
): SliceTask | null {
  const taskQueue = slice.taskQueue ?? [];
  if (taskQueue.length === 0) {
    return null;
  }

  if (currentTaskId) {
    const matched = taskQueue.find((task) => task.id === currentTaskId);
    if (matched) {
      return matched;
    }
  }

  return taskQueue[0] ?? null;
}

export function resolveNextSliceTasks(
  slice: SliceDefinition,
  currentTaskId: string | null,
  limit = 3,
): SliceTask[] {
  const taskQueue = slice.taskQueue ?? [];
  if (taskQueue.length === 0) {
    return [];
  }

  const currentIndex =
    currentTaskId === null
      ? 0
      : taskQueue.findIndex((task) => task.id === currentTaskId);
  const startIndex = currentIndex >= 0 ? currentIndex + 1 : 1;
  return taskQueue.slice(startIndex, startIndex + limit);
}

export function expandEnvironmentVariables(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => {
    return process.env[name] ?? '';
  });
}

export function resolveCodexBinary(
  config: LoopConfig,
  override: string | null = null,
): string {
  if (override) {
    return override;
  }

  for (const candidate of config.codexBinaryCandidates) {
    const expanded = expandEnvironmentVariables(candidate);
    if (expanded.includes(path.sep)) {
      if (existsSync(expanded)) {
        return expanded;
      }
      continue;
    }

    return expanded;
  }

  throw new Error('Unable to resolve a Codex CLI binary.');
}

export function resolveWorkerWorkspaceMode(options: LoopCliOptions): WorkerWorkspaceMode {
  if (options.inPlace) {
    return 'in-place';
  }

  return options.worktree ? 'git-worktree' : 'snapshot-copy';
}

export function resolveWorkerWorkspacePath(
  root: string,
  config: LoopConfig,
  mode: WorkerWorkspaceMode,
): string {
  if (mode === 'git-worktree') {
    return path.resolve(root, config.workerWorktreeRelativePath);
  }

  if (mode === 'snapshot-copy') {
    return path.resolve(root, config.workerWorkspaceRelativePath);
  }

  return root;
}

export async function ensureWorkerWorkspace(
  root: string,
  config: LoopConfig,
  options: LoopCliOptions,
): Promise<ResolvedWorkerWorkspace> {
  const mode = resolveWorkerWorkspaceMode(options);
  const workerWorkspace = resolveWorkerWorkspacePath(root, config, mode);

  if (mode === 'in-place') {
    return {mode, path: root};
  }

  if (mode === 'git-worktree') {
    await ensureGitWorktreeWorkspace(root, workerWorkspace, config, options.resume);
  } else {
    await ensureSnapshotWorkspace(root, workerWorkspace, config, options.resume);
  }

  await syncFocusDocs(root, workerWorkspace, config.focusDocs);

  return {
    mode,
    path: workerWorkspace,
  };
}

async function ensureSnapshotWorkspace(
  sourceRoot: string,
  targetRoot: string,
  config: LoopConfig,
  resume: boolean,
): Promise<void> {
  if (!resume) {
    await rm(targetRoot, {force: true, recursive: true});
  }

  if (!existsSync(targetRoot)) {
    await mkdir(targetRoot, {recursive: true});
    await syncWorkspaceMirror(sourceRoot, targetRoot, config);
  }
}

async function ensureGitWorktreeWorkspace(
  sourceRoot: string,
  targetRoot: string,
  config: LoopConfig,
  resume: boolean,
): Promise<void> {
  await ensureGitWorktreeExists(sourceRoot, targetRoot, config.workerWorktreeBranch);

  if (!resume) {
    await syncWorkspaceMirror(sourceRoot, targetRoot, config, new Set(['.git']));
  }
}

async function ensureGitWorktreeExists(
  sourceRoot: string,
  targetRoot: string,
  branchName: string,
): Promise<void> {
  const gitPointerPath = path.join(targetRoot, '.git');
  if (existsSync(gitPointerPath)) {
    return;
  }

  if (existsSync(targetRoot)) {
    await rm(targetRoot, {force: true, recursive: true});
  }

  await mkdir(path.dirname(targetRoot), {recursive: true});

  const branchExists = await gitBranchExists(sourceRoot, branchName);
  if (!branchExists) {
    await runGitCommand(sourceRoot, ['branch', branchName, 'HEAD']);
  }

  await runGitCommand(sourceRoot, ['worktree', 'add', '--force', targetRoot, branchName]);
}

async function gitBranchExists(
  cwd: string,
  branchName: string,
): Promise<boolean> {
  const result = await spawnWithInput('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], null, cwd);
  return result.exitCode === 0;
}

async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<void> {
  const result = await spawnWithInput('git', args, null, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed with exit code ${result.exitCode}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
}

async function syncWorkspaceMirror(
  sourceRoot: string,
  targetRoot: string,
  config: LoopConfig,
  preserveTargetNames = new Set<string>(),
): Promise<void> {
  const ignoreNames = new Set(config.copyIgnoreNames);
  const ignorePaths = new Set(config.copyIgnoreRelativePaths.map(normalizeRelativePath));
  const sourceTopLevelEntries = await readdir(sourceRoot, {withFileTypes: true});
  const sourceTopLevelNames = new Set<string>();

  await mkdir(targetRoot, {recursive: true});

  for (const entry of sourceTopLevelEntries) {
    if (ignoreNames.has(entry.name)) {
      continue;
    }

    const sourceEntryPath = path.join(sourceRoot, entry.name);
    const relativePath = normalizeRelativePath(path.relative(sourceRoot, sourceEntryPath));
    if (ignorePaths.has(relativePath)) {
      continue;
    }

    sourceTopLevelNames.add(entry.name);
  }

  const targetTopLevelEntries = existsSync(targetRoot)
    ? await readdir(targetRoot, {withFileTypes: true})
    : [];

  for (const entry of targetTopLevelEntries) {
    if (preserveTargetNames.has(entry.name)) {
      continue;
    }

    if (!sourceTopLevelNames.has(entry.name)) {
      await rm(path.join(targetRoot, entry.name), {force: true, recursive: true});
    }
  }

  for (const entry of sourceTopLevelEntries) {
    if (!sourceTopLevelNames.has(entry.name)) {
      continue;
    }

    const sourceEntryPath = path.join(sourceRoot, entry.name);
    const targetEntryPath = path.join(targetRoot, entry.name);

    if (existsSync(targetEntryPath)) {
      await rm(targetEntryPath, {force: true, recursive: true});
    }

    await cp(sourceEntryPath, targetEntryPath, {
      filter: (sourcePath) => {
        const nestedRelativePath = normalizeRelativePath(path.relative(sourceRoot, sourcePath));

        if (ignorePaths.has(nestedRelativePath)) {
          return false;
        }

        const segments = nestedRelativePath.split('/');
        return !segments.some((segment) => ignoreNames.has(segment));
      },
      recursive: true,
    });
  }

  const sourceNodeModules = path.join(sourceRoot, 'node_modules');
  const targetNodeModules = path.join(targetRoot, 'node_modules');
  if (existsSync(sourceNodeModules) && !existsSync(targetNodeModules)) {
    await symlink(
      sourceNodeModules,
      targetNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }
}

async function syncFocusDocs(
  sourceRoot: string,
  targetRoot: string,
  focusDocs: string[],
): Promise<void> {
  for (const relativePath of focusDocs) {
    const sourcePath = path.join(sourceRoot, relativePath);
    const targetPath = path.join(targetRoot, relativePath);
    if (!existsSync(sourcePath)) {
      continue;
    }
    await mkdir(path.dirname(targetPath), {recursive: true});
    await cp(sourcePath, targetPath, {force: true});
  }
}

export async function runCodexExec(options: {
  addDirs?: string[];
  codexPath: string;
  cwd: string;
  logLabel: string;
  outputLastMessagePath: string;
  outputSchemaPath: string;
  prompt: string;
  skipGitRepoCheck?: boolean;
  stderrLogPath: string;
  stdoutLogPath: string;
}): Promise<void> {
  const args = [
    'exec',
    '--ephemeral',
    '--dangerously-bypass-approvals-and-sandbox',
    '--color',
    'never',
    '--cd',
    options.cwd,
    '--output-schema',
    options.outputSchemaPath,
    '--output-last-message',
    options.outputLastMessagePath,
  ];

  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }

  for (const addDir of options.addDirs ?? []) {
    args.push('--add-dir', addDir);
  }

  args.push('-');

  await appendLogEvent('agent-loop.codex.exec', `${options.logLabel} => ${options.codexPath} ${args.join(' ')}`);
  const result = await spawnWithInput(options.codexPath, args, options.prompt, options.cwd);

  await writeFile(options.stdoutLogPath, result.stdout, 'utf8');
  await writeFile(options.stderrLogPath, result.stderr, 'utf8');
  await appendLogChunk(`${options.logLabel}.stdout`, result.stdout);
  await appendLogChunk(`${options.logLabel}.stderr`, result.stderr);

  if (result.exitCode !== 0) {
    await appendLogEvent(
      'agent-loop.codex.error',
      `${options.logLabel} exited with code ${result.exitCode}.`,
    );
    throw new Error(
      `Codex command failed with exit code ${result.exitCode}.\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    );
  }
}

export async function runCommand(
  command: string,
  cwd: string,
  logLabel = 'agent-loop.command',
): Promise<CommandRunResult> {
  const [bin, args] =
    process.platform === 'win32'
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command]]
      : ['/bin/bash', ['-lc', command]];

  await appendLogEvent('agent-loop.command', `${logLabel} => ${command}`);
  const result = await spawnWithInput(bin, args, null, cwd);
  const combinedOutput = `${result.stdout}${result.stderr}`.trim();
  await appendLogChunk(`${logLabel}.stdout`, result.stdout);
  await appendLogChunk(`${logLabel}.stderr`, result.stderr);

  return {
    command,
    exitCode: result.exitCode,
    outputTail: combinedOutput.slice(-4000),
    success: result.exitCode === 0,
  };
}

async function spawnWithInput(
  command: string,
  args: string[],
  input: string | null,
  cwd: string,
): Promise<{exitCode: number; stderr: string; stdout: string}> {
  return new Promise((resolve, reject) => {
    const spawnCommand =
      process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
        ? process.env.ComSpec ?? 'cmd.exe'
        : command;
    const spawnArgs =
      process.platform === 'win32' && /\.(cmd|bat)$/i.test(command)
        ? ['/d', '/s', '/c', formatWindowsCommand(command, args)]
        : args;
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stderr,
        stdout,
      });
    });

    if (input !== null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function formatWindowsCommand(command: string, args: string[]): string {
  return [quoteWindowsArgument(command), ...args.map((argument) => quoteWindowsArgument(argument))].join(' ');
}

function quoteWindowsArgument(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

export async function collectChangedFiles(
  sourceRoot: string,
  workerRoot: string,
  config: LoopConfig,
): Promise<ChangedFile[]> {
  const details = await collectChangedFileDetails(sourceRoot, workerRoot, config);
  return details.map(({kind, path}) => ({kind, path}));
}

export async function collectChangedFileDetails(
  sourceRoot: string,
  workerRoot: string,
  config: LoopConfig,
): Promise<ChangedFileDetail[]> {
  const ignoreNames = new Set(config.copyIgnoreNames);
  const ignorePaths = new Set(config.copyIgnoreRelativePaths.map(normalizeRelativePath));
  const sourceMap = await collectFileHashes(sourceRoot, sourceRoot, ignoreNames, ignorePaths);
  const workerMap = await collectFileHashes(workerRoot, workerRoot, ignoreNames, ignorePaths);
  const allPaths = new Set([...sourceMap.keys(), ...workerMap.keys()]);
  const changedFiles: ChangedFileDetail[] = [];

  for (const relativePath of [...allPaths].sort()) {
    const sourceHash = sourceMap.get(relativePath);
    const workerHash = workerMap.get(relativePath);

    if (sourceHash && !workerHash) {
      changedFiles.push({
        kind: 'deleted',
        path: relativePath,
        sourceAbsolutePath: path.join(sourceRoot, relativePath),
        sourceHash,
        workerAbsolutePath: path.join(workerRoot, relativePath),
        workerHash: null,
      });
      continue;
    }

    if (!sourceHash && workerHash) {
      changedFiles.push({
        kind: 'added',
        path: relativePath,
        sourceAbsolutePath: path.join(sourceRoot, relativePath),
        sourceHash: null,
        workerAbsolutePath: path.join(workerRoot, relativePath),
        workerHash,
      });
      continue;
    }

    if (sourceHash !== workerHash) {
      changedFiles.push({
        kind: 'modified',
        path: relativePath,
        sourceAbsolutePath: path.join(sourceRoot, relativePath),
        sourceHash: sourceHash ?? null,
        workerAbsolutePath: path.join(workerRoot, relativePath),
        workerHash: workerHash ?? null,
      });
    }
  }

  return changedFiles;
}

export async function writePromotionArtifacts(options: {
  checkResults: CheckResults;
  decision: MonitorReview['decision'] | 'not-reviewed';
  root: string;
  runDir: string;
  runId: string;
  workerWorkspace: ResolvedWorkerWorkspace;
}): Promise<PromotionManifest> {
  const paths = createLoopPaths(options.root);
  const config = await readJsonFile<LoopConfig>(paths.configPath);
  const changedFiles = await collectChangedFileDetails(
    options.root,
    options.workerWorkspace.path,
    config,
  );
  const manifest: PromotionManifest = {
    changedFiles,
    createdAt: new Date().toISOString(),
    decision: options.decision,
    requiredDocUpdatesMissing: [...options.checkResults.requiredDocUpdatesMissing],
    requiredDocUpdatesPresent: [...options.checkResults.requiredDocUpdatesPresent],
    reviewReady:
      options.checkResults.scopeViolations.length === 0 &&
      options.checkResults.requiredDocUpdatesMissing.length === 0,
    rootPath: options.root,
    runId: options.runId,
    scopeViolations: [...options.checkResults.scopeViolations],
    workerWorkspaceMode: options.workerWorkspace.mode,
    workerWorkspacePath: options.workerWorkspace.path,
  };
  const reviewMarkdown = buildPromotionReviewMarkdown(manifest);

  await writeJsonFile(path.join(options.runDir, 'promotion-manifest.json'), manifest);
  await writeMarkdownFile(path.join(options.runDir, 'review-worker-changes.md'), reviewMarkdown);

  return manifest;
}

export async function promoteRunChanges(
  root: string,
  runId: string,
): Promise<PromotionResult> {
  const runDir = path.join(createLoopPaths(root).runRoot, runId);
  const manifestPath = path.join(runDir, 'promotion-manifest.json');
  const manifest = await readJsonFile<PromotionManifest>(manifestPath);
  const conflicts: string[] = [];

  for (const entry of manifest.changedFiles) {
    const currentRootHash = await readPathHash(entry.sourceAbsolutePath);
    const currentWorkerHash = await readPathHash(entry.workerAbsolutePath);

    if (currentRootHash !== entry.sourceHash) {
      conflicts.push(
        `${entry.path}: root changed since review artifact creation (expected ${entry.sourceHash ?? 'missing'}, found ${currentRootHash ?? 'missing'})`,
      );
    }

    if (currentWorkerHash !== entry.workerHash) {
      conflicts.push(
        `${entry.path}: worker workspace changed since review artifact creation (expected ${entry.workerHash ?? 'missing'}, found ${currentWorkerHash ?? 'missing'})`,
      );
    }
  }

  const result: PromotionResult = {
    appliedAt: new Date().toISOString(),
    appliedFiles: [],
    conflicts,
    notes: [],
    runId,
    status: conflicts.length === 0 ? 'applied' : 'blocked',
  };

  if (conflicts.length > 0) {
    result.notes.push('Promotion aborted before applying any file because at least one hash check failed.');
    await writeJsonFile(path.join(runDir, 'promotion-result.json'), result);
    await writeMarkdownFile(path.join(runDir, 'promotion-result.md'), buildPromotionResultMarkdown(result));
    await appendLogEvent(
      'agent-loop.promote.blocked',
      `Blocked promotion for run ${runId}: ${conflicts.join(' | ')}`,
      {logPath: resolveUnifiedLogPath(root)},
    );
    throw new Error(`Promotion blocked for run ${runId}.\n${conflicts.join('\n')}`);
  }

  for (const entry of manifest.changedFiles) {
    const targetPath = entry.sourceAbsolutePath;

    if (entry.kind === 'deleted') {
      await rm(targetPath, {force: true});
      result.appliedFiles.push(entry.path);
      continue;
    }

    await mkdir(path.dirname(targetPath), {recursive: true});
    await cp(entry.workerAbsolutePath, targetPath, {force: true});
    result.appliedFiles.push(entry.path);
  }

  result.notes.push(
    manifest.decision === 'accept'
      ? 'Monitor accepted this run before promotion.'
      : `Promoted after manual review of a ${manifest.decision} run.`,
  );

  await writeJsonFile(path.join(runDir, 'promotion-result.json'), result);
  await writeMarkdownFile(path.join(runDir, 'promotion-result.md'), buildPromotionResultMarkdown(result));
  await appendLogEvent(
    'agent-loop.promote.applied',
    `Applied ${result.appliedFiles.length} file(s) from run ${runId}: ${result.appliedFiles.join(', ')}`,
    {logPath: resolveUnifiedLogPath(root)},
  );

  return result;
}

async function collectFileHashes(
  currentPath: string,
  basePath: string,
  ignoreNames: Set<string>,
  ignorePaths: Set<string>,
): Promise<Map<string, string>> {
  const entries = await readdir(currentPath, {withFileTypes: true});
  const files = new Map<string, string>();

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = normalizeRelativePath(path.relative(basePath, absolutePath));

    if (ignorePaths.has(relativePath)) {
      continue;
    }

    if (ignoreNames.has(entry.name)) {
      continue;
    }

    if (entry.isDirectory()) {
      const nestedFiles = await collectFileHashes(
        absolutePath,
        basePath,
        ignoreNames,
        ignorePaths,
      );
      for (const [nestedRelativePath, hash] of nestedFiles.entries()) {
        files.set(nestedRelativePath, hash);
      }
      continue;
    }

    if (entry.isFile()) {
      const buffer = await readFile(absolutePath);
      files.set(relativePath, createHash('sha1').update(buffer).digest('hex'));
      continue;
    }

    if ((await lstat(absolutePath)).isSymbolicLink()) {
      files.set(relativePath, 'symlink');
    }
  }

  return files;
}

async function readPathHash(filePath: string): Promise<string | null> {
  try {
    const stats = await lstat(filePath);
    if (!stats.isFile()) {
      return stats.isSymbolicLink() ? 'symlink' : null;
    }

    const buffer = await readFile(filePath);
    return createHash('sha1').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

function buildPromotionReviewMarkdown(manifest: PromotionManifest): string {
  const changedFilesBlock =
    manifest.changedFiles.length === 0
      ? '- none'
      : manifest.changedFiles
          .map((entry) => {
            return [
              `- \`${entry.kind}\` \`${entry.path}\``,
              `  root: \`${entry.sourceAbsolutePath}\``,
              `  worker: \`${entry.workerAbsolutePath}\``,
              `  root hash: \`${entry.sourceHash ?? 'missing'}\``,
              `  worker hash: \`${entry.workerHash ?? 'missing'}\``,
            ].join('\n');
          })
          .join('\n');
  const scopeBlock =
    manifest.scopeViolations.length === 0
      ? '- none'
      : formatListBlock(manifest.scopeViolations.map((entry) => `\`${entry}\``));
  const missingDocsBlock =
    manifest.requiredDocUpdatesMissing.length === 0
      ? '- none'
      : formatListBlock(manifest.requiredDocUpdatesMissing.map((entry) => `\`${entry}\``));
  const presentDocsBlock =
    manifest.requiredDocUpdatesPresent.length === 0
      ? '- none'
      : formatListBlock(manifest.requiredDocUpdatesPresent.map((entry) => `\`${entry}\``));
  const diffCommands =
    manifest.changedFiles.length === 0
      ? '- none'
      : manifest.changedFiles
          .map(
            (entry) =>
              `- \`git diff --no-index -- "${entry.sourceAbsolutePath}" "${entry.workerAbsolutePath}"\``,
          )
          .join('\n');

  return `# Review Worker Changes

- Run: \`${manifest.runId}\`
- Decision: \`${manifest.decision}\`
- Review ready: \`${manifest.reviewReady}\`
- Root: \`${manifest.rootPath}\`
- Worker workspace: \`${manifest.workerWorkspacePath}\`
- Worker mode: \`${manifest.workerWorkspaceMode}\`

## Required Docs

### Present

${presentDocsBlock}

### Missing

${missingDocsBlock}

## Scope Violations

${scopeBlock}

## Changed Files

${changedFilesBlock}

## Suggested Review Commands

${diffCommands}

## Apply Back To Root

\`\`\`powershell
.\\agent.ps1 -PromoteRun ${manifest.runId}
\`\`\`
`;
}

function buildPromotionResultMarkdown(result: PromotionResult): string {
  const conflictsBlock =
    result.conflicts.length === 0
      ? '- none'
      : formatListBlock(result.conflicts);
  const appliedFilesBlock =
    result.appliedFiles.length === 0
      ? '- none'
      : formatListBlock(result.appliedFiles.map((entry) => `\`${entry}\``));
  const notesBlock =
    result.notes.length === 0
      ? '- none'
      : formatListBlock(result.notes);

  return `# Promotion Result

- Run: \`${result.runId}\`
- Status: \`${result.status}\`
- Applied At: \`${result.appliedAt}\`

## Applied Files

${appliedFilesBlock}

## Conflicts

${conflictsBlock}

## Notes

${notesBlock}
`;
}

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/');
}

export function detectScopeViolations(
  changedFiles: ChangedFile[],
  preparedSlice: PreparedSlice,
): string[] {
  const allowed = new Set([
    ...preparedSlice.ownedFiles,
    ...preparedSlice.conditionalOwnedFiles,
  ]);
  const disallowed = new Set(preparedSlice.mustNotTouch);

  return changedFiles
    .map((entry) => entry.path)
    .filter((relativePath) => {
      if (disallowed.has(relativePath)) {
        return true;
      }

      return !allowed.has(relativePath);
    });
}

export function formatCommandBlock(commands: SliceCommand[]): string {
  return commands.map((command) => `- \`${command.command}\``).join('\n');
}

export function formatListBlock(values: string[]): string {
  return values.map((value) => `- ${value}`).join('\n');
}

export function resolveNextSlice(
  config: LoopConfig,
  currentSlice: number,
): number | null {
  const sortedSlices = [...config.slices].sort((left, right) => left.slice - right.slice);
  const currentIndex = sortedSlices.findIndex((slice) => slice.slice === currentSlice);
  const nextSlice = sortedSlices[currentIndex + 1];
  return nextSlice?.slice ?? null;
}

export function resolveNextTaskId(
  slice: SliceDefinition,
  currentTaskId: string | null,
): string | null {
  const taskQueue = slice.taskQueue ?? [];
  if (taskQueue.length === 0) {
    return null;
  }

  if (currentTaskId === null) {
    return taskQueue[0]?.id ?? null;
  }

  const currentIndex = taskQueue.findIndex((task) => task.id === currentTaskId);
  if (currentIndex < 0) {
    return taskQueue[0]?.id ?? null;
  }

  return taskQueue[currentIndex + 1]?.id ?? null;
}

export function printSection(title: string, body: string): void {
  console.log(`\n[agent-loop] ${title}\n${body}`);
}

export async function ensureRunDirectory(runRoot: string): Promise<{runDir: string; runId: string}> {
  const runId = formatRunId();
  const runDir = path.join(runRoot, runId);

  await mkdir(runDir, {recursive: true});

  return {runDir, runId};
}

export function looksLikeGitWorkspace(workspace: string): boolean {
  return existsSync(path.join(workspace, '.git'));
}

export function workerWorkspaceLabel(
  root: string,
  workerWorkspace: string,
  mode: WorkerWorkspaceMode,
): string {
  if (workerWorkspace === root || mode === 'in-place') {
    return 'in-place root workspace';
  }

  if (mode === 'git-worktree') {
    return `git worktree at ${workerWorkspace}`;
  }

  return `snapshot workspace at ${workerWorkspace}`;
}

export function isImagePath(relativePath: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/iu.test(relativePath);
}

export function formatMonitorStepLines(steps: MonitorStep[]): string {
  if (steps.length === 0) {
    return '- none';
  }

  return steps
    .map((step) => `- [${step.status}] ${step.title}: ${step.evidence}`)
    .join('\n');
}

export function buildMonitorStepsMarkdown(
  runId: string,
  steps: MonitorStep[],
): string {
  return `# Monitor Steps

- Run: \`${runId}\`

${formatMonitorStepLines(steps)}
`;
}

export function trimPromptContent(value: string): string {
  return value.trim().replace(/\r\n/g, '\n');
}

export function formatRunId(date = new Date()): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function platformEol(): string {
  return os.EOL;
}

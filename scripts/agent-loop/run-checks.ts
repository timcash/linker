import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  collectChangedFiles,
  createLoopPaths,
  detectScopeViolations,
  isImagePath,
  readJsonFile,
  resolveWorkerWorkspacePath,
  runCommand,
  writeJsonFile,
  type CheckResults,
  type LoopConfig,
  type LoopState,
  type PreparedSlice,
  type SliceTask,
} from './shared';

export async function runChecks(
  root: string,
  workerWorkspace: string,
  runDir: string,
  options: {
    enforceRequiredDocUpdates?: boolean;
  } = {},
): Promise<CheckResults> {
  const paths = createLoopPaths(root);
  const config = await readJsonFile<LoopConfig>(paths.configPath);
  const preparedSlice = await readJsonFile<PreparedSlice>(paths.currentSliceJsonPath);
  const currentTask = await readJsonFile<SliceTask | null>(paths.currentTaskJsonPath);
  const changedFiles = await collectChangedFiles(root, workerWorkspace, config);
  const changedFilePaths = new Set(changedFiles.map((entry) => entry.path));
  const requiredDocUpdatesPresent = preparedSlice.docsToReview.filter((relativePath) =>
    changedFilePaths.has(relativePath),
  );
  const requiredDocUpdatesMissing =
    options.enforceRequiredDocUpdates === false
      ? []
      : preparedSlice.docsToReview.filter(
          (relativePath) => !changedFilePaths.has(relativePath),
        );
  const commands = [];

  for (const command of preparedSlice.commandsToRun) {
    commands.push(await runCommand(command.command, workerWorkspace, `agent-loop.check.${command.id}`));
  }

  const results: CheckResults = {
    changedFiles,
    changedImageFiles: changedFiles
      .map((entry) => entry.path)
      .filter((relativePath) => isImagePath(relativePath)),
    commands,
    requiredDocUpdatesMissing,
    requiredDocUpdatesPresent,
    scopeViolations: detectScopeViolations(changedFiles, preparedSlice),
    taskScopeViolations: detectTaskScopeViolations(changedFiles, currentTask),
  };

  await writeJsonFile(path.join(runDir, 'check-results.json'), results);

  return results;
}

function detectTaskScopeViolations(
  changedFiles: CheckResults['changedFiles'],
  currentTask: SliceTask | null,
): string[] {
  if (!currentTask) {
    return [];
  }

  const allowed = new Set([...currentTask.allowedFiles, 'README.md', 'PLAN.md']);

  return changedFiles
    .map((entry) => entry.path)
    .filter((relativePath) => !allowed.has(relativePath));
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const paths = createLoopPaths(root);
  const runDir = process.argv[process.argv.length - 1];
  if (!runDir) {
    throw new Error('Missing run directory argument for run-checks.ts');
  }
  const config = await readJsonFile<LoopConfig>(paths.configPath);
  const state = await readJsonFile<LoopState>(paths.statePath);
  const results = await runChecks(
    root,
    resolveWorkerWorkspacePath(root, config, state.workerWorkspaceMode),
    runDir,
    {
      enforceRequiredDocUpdates: true,
    },
  );
  console.log(`Ran ${results.commands.length} checks.`);
}

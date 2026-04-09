import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  createLoopPaths,
  readJsonFile,
  resolveNextSlice,
  resolveNextTaskId,
  writeJsonFile,
  type LoopConfig,
  type LoopState,
  type MonitorReview,
  type PreparedSlice,
} from './shared';

export async function advanceLoop(
  root: string,
  runId: string,
): Promise<LoopState> {
  const paths = createLoopPaths(root);
  const config = await readJsonFile<LoopConfig>(paths.configPath);
  const state = await readJsonFile<LoopState>(paths.statePath);
  const preparedSlice = await readJsonFile<PreparedSlice>(paths.currentSliceJsonPath);
  const currentSliceDefinition = config.slices.find((slice) => slice.slice === preparedSlice.slice) ?? null;
  const review = await readJsonFile<MonitorReview>(
    path.join(paths.runRoot, runId, 'supervisor-review.json'),
  );
  const currentTaskId = preparedSlice.currentTask?.id ?? state.currentTaskId ?? null;
  const acceptedNextTaskId =
    review.decision === 'accept' && currentSliceDefinition
      ? resolveNextTaskId(currentSliceDefinition, currentTaskId)
      : currentTaskId;
  const acceptedNextSlice =
    review.decision !== 'accept'
      ? preparedSlice.slice
      : acceptedNextTaskId !== null
        ? preparedSlice.slice
        : resolveNextSlice(config, preparedSlice.slice) ?? preparedSlice.slice;
  const nextState: LoopState = {
    ...state,
    currentSlice: acceptedNextSlice,
    currentTaskId:
      review.decision === 'accept' && acceptedNextSlice !== preparedSlice.slice
        ? null
        : acceptedNextTaskId,
    iteration: state.iteration + 1,
    lastDecision: review.decision,
    lastRunId: runId,
    status:
      review.decision === 'ask-user'
        ? 'needs-user'
        : review.decision === 'accept'
          ? 'accepted'
          : 'idle',
  };

  await writeJsonFile(paths.statePath, nextState);

  return nextState;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const runId = process.argv[process.argv.length - 1];
  if (!runId) {
    throw new Error('Missing run id for advance-loop.ts');
  }
  const state = await advanceLoop(root, runId);
  console.log(`Advanced loop to iteration ${state.iteration}.`);
}

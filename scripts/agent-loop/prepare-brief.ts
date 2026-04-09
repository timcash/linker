import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  buildPreparedSlice,
  createLoopPaths,
  formatCommandBlock,
  formatListBlock,
  parseLoopCliOptions,
  readJsonFile,
  readTextFile,
  resolveLoopMode,
  selectSliceDefinition,
  trimPromptContent,
  writeJsonFile,
  writeMarkdownFile,
  type LoopCliOptions,
  type LoopConfig,
  type LoopState,
  type PreparedSlice,
} from './shared';
import {writeTasksDashboard} from './write-tasks-dashboard';

export async function prepareBrief(
  root: string,
  options: LoopCliOptions,
): Promise<PreparedSlice> {
  const paths = createLoopPaths(root);
  const config = await readJsonFile<LoopConfig>(paths.configPath);
  const state = await readJsonFile<LoopState>(paths.statePath);
  const slice = selectSliceDefinition(config, state, options);
  const rubricMarkdown = await readTextFile(paths.rubricPath);
  const preparedSlice = buildPreparedSlice(
    config,
    slice,
    state,
    rubricMarkdown,
    resolveLoopMode(options),
  );
  const markdown = buildCurrentSliceMarkdown(preparedSlice, root);
  const currentTaskMarkdown = buildCurrentTaskMarkdown(preparedSlice);
  const nextTaskIdeasMarkdown = buildNextTaskIdeasMarkdown(preparedSlice);

  if ((state.currentTaskId ?? null) !== (preparedSlice.currentTask?.id ?? null)) {
    await writeJsonFile(paths.statePath, {
      ...state,
      currentTaskId: preparedSlice.currentTask?.id ?? null,
    });
  }

  await writeJsonFile(paths.currentSliceJsonPath, preparedSlice);
  await writeMarkdownFile(paths.currentSliceMarkdownPath, markdown);
  await writeJsonFile(paths.currentTaskJsonPath, preparedSlice.currentTask);
  await writeMarkdownFile(paths.currentTaskMarkdownPath, currentTaskMarkdown);
  await writeMarkdownFile(paths.nextTaskIdeasPath, nextTaskIdeasMarkdown);
  await writeTasksDashboard(root);

  return preparedSlice;
}

function buildCurrentSliceMarkdown(
  preparedSlice: PreparedSlice,
  root: string,
): string {
  return trimPromptContent(`
# Current Slice Brief

- Slice: ${preparedSlice.slice}
- Name: ${preparedSlice.name}
- Intent: ${preparedSlice.intent}
- Root: \`${root}\`
- Docs To Review: ${preparedSlice.docsToReview.map((doc) => `\`${doc}\``).join(', ')}

## Owned Files

${formatListBlock(preparedSlice.ownedFiles.map((entry) => `\`${entry}\``))}

## Conditional Files

${formatListBlock(preparedSlice.conditionalOwnedFiles.map((entry) => `\`${entry}\``))}

## Must Not Touch

${formatListBlock(preparedSlice.mustNotTouch.map((entry) => `\`${entry}\``))}

## Tests To Write

${formatListBlock(preparedSlice.testsToWrite)}

## Commands

${formatCommandBlock(preparedSlice.commandsToRun)}

## Datasets

${formatListBlock(preparedSlice.datasets)}

## Current Task

${preparedSlice.currentTask ? formatCurrentTaskBlock(preparedSlice.currentTask) : '- none'}

## Next Task Ideas

${preparedSlice.nextTaskIdeas.length === 0 ? '- none' : formatListBlock(preparedSlice.nextTaskIdeas.map((task) => `\`${task.id}\` ${task.title}`))}

## Rubric

${preparedSlice.rubricMarkdown}
`);
}

function buildCurrentTaskMarkdown(preparedSlice: PreparedSlice): string {
  if (!preparedSlice.currentTask) {
    return trimPromptContent(`
# Current Task

- none
`);
  }

  return trimPromptContent(`
# Current Task

${formatCurrentTaskBlock(preparedSlice.currentTask)}
`);
}

function buildNextTaskIdeasMarkdown(preparedSlice: PreparedSlice): string {
  return trimPromptContent(`
# Next Task Ideas

${preparedSlice.nextTaskIdeas.length === 0 ? '- none' : formatListBlock(preparedSlice.nextTaskIdeas.map((task) => `\`${task.id}\` ${task.title}`))}
`);
}

function formatCurrentTaskBlock(task: NonNullable<PreparedSlice['currentTask']>): string {
  return trimPromptContent(`
- Task: \`${task.id}\`
- Title: ${task.title}
- Role: \`${task.role}\`
- Intent: ${task.intent}
- Verify: \`${task.verifyCommand}\` expects \`${task.expectedResult}\`

## Task Allowed Files

${formatListBlock(task.allowedFiles.map((entry) => `\`${entry}\``))}

## Task Context Files

${formatListBlock(task.contextFiles.map((entry) => `\`${entry}\``))}

## Task Notes

${formatListBlock(task.notes)}

## Task Done When

${formatListBlock(task.doneWhen)}
`);
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const options = parseLoopCliOptions(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const preparedSlice = await prepareBrief(root, options);
  console.log(`Prepared slice ${preparedSlice.slice}: ${preparedSlice.name}`);
}

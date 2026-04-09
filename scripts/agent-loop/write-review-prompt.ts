import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  createLoopPaths,
  formatCommandBlock,
  formatListBlock,
  readJsonFile,
  readTextFile,
  trimPromptContent,
  writeMarkdownFile,
  type CheckResults,
  type PreparedSlice,
  type WorkerReport,
} from './shared';
import {readUnifiedLogTail, resolveUnifiedLogPath} from '../logging';

export async function writeReviewPrompt(
  root: string,
  runDir: string,
): Promise<string> {
  const paths = createLoopPaths(root);
  const systemPrompt = await readTextFile(paths.monitorSystemPromptPath);
  const preparedSlice = await readJsonFile<PreparedSlice>(paths.currentSliceJsonPath);
  const workerReport = await readJsonFile<WorkerReport>(
    path.join(runDir, 'worker-report.json'),
  );
  const checkResults = await readJsonFile<CheckResults>(
    path.join(runDir, 'check-results.json'),
  );
  const changedFilesList =
    checkResults.changedFiles.length === 0
      ? '- none'
      : checkResults.changedFiles
          .map((entry) => `- ${entry.kind}: \`${entry.path}\``)
          .join('\n');
  const changedImagesList =
    checkResults.changedImageFiles.length === 0
      ? '- none'
      : formatListBlock(checkResults.changedImageFiles.map((entry) => `\`${entry}\``));
  const requiredDocUpdatesPresentList =
    checkResults.requiredDocUpdatesPresent.length === 0
      ? '- none'
      : formatListBlock(checkResults.requiredDocUpdatesPresent.map((entry) => `\`${entry}\``));
  const requiredDocUpdatesMissingList =
    checkResults.requiredDocUpdatesMissing.length === 0
      ? '- none'
      : formatListBlock(checkResults.requiredDocUpdatesMissing.map((entry) => `\`${entry}\``));
  const commandResultsList =
    checkResults.commands.length === 0
      ? '- none'
      : checkResults.commands
          .map((entry) => {
            return `- \`${entry.command}\` => ${entry.success ? 'success' : `failure (${entry.exitCode})`}`;
          })
          .join('\n');
  const commandOutputTails =
    checkResults.commands.length === 0
      ? 'none'
      : checkResults.commands
          .map((entry) => {
            return `### ${entry.command}\n\n\`\`\`\n${entry.outputTail || '(no output captured)'}\n\`\`\``;
          })
          .join('\n\n');
  const scopeViolationBlock =
    checkResults.scopeViolations.length === 0
      ? '- none'
      : formatListBlock(checkResults.scopeViolations.map((entry) => `\`${entry}\``));
  const taskScopeViolationBlock =
    checkResults.taskScopeViolations.length === 0
      ? '- none'
      : formatListBlock(checkResults.taskScopeViolations.map((entry) => `\`${entry}\``));
  const workerStdoutTail = tailText(
    await readTextFile(path.join(runDir, 'worker-stdout.log')),
  );
  const workerStderrTail = tailText(
    await readTextFile(path.join(runDir, 'worker-stderr.log')),
  );
  const currentTaskMarkdown = await readTextFile(paths.currentTaskMarkdownPath);
  const nextTaskIdeasMarkdown = await readTextFile(paths.nextTaskIdeasPath);
  const unifiedLogTail = await readUnifiedLogTail(resolveUnifiedLogPath(root));
  const prompt = trimPromptContent(`
${systemPrompt}

Review this worker run for the Linker repo.

You must verify alignment with:

- \`README.md\` as the workflow guide
- \`PLAN.md\` as the upgrade and test ladder
- the rubric below

The worker is required to update both \`README.md\` and \`PLAN.md\` in every real iteration to keep the docs in sync with the code and test loop. Treat missing doc updates as a failed docs-sync step unless the run was explicitly review-only.

## Slice

- Slice: ${preparedSlice.slice}
- Name: ${preparedSlice.name}
- Intent: ${preparedSlice.intent}

## Commands That Were Expected

${formatCommandBlock(preparedSlice.commandsToRun)}

## Current Task

${currentTaskMarkdown}

## Next Task Ideas

${nextTaskIdeasMarkdown}

## Worker Report

\`\`\`json
${JSON.stringify(workerReport, null, 2)}
\`\`\`

## Check Results

### Changed Files

${changedFilesList}

### Changed Image Files

${changedImagesList}

### Required Doc Updates Present

${requiredDocUpdatesPresentList}

### Required Doc Updates Missing

${requiredDocUpdatesMissingList}

### Command Results

${commandResultsList}

### Command Output Tails

${commandOutputTails}

### Scope Violations

${scopeViolationBlock}

### Task Scope Violations

${taskScopeViolationBlock}

## Worker Log Tails

### worker-stdout.log

\`\`\`
${workerStdoutTail}
\`\`\`

### worker-stderr.log

\`\`\`
${workerStderrTail}
\`\`\`

## Unified Linker Log

- path: \`${resolveUnifiedLogPath(root)}\`

\`\`\`
${unifiedLogTail}
\`\`\`

## Monitor Focus

${formatListBlock(preparedSlice.monitorFocus)}

## Screenshot Expectation

- artifactsExpected: ${preparedSlice.artifactsExpected ? 'true' : 'false'}

## Required Monitor Steps

- \`readme-review\`
- \`plan-review\`
- \`test-written\`
- \`code-used-in-test\`
- \`commands-reviewed\`
- \`logs-reviewed\`
- \`scope-review\`
- \`screenshot-review\`

Mark \`screenshot-review\` as \`not-applicable\` only when screenshot review is truly outside this slice. If the worker changed image files or the slice explicitly expects screenshot artifacts, the screenshot step must not be skipped.

For this repo, \`readme-review\` and \`plan-review\` should use both review evidence and docs-sync evidence:

- did the worker review the docs?
- did the worker update the docs in this cycle?

## Rubric

${preparedSlice.rubricMarkdown}

Decide one of:

- accept
- revise
- tighten-test
- ask-user
- stop

Return only JSON that matches the schema.
`);

  await writeMarkdownFile(path.join(runDir, 'review-prompt.md'), prompt);
  return prompt;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const runDir = process.argv[process.argv.length - 1];
  if (!runDir) {
    throw new Error('Missing run directory argument for write-review-prompt.ts');
  }
  await writeReviewPrompt(root, runDir);
  console.log(`Wrote review prompt for ${runDir}`);
}

function tailText(value: string, length = 4000): string {
  const normalized = value.trim();
  return normalized.length === 0 ? '(empty)' : normalized.slice(-length);
}

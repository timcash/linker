import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {promoteRunChanges} from './shared';
import {writeTasksDashboard} from './write-tasks-dashboard';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runId = process.argv[2];

if (!runId) {
  throw new Error('Missing run id. Usage: tsx scripts/agent-loop/promote-run.ts <run-id>');
}

const result = await promoteRunChanges(root, runId);
await writeTasksDashboard(root);
console.log(
  JSON.stringify(
    {
      appliedFiles: result.appliedFiles,
      runId: result.runId,
      status: result.status,
    },
    null,
    2,
  ),
);

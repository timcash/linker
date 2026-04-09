# Agent Test Loop

## Goal

Run a repo-contained Codex-on-Codex loop where:

- one Codex CLI instance is the `worker`
- one Codex CLI instance is the `monitor`
- `README.md` stays the short workflow source of truth
- `PLAN.md` stays the slice ladder and test roadmap
- one focused test loop advances one slice at a time

The preferred operator entrypoint is:

```powershell
.\agent.ps1 -Worktree -Browser -Once
```

That command should:

- prepare the current slice brief from `PLAN.md` and `.codex-loop/rubric.md`
- prepare one explicit task packet for the current run
- start a worker run in an isolated workspace
- run the required repo checks
- start a monitor review
- write the next decision and checklist into `.codex-loop/runs/<run-id>/`
- require the worker to update `README.md` and `PLAN.md` on every real iteration

## Current Repo Status

This is no longer only a concept note. The repo already has a working first version of the loop.

Current entrypoint:

- [agent.ps1](agent.ps1)

Current loop implementation:

- [scripts/agent-loop/run.ts](scripts/agent-loop/run.ts)
- [scripts/agent-loop/prepare-brief.ts](scripts/agent-loop/prepare-brief.ts)
- [scripts/agent-loop/run-checks.ts](scripts/agent-loop/run-checks.ts)
- [scripts/agent-loop/write-review-prompt.ts](scripts/agent-loop/write-review-prompt.ts)
- [scripts/agent-loop/advance-loop.ts](scripts/agent-loop/advance-loop.ts)
- [scripts/agent-loop/shared.ts](scripts/agent-loop/shared.ts)

Current per-run task artifacts:

- [.codex-loop/current-task.json](.codex-loop/current-task.json)
- [.codex-loop/current-task.md](.codex-loop/current-task.md)
- [.codex-loop/next-task-ideas.md](.codex-loop/next-task-ideas.md)
- [public/tasks-data.json](public/tasks-data.json)
- `/tasks`

Current prompt and schema files:

- [.codex-loop/prompts/worker-system.md](.codex-loop/prompts/worker-system.md)
- [.codex-loop/prompts/monitor-system.md](.codex-loop/prompts/monitor-system.md)
- [.codex-loop/prompts/worker-output-schema.json](.codex-loop/prompts/worker-output-schema.json)
- [.codex-loop/prompts/monitor-output-schema.json](.codex-loop/prompts/monitor-output-schema.json)

Current slice/config source:

- [.codex-loop/config.json](.codex-loop/config.json)
- [.codex-loop/rubric.md](.codex-loop/rubric.md)

Latest experiment:

- run `20260408-161302` proved the worker can update `README.md` and `PLAN.md` in a real worktree cycle while the monitor reads explicit docs-sync evidence from `check-results.json`
- that run ended in `tighten-test`, which is the intended behavior for a partial Slice 6 step: the static LOD helper/test work was accepted as real progress, and the monitor pushed the next task back toward the missing browser smoke proof
- browser-backed runs should now also track `npm run test:live -- --url https://timcash.github.io/linker/` so the GitHub Pages smoke result stays visible beside the local browser proof
- run `20260408-174647` proved the full review-and-promote path: the worker updated `README.md` and `PLAN.md`, the monitor cited `[test.live.pass]` from `test.log`, the run wrote `review-worker-changes.md` plus `promotion-manifest.json`, and `.\agent.ps1 -PromoteRun 20260408-174647` applied the reviewed files back into root with hash checks
- the loop now also prepares one explicit task packet per run and records the next few task ideas, which is the first concrete step toward the subtask-first model described later in this document
- focused browser commands now only fail on unexpected structured errors from their own session, so an earlier intentional worker failure in the same shared `test.log` no longer poisons the later monitored check
- run `20260408-183023` proved the task packet is already useful in practice: the worker got all required commands green, including the live GitHub Pages smoke, and the monitor rejected the run for the right reason `scope-review` because the diff escaped the current task into `src/app.ts` and `scripts/test/dag-view-smoke.ts`
- the repo now exports the loop into `public/tasks-data.json` and renders it at `/tasks` as HTML tables for loop summary, current task, next tasks, task ladder, run history, and monitor review steps
- the repo now also has a focused browser smoke for that loop UI through `npm run test:browser:tasks`, so the worker and monitor dashboard stays under the same regression discipline as the app

## Windows-First Workflow

This repo is currently optimized for Windows-first development because the browser tests assume a host Chrome flow.

Recommended loop:

```powershell
# one browser-backed loop cycle in an isolated git worktree
.\agent.ps1 -Worktree -Browser -Once

# one static-only loop cycle
.\agent.ps1 -Worktree -StaticOnly -Once

# continue iterating on the same worker workspace
.\agent.ps1 -Worktree -Browser -Resume

# review a run and apply its worker diff back into root
.\agent.ps1 -PromoteRun 20260408-174647

# verify the loop dashboard itself
npm run test:browser:tasks
```

Supported flags today:

- `-Worktree`: use the worker git worktree at `.codex-loop/worktrees/worker`
- `-StaticOnly`: skip browser checks and run only static/lint commands for the slice
- `-Browser`: include browser commands for the slice
- `-Once`: run exactly one worker plus monitor cycle
- `-Resume`: reuse the existing worker workspace instead of refreshing it
- `-Slice <n>`: override the active slice from state
- `-InPlace`: run directly in the root workspace
- `-ReviewOnly`: skip the worker and only run checks plus monitor review
- `-PromoteAccepted`: automatically apply the run back into root after a monitor `accept`
- `-PromoteRun <run-id>`: apply a reviewed worker run back into the root workspace after hash-checking the reviewed files
- `-MaxIterations <n>`: cap the loop length
- `-UseWsl`: optional Linux path when WSL Codex and `tsx` are installed

## Workspace Modes

The loop supports three workspace modes:

### 1. `git-worktree`

Recommended default.

- worker path: `.codex-loop/worktrees/worker`
- branch: `codex/agent-loop-worker`
- behavior: create or reuse a git worktree, then mirror the current repo contents into it before a fresh worker cycle

Why this is preferred:

- isolates the worker from the main tree
- keeps git semantics intact
- still reflects current local `README.md`, `PLAN.md`, and source edits

### 2. `snapshot-copy`

Fallback when worktrees are not desired.

- worker path: `.codex-loop/workspaces/worker`
- behavior: copy the repo into a child workspace, excluding `.git`, `.codex-loop`, `dist`, `artifacts`, and `node_modules`

### 3. `in-place`

Special-case mode only.

- worker path: repo root
- behavior: worker edits the main workspace directly

## Operator Loop

The intended human loop is:

1. Review [README.md](README.md) for the short repo workflow.
2. Review [PLAN.md](PLAN.md) for the next slice and focused test path.
3. Start one narrow loop cycle with `.\agent.ps1 -Worktree -Browser -Once` or `-StaticOnly`.
4. Open the latest run folder under `.codex-loop/runs/`.
5. Read `.codex-loop/current-task.md` to see the single task, role, verify command, and done conditions for the current run.
6. Read `monitor-steps.md` first.
7. Read `review-worker-changes.md` to inspect the proposed root-vs-worker file set.
8. If the run is worth keeping, apply it with `.\agent.ps1 -PromoteRun <run-id>`.
9. If the monitor returned `tighten-test` or `revise`, run another cycle with `-Resume`.
10. Only broaden to the next slice after the monitor accepts the current one.

The docs-sync rule is mandatory:

- every non-review-only worker cycle must update `README.md`
- every non-review-only worker cycle must update `PLAN.md`

The goal is to keep the repo workflow, slice status, and next steps current after every experiment.

## Subtask-First Model

To make the worker complete one thing at a time, each slice should be broken into an ordered subtask list.

The loop should advance by:

- `slice`
- then `subtask`
- then `gate result`

That means a slice is not one big worker prompt. It is a short sequence like:

1. review docs
2. write the smallest test
3. run the failing command
4. write the smallest code
5. rerun the command
6. review logs
7. review screenshots if required
8. report one proven invariant

The monitor should only approve one subtask at a time. The next subtask should not be sent until the current one has passed its gate.

## Recommended Subtask Types

Use a small fixed vocabulary so the loop stays predictable:

- `role-setup`
  - assign the worker a narrow role for the current subtask
- `review-docs`
  - open `README.md` and `PLAN.md`, restate the target invariant
- `write-test`
  - add or tighten only the next needed test
- `run-failing-test`
  - run the narrow command and prove the failure is the expected one
- `write-code`
  - change only the minimal production code needed for that test
- `run-passing-test`
  - rerun the same command and prove it is green
- `tighten-browser-proof`
  - when the slice needs runtime proof, tighten the focused browser flow
- `review-logs`
  - inspect `test.log` plus worker stdout/stderr and confirm the claims
- `review-screenshot`
  - inspect screenshot artifacts only when the slice requires them
- `report-invariant`
  - summarize one proven invariant and the remaining open risk

## One-Step-At-A-Time Gates

Each subtask should have a gate that is checked before the loop advances.

Examples:

- `review-docs`
  - pass only if `test.log` shows explicit `README.md` and `PLAN.md` open commands
- `write-test`
  - pass only if a test file changed and no production file changed yet
- `run-failing-test`
  - pass only if the required command failed for the expected reason
- `write-code`
  - pass only if production files changed and the changed test still exists
- `run-passing-test`
  - pass only if the same command is now green
- `review-logs`
  - pass only if the worker report matches the actual `test.log` evidence
- `review-screenshot`
  - pass only if the expected artifact exists and the slice requires it

This is the key rule:

- the worker does not choose the next subtask
- the loop does

## Monitor-to-Worker Packet

The monitor should not send the worker a vague slice summary. It should send a structured packet with:

1. a `role`
2. a small `context` bundle
3. one `completion test`
4. one `done` rule

The worker should treat that packet as the entire assignment for the current cycle.

### Required Packet Fields

- `role`
  - the worker's narrow identity for this subtask
- `intent`
  - one sentence saying what the worker is trying to prove
- `allowedFiles`
  - the only files the worker should touch
- `contextFiles`
  - the minimum files to read right now
- `contextNotes`
  - short extracted facts from the monitor
- `verify`
  - the exact command or test that proves the subtask is complete
- `expectedResult`
  - `fail` or `pass`
- `doneWhen`
  - a short list of concrete gate conditions

### Example Roles

Use roles that match the current subtask instead of one generic "worker" role:

- `doc-reviewer`
  - prove the repo workflow and slice ladder were reviewed
- `test-author`
  - add the smallest missing test first
- `failure-checker`
  - run the command and confirm the expected failure
- `minimal-implementer`
  - write the smallest code needed for the test
- `pass-checker`
  - rerun the command and confirm it is green
- `browser-proof-author`
  - tighten the focused browser flow
- `log-reviewer`
  - compare worker claims to `test.log`
- `screenshot-reviewer`
  - inspect expected artifacts when the slice requires them

The important idea is that the role should constrain behavior. A `test-author` should not also broaden implementation. A `log-reviewer` should not also edit production code.

## Just-In-Time Context Packs

To avoid overloading the worker, each subtask should get a small context pack instead of the whole slice history.

### `review-docs` pack

- `README.md`
- `PLAN.md`
- `.codex-loop/current-slice.md`

### `write-test` pack

- current invariant sentence
- owned test file paths
- the smallest related production file path
- the previous gate result

### `run-failing-test` pack

- the changed test file
- the one required command
- the expected failing condition

### `write-code` pack

- failing command output
- touched test file
- owned production file paths

### `run-passing-test` pack

- same command as the failing step
- same touched files
- expected green condition

### `review-logs` pack

- `test.log` tail
- `worker-stdout.log`
- `worker-stderr.log`
- `check-results.json`

### `review-screenshot` pack

- expected screenshot paths
- slice screenshot rule
- screenshot artifact list from `test.log`

The worker brief should include only the current pack plus the minimum rules needed for scope control.

## Verification-First Completion

Every subtask should have one primary test or command that answers:

- how does the worker know this subtask is complete?

That verification should come from the monitor, not from the worker.

Examples:

- for `review-docs`
  - verify by checking that `test.log` contains explicit `Get-Content -Raw README.md` and `Get-Content -Raw PLAN.md`
- for `write-test`
  - verify by checking that a test file changed and no production file changed
- for `run-failing-test`
  - verify with `npm run test:dag:static` and expect `fail`
- for `write-code`
  - verify by rerunning the same failing command after the code change
- for `run-passing-test`
  - verify with `npm run test:dag:static` and expect `pass`
- for `tighten-browser-proof`
  - verify with `npm run test:browser -- --flow dag-view-smoke`
- for `review-logs`
  - verify by matching the worker report claims against `test.log`

The worker should not invent a different completion test mid-task unless the monitor explicitly revises the packet.

## Suggested Task File Shape

The cleanest repo-local shape is one current task file plus optional per-slice task templates.

Suggested runtime file:

- `.codex-loop/current-task.json`

Suggested shape:

```json
{
  "slice": 6,
  "subtaskIndex": 2,
  "subtaskId": "write-test",
  "role": "test-author",
  "intent": "Add the next smallest failing test for DAG LOD bucketing.",
  "allowedFiles": [
    "scripts/test/unit.ts"
  ],
  "contextFiles": [
    "README.md",
    "PLAN.md",
    ".codex-loop/current-slice.md",
    "scripts/test/unit.ts",
    "src/dag-view.ts"
  ],
  "contextNotes": [
    "README.md is the repo workflow source of truth.",
    "PLAN.md says Slice 6 still needs the next smallest LOD proof.",
    "Do not change browser flow files in this subtask."
  ],
  "verify": {
    "command": "npm run test:dag:static",
    "why": "The new test should fail for the missing LOD behavior before code changes."
  },
  "expectedResult": "fail",
  "commands": [
    {
      "command": "npm run test:dag:static",
      "expect": "fail"
    }
  ],
  "doneWhen": [
    "A test file changed",
    "No production file changed",
    "The next command failure matches the target invariant"
  ]
}
```

The worker prompt should be generated from this file, not from the full slice every time.

## Worker Prompt Shape

The worker prompt should be built from the task packet in this order:

1. `role`
2. `intent`
3. `allowedFiles`
4. `contextFiles`
5. `contextNotes`
6. `verify`
7. `doneWhen`

That means the worker sees:

- who it is for this step
- what it is trying to prove
- what files it may touch
- what files it must read
- what command proves completion

The prompt should stay small enough that the worker is naturally pushed into one action, not a whole slice worth of work.

## Slice Template Shape

Each slice in `.codex-loop/config.json` should eventually carry a subtask ladder instead of only a flat list of commands.

Suggested extension:

```json
{
  "slice": 6,
  "name": "LOD Bucketing",
  "subtasks": [
    {
      "id": "review-docs",
      "kind": "review-docs"
    },
    {
      "id": "write-static-test",
      "kind": "write-test",
      "allowedFiles": ["scripts/test/unit.ts"]
    },
    {
      "id": "run-static-fail",
      "kind": "run-failing-test",
      "commands": ["npm run test:dag:static"]
    },
    {
      "id": "write-helper-code",
      "kind": "write-code",
      "allowedFiles": ["src/dag-view.ts"]
    }
  ]
}
```

That gives the loop a machine-readable ladder instead of a single freeform brief.

## Current Slice Example

For the current Slice 6 flow, a good ordered subtask list would be:

1. `review-docs`
   - role: `doc-reviewer`
   - open `README.md`
   - open `PLAN.md`
   - restate the exact Slice 6 target
2. `write-static-test`
   - role: `test-author`
   - add the smallest missing unit test for the next LOD invariant
3. `run-static-fail`
   - role: `failure-checker`
   - run `npm run test:dag:static`
   - capture the expected failure in `test.log`
4. `write-static-code`
   - role: `minimal-implementer`
   - make the smallest code change in `src/dag-view.ts`
5. `run-static-pass`
   - role: `pass-checker`
   - rerun `npm run test:dag:static`
6. `tighten-browser-test`
   - role: `browser-proof-author`
   - update `scripts/test/dag-view-smoke.ts`
7. `run-browser-pass`
   - role: `pass-checker`
   - run `npm run test:browser -- --flow dag-view-smoke`
8. `review-logs`
   - role: `log-reviewer`
   - confirm `test.log` supports the worker claims
9. `report-invariant`
   - role: `minimal-implementer`
   - report one proven invariant and one open risk

That is much tighter than asking the worker to do “Slice 6” all at once.

## Where To Implement This

The minimal repo changes to support subtask-first execution are:

- [scripts/agent-loop/prepare-brief.ts](scripts/agent-loop/prepare-brief.ts)
  - build `current-task.json` and `current-task.md` instead of only a slice brief
- [scripts/agent-loop/run.ts](scripts/agent-loop/run.ts)
  - run one subtask per cycle, print the current subtask id, and surface the current role
- [scripts/agent-loop/run-checks.ts](scripts/agent-loop/run-checks.ts)
  - use the current subtask gate and current verification command instead of always running the full slice command set
- [scripts/agent-loop/advance-loop.ts](scripts/agent-loop/advance-loop.ts)
  - advance `subtaskIndex` first, then advance `slice` only after the last subtask is accepted
- [.codex-loop/prompts/worker-system.md](.codex-loop/prompts/worker-system.md)
  - tell the worker it owns only the current role, context pack, and verification target
- [.codex-loop/prompts/monitor-system.md](.codex-loop/prompts/monitor-system.md)
  - tell the monitor to judge only the current subtask gate and whether the completion test was truly satisfied
- [.codex-loop/config.json](.codex-loop/config.json)
  - add subtask ladders, roles, and verification commands per slice

## State Model Extension

The current loop state is slice-oriented. To make subtask progression explicit, add fields like:

```json
{
  "currentSlice": 6,
  "currentSubtaskIndex": 3,
  "currentSubtaskId": "write-code",
  "lastDecision": "tighten-test",
  "lastRunId": "20260408-150933"
}
```

That will let the loop resume exactly where it left off without rebuilding the whole slice prompt every time.

## Run Artifacts

Each loop run writes a folder under:

- `.codex-loop/runs/<run-id>/`

Important artifacts:

- `brief.md`
  - the exact worker brief for the slice
- `current-task.json`
  - the active task packet for the run with role, intent, allowed files, verify command, and done conditions
- `current-task.md`
  - readable form of the active task packet
- `next-task-ideas.md`
  - the next few task packets after the current one
- `worker-report.json`
  - the worker's structured report
- `worker-stdout.log`
  - worker Codex stdout
- `worker-stderr.log`
  - worker Codex stderr
- `check-results.json`
  - changed files, command results, scope violations, changed image files, explicit required-doc-update presence or missing lists, and the GitHub Pages live-smoke result when the loop ran in browser mode
- `review-prompt.md`
  - the prompt given to the monitor
- `supervisor-review.json`
  - the monitor's structured decision
- `monitor-steps.md`
  - the readable checklist summary
- `review-worker-changes.md`
  - the reviewable root-vs-worker diff manifest with suggested review commands and the promote command
- `promotion-manifest.json`
  - hash-checked file manifest used by `.\agent.ps1 -PromoteRun <run-id>`
- `promotion-result.json`
  - the result of a promotion attempt
- `promotion-result.md`
  - readable promotion outcome
- `test-log-tail.md`
  - the tail of the shared unified log captured for the review

The current state file lives at:

- [.codex-loop/state.json](.codex-loop/state.json)

## Unified Logging

All local test and loop output should roll into a single file:

- [test.log](test.log)

That log is reset at the start of each top-level run:

- `npm run test:dag:static`
- `npm run test:browser ...`
- `npm run test:preview`
- `npm run test:live`
- `.\agent.ps1 ...`

The unified log should include:

- Vite dev server output
- Vite build and preview output
- Puppeteer browser console output
- Puppeteer page errors
- failed network requests and error responses
- saved browser artifact paths
- static test output
- focused command output run by the agent loop
- GitHub Pages live-smoke output
- worker Codex stdout/stderr
- monitor Codex stdout/stderr

The monitor must review this shared log, not just the worker JSON report.

Important detail:

- browser commands should only treat unexpected structured error lines from their own session as fatal
- earlier exploratory failures may stay visible in the shared `test.log`, but they should not automatically fail a later monitored browser command in the same loop run

## Monitor Checklist

The monitor must always emit explicit step results for:

1. `readme-review`
2. `plan-review`
3. `test-written`
4. `code-used-in-test`
5. `commands-reviewed`
6. `logs-reviewed`
7. `scope-review`
8. `screenshot-review`

The monitor should use `check-results.json` as the first docs-sync proof:

- `requiredDocUpdatesPresent` should include `README.md` and `PLAN.md` for every non-review-only worker cycle
- `requiredDocUpdatesMissing` should be empty for every non-review-only worker cycle
- the latest real example is `.codex-loop/runs/20260408-161302/check-results.json`
- `taskScopeViolations` should stay empty when the worker really stayed inside the active task packet

Current checklist artifact:

- `monitor-steps.md`

Current structured schema:

- [.codex-loop/prompts/monitor-output-schema.json](.codex-loop/prompts/monitor-output-schema.json)

Decision values:

- `accept`
- `revise`
- `tighten-test`
- `ask-user`
- `stop`

### What The Monitor Should Be Strict About

- `README.md` review must be evidenced in commands or logs, not merely asserted in JSON.
- `PLAN.md` review must be evidenced in commands or logs, not merely asserted in JSON.
- `README.md` must also be updated in every worker iteration
- `PLAN.md` must also be updated in every worker iteration
- the worker must add or tighten the smallest relevant test first
- the changed implementation must be exercised by that tightened test
- required commands must be backed by real command output
- the shared `test.log` must support the worker's claims
- out-of-scope file changes must fail scope review
- screenshot review may be `not-applicable` only when the slice truly does not require screenshot work

## Worker Contract

The worker should behave like a narrow TDD assistant, not a roadmap finisher.

Required sequence:

1. open `README.md`
2. open `PLAN.md`
3. restate the smallest invariant
4. add or tighten the smallest relevant test
5. run the focused command and confirm the failure is on target
6. make the smallest production change
7. rerun the focused command
8. stop after one new invariant goes green

The worker must report:

- `docsReviewed`
- `changedFiles`
- `commandsRun`
- `testsTouched`
- `implementationFilesUsedByTests`
- `logsReviewed`
- `screenshotsReviewed`
- `newInvariant`
- `openRisks`

Important rule:

- evidence matters more than claims
- docs sync matters every time, not only when a milestone lands

That means the worker should prefer explicit log-visible actions like:

```powershell
Get-Content -Raw README.md
Get-Content -Raw PLAN.md
npm run test:dag:static
```

and should make sure the initial failing test output is visible in `test.log`, not only summarized later.

The worker should also leave a small but real docs delta in both `README.md` and `PLAN.md` every cycle, for example:

- current slice status
- what changed in the loop
- what test or command was just proven
- what the next smallest step is

## Slice Contract

Each slice should stay small enough that one monitor decision can clearly say:

- what new invariant is now proven
- which test proves it
- which implementation is exercised
- what still remains out of scope

The current slice source of truth is:

- [PLAN.md](PLAN.md)
- [.codex-loop/config.json](.codex-loop/config.json)
- [.codex-loop/rubric.md](.codex-loop/rubric.md)

For the current DAG flow, the narrow command ladder is:

```bash
npm run test:dag:static
npm run lint
npm run test:browser -- --flow dag-view-smoke
npm run test:live -- --url https://timcash.github.io/linker/
```

## Implementation Map

Current responsibilities by file:

- [agent.ps1](agent.ps1)
  - PowerShell entrypoint and flag forwarding
- [scripts/agent-loop/run.ts](scripts/agent-loop/run.ts)
  - main loop orchestration
- [scripts/agent-loop/shared.ts](scripts/agent-loop/shared.ts)
  - workspace setup, Codex execution, command execution, diff collection
- [scripts/agent-loop/prepare-brief.ts](scripts/agent-loop/prepare-brief.ts)
  - slice preparation
- [scripts/agent-loop/run-checks.ts](scripts/agent-loop/run-checks.ts)
  - local repo command checks
- [scripts/agent-loop/write-review-prompt.ts](scripts/agent-loop/write-review-prompt.ts)
  - builds the monitor prompt with log tails and run artifacts
- [scripts/agent-loop/advance-loop.ts](scripts/agent-loop/advance-loop.ts)
  - updates the state machine after the monitor decision
- [scripts/agent-loop/promote-run.ts](scripts/agent-loop/promote-run.ts)
  - applies a reviewed worker run back into the root workspace using the run's promotion manifest
- [scripts/logging.ts](scripts/logging.ts)
  - unified `test.log` management

## Known Gaps

The current loop works, but it still needs improvement.

Important gaps:

- the worker can still claim README/PLAN review without enough direct log evidence
- the worker can still update docs too vaguely unless the monitor checks for concrete slice-status changes
- the worker can still claim an initial failing test without the failure always landing in `test.log`
- monitor review currently sees Codex stderr noise from external plugin startup warnings, which may need future filtering
- promotion is now available, but it is still intentionally manual; the operator must review `review-worker-changes.md` before applying a run back into root
- the loop now chooses one explicit task per run, but task-specific scope review is still lighter than the full subtask-gate system described later in this doc
- the current `export-dag-lod-dataset` task packet may still be too narrow, because the real implementation path touched `src/app.ts`; the task definitions themselves now need iteration based on real runs, not just intent

## Recommended Next Improvements

1. Make doc-review evidence mandatory by logging explicit `README.md` and `PLAN.md` open commands first.
2. Make docs-sync quality stricter so `README.md` and `PLAN.md` always record the new invariant and next step, not just generic wording.
3. Make the initial failing test run mandatory in the worker contract.
4. Filter known Codex/plugin noise from monitor log review without hiding real repo errors.
5. Keep `-PromoteAccepted` opt-in until more loop slices have soaked in real use.
6. Promote task-specific scope violations into first-class monitor evidence.
7. Add more slice-specific browser checks as `PLAN.md` grows.

## Summary

This repo now has a real first-pass supervised agent loop.

The practical model is:

- `README.md` is the short workflow guide
- `PLAN.md` is the slice ladder
- `agent.ps1` is the single human entrypoint
- a worker Codex instance edits code in an isolated workspace
- a monitor Codex instance reviews the result
- `test.log` is the single shared log
- `monitor-steps.md` is the fastest artifact to inspect after each run

The loop should continue evolving toward stricter evidence, smaller diffs, and narrower test-first progress.

# History And Session Persistence Plan

Research snapshot: 2026-03-31

## Goal

Keep history enabled without making `2d-mode` zooming and panning slower over time.

The new rule for this system is:

- history must scale with session length
- browser URL state must stay minimal
- persistence must append incrementally instead of rewriting the full history blob

## Problem Summary

The current history system gets slower as the session gets older because it does three expensive things:

- it copies the full in-memory history array on every new entry
- it exports and rewrites the full persisted history on save
- it pushes browser history entries while also mirroring extra app state into the URL

Observed consequences:

- fresh sessions feel fast
- long-lived sessions become laggy during repeated zoom/pan in `2d-mode`
- performance degradation is driven by session age, not just by visible scene complexity

## Current Problems In The Code

### 1. Full Array Copy On Every Append

`src/stage-history.ts`

- `appendEntry(...)` currently does `history.entries.slice(0, history.cursorStep + 1)`
- that means every new view/checkpoint entry copies the full entry array
- repeated camera movement becomes more expensive as `entries.length` grows

This is the main reason the system slows down over time.

### 2. Full History Export On Save

`src/app.ts`

- debounced session save calls `createPersistedStageSessionSnapshot()`
- that exports the full history from the worker

`src/stage-session-store.ts`

- the whole history payload is then written back into IndexedDB as a single large record

This turns every save into a rewrite of the entire accumulated session history.

### 3. Browser History And URL State Are Doing Too Much

`src/app.ts`

- history snapshot updates call `syncStageHistoryQueryParam(..., 'push')`
- route sync also mirrors stage mode, workplane, camera, layout, line strategy, and text strategy

`src/stage-config.ts`

- route state currently carries more than the minimum needed to reopen a session state

This creates unnecessary browser history churn and extra route/state update work.

## New Direction

The history system should move from:

- in-memory array snapshots
- full-history persistence
- browser `pushState` as part of app history
- broad URL mirroring of app state

to:

- append-only persisted history entries in IndexedDB
- minimal in-memory metadata plus small cached windows when needed
- URL state limited to `session=<session_id>` and `history=<step>`
- no browser back/forward integration for internal stage history

## URL Rules

The URL should only use:

- `session=<session_id>`
- `history=<step>`

The URL should stop mirroring:

- camera position
- camera label
- stage mode
- active workplane
- layout strategy
- line strategy
- text strategy
- browser history cursor state other than the explicit `history` step

Implications:

- route sync becomes much cheaper
- refresh/reopen still works through `session` and `history`
- browser history is no longer the transport for interactive app history

## Persistence Design

### Session Metadata Store

Create a session metadata record keyed by `sessionToken`.

This record should contain:

- `sessionToken`
- `savedAt`
- config needed to validate compatibility
- UI preferences that are not history entries
- current `headStep`
- current `cursorStep`
- latest checkpoint step metadata

### History Entry Store

Create a second IndexedDB store for history entries.

Each row should contain:

- `sessionToken`
- `step`
- `kind`
- `summary`
- payload for the entry

Entry kinds:

- `checkpoint`
- `view`

Checkpoint payload:

- full `StageSystemState`

View payload:

- `StageHistoryViewState`

Important rule:

- adding a new history step must insert exactly one new row

Important anti-rule:

- do not rewrite prior steps when adding a new step

## In-Memory Model

The in-memory controller should stop treating history as one growing copied array.

Keep only:

- current `cursorStep`
- current `headStep`
- latest checkpoint step
- latest checkpoint state when useful
- small recent-entry cache if needed for replay responsiveness

Appending a new entry should:

- assign `step = headStep + 1`
- persist only that one new row
- update session metadata
- update in-memory cursor/head numbers

If the cursor is not at the head when a new entry is added:

- delete or tombstone forward entries for that session beyond the cursor
- then append the new row at the next step

That work should happen in IndexedDB by range, not by rebuilding a whole history array.

## Replay Design

To restore a specific `history=<step>`:

1. Find the nearest checkpoint at or before the target step.
2. Load that checkpoint state.
3. Read forward entries from that checkpoint step through the target step.
4. Apply view entries in order.

This keeps replay cost proportional to:

- distance from the nearest checkpoint

not:

- total session history length

## Checkpoint Strategy

We still need checkpoints so replay does not get too expensive.

Rules:

- keep checkpoints for structural changes:
  - spawn/delete/select workplane
  - stage mode changes
  - label text edits
  - route/session override opens
- keep view entries for small camera/view changes
- add periodic checkpoints every N view entries if replay windows grow too large

Suggested starting rule:

- one checkpoint every `128` view entries per session

This can be tuned later based on measured replay cost.

## Browser History Changes

Remove browser-history integration for stage history.

Specifically:

- stop pushing stage history state into `window.history`
- stop using `popstate` to replay stage history
- stop syncing route state through browser navigation events

The app should still read `session` and `history` from the URL on load.

But after load:

- internal stage history should be app-managed only
- browser back/forward should not be part of the stage-history mechanism

## Step Recording Rules

For `2d-mode` camera movement:

- record only the latest meaningful settled view change
- avoid recording redundant no-op views
- do not copy the full history structure during append

For `3d-mode` orbit:

- keep the existing settle/debounce behavior conceptually
- persist one settled view entry, not a stream of intermediate drag samples

## Migration Plan

### Step 1. Remove Browser History Coupling

Work:

- stop pushing history snapshots through `pushState`
- remove `popstate` replay integration
- reduce route sync to `session` and `history` only
- remove syncing of camera/stage/workplane/layout/line/text into the URL

Success criteria:

- interactive camera movement no longer grows browser navigation history
- refreshing with `session` and `history` still restores the right state

### Step 2. Split Session Metadata From History Entries

Work:

- add an IndexedDB store for session metadata
- add an IndexedDB store for append-only history entries
- update load/save APIs to use the two-store model

Success criteria:

- appending one history step writes one row plus a small metadata update
- no full-history blob rewrite occurs during ordinary view changes

### Step 3. Replace Full-Array In-Memory Appends

Work:

- replace `StageHistoryState.entries` append-copy behavior
- keep lightweight cursor/head metadata in memory
- use cached recent rows or replay reads from IndexedDB when needed

Success criteria:

- per-step append cost stays effectively flat as session length grows
- long sessions no longer make pan/zoom progressively slower

### Step 4. Add Replay-From-Checkpoint Logic

Work:

- load nearest checkpoint at or before target step
- apply forward view entries from storage
- add periodic checkpointing rules

Success criteria:

- reopening `session=<id>&history=<step>` is deterministic
- replay cost depends on distance from checkpoint, not total history size

### Step 5. Update Tests And Perf Coverage

Work:

- update browser tests to stop expecting broad URL mirroring
- keep history-specific tests focused on:
  - restore by `session`
  - restore by `history`
  - replay correctness
- add a long-session perf test:
  - thousands of view entries
  - measure append latency growth
  - measure save cost
  - measure reopen/replay cost

Success criteria:

- tests validate the new storage model
- perf tests prove that history cost stays bounded over long sessions

## Non-Goals

This plan does not try to:

- redesign the text renderer
- redesign the line renderer
- use browser back/forward as a feature
- preserve old route formats beyond what is needed for migration

## Expected Outcome

After this change:

- `2d-mode` zoom/pan should stay fast even after long use
- history should remain available
- session restore should still work
- URL complexity should be reduced to `session` and `history`
- history persistence cost should scale with the newest step, not with total history length

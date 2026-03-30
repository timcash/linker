# Plane Stack Test Plan

## Review Summary

`PLAN.md` is directionally right, but the safest execution order in this repo is:

1. land state and observability first
2. land multi-workplane behavior in `2d-mode`
3. land persistence once the state shape is stable
4. refactor rendering behind a projector abstraction without changing behavior
5. land `3d-mode` and the `sdf-instanced` plane-aware text path last

That order matches the current codebase:

- `src/app.ts` is still the main controller and currently owns single-instance scene, camera, and UI state
- `src/stage-config.ts` is the route surface
- `src/stage-snapshot.ts` is the dataset contract used by browser tests
- `scripts/test/unit.ts` is the place for reducer/config/projector math checks
- `scripts/test.ts` runs an ordered browser flow, so new plane-stack coverage should be added as new numbered browser steps

The highest-risk item in the whole feature is still the `sdf-instanced` text rewrite for oriented glyph quads. It should not be mixed into the early state and lifecycle work.

## Baseline Gate

Before step 1, run the existing suite and keep it green after every step:

```bash
npm test
```

Current baseline review on 2026-03-29:

- `npm test` passes

## Step 1. Add Plane-Stack State And Test Observability

Goal:

- introduce `StageMode`, `WorkplaneId`, and the top-level plane-stack state container
- boot with one workplane only
- keep rendering and interaction behavior identical to today
- expose the new state through route parsing and body datasets without changing feature behavior yet

Implementation targets:

- `src/app.ts`
- `src/stage-config.ts`
- `src/stage-snapshot.ts`
- new state/reducer helpers if extracted from `src/app.ts`

Test work for this step:

- add unit coverage for default and invalid `stageMode` / `workplane` query parsing
- add unit coverage for initial plane-stack invariants:
  - one workplane exists
  - active workplane exists in order
  - delete is blocked at count `1`
- extend the ready browser step to assert new datasets:
  - `stageMode=2d-mode`
  - `planeCount=1`
  - `activeWorkplaneId=wp-1`
  - `workplaneCanDelete=false`
- assert the selection box still renders in the default route

Gate to run:

```bash
npm test
```

## Step 2. Land `2d-mode` Workplane Lifecycle First

Goal:

- implement `+`, `Delete`, `[`, and `]` against the new state model
- keep `2d-mode` drawing only the active workplane
- move camera memory, selected label, and label text overrides into per-workplane state
- enforce the phase 1 hard cap of `8`

Implementation targets:

- `src/app.ts`
- `src/label-focused-camera.ts`
- `src/stage-selection-box.ts`
- any new reducer/selector module created in step 1

Test work for this step:

- add unit coverage for reducer behavior:
  - spawn inserts behind the active workplane
  - spawned workplane becomes active
  - delete picks the nearest surviving neighbor
  - deleting the last workplane is blocked
  - spawn is blocked at `8`
- add a new browser step for `2d-mode` workplane lifecycle:
  - `+` increases `planeCount` and selects the new workplane
  - `]` and `[` move between workplanes
  - `Delete` removes the active workplane when allowed
  - per-workplane camera state is restored when switching back
  - per-workplane label edit text stays isolated
  - the selection box stays visible in `2d-mode`

Gate to run:

```bash
npm test
```

## Step 3. Add Session Persistence And Hydration

Goal:

- persist full plane-stack document and session state
- restore it on reload with the planned hydration order
- keep route params shallow and treat `session` as the deep-state hook

Implementation targets:

- `src/stage-config.ts`
- `src/stage-snapshot.ts`
- new persistence module for `IndexedDB`
- `src/app.ts`

Test work for this step:

- add unit coverage for snapshot schema and hydration rules:
  - invalid session token falls back safely
  - route `stageMode` override wins over stored mode
  - route `workplane` override only applies when the workplane exists
- add a new browser step that:
  - creates multiple workplanes
  - edits label text on at least two workplanes
  - moves each workplane to a different camera/focus state
  - reloads the page
  - verifies restoration of `planeCount`, active workplane, per-workplane camera state, and label edits

Gate to run:

```bash
npm test
```

## Step 4. Refactor Rendering Behind A Projector Without Changing UX

Goal:

- introduce the projection contract needed for stack view
- make `grid-layer`, `line-layer`, and `text-layer` consume a projector interface
- keep `2d-mode` visually equivalent by using a `PlaneFocusProjector` backed by the existing `Camera2D`

Implementation targets:

- `src/camera.ts`
- `src/grid.ts`
- `src/line/layer.ts`
- `src/text/layer.ts`
- new projector module(s)

Test work for this step:

- add unit coverage for projector math parity:
  - `PlaneFocusProjector.projectWorldPoint()` matches current camera projection
  - visible-bounds dependent logic still matches existing `2d-mode` behavior
- extend browser checks with a regression-style assertion:
  - default route still shows the root layer
  - camera controls still produce the same semantic route updates
  - the canvas pixel signature stays stable enough for the default route and a focused camera route

Gate to run:

```bash
npm test
```

## Step 5. Add `3d-mode` Stack View And Plane-Aware `sdf-instanced` Text

Goal:

- add `/` mode toggle and full stack rendering
- render all workplanes with `IsometricStackProjector`
- add finite workplane backplates and active-plane emphasis
- hide the normal `2d-mode` selection box and label picking behavior in `3d-mode`
- convert `sdf-instanced` to support oriented plane quads

Implementation targets:

- `src/app.ts`
- `src/grid.ts`
- `src/line/layer.ts`
- `src/text/layer.ts`
- new stack projector / backplate renderer modules

Test work for this step:

- add a new browser step for `3d-mode`:
  - `/` toggles the dataset and route between `2d-mode` and `3d-mode`
  - all workplanes render in stack order
  - active workplane changes with `[` and `]` in both modes
  - the selection box is hidden in `3d-mode`
  - label picking and label-edit interactions do not activate in `3d-mode`
  - toggling back to `2d-mode` restores the active workplane's camera and selection
  - the rendered pixel signature differs between `2d-mode` and `3d-mode`
- add focused unit coverage for the new glyph-basis packing used by the `sdf-instanced` plane-quad path

Gate to run:

```bash
npm test
LINKER_EXTENDED_TEST_MATRIX=1 npm test
```

## Recommended Test File Layout

Keep the existing harness shape and add plane-stack coverage incrementally:

- extend `scripts/test/unit.ts` for reducer, route, persistence, projector, and glyph-basis unit checks
- extend `scripts/test/browser.ts` and `scripts/test/types.ts` with:
  - `stageMode`
  - `activeWorkplaneId`
  - `planeCount`
  - `workplaneCanDelete`
- add new browser steps after `008_label_edit_strategy.ts`, for example:
  - `009_plane_stack_2d.ts`
  - `010_plane_stack_persistence.ts`
  - `011_plane_stack_3d.ts`
- wire those steps into `scripts/test.ts` in the same ordered style as the current suite

## Exit Criteria

The feature should only be considered complete when all of the following are true:

- `npm test` is green after every step
- the final step is also green under `LINKER_EXTENDED_TEST_MATRIX=1 npm test`
- `2d-mode` keeps the current editing/navigation behavior
- workplane lifecycle is stable in `2d-mode` before `3d-mode` ships
- `3d-mode` uses the same authoritative plane-stack state as `2d-mode`
- per-workplane camera, selection, and label edits survive plane switching and reloads

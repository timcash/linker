# PLAN

## Goal

Replace the current free-pan numeric camera for the demo scene with a label-centered camera.
The source of truth should be an active label, and the rendered camera view should be derived
from that label's location and zoom target.

## Current Code Review

- `src/camera.ts`
  - The camera is purely numeric today: `centerX`, `centerY`, and `zoom`.
  - `reset()` hard-resets to `(0, 0, 0)`.
  - Movement is pixel pan plus screen-point zoom.
- `src/app.ts`
  - The camera panel calls `applyControlAction()` with `pan-*`, `zoom-*`, and `reset-camera`.
  - URL sync only knows about `cameraCenterX`, `cameraCenterY`, and `cameraZoom`.
  - Benchmark traces also depend on those numeric camera semantics.
- `src/data/labels.ts`
  - Demo labels are generated from `(column, row)` loops.
  - The hierarchy is implicit in label text like `1:1:1` and `1:1:2`.
  - Only two layers exist today: root `:1` and child `:2`.
- `src/data/demo-layout.ts`
  - The demo layout already knows the source column and row for every entry.
  - Root and child labels currently share the same world anchor.
- `src/data/static-benchmark.ts`
  - Benchmark labels do not have the same `column:row:layer` structure, so this camera model
    does not transfer there automatically.

## Desired Behavior

- The camera must always resolve to a concrete label.
- `Right`: move to the next column on the same row and layer.
- `Left`: move to the previous column on the same row and layer.
- `Up`: move to the visually higher row on the same column and layer.
- `Down`: move to the visually lower row on the same column and layer.
- `Zoom In`: move to the next layer for the same column and row, center it, and use that layer's
  zoom target. Example: `1:1:1 -> 1:1:2`.
- `Zoom Out`: move to the previous layer for the same column and row. Example:
  `1:1:2 -> 1:1:1`.
- If the requested destination does not exist, stay on the current label.
- `Reset`: go back to `1:1:1`.

## Proposed Design

### 1. Make label identity explicit

Do not rely on parsing label text everywhere at runtime.

Add structured navigation metadata to demo labels, for example:

- `column`
- `row`
- `layer`
- `key`

Recommended shape:

- either extend `LabelDefinition` with optional navigation metadata
- or create a demo-specific wrapper type that carries both the render label and the navigation key

The visible text can stay as `1:1:1`, but it should stop being the only source of truth.

### 2. Build a navigation index

Add a small helper module, for example `src/label-navigation.ts`, that:

- builds a lookup by label key
- builds a lookup by `(column, row, layer)`
- resolves neighbors for left/right/up/down
- resolves next and previous layer within the same cell
- exposes a stable default selection of `1:1:1`

This index should be rebuilt whenever the label set changes or the demo layout strategy changes,
because the label key can stay the same while the world position changes.

### 3. Keep `Camera2D` as the render camera, but stop using numeric pan as app state

`Camera2D` is still useful because grid, line, and text rendering already depend on it.

The change should happen one level above it:

- app-level state becomes `activeLabelKey`
- numeric camera values become derived state

When selection changes:

1. Resolve the active label from the navigation index.
2. Call `camera.setView(label.location.x, label.location.y, label.zoomLevel)`.
3. Sync datasets and route state from that derived camera snapshot.

That keeps render code stable while changing the interaction model.

### 4. Change control semantics

The current control names can stay, but their meaning should change in demo mode:

- `pan-left` -> select `(column - 1, row, layer)`
- `pan-right` -> select `(column + 1, row, layer)`
- `pan-up` -> select the visually higher row
- `pan-down` -> select the visually lower row
- `zoom-in` -> select the next layer in the same cell
- `zoom-out` -> select the previous layer in the same cell
- `reset-camera` -> select `1:1:1`

If a target label is missing, the camera should no-op instead of drifting numerically.

Recommended UX improvement:

- disable buttons that have no valid destination instead of leaving them clickable

### 5. Add label-based route and dataset state

The route should expose the selected label directly.

Recommended primary query param:

- `cameraLabel=1:1:1`

Keep the existing numeric body datasets because they are already useful for tests and debugging:

- `cameraCenterX`
- `cameraCenterY`
- `cameraZoom`

Add label-oriented datasets as well:

- `cameraLabel`
- `cameraColumn`
- `cameraRow`
- `cameraLayer`
- optionally `cameraCanMoveLeft`, `cameraCanMoveRight`, `cameraCanMoveUp`, `cameraCanMoveDown`
- optionally `cameraCanZoomIn`, `cameraCanZoomOut`

Suggested load order:

1. prefer `cameraLabel` when present
2. fall back to the current numeric query params only if backward compatibility still matters
3. otherwise default to `1:1:1`

### 6. Scope benchmark behavior explicitly

The benchmark label set does not currently have layers, and `BENCHMARK_CAMERA_TRACE` depends on
the old numeric pan and zoom behavior.

Recommended first pass:

- enable the new label-centered camera for the demo label set only
- keep benchmark mode on the current numeric camera path until separate benchmark navigation
  requirements exist

That avoids breaking the benchmark route while the demo camera semantics change.

## Implementation Steps

1. Extend the demo label generation path in `src/data/labels.ts` with explicit navigation metadata.
2. Add a focused navigation helper module that can resolve labels and neighbors from the active
   label set.
3. Refactor `src/app.ts` so camera buttons mutate `activeLabelKey` in demo mode.
4. Derive numeric camera values from the selected label instead of using `panByPixels()` for demo
   navigation.
5. Update reset, initial route parsing, and query syncing to understand label-based state.
6. Rebuild the navigation index when layout strategy changes and preserve the same label key when
   it still exists.
7. Update status datasets and button disabled states.
8. Leave `src/camera.ts` mostly intact unless a tiny helper is needed for centering on a label.

## Test Plan

### Unit tests

- verify the label index contains `1:1:1` through `12:12:2`
- verify left/right/up/down resolution
- verify no-op behavior at all edges
- verify `zoom-in` moves from `x:y:1` to `x:y:2`
- verify `zoom-out` moves from `x:y:2` to `x:y:1`
- verify missing next-layer behavior no-ops
- verify missing previous-layer behavior no-ops
- verify reset resolves to `1:1:1`

### Browser tests

- initial demo route starts on `1:1:1`
- `Right` moves to `2:1:1`
- `Down` from `2:1:1` moves to `2:2:1`
- `Zoom In` from `2:2:1` moves to `2:2:2`
- `Zoom Out` from `2:2:2` moves to `2:2:1`
- reset returns to `1:1:1`
- URL sync tracks the active label
- layout strategy changes preserve the selected label key and recenter to its new location

### Regression checks

- existing text and render strategy tests still pass
- benchmark mode either keeps numeric camera behavior or clearly disables the label camera path

## Risks And Notes

- Root and child demo labels currently share the same `location`, so `zoom-in` will mainly change
  zoom state, not camera position. That still matches the label-centered model, but it means layer
  transitions will only visibly recenter if future layers get different anchors.
- `scripts/test/004_camera_controls.ts` currently asserts numeric pan behavior and seeded numeric
  query params. Those expectations will need to change for demo mode.
- `BENCHMARK_CAMERA_TRACE` in `src/app.ts` assumes numeric controls. It should not be changed
  implicitly.

## Open Questions

- Do you want this new camera only for the demo label set first, or do you want an equivalent
  label-indexed behavior for benchmark/static labels too?
- Should deep links use a single `cameraLabel=1:1:2` param, or separate
  `cameraColumn`, `cameraRow`, and `cameraLayer` params?
- If a requested label disappears after a layout or scene change, should fallback always be
  `1:1:1`, or should it choose the nearest available sibling?
- Should unavailable controls be disabled, or should they remain clickable and simply no-op?

# Linker

Linker is a pure `luma.gl` + WebGPU text strategy lab.

The system is easiest to reason about as:

- one fullscreen `luma-stage`
- one `stage-canvas`
- one `grid-layer`
- one `text-layer`
- several explicit `text-strategy` paths
- deterministic `label-set` inputs
- deterministic `camera-trace` tests
- measurable `frame-telemetry`

`PLAN.md` is the agent-oriented workflow document for this repo. This README uses the preferred domain language from that file, even where some code still has older names like `rendererMode`.

## Domain Language

Use these words consistently when describing the system:

- `luma-stage`
  The fullscreen runtime surface that owns the canvas, panels, and render loop.
- `stage-canvas`
  The fullscreen WebGPU canvas behind the UI.
- `text-layer`
  The atlas-backed label rendering layer.
- `text-strategy`
  A selectable text rendering path such as `baseline` or `chunked`.
- `label-set`
  A deterministic collection of labels used by the text layer.
- `camera-trace`
  A deterministic zoom and pan script used by tests and benchmarks.
- `frame-telemetry`
  CPU, GPU, upload, visibility, and submission metrics for the current frame or benchmark run.

Legacy naming that still exists in code:

- the route query param is still `renderer=...`, but it selects a `text-strategy`
- some code still uses `rendererMode`, but the preferred concept name is `text-strategy`
- the route query param `dataset=...` maps to a `label-set`

## Quick Start

Install dependencies:

```bash
npm install --legacy-peer-deps
```

Start the dev server:

```bash
npm run dev -- --host 127.0.0.1
```

Open:

`http://127.0.0.1:5173/`

Useful routes:

- Demo route: `/`
- Start in a specific text strategy: `/?renderer=chunked`
- Run a benchmark route: `/?dataset=benchmark&benchmark=1&gpuTiming=1&renderer=visible-index&labelCount=4096&benchmarkFrames=8`

The default UI boots the demo label set preset `demo-csv-v1`, which is sourced from `src/data/demo-label-set.csv`.

## Terminal Commands

- `npm run dev -- --host 127.0.0.1`
  Starts Vite on `127.0.0.1:5173`.
- `npm run lint`
  Runs ESLint across the repo.
- `npm run build`
  Runs TypeScript and produces the Vite production build.
- `npm run preview`
  Serves the production build locally.
- `npm test`
  Runs `lint` first, then launches the headed Chrome WebGPU test suite.

## UI Panels

The page uses a fullscreen CSS grid with the `stage-canvas` filling the viewport behind the UI.

- `status-panel`
  Top-left. Shows live app state, camera state, grid counts, visible label counts, upload size, and current frame telemetry.
- `details-panel`
  Top-right. Holds the current operator-facing explanation of what the stage is testing.
- `render-panel`
  Bottom-left. Contains the text strategy buttons used to switch the active text path.
- `camera-panel`
  Bottom-right. Contains the deterministic pan, zoom, and reset button grid.
- `stage-canvas`
  Fullscreen WebGPU canvas rendered behind all panels.

Current panel layout:

- top-left = `status-panel`
- top-right = `details-panel`
- bottom-left = `render-panel`
- bottom-right = `camera-panel`

## Render Strategies

The code still uses the query param name `renderer`, but conceptually each option is a `text-strategy`.

- `baseline`
  Correctness reference. CPU filters visible glyphs and expands them into full triangle-list vertex data every frame.
- `instanced`
  CPU still filters visible glyphs, but uploads visible glyph instances instead of expanded triangles.
- `packed`
  Uploads packed glyph records once and only updates camera uniforms, but still submits the full packed glyph set every frame.
- `visible-index`
  Uploads glyph records once, then uploads only the current visible glyph index list for drawing.
- `chunked`
  Uses the visible-index draw path plus a `chunk-index` to reduce CPU visibility work.

Practical guidance:

- use `baseline` when checking correctness first
- use `instanced` as the simple improvement over baseline uploads
- use `visible-index` when comparing indexed submission behavior
- use `chunked` when testing the current best CPU-side visibility path
- use `packed` when isolating the cost of near-zero per-frame upload with full-set submission

## Testing

The repo is intentionally test-heavy for a rendering prototype. `npm test` starts its own Vite server on `127.0.0.1:4173`, launches headed Chrome with WebGPU enabled, and exercises the live stage through deterministic camera traces.

What the test suite checks:

- app boot reaches `ready` without unexpected browser errors
- the `stage-canvas` fills the viewport
- the four UI panels are present and positioned correctly
- the default demo route uses the shared preset `demo-csv-v1`
- all render-panel buttons switch strategies correctly
- zoom-window visibility behaves correctly for every text strategy
- each strategy survives a large-scale `4096` label zoom sweep with visible and fully hidden phases
- benchmark routes use the shared preset `static-benchmark-v2`
- benchmark summaries are collected for `1024`, `4096`, and `16384` labels
- `browser.log` and `browser.png` are written on each run

Benchmark route template:

```text
/?dataset=benchmark&benchmark=1&gpuTiming=1&renderer=<baseline|instanced|packed|visible-index|chunked>&labelCount=<1024|4096|16384>&benchmarkFrames=8
```

The benchmark label set is deterministic. All strategies run against stable prefixes of the same centered static dataset, so the comparisons are meaningful.

## Text CSV File Example

The demo label set is sourced from `src/data/demo-label-set.csv`.

The file format is intentionally simple: one text item per line.

```csv
BUTTON PAN
WEBGPU LABEL
LUMA TEXT
MID DETAIL
CLOSE READ
WORLD VIEW
GRID LAYER
TEXT LAYER
TEXT STRATEGY
FRAME TELEMETRY
```

Notes:

- empty lines are ignored
- wrapping single or double quotes are stripped
- the current demo layout has a fixed number of anchor slots
- if the CSV has fewer lines than slots, fallback text is used
- if the CSV has more lines than slots, extra rows are ignored

The parsing and placement logic lives in `src/data/labels.ts`.

## luma.gl Quick Start

If you are new to this repo, start with these files:

- `src/app.ts`
  Boots the `luma-stage`, reads query params, builds the panels, runs the render loop, and exports dataset-based telemetry.
- `src/camera.ts`
  Owns the 2D camera model and world-to-screen transforms.
- `src/grid.ts`
  Implements the `grid-layer`.
- `src/text/renderer.ts`
  Implements the `text-layer`, text strategy selection, visibility analysis, and draw submission.
- `src/perf.ts`
  Captures CPU and GPU frame telemetry.

Minimal render flow:

1. `startApp` creates the stage chrome and reads the route config.
2. `luma.createDevice(...)` creates the WebGPU device and binds the `stage-canvas`.
3. `GridRenderer` and `TextRenderer` are created from the chosen `label-set` and `text-strategy`.
4. Each frame updates camera-dependent grid and text state.
5. A render pass draws the background, grid layer, and text layer.
6. The device submits the frame and `FrameProfiler` updates `frame-telemetry`.

If you want to add another text strategy, the shortest path is:

1. Add the mode to `src/text/types.ts`.
2. Implement the strategy path in `src/text/renderer.ts`.
3. Expose the new button in the render panel from `src/app.ts`.
4. Extend `scripts/test.ts` so the new strategy participates in zoom sweeps and benchmark collection.

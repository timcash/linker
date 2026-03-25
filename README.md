# Linker

![Linker UI](./docs/readme-ui.png)

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

Canonical public surface:

- use `labelSet=...` to choose the label-set
- use `textStrategy=...` to choose the text strategy
- use `cameraCenterX=...`, `cameraCenterY=...`, and `cameraZoom=...` to seed or share the camera view
- read live label, strategy, and benchmark telemetry from `document.body.dataset`

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
- Start in a specific text strategy: `/?textStrategy=chunked`
- Start at a specific camera view: `/?cameraCenterX=1.25&cameraCenterY=-2.5&cameraZoom=0.75`
- Run a benchmark route: `/?labelSet=benchmark&benchmark=1&gpuTiming=1&textStrategy=visible-index&labelCount=4096&benchmarkFrames=8`

The default UI boots the demo label-set preset `demo-label-set-v1`, which is sourced from `src/data/demo-label-set.csv`.

## Deterministic Assets

- Demo label-set id: `demo-label-set-v1`
- Demo label-set source: `src/data/demo-label-set.csv`
- Demo label-set layout: `12` left-to-right columns with `1..12` top-level roots
- Demo hierarchy depth: every top-level root generates `2` nested zoom-in levels
- Benchmark label-set id: `static-benchmark-label-set-v2`
- Benchmark label counts: `1024`, `4096`, `16384`
- Benchmark route template:

```text
/?labelSet=benchmark&benchmark=1&gpuTiming=1&textStrategy=<baseline|instanced|packed|visible-index|chunked>&labelCount=<1024|4096|16384>&benchmarkFrames=8
```

Never replace the benchmark label set with random or unstable generation.

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
- the default demo route uses the shared preset `demo-label-set-v1`
- all render-panel buttons switch strategies correctly
- zoom-window visibility behaves correctly for every text strategy
- each strategy survives a large-scale `4096` label zoom sweep with visible and fully hidden phases
- benchmark routes use the shared preset `static-benchmark-label-set-v2`
- benchmark summaries are collected for `1024`, `4096`, and `16384` labels
- `browser.log` and `browser.png` are written on each run

Benchmark route template:

```text
/?labelSet=benchmark&benchmark=1&gpuTiming=1&textStrategy=<baseline|instanced|packed|visible-index|chunked>&labelCount=<1024|4096|16384>&benchmarkFrames=8
```

The benchmark label set is deterministic. All strategies run against stable prefixes of the same centered static label set, so the comparisons are meaningful.

## Contributor Workflow

Use this when making non-trivial changes:

1. Name the task in domain terms.
2. Pick one primary owner: stage, camera model, grid layer, text layer, or frame telemetry.
3. Trace the control path before editing.
   For text work: `readStageConfig -> LumaStageController.start -> TextLayer.createStrategy -> TextLayer.update -> TextLayer.draw -> LumaStageController.updateStatus`.
4. Keep the benchmark label set and camera trace deterministic.
5. Export any comparison-worthy metric through `document.body.dataset`.
6. Extend the browser suite with structural assertions instead of fragile hardcoded thresholds.
7. Keep panel names semantic: `status-panel`, `details-panel`, `render-panel`, `camera-panel`.
8. Run the quality gate before handing work back.

Quality gate:

- `npm run lint`
- `npm run build`
- `npm test`

## Text CSV File Example

The demo label set is sourced from `src/data/demo-label-set.csv`.

The file format is intentionally simple: one text item per line.

```csv
WORLD VIEW
BUTTON PAN
STATUS PANEL
DETAILS PANEL
RENDER PANEL
CAMERA PANEL
STAGE CANVAS
GRID LAYER
TEXT LAYER
FRAME TELEMETRY
GPU SAMPLE
CPU SAMPLE
```

Notes:

- empty lines are ignored
- wrapping single or double quotes are stripped
- each CSV row becomes a top-level root label in the demo hierarchy
- the demo layout fills `12` left-to-right columns with `1..12` roots per column
- every top-level root automatically gets `2` nested zoom-in labels
- if the CSV has fewer than `78` root rows, fallback labels are used
- if the CSV has more than `78` root rows, extra rows are ignored

The parsing and placement logic lives in `src/data/labels.ts`.

## luma.gl Quick Start

If you are new to this repo, start with these files:

- `src/app.ts`
  Boots the `luma-stage`, reads query params, builds the panels, runs the render loop, and exports stage telemetry.
- `src/camera.ts`
  Owns the 2D camera model and world-to-screen transforms.
- `src/grid.ts`
  Implements the `grid-layer`.
- `src/text/layer.ts`
  Implements the `text-layer`, text strategy selection, visibility analysis, and draw submission.
- `src/perf.ts`
  Captures CPU and GPU frame telemetry.

Minimal render flow:

1. `startApp` creates the stage chrome and reads the route config.
   Current stage helpers: `createStageChrome`, `readStageConfig`, and `LumaStageController`.
2. `luma.createDevice(...)` creates the WebGPU device and binds the `stage-canvas`.
3. `GridLayer` and `TextLayer` are created from the chosen `label-set` and `text-strategy`.
4. Each frame updates camera-dependent grid and text state.
5. A render pass draws the background, grid layer, and text layer.
6. The device submits the frame and `FrameTelemetry` updates `frame-telemetry`.

If you want to add another text strategy, the shortest path is:

1. Add the mode to `src/text/types.ts`.
2. Implement the strategy path in `src/text/layer.ts`.
3. Expose the new button in the render panel from `src/app.ts`.
4. Extend `scripts/test.ts` so the new strategy participates in zoom sweeps and benchmark collection.

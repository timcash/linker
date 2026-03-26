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
- `zoom-band`
  The focal visibility band defined by `zoomLevel` and `zoomRange`.
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
- use `gpuTiming=0` to disable live GPU timestamp collection for a route
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
- Run a benchmark route: `/?labelSet=benchmark&benchmark=1&textStrategy=sdf-visible-index&labelCount=4096&benchmarkFrames=8`
- Disable GPU timing explicitly: `/?gpuTiming=0`

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
/?labelSet=benchmark&benchmark=1&textStrategy=<baseline|instanced|packed|visible-index|chunked|sdf-instanced|sdf-visible-index>&labelCount=<1024|4096|16384>&benchmarkFrames=8
```

Never replace the benchmark label set with random or unstable generation.

## Zoom Model

The text layer now uses a focal `zoom-band` model instead of hard `minZoom` / `maxZoom` fields.

- each label carries `size`, `zoomLevel`, and `zoomRange`
- a label is visible when `abs(camera.zoom - zoomLevel) <= zoomRange`
- glyph size scales at runtime from `0.72` at the band edge to `1.0` at the focal zoom
- shared zoom helpers live in `src/text/zoom.ts`
- benchmark and demo label builders derive their bands from `createZoomBand(...)`

If you change zoom visibility, touch both sides:

- CPU visibility and chunk filtering in `src/text/layer.ts`
- shader-side zoom helpers in the packed, indexed, and SDF WGSL paths in `src/text/layer.ts`

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
- `sdf-instanced`
  Reuses the instanced quad path, but samples an SDF atlas for smoother text edges inspired by `deck.gl` and `MapLibre`.
- `sdf-visible-index`
  Combines the indexed visible-glyph submission path with the SDF atlas for the current best smooth-text indexed path.

Practical guidance:

- use `baseline` when checking correctness first
- use `instanced` as the simple improvement over baseline uploads
- use `visible-index` when comparing indexed submission behavior
- use `chunked` when testing the current best CPU-side visibility path
- use `sdf-instanced` when you want the instanced path with smoother SDF text shading
- use `sdf-visible-index` when you want indexed submission plus smoother SDF text shading
- use `packed` when isolating the cost of near-zero per-frame upload with full-set submission

## Testing

The repo is intentionally test-heavy for a rendering prototype. `npm test` starts its own Vite server on `127.0.0.1:4173`, launches headed Chrome with WebGPU enabled, and exercises the live stage through deterministic camera traces.

What the test suite checks:

- app boot reaches `ready` without unexpected browser errors
- the `stage-canvas` fills the viewport
- the four UI panels are present and positioned correctly
- the default demo route uses the shared preset `demo-label-set-v1`
- all render-panel buttons switch strategies correctly
- zoom-band visibility behaves correctly for every text strategy
- each strategy survives a large-scale `4096` label zoom sweep with visible and fully hidden phases
- benchmark routes use the shared preset `static-benchmark-label-set-v2`
- benchmark summaries are collected for `1024`, `4096`, and `16384` labels
- `browser.log` and `browser.png` are written on each run

Benchmark route template:

```text
/?labelSet=benchmark&benchmark=1&textStrategy=<baseline|instanced|packed|visible-index|chunked|sdf-instanced|sdf-visible-index>&labelCount=<1024|4096|16384>&benchmarkFrames=8
```

The benchmark label set is deterministic. All strategies run against stable prefixes of the same centered static label set, so the comparisons are meaningful.

GPU timing note:

- GPU timing is enabled by default. Use `gpuTiming=0` to disable it for a route.
- When timestamp-query is supported, the app records both total GPU frame time and a text-only GPU pass time so text strategies can be compared more directly.
- The status panel distinguishes `gpu disabled`, `gpu pending`, `gpu unsupported`, `gpu error ...`, and live GPU timings.
- the total GPU frame metric is derived from the timed render passes, so it excludes small untimed command overhead between passes.
- Chrome quantizes timestamp queries to `100` microseconds by default. For higher-resolution development measurements, enable `chrome://flags/#enable-webgpu-developer-features`.

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
- `src/text/zoom.ts`
  Owns the shared zoom-band visibility and zoom-scale math used by labels, tests, and chunk culling.
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

## Performance History

This section is auto-appended by `npm test` and keeps only the 3 most recent benchmark snapshots.

### 2026-03-25T23:56:31.601Z

```text
strategy=baseline labels=1024 glyphs=19968 cpuFrame=4.042ms cpuSamples=12 cpuText=3.642ms cpuDraw=0.283ms gpu=2.464ms gpuSamples=12 gpuText=2.006ms uploaded=1493568B visibleLabels=402 visibleGlyphs=7779 visibleVertices=46674 submittedGlyphs=7779 submittedVertices=46674 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=1024 glyphs=19968 cpuFrame=1.958ms cpuSamples=12 cpuText=1.583ms cpuDraw=0.275ms gpu=2.423ms gpuSamples=12 gpuText=1.959ms uploaded=373408B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=1024 glyphs=19968 cpuFrame=1.125ms cpuSamples=12 cpuText=0.717ms cpuDraw=0.292ms gpu=2.481ms gpuSamples=12 gpuText=2.035ms uploaded=32B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=19968 submittedVertices=79872 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=1024 glyphs=19968 cpuFrame=1.283ms cpuSamples=12 cpuText=0.858ms cpuDraw=0.267ms gpu=2.266ms gpuSamples=12 gpuText=1.803ms uploaded=31148B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=1024 glyphs=19968 cpuFrame=1.342ms cpuSamples=12 cpuText=0.908ms cpuDraw=0.308ms gpu=2.908ms gpuSamples=12 gpuText=2.418ms uploaded=31148B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=12 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=1024 glyphs=19968 cpuFrame=1.917ms cpuSamples=12 cpuText=1.458ms cpuDraw=0.300ms gpu=2.681ms gpuSamples=12 gpuText=2.155ms uploaded=373424B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=1024 glyphs=19968 cpuFrame=1.200ms cpuSamples=12 cpuText=0.817ms cpuDraw=0.267ms gpu=2.105ms gpuSamples=12 gpuText=1.658ms uploaded=31164B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=baseline labels=4096 glyphs=79872 cpuFrame=7.317ms cpuSamples=12 cpuText=5.400ms cpuDraw=1.850ms gpu=2.913ms gpuSamples=12 gpuText=2.497ms uploaded=1738752B visibleLabels=557 visibleGlyphs=9056 visibleVertices=54336 submittedGlyphs=9056 submittedVertices=54336 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=4096 glyphs=79872 cpuFrame=3.583ms cpuSamples=12 cpuText=3.208ms cpuDraw=0.275ms gpu=2.691ms gpuSamples=12 gpuText=2.237ms uploaded=434704B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=4096 glyphs=79872 cpuFrame=2.375ms cpuSamples=12 cpuText=1.942ms cpuDraw=0.325ms gpu=2.767ms gpuSamples=12 gpuText=2.266ms uploaded=32B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=79872 submittedVertices=319488 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=4096 glyphs=79872 cpuFrame=2.808ms cpuSamples=12 cpuText=2.383ms cpuDraw=0.308ms gpu=2.902ms gpuSamples=12 gpuText=2.489ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=4096 glyphs=79872 cpuFrame=1.992ms cpuSamples=12 cpuText=1.608ms cpuDraw=0.283ms gpu=2.237ms gpuSamples=12 gpuText=1.829ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=18 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=4096 glyphs=79872 cpuFrame=2.808ms cpuSamples=12 cpuText=2.433ms cpuDraw=0.258ms gpu=2.643ms gpuSamples=12 gpuText=2.205ms uploaded=434720B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=4096 glyphs=79872 cpuFrame=2.117ms cpuSamples=12 cpuText=1.683ms cpuDraw=0.317ms gpu=2.456ms gpuSamples=12 gpuText=1.984ms uploaded=36272B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=baseline labels=16384 glyphs=319488 cpuFrame=9.000ms cpuSamples=12 cpuText=8.658ms cpuDraw=0.250ms gpu=3.408ms gpuSamples=13 gpuText=2.905ms uploaded=1738752B visibleLabels=557 visibleGlyphs=9056 visibleVertices=54336 submittedGlyphs=9056 submittedVertices=54336 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=16384 glyphs=319488 cpuFrame=5.883ms cpuSamples=12 cpuText=5.517ms cpuDraw=0.242ms gpu=2.975ms gpuSamples=12 gpuText=2.560ms uploaded=434704B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=16384 glyphs=319488 cpuFrame=5.767ms cpuSamples=12 cpuText=5.383ms cpuDraw=0.283ms gpu=3.785ms gpuSamples=12 gpuText=3.396ms uploaded=32B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=319488 submittedVertices=1277952 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=16384 glyphs=319488 cpuFrame=6.292ms cpuSamples=12 cpuText=5.933ms cpuDraw=0.275ms gpu=2.241ms gpuSamples=12 gpuText=1.872ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=16384 glyphs=319488 cpuFrame=2.067ms cpuSamples=12 cpuText=1.683ms cpuDraw=0.292ms gpu=2.510ms gpuSamples=12 gpuText=2.079ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=18 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=16384 glyphs=319488 cpuFrame=5.433ms cpuSamples=12 cpuText=5.083ms cpuDraw=0.267ms gpu=2.425ms gpuSamples=12 gpuText=1.975ms uploaded=434720B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=16384 glyphs=319488 cpuFrame=6.215ms cpuSamples=13 cpuText=5.831ms cpuDraw=0.277ms gpu=2.951ms gpuSamples=13 gpuText=2.511ms uploaded=36272B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
```

### 2026-03-26T00:15:13.178Z

```text
strategy=baseline labels=1024 glyphs=19968 cpuFrame=4.100ms cpuSamples=12 cpuText=3.708ms cpuDraw=0.292ms gpu=2.245ms gpuSamples=12 gpuText=1.800ms uploaded=1493568B visibleLabels=402 visibleGlyphs=7779 visibleVertices=46674 submittedGlyphs=7779 submittedVertices=46674 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=1024 glyphs=19968 cpuFrame=3.338ms cpuSamples=13 cpuText=1.808ms cpuDraw=1.446ms gpu=2.306ms gpuSamples=13 gpuText=1.848ms uploaded=373408B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=1024 glyphs=19968 cpuFrame=1.125ms cpuSamples=12 cpuText=0.742ms cpuDraw=0.275ms gpu=2.727ms gpuSamples=12 gpuText=2.233ms uploaded=32B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=19968 submittedVertices=79872 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=1024 glyphs=19968 cpuFrame=1.292ms cpuSamples=12 cpuText=0.883ms cpuDraw=0.275ms gpu=2.293ms gpuSamples=12 gpuText=1.803ms uploaded=31148B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=1024 glyphs=19968 cpuFrame=1.425ms cpuSamples=12 cpuText=0.992ms cpuDraw=0.317ms gpu=2.090ms gpuSamples=12 gpuText=1.640ms uploaded=31148B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=12 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=1024 glyphs=19968 cpuFrame=1.858ms cpuSamples=12 cpuText=1.425ms cpuDraw=0.308ms gpu=2.317ms gpuSamples=12 gpuText=1.817ms uploaded=373424B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=1024 glyphs=19968 cpuFrame=1.300ms cpuSamples=12 cpuText=0.875ms cpuDraw=0.325ms gpu=2.491ms gpuSamples=12 gpuText=1.917ms uploaded=31164B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=baseline labels=4096 glyphs=79872 cpuFrame=5.075ms cpuSamples=12 cpuText=4.658ms cpuDraw=0.308ms gpu=3.218ms gpuSamples=12 gpuText=2.796ms uploaded=1738752B visibleLabels=557 visibleGlyphs=9056 visibleVertices=54336 submittedGlyphs=9056 submittedVertices=54336 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=4096 glyphs=79872 cpuFrame=3.300ms cpuSamples=12 cpuText=2.875ms cpuDraw=0.300ms gpu=2.761ms gpuSamples=12 gpuText=2.328ms uploaded=434704B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=4096 glyphs=79872 cpuFrame=2.083ms cpuSamples=12 cpuText=1.667ms cpuDraw=0.308ms gpu=3.149ms gpuSamples=12 gpuText=2.614ms uploaded=32B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=79872 submittedVertices=319488 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=4096 glyphs=79872 cpuFrame=2.567ms cpuSamples=12 cpuText=2.175ms cpuDraw=0.292ms gpu=2.749ms gpuSamples=12 gpuText=2.322ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=4096 glyphs=79872 cpuFrame=2.142ms cpuSamples=12 cpuText=1.783ms cpuDraw=0.267ms gpu=2.202ms gpuSamples=12 gpuText=1.774ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=18 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=4096 glyphs=79872 cpuFrame=3.042ms cpuSamples=12 cpuText=2.667ms cpuDraw=0.283ms gpu=2.478ms gpuSamples=12 gpuText=2.023ms uploaded=434720B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=4096 glyphs=79872 cpuFrame=2.042ms cpuSamples=12 cpuText=1.625ms cpuDraw=0.325ms gpu=2.410ms gpuSamples=12 gpuText=1.947ms uploaded=36272B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=baseline labels=16384 glyphs=319488 cpuFrame=9.917ms cpuSamples=12 cpuText=9.483ms cpuDraw=0.292ms gpu=3.103ms gpuSamples=12 gpuText=2.617ms uploaded=1738752B visibleLabels=557 visibleGlyphs=9056 visibleVertices=54336 submittedGlyphs=9056 submittedVertices=54336 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=16384 glyphs=319488 cpuFrame=6.225ms cpuSamples=12 cpuText=5.858ms cpuDraw=0.275ms gpu=2.936ms gpuSamples=12 gpuText=2.549ms uploaded=434704B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=16384 glyphs=319488 cpuFrame=4.983ms cpuSamples=12 cpuText=4.600ms cpuDraw=0.292ms gpu=4.334ms gpuSamples=12 gpuText=3.942ms uploaded=32B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=319488 submittedVertices=1277952 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=16384 glyphs=319488 cpuFrame=5.017ms cpuSamples=12 cpuText=4.658ms cpuDraw=0.275ms gpu=2.961ms gpuSamples=12 gpuText=2.497ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=16384 glyphs=319488 cpuFrame=2.975ms cpuSamples=12 cpuText=2.600ms cpuDraw=0.267ms gpu=2.767ms gpuSamples=12 gpuText=2.349ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=18 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=16384 glyphs=319488 cpuFrame=5.483ms cpuSamples=12 cpuText=5.117ms cpuDraw=0.258ms gpu=2.538ms gpuSamples=12 gpuText=2.147ms uploaded=434720B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=16384 glyphs=319488 cpuFrame=5.775ms cpuSamples=12 cpuText=5.367ms cpuDraw=0.267ms gpu=2.989ms gpuSamples=12 gpuText=2.545ms uploaded=36272B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
```

### 2026-03-26T00:16:18.215Z

```text
strategy=baseline labels=1024 glyphs=19968 cpuFrame=3.933ms cpuSamples=12 cpuText=3.558ms cpuDraw=0.258ms gpu=2.493ms gpuSamples=12 gpuText=2.004ms uploaded=1493568B visibleLabels=402 visibleGlyphs=7779 visibleVertices=46674 submittedGlyphs=7779 submittedVertices=46674 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=1024 glyphs=19968 cpuFrame=2.083ms cpuSamples=12 cpuText=1.650ms cpuDraw=0.325ms gpu=2.531ms gpuSamples=12 gpuText=2.023ms uploaded=373408B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=1024 glyphs=19968 cpuFrame=1.217ms cpuSamples=12 cpuText=0.817ms cpuDraw=0.292ms gpu=2.791ms gpuSamples=12 gpuText=2.225ms uploaded=32B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=19968 submittedVertices=79872 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=1024 glyphs=19968 cpuFrame=1.283ms cpuSamples=12 cpuText=0.867ms cpuDraw=0.267ms gpu=2.329ms gpuSamples=12 gpuText=1.808ms uploaded=31148B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=1024 glyphs=19968 cpuFrame=1.567ms cpuSamples=12 cpuText=1.125ms cpuDraw=0.358ms gpu=2.695ms gpuSamples=12 gpuText=2.056ms uploaded=31148B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=12 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=1024 glyphs=19968 cpuFrame=2.058ms cpuSamples=12 cpuText=1.583ms cpuDraw=0.350ms gpu=2.330ms gpuSamples=12 gpuText=1.839ms uploaded=373424B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=1024 glyphs=19968 cpuFrame=1.283ms cpuSamples=12 cpuText=0.892ms cpuDraw=0.258ms gpu=2.233ms gpuSamples=12 gpuText=1.778ms uploaded=31164B visibleLabels=402 visibleGlyphs=7779 visibleVertices=31116 submittedGlyphs=7779 submittedVertices=31116 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=baseline labels=4096 glyphs=79872 cpuFrame=5.533ms cpuSamples=12 cpuText=5.167ms cpuDraw=0.258ms gpu=3.118ms gpuSamples=13 gpuText=2.683ms uploaded=1738752B visibleLabels=557 visibleGlyphs=9056 visibleVertices=54336 submittedGlyphs=9056 submittedVertices=54336 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=4096 glyphs=79872 cpuFrame=3.967ms cpuSamples=12 cpuText=3.533ms cpuDraw=0.325ms gpu=2.952ms gpuSamples=12 gpuText=2.446ms uploaded=434704B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=4096 glyphs=79872 cpuFrame=2.517ms cpuSamples=12 cpuText=2.050ms cpuDraw=0.367ms gpu=3.493ms gpuSamples=12 gpuText=2.744ms uploaded=32B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=79872 submittedVertices=319488 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=4096 glyphs=79872 cpuFrame=3.158ms cpuSamples=12 cpuText=2.725ms cpuDraw=0.300ms gpu=2.820ms gpuSamples=12 gpuText=2.378ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=4096 glyphs=79872 cpuFrame=2.225ms cpuSamples=12 cpuText=1.817ms cpuDraw=0.300ms gpu=2.159ms gpuSamples=12 gpuText=1.724ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=18 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=4096 glyphs=79872 cpuFrame=2.792ms cpuSamples=12 cpuText=2.408ms cpuDraw=0.283ms gpu=2.764ms gpuSamples=12 gpuText=2.338ms uploaded=434720B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=4096 glyphs=79872 cpuFrame=2.200ms cpuSamples=12 cpuText=1.758ms cpuDraw=0.342ms gpu=2.639ms gpuSamples=12 gpuText=2.147ms uploaded=36272B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=baseline labels=16384 glyphs=319488 cpuFrame=9.825ms cpuSamples=12 cpuText=9.442ms cpuDraw=0.267ms gpu=3.198ms gpuSamples=13 gpuText=2.765ms uploaded=1738752B visibleLabels=557 visibleGlyphs=9056 visibleVertices=54336 submittedGlyphs=9056 submittedVertices=54336 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=instanced labels=16384 glyphs=319488 cpuFrame=5.883ms cpuSamples=12 cpuText=5.533ms cpuDraw=0.258ms gpu=2.399ms gpuSamples=12 gpuText=2.014ms uploaded=434704B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=packed labels=16384 glyphs=319488 cpuFrame=4.850ms cpuSamples=12 cpuText=4.483ms cpuDraw=0.267ms gpu=5.100ms gpuSamples=12 gpuText=4.703ms uploaded=32B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=319488 submittedVertices=1277952 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=visible-index labels=16384 glyphs=319488 cpuFrame=5.392ms cpuSamples=12 cpuText=4.983ms cpuDraw=0.283ms gpu=2.800ms gpuSamples=12 gpuText=2.417ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=chunked labels=16384 glyphs=319488 cpuFrame=1.842ms cpuSamples=12 cpuText=1.483ms cpuDraw=0.258ms gpu=2.458ms gpuSamples=12 gpuText=1.967ms uploaded=36256B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=18 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-instanced labels=16384 glyphs=319488 cpuFrame=5.692ms cpuSamples=12 cpuText=5.342ms cpuDraw=0.250ms gpu=2.800ms gpuSamples=12 gpuText=2.414ms uploaded=434720B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
strategy=sdf-visible-index labels=16384 glyphs=319488 cpuFrame=4.933ms cpuSamples=12 cpuText=4.583ms cpuDraw=0.267ms gpu=2.492ms gpuSamples=12 gpuText=2.073ms uploaded=36272B visibleLabels=557 visibleGlyphs=9056 visibleVertices=36224 submittedGlyphs=9056 submittedVertices=36224 visibleChunks=0 labelSetPreset=static-benchmark-label-set-v2
```

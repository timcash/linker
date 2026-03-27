# Linker

![Linker UI](./browser.png)

Linker is a pure `luma.gl` + WebGPU repo for mapping networks. The app keeps the scene deterministic, exposes multiple network mapping strategies across text and line rendering, and exports live telemetry through `document.body.dataset` so browser tests and manual runs can observe the same state.

## Quick Start

Prerequisites:

- A recent Chrome build with WebGPU support. `npm test` launches headed Chrome.

Install dependencies:

```bash
npm install --legacy-peer-deps
```

Start the dev server:

```bash
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/`.

Useful commands:

- `npm run dev -- --host 127.0.0.1`
- `npm run lint`
- `npm run build`
- `npm run preview`
- `npm test`
- `LINKER_EXTENDED_TEST_MATRIX=1 npm test`

Test artifacts:

- `npm test` writes `browser.log` and `browser.png`.
- Extended matrix runs log benchmark summaries to `browser.log`.

## Public Surface

Query params:

- `labelSet=...` chooses the label-set.
- `layoutStrategy=...` chooses the demo layout strategy.
- `lineStrategy=...` chooses the active `line-strategy`.
- `textStrategy=...` chooses the active `text-strategy`.
- `cameraCenterX=...`, `cameraCenterY=...`, and `cameraZoom=...` seed or share the camera view.
- `gpuTiming=0` disables live GPU timestamp collection.
- `benchmark=1`, `labelCount=...`, and `benchmarkFrames=...` enable benchmark routes.

Useful routes:

- Demo route: `/`
- Demo with the Flow Columns layout: `/?layoutStrategy=flow-columns`
- Demo with a specific `text-strategy`: `/?textStrategy=packed`
- Demo with a specific `line-strategy`: `/?lineStrategy=orbit-links`
- Demo with a seeded camera: `/?cameraCenterX=1.25&cameraCenterY=-2.5&cameraZoom=0.75`
- Benchmark route: `/?labelSet=benchmark&benchmark=1&textStrategy=sdf-visible-index&labelCount=4096&benchmarkFrames=8`
- Disable GPU timing explicitly: `/?gpuTiming=0`

## Domain Language

Use these words consistently:

- `luma-stage`: fullscreen runtime surface that owns the canvas, panels, and render loop
- `stage-canvas`: fullscreen WebGPU canvas behind the UI
- `line-layer`: curved network-edge rendering layer
- `link-point`: top-center, right-center, bottom-center, or left-center label anchor used by the line-layer
- `line-strategy`: selectable curved network-edge path such as `arc-links` or `orbit-links`
- `network-mapping-strategy`: umbrella term for the selectable `text-strategy` and `line-strategy` controls
- `text-layer`: atlas-backed label rendering layer
- `text-strategy`: selectable label-rendering path such as `baseline` or `chunked`
- `zoom-band`: focal visibility band defined by `zoomLevel` and `zoomRange`
- `label-set`: deterministic collection of labels used by the text-layer
- `link-set`: deterministic collection of network links used by the line-layer
- `camera-trace`: deterministic zoom and pan script used by tests and benchmarks
- `frame-telemetry`: CPU, GPU, upload, visibility, and submission metrics for the current frame or benchmark run

## Scene Invariants

Canonical demo scene:

- Demo label-set id: `scene-12x12-v1`
- Demo label-set source: `src/data/labels.ts`
- Demo link-set source: `src/data/links.ts`
- Demo layout strategies: `flow-columns`
- Default layout strategy: `flow-columns`
- Default `text-strategy`: `packed`
- Default `line-strategy`: `arc-links`
- Demo shape: `12 x 12 x 2` labels
- Demo link-set size: `81` links
- Label id format: `column:row:level`
- Every root has exactly one hidden child at the same anchor
- Zoom `0` shows the full `12 x 12` root grid
- Zooming in swaps visibility to the level-`2` child layer
- Camera zoom floor: `0`

Canonical label ids:

- `1:1:1` = first column, first row, root level
- `12:12:1` = last root label in the zoom-0 grid
- `1:1:2` = first hidden child label
- `12:12:2` = last hidden child label

Benchmark scene:

- Benchmark label-set id: `static-benchmark-label-set-v2`
- Supported benchmark counts: `1024`, `4096`, `16384`
- Route template:

```text
/?labelSet=benchmark&benchmark=1&textStrategy=<baseline|instanced|packed|visible-index|chunked|sdf-instanced|sdf-visible-index>&labelCount=<1024|4096|16384>&benchmarkFrames=8
```

Never replace the benchmark label set with random or unstable generation.

## Zoom Model

The text layer uses a focal `zoom-band` model instead of hard `minZoom` / `maxZoom` fields.

- Each label carries `size`, `zoomLevel`, and `zoomRange`.
- A label is submitted when `abs(camera.zoom - zoomLevel) <= zoomRange`.
- Label opacity fades from the band edge toward the focal zoom.
- Glyph size scales at runtime from `0.72` at the band edge to `1.0` at the focal zoom.
- Shared zoom helpers live in `src/text/zoom.ts`.
- Benchmark label builders derive their bands from `createZoomBand(...)`.

If you change zoom visibility, touch both sides:

- CPU visibility and chunk filtering in `src/text/layer.ts`
- Shader-side zoom helpers in the packed, indexed, and SDF WGSL paths in `src/text/layer.ts`

## Text Strategies

- `baseline`: correctness reference; CPU filters visible glyphs and expands them into full triangle-list vertex data every frame
- `instanced`: CPU still filters visible glyphs, but uploads visible glyph instances instead of expanded triangles
- `packed`: uploads packed glyph records once and only updates camera uniforms, but still submits the full packed glyph set every frame
- `visible-index`: uploads glyph records once, then uploads only the current visible glyph index list for drawing
- `chunked`: uses the visible-index path plus a `chunk-index` to reduce CPU visibility work
- `sdf-instanced`: reuses the instanced quad path, but samples an SDF atlas for smoother text edges
- `sdf-visible-index`: combines indexed visible-glyph submission with the SDF atlas

Practical guidance:

- Use `baseline` for correctness checks.
- Use `instanced` as the simple improvement over baseline uploads.
- Use `visible-index` when comparing indexed submission behavior.
- Use `chunked` for the best current CPU-side visibility path.
- Use `sdf-instanced` or `sdf-visible-index` when comparing smoother SDF text paths.
- Use `packed` as the default path for the canonical demo scene.

## Line Strategies

- `arc-links`: midpoint arc with a stable center lift for the clearest default network-edge shape
- `fan-links`: source-biased cubic curve that fans outward from the link origin before settling onto the target
- `orbit-links`: opposing-handle cubic curve that creates a more pronounced orbital sweep between labels

Practical guidance:

- Use `arc-links` for the cleanest default link-set read.
- Use `fan-links` when you want directionality to feel biased toward the source side.
- Use `orbit-links` when you want the strongest curve separation between long links.

## Layout Strategies

- `flow-columns`: default layout; keeps the full `12 x 12` root grid visible at zoom `0` while the child layer appears only after zooming in

## UI Panels

The page uses a fullscreen CSS grid with the `stage-canvas` behind the UI.

- `status-panel`: top-left; app state, camera state, grid counts, link-set counts, visible label counts, upload size, and frame telemetry
- `details-panel`: top-right; operator-facing explanation of what the stage is testing
- `strategy-mode-panel`: top-right below `details-panel`; toggles between text, line, and layout controls
- `render-panel`: bottom-left; active text, line, or layout strategy controls
- `camera-panel`: bottom-right; deterministic pan, zoom, and reset controls
- `stage-canvas`: fullscreen WebGPU canvas rendered behind all panels

## Testing

`npm test` starts its own Vite server on `127.0.0.1:4173`, launches headed Chrome with WebGPU enabled, and exercises the live stage through deterministic camera traces.

Default suite coverage:

- app boot reaches `ready` without unexpected browser errors
- `stage-canvas` fills the viewport
- all five UI panels are present and positioned correctly
- the default route uses `scene-12x12-v1`, the `packed` `text-strategy`, and the `arc-links` `line-strategy`
- line strategy view exposes the deterministic demo link-set and distinct curve fingerprints for each line strategy
- zoom `0` shows the full root grid
- zooming in reveals the hidden child layer
- camera button controls keep the URL in sync

Extended matrix:

- Run `LINKER_EXTENDED_TEST_MATRIX=1 npm test` to add the full network-mapping-strategy demo sweep, large-scale visibility sweep, and benchmark comparison matrix.
- Benchmark summaries are written to `browser.log`.

GPU timing notes:

- GPU timing is enabled by default. Use `gpuTiming=0` to disable it for a route.
- When `timestamp-query` is supported, the app records both whole-frame GPU time and a text-only GPU pass time.
- The status panel distinguishes `gpu disabled`, `gpu pending`, `gpu unsupported`, `gpu error ...`, and live GPU timings.
- Chrome quantizes timestamp queries to `100` microseconds by default. For higher-resolution development measurements, enable `chrome://flags/#enable-webgpu-developer-features`.

## Contributor Notes

Useful files:

- `src/app.ts`: boots the stage, reads query params, builds the panels, runs the render loop, and exports stage telemetry
- `src/camera.ts`: 2D camera model and world-to-screen transforms
- `src/data/links.ts`: deterministic demo link-set builder
- `src/grid.ts`: grid-layer implementation
- `src/line/layer.ts`: line-layer implementation, curve strategy selection, and curved link draw submission
- `src/text/layer.ts`: text-layer implementation, strategy selection, visibility analysis, and draw submission
- `src/text/zoom.ts`: shared zoom-band visibility and zoom-scale math
- `src/perf.ts`: CPU and GPU frame telemetry

Minimal render flow:

1. `startApp` creates the stage chrome and reads the route config.
2. `luma.createDevice(...)` creates the WebGPU device and binds the `stage-canvas`.
3. `GridLayer`, `LineLayer`, and `TextLayer` are created from the chosen `label-set`, `link-set`, and active strategies.
4. Each frame updates camera-dependent grid, line, and text state.
5. A render pass draws the background, grid layer, line layer, and text layer.
6. The device submits the frame and `FrameTelemetry` updates `frame-telemetry`.

Network-mapping control path:

- `readStageConfig -> LumaStageController.start -> LineLayer.update -> TextLayer.createStrategy -> TextLayer.update -> TextLayer.draw -> LumaStageController.updateStatus`

Quality gate:

- `npm run lint`
- `npm run build`
- `npm test`

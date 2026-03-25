# PLAN

## Mission

This repo is a text strategy lab for pure `luma.gl` + WebGPU.

The system should stay easy for another LLM agent to reason about:

- one fullscreen stage
- one grid layer
- one text layer
- several explicit text strategies
- deterministic camera traces
- deterministic benchmark label sets
- measurable frame telemetry

The goal is not just “render text.”
The goal is:

- keep one correctness reference
- compare strategies on the same label set
- expose enough telemetry to explain wins and regressions
- keep the language of the code simple and stable

## Preferred Domain Language

Use these terms consistently when reading, editing, or renaming the system.

- `luma-stage`
  The fullscreen runtime surface that owns the canvas, panels, and render loop.
- `stage-canvas`
  The WebGPU canvas that fills the viewport behind the UI.
- `launch-banner`
  The centered loading, unsupported, or error overlay.
- `status-panel`
  Top-left operator panel with live state and telemetry summary.
- `details-panel`
  Top-right operator panel with explanatory copy.
- `render-panel`
  Bottom-left operator panel for text strategy selection.
- `camera-panel`
  Bottom-right operator panel for deterministic camera controls.
- `grid-layer`
  The world grid visual layer.
- `text-layer`
  The atlas-backed label rendering layer.
- `text-strategy`
  A selectable implementation of text submission and visibility work.
- `label-set`
  A deterministic collection of labels used by the text layer.
- `demo-label-set`
  Small correctness-oriented label set for manual and test visibility checks.
- `benchmark-label-set`
  Static repeatable label set for performance comparison.
- `camera-trace`
  A deterministic zoom and pan script used during benchmark runs.
- `frame-telemetry`
  CPU, GPU, upload, visibility, and submission metrics for the current frame or run.
- `glyph-atlas`
  Texture and metrics for raster glyphs.
- `glyph-layout`
  Label-to-glyph placement output.
- `glyph-record-table`
  Packed per-glyph GPU records uploaded once.
- `visible-glyph-set`
  Per-frame visible glyph ids used for draw submission.
- `chunk-index`
  Spatial partition used to narrow visibility work.

## Current System Model

Think about the repo as five subsystems:

1. `luma-stage`
   Owns startup, canvas, panels, query params, render loop, and benchmark execution.
2. `camera-model`
   Owns world/screen transforms and visible world bounds.
3. `grid-layer`
   Builds and draws the visual reference grid.
4. `text-layer`
   Builds atlas resources once, chooses a text strategy, updates per frame, and draws labels.
5. `frame-telemetry`
   Measures CPU and GPU work and exposes metrics through `document.body.dataset`.

If a future task does not clearly belong to one of those five areas, name the area before editing code.

## Current Text Strategies

These are the current `text-strategy` values:

- `baseline`
  CPU expands visible glyphs into full triangle-list vertex data every frame.
- `instanced`
  CPU still filters visible glyphs, but uploads visible glyph instances instead of expanded triangles.
- `packed`
  Uploads glyph records once and only updates camera uniforms, but still submits the full glyph set every frame.
- `visible-index`
  Uploads glyph records once and then uploads only the current visible glyph index list.
- `chunked`
  Uses the visible-index draw path and a chunk index to reduce CPU visibility work.

The baseline remains the correctness reference.

## Current Deterministic Assets

- `demo-label-set`
  Lives in `src/data/labels.ts`.
- `benchmark-label-set`
  Lives in `src/data/static-benchmark.ts`.
- benchmark preset id
  `static-benchmark-v2`
- benchmark sizes
  `1024`, `4096`, `16384`
- benchmark route template
  `/?dataset=benchmark&benchmark=1&gpuTiming=1&renderer=<baseline|instanced|packed|visible-index|chunked>&labelCount=<1024|4096|16384>&benchmarkFrames=8`

Never replace the benchmark label set with random or unstable generation.

## Central Files

- `src/app.ts`
  Stage bootstrap, UI panels, config parsing, render loop, benchmark run, and dataset telemetry export.
- `src/camera.ts`
  Camera model and world/screen conversion.
- `src/grid.ts`
  Grid layer mesh generation and drawing.
- `src/text/atlas.ts`
  Glyph atlas build step.
- `src/text/layout.ts`
  Glyph layout build step.
- `src/text/renderer.ts`
  Text layer resources, strategy selection, visibility analysis, and draw submission.
- `src/perf.ts`
  Frame telemetry and GPU timestamp support.
- `src/data/labels.ts`
  Demo label set.
- `src/data/static-benchmark.ts`
  Benchmark label set.
- `scripts/test.ts`
  Browser-based system verification and benchmark collection.

## Central Functions And Methods

These are the most important entry points in the system as it exists today.

### Stage control

- `startApp`
  Main stage bootstrap.
- `createShell`
  Builds the visible operator surface and canvas.
- `readAppConfig`
  Converts query params into stage config.
- `buildBenchmarkCameraTrace`
  Produces the deterministic camera trace for a benchmark run.
- `WebGPUShell.start`
  Creates the device, grid layer, text layer, and telemetry pipeline.
- `WebGPUShell.render`
  Main frame loop for grid update, text update, draw, submit, and status export.
- `WebGPUShell.runBenchmark`
  Executes the benchmark camera trace and records a benchmark summary.
- `WebGPUShell.updateStatus`
  Pushes live stage telemetry into `document.body.dataset`.
- `WebGPUShell.setTextStrategy`
  Switches the active text strategy.

### Camera model

- `Camera2D.panByPixels`
  Moves the camera in response to operator commands.
- `Camera2D.zoomAtScreenPoint`
  Deterministic zoom around a screen anchor.
- `Camera2D.worldToScreen`
  Core transform for visibility and placement logic.
- `Camera2D.getVisibleWorldBounds`
  Used to reduce work for grid and chunk visibility logic.

### Grid layer

- `GridRenderer.update`
  Rebuilds the grid mesh for the current camera state.
- `buildGridMesh`
  Generates line geometry from visible bounds and spacing.
- `niceStep`
  Chooses stable grid spacing values.

### Text layer

- `TextRenderer.createStrategy`
  Selects the active text strategy.
- `TextRenderer.update`
  Delegates per-frame text work to the active strategy.
- `TextRenderer.draw`
  Delegates draw submission to the active strategy.
- `buildGlyphAtlas`
  Builds the glyph atlas texture and metrics once.
- `layoutLabels`
  Converts labels into glyph placements once.
- `analyzeGlyphVisibility`
  Core per-frame visibility pass.
- `inspectGlyph`
  Tests one glyph against zoom and screen bounds.
- `buildGlyphChunkIndex`
  Creates the chunk index used by the chunked strategy.
- `buildGlyphRecordData`
  Packs glyph data for GPU-side indexed drawing.
- `buildTextMesh`
  Builds the baseline expanded triangle mesh.
- `buildVisibleGlyphInstances`
  Builds per-frame instance payloads for the instanced strategy.
- `buildPackedGlyphInstances`
  Builds static packed instance payloads for the packed strategy.

### Frame telemetry

- `FrameProfiler.getRenderPassTimingProps`
  Enables GPU timestamp capture for a render pass.
- `FrameProfiler.recordCpuGrid`
  Records CPU grid update time.
- `FrameProfiler.recordCpuText`
  Records CPU text update time.
- `FrameProfiler.recordCpuDraw`
  Records CPU draw and submit time.
- `FrameProfiler.recordCpuFrame`
  Records total CPU frame time.
- `FrameProfiler.getSnapshot`
  Returns the current frame telemetry summary.

## Recommended Language Cleanup

These are the most useful future renames if the next agent wants to align code names with the preferred domain language.

- `WebGPUShell`
  Better term: `LumaStageController`
- `createShell`
  Better term: `createStageChrome`
- `SHELL_SHADER`
  Better term: `STAGE_SHADER`
- `.app-shell`
  Better term: `.luma-stage`
- `.app-canvas`
  Better term: `.stage-canvas`
- `.center-message`
  Better term: `.launch-banner`
- `rendererMode`
  Better term: `textStrategy`
- `RendererMode`
  Better term: `TextStrategy`
- `DatasetName`
  Better term: `LabelSetKind`
- `datasetPreset`
  Better term: `labelSetPreset`
- `requestedLabelCount`
  Better term: `labelTargetCount`
- `TextRenderer`
  Better term: `TextLayer`
- `GridRenderer`
  Better term: `GridLayer`
- `FrameProfiler`
  Better term: `FrameTelemetry`
- `VisibilityAnalysis`
  Better term: `GlyphVisibilityResult`

Do not perform a broad rename pass casually.
Only rename if the system is already behaviorally stable and the rename is done as a coherent sweep with tests.

## Execution Workflow For Another LLM Agent

Use this workflow for any non-trivial task.

1. Name the task in domain terms.
   Example: “change the camera-panel layout” or “add a new text-strategy to the text-layer.”
2. Identify which subsystem owns the change.
   Use only one primary owner when possible: stage, camera model, grid layer, text layer, or frame telemetry.
3. Trace the control path before editing.
   For text work, follow:
   `readAppConfig -> WebGPUShell.start -> TextRenderer.createStrategy -> TextRenderer.update -> TextRenderer.draw -> WebGPUShell.updateStatus`.
4. Preserve the correctness reference.
   Do not remove or weaken the `baseline` strategy while testing a candidate strategy.
5. Keep deterministic assets deterministic.
   Do not randomize the benchmark label set or benchmark camera trace.
6. Export any new metric through `document.body.dataset`.
   If a new concept matters for tests or comparison, it should be readable from the page.
7. Update browser coverage with structural assertions.
   Prefer “strategy A uploads fewer bytes than strategy B” over fragile absolute thresholds.
8. Keep the operator surface coherent.
   Panel names should stay semantic: `status-panel`, `details-panel`, `render-panel`, `camera-panel`.
9. Run verification after code changes.
   Run `npm run lint`, `npm run build`, and `npm test`.
10. Update `README.md` if the user-facing strategy set, benchmark route, or workflow changes.

## System Invariants

- use pure `luma.gl` + WebGPU
- keep the app framework-free
- do not add a WebGL fallback
- keep unsupported-browser handling explicit
- keep the benchmark label set static and repeatable
- keep benchmark comparison across the same label set and camera trace
- keep the baseline strategy available
- keep metrics visible in `document.body.dataset`
- keep benchmark summaries in `browser.log`

## Current Quality Gate

Before handing work back, the repo should be green on:

- `npm run lint`
- `npm run build`
- `npm test`

If one of those steps is intentionally skipped, say so explicitly and explain why.

## Next High-Value Work

- add `decluttered` as a new text strategy
- add accepted-label and overlap telemetry
- make tests assert declutter correctness against the non-decluttered strategies
- consider a full naming cleanup toward the domain language above once behavior is stable

## Short Mental Model

If the next agent needs the fastest possible summary, use this:

- the app is a `luma-stage`
- it draws a `grid-layer` and a `text-layer`
- the `text-layer` supports multiple `text-strategy` values
- the operator uses `status-panel`, `details-panel`, `render-panel`, and `camera-panel`
- the system compares strategies on a deterministic `benchmark-label-set`
- the benchmark is driven by a deterministic `camera-trace`
- the page exports `frame-telemetry` through `document.body.dataset`

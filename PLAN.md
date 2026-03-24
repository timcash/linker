# PLAN

## Goal

Turn this repo into a good place to test and compare more efficient text-rendering strategies in pure `luma.gl` + WebGPU.

The point is no longer just “render some text.” The point is:

- keep one correct baseline renderer
- add better renderers behind explicit modes
- measure CPU and GPU cost in a repeatable way
- make `npm test` catch regressions

## Current Baseline

Verified on March 24, 2026 with:

- headed Chrome
- `luma.gl 9.3.0-alpha.10`
- `npm test`

Current benchmark route template:

`/?dataset=benchmark&benchmark=1&gpuTiming=1&renderer=<baseline|instanced|packed|visible-index|chunked>&labelCount=<1024|4096|16384>&benchmarkFrames=40`

Latest comparison snapshots from `browser.log`:

- `1024 labels`
  `baseline cpuFrame=3.332ms gpu=2.646ms uploaded=886272B`
  `instanced cpuFrame=2.589ms gpu=2.021ms uploaded=221584B`
  `visible-index cpuFrame=1.934ms gpu=2.258ms uploaded=18496B`
  `chunked cpuFrame=1.884ms gpu=2.384ms uploaded=18496B`
  `packed cpuFrame=1.807ms gpu=2.251ms uploaded=32B`
- `4096 labels`
  `baseline cpuFrame=5.386ms gpu=3.066ms uploaded=1818048B`
  `instanced cpuFrame=3.909ms gpu=2.250ms uploaded=454528B`
  `visible-index cpuFrame=3.666ms gpu=2.767ms uploaded=37908B`
  `chunked cpuFrame=1.982ms gpu=2.841ms uploaded=37908B`
  `packed cpuFrame=2.975ms gpu=3.056ms uploaded=32B`
- `16384 labels`
  `baseline cpuFrame=8.639ms gpu=2.735ms uploaded=1818048B`
  `instanced cpuFrame=5.793ms gpu=2.621ms uploaded=454528B`
  `visible-index cpuFrame=4.668ms gpu=2.543ms uploaded=37908B`
  `chunked cpuFrame=2.543ms gpu=3.030ms uploaded=37908B`
  `packed cpuFrame=4.820ms gpu=5.061ms uploaded=32B`

Large-scale sweep evidence at `labelCount=4096` now exists in `browser.log` for all five modes, using the fixed dataset `static-benchmark-v2`. The trace starts with `600` visible labels / `8901` visible glyphs at zoom `0.00` and reaches a fully hidden state at zoom `4.08+`. `chunked` reports `16` visible chunks at reset and `2` chunks near zoom `3.84` before dropping to `0`.

The baseline remains the correctness reference. `visible-index` is the current direct replacement for packed full-draw submission, and `chunked` is the current best CPU path on the benchmark routes.

## What Exists Now

- `src/app.ts`
  Owns the shell, dataset selection, benchmark route, status panel, and render loop.
- `src/perf.ts`
  Owns rolling CPU timings plus WebGPU timestamp-query timing.
- `src/data/labels.ts`
  Owns the demo labels.
- `src/data/static-benchmark.ts`
  Owns the centered static benchmark dataset `static-benchmark-v2`.
- `src/text/atlas.ts`
  Builds the bitmap glyph atlas with Canvas 2D.
- `src/text/layout.ts`
  Converts labels into glyph placements.
- `src/text/renderer.ts`
  Shared text resources plus explicit `baseline`, `instanced`, `packed`, `visible-index`, and `chunked` renderer modes.

Important facts about the current renderers:

- `baseline`
  expands visible glyph quads on the CPU every frame and uploads full position/uv/color vertex data
- `instanced`
  still filters visible glyphs on the CPU, but uploads one visible-glyph instance record instead of six expanded vertices
- `packed`
  uploads packed glyph records once and only updates camera uniforms per frame, but currently draws the full packed glyph set every frame
- `visible-index`
  uploads packed glyph records once, then uploads only the per-frame visible glyph index list
- `chunked`
  uses the visible-index draw path, but limits CPU visibility work to chunk candidates and exposes visible chunk counts

## Hard Constraints

- Use `luma.gl`
- Use pure WebGPU
- Do not add `three.js`
- Do not add `deck.gl`
- Do not add `MapLibre`
- Keep the app framework-free
- Keep the unsupported-browser state explicit

## Main Testing Rule

Every optimization should be added in a way that can be compared against the current baseline.

That means:

- do not delete the baseline renderer until a better renderer is proven
- add candidate renderers behind an explicit mode or query param
- run the same dataset and benchmark flow for each renderer
- keep output metrics in `document.body.dataset`
- keep benchmark summaries in `browser.log`

## Renderer Comparison Plan

The repo should support renderer modes like:

- `baseline`
  Current CPU-expanded visible quad path.
- `instanced`
  Visible-glyph instancing with per-frame instance uploads.
- `packed`
  Static packed glyph records with camera-uniform updates only.
- `visible-index`
  Static packed glyph records plus per-frame visible glyph index uploads.
- `chunked`
  Visible-index renderer plus chunk visibility filtering.
- `decluttered`
  Packed renderer plus chunking plus label overlap rejection.

Recommended query param:

- `?renderer=baseline`
- `?renderer=instanced`
- `?renderer=packed`
- `?renderer=visible-index`
- `?renderer=chunked`
- `?renderer=decluttered`

The default still stays on `baseline`.

## Metrics We Need

Keep the current metrics and add a few more.

Already present:

- CPU frame average
- CPU text-update average
- CPU draw average
- GPU frame average
- visible label count
- visible glyph count
- renderer mode
- benchmark label count
- total glyph count
- bytes uploaded to GPU per frame
- vertex count submitted per frame
- submitted glyph count
- visible chunk count

Add next:

- accepted labels after declutter

These should be exposed through `document.body.dataset` so Puppeteer can read them directly.

## Benchmark Matrix

Do not judge a renderer from one dataset size only.

At minimum, compare these cases:

1. `labelCount=1024`
2. `labelCount=4096`
3. `labelCount=16384`

For each case, record:

- CPU frame average
- CPU text average
- CPU draw average
- GPU frame average
- visible label count
- visible glyph count
- bytes uploaded per frame

If a renderer only wins at 1024 labels and falls apart at 4096+, it is not the right next architecture.

## Test Strategy

The browser test should evolve from “does it render” to “does the better renderer actually reduce work.”

### Current coverage

The browser test now does all of this:

- app reaches `ready` or `unsupported`
- button-only camera controls work
- demo zoom-window label visibility works
- renderer buttons switch between `baseline`, `instanced`, `packed`, `visible-index`, and `chunked`
- the `4096` label sweep zooms out and then in for each renderer mode, proving both visible and hidden text states on `static-benchmark-v2`
- benchmark routes run for all five current renderer modes
- benchmark routes run at `1024`, `4096`, and `16384`
- benchmark routes verify the shared static dataset preset
- upload bytes and submitted vertices are compared structurally across modes
- visible chunk counts are checked for `chunked`
- intentional error ping appears in `browser.log`

### Next coverage

Next additions should focus on declutter:

- `decluttered` at `1024`, `4096`, and `16384`
- declutter-specific accepted-label assertions
- overlap rejection correctness checks against the non-decluttered modes

The test should prefer structural assertions over brittle absolute thresholds.

Good example:

- packed path uploads fewer bytes per frame than baseline

Bad example:

- CPU frame must be under `1.4ms` on every machine forever

## Immediate Next Work

### 1. Add declutter as another explicit mode

Goal:

- compare correctness and accepted-label counts against non-decluttered paths
- keep it benchmarkable behind `?renderer=decluttered`

### 2. Add accepted-label and overlap metrics

Goal:

- expose accepted-label counts through `document.body.dataset`
- make `npm test` assert that declutter is dropping overlaps instead of silently hiding too much or too little

### 3. Explore whether chunked draw submission should stay CPU-driven

Current tradeoff:

- `chunked` materially reduces CPU text-update cost
- `chunked` still has a small GPU cost increase versus `visible-index` because the chunk optimization only changes CPU search work

Goal:

- keep `chunked` as the fast CPU path
- evaluate whether chunk metadata or GPU-assisted filtering can reduce the remaining draw-path overhead without regressing correctness

## Implementation Direction

The current efficient renderer direction now looks like this:

- atlas built once
- glyph layout built once
- packed glyph records uploaded once
- per-frame work limited to:
  camera uniforms
  visible glyph index list
  chunk candidate filtering
  optional declutter results

Do not jump to compute shaders first.

The correct order is:

1. packed glyph records
2. visible index list
3. chunk filtering
4. declutter
5. optional GPU-assisted filtering

## Handoff Notes

If work stops here, the next agent should know:

- the current repo is green on `npm run lint`, `npm run build`, and `npm test`
- `npm test` uses headed Chrome and records real GPU timestamp samples
- `README.md` is now simplified and up to date
- `luma.gl 9.3.0-alpha.10` is working here, but the install used `npm install --legacy-peer-deps`
- the benchmark dataset is now a fixed centered prefix set in `src/data/static-benchmark.ts`
- the most important missing capability is now declutter plus accepted-label metrics, not another basic renderer split

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

Current benchmark route:

`/?dataset=benchmark&benchmark=1&gpuTiming=1&labelCount=1024&benchmarkFrames=28`

Latest benchmark summary from `browser.log`:

- `cpuFrame=2.166ms`
- `cpuText=1.731ms`
- `cpuDraw=0.369ms`
- `gpu=1.390ms`
- `visibleLabels=102`
- `visibleGlyphs=1003`

This is the baseline to beat.

## What Exists Now

- `src/app.ts`
  Owns the shell, dataset selection, benchmark route, status panel, and render loop.
- `src/perf.ts`
  Owns rolling CPU timings plus WebGPU timestamp-query timing.
- `src/data/labels.ts`
  Owns both the demo labels and the synthetic benchmark label generator.
- `src/text/atlas.ts`
  Builds the bitmap glyph atlas with Canvas 2D.
- `src/text/layout.ts`
  Converts labels into glyph placements.
- `src/text/renderer.ts`
  Current baseline renderer.

Important fact about the current renderer:

- it still expands visible glyph quads on the CPU every frame
- it uploads full position/uv/color vertex data every frame
- it is correct enough for comparison, but it is not the efficient design we want

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
- `packed`
  Static packed glyph records plus compact visible draw list.
- `chunked`
  Packed renderer plus chunk visibility filtering.
- `decluttered`
  Packed renderer plus chunking plus label overlap rejection.

Recommended query param:

- `?renderer=baseline`
- `?renderer=packed`
- `?renderer=chunked`
- `?renderer=decluttered`

The default can stay on the current renderer until the next mode is proven.

## Metrics We Need

Keep the current metrics and add a few more.

Already present:

- CPU frame average
- CPU text-update average
- CPU draw average
- GPU frame average
- visible label count
- visible glyph count

Add next:

- renderer mode
- benchmark label count
- total glyph count
- bytes uploaded to GPU per frame
- vertex count submitted per frame
- visible chunk count
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

### Phase A

Keep the current correctness checks:

- app reaches `ready` or `unsupported`
- controls work
- zoom-window label visibility works
- intentional error ping appears in `browser.log`

### Phase B

Add renderer-comparison checks:

- run benchmark once with `renderer=baseline`
- run benchmark once with `renderer=packed`
- assert both runs complete
- log both summaries
- assert the packed path uploads less per-frame data than baseline

### Phase C

Add scaling checks:

- run `renderer=packed` at `1024`, `4096`, and `16384`
- assert CPU text time does not scale linearly with total glyph count once chunking is added
- assert bytes uploaded per frame stay bounded relative to visible glyphs, not total glyphs

The test should prefer structural assertions over brittle absolute thresholds.

Good example:

- packed path uploads fewer bytes per frame than baseline

Bad example:

- CPU frame must be under `1.4ms` on every machine forever

## Immediate Next Work

### 1. Make renderer mode explicit

Add renderer selection to `src/app.ts`.

Goal:

- choose between `baseline` and future renderers through query params
- write the selected mode into `document.body.dataset.rendererMode`

### 2. Instrument upload cost

Add metrics for:

- vertex count submitted
- bytes written to buffers each frame

Goal:

- prove when a renderer reduces per-frame upload cost

### 3. Build the packed renderer

Replace per-frame quad expansion with:

- one static packed glyph-record buffer
- one compact visible-glyph index buffer
- one instanced draw path

Goal:

- keep atlas and layout code
- stop rebuilding full quad geometry every frame

### 4. Compare baseline vs packed in Puppeteer

Update `scripts/test.ts` to benchmark both modes and log both summaries.

Minimum required win for the packed renderer:

- fewer bytes uploaded per frame than baseline
- same or better visible text correctness

## Implementation Direction

The next efficient renderer should look like this:

- atlas built once
- glyph layout built once
- packed glyph records uploaded once
- per-frame work limited to:
  camera uniforms
  visible glyph index list
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
- the most important missing capability is not “more text features”
- the most important missing capability is a second renderer mode that is measurably more efficient than the baseline

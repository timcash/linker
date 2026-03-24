# Linker

Minimal Vite + TypeScript app for a pure `luma.gl` + WebGPU text-rendering prototype.

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

## Commands

- `npm run dev -- --host 127.0.0.1`
  Starts the Vite dev server on `127.0.0.1:5173`.
- `npm run lint`
  Runs ESLint.
- `npm run build`
  Runs TypeScript and builds the production bundle.
- `npm test`
  Runs lint first, then runs the headed Chrome browser test.

## Required Workflow

Use this workflow after every code change:

1. Start or reuse the dev server: `npm run dev -- --host 127.0.0.1`
2. Make the change.
3. Run `npm run lint`
4. Run `npm run build`
5. Run `npm test`
6. Inspect `browser.log` and `browser.png`

Important notes:

- Do not stop after `lint`.
- If `package.json` changes, restart any long-running Vite dev server so optimized deps are rebuilt.
- `npm test` launches a headed `Google Chrome` instance.
- `browser.log` is reset at the start of every test run.
- A passing run intentionally includes `ERROR_PING_TEST` in `browser.log`.

## What `npm test` Does

The browser test:

- starts its own Vite server on `127.0.0.1:4173`
- launches headed Chrome with WebGPU enabled
- verifies the app reaches `ready` or `unsupported`
- verifies the button-only camera controls
- verifies renderer-mode buttons for `baseline`, `instanced`, `packed`, `visible-index`, and `chunked`
- verifies label visibility changes with zoom for every renderer mode
- verifies the benchmark routes report the shared static dataset preset `static-benchmark-v2`
- creates an intentional browser error ping and checks that it is written to `browser.log`
- runs a large-scale 4096-label zoom sweep for every renderer mode, including hidden and visible phases
- runs benchmark routes for every renderer mode at `1024`, `4096`, and `16384` labels
- writes `browser.log`
- saves `browser.png`

Benchmark route template used by the test:

`/?dataset=benchmark&benchmark=1&gpuTiming=1&renderer=<baseline|instanced|packed|visible-index|chunked>&labelCount=<1024|4096|16384>&benchmarkFrames=40`

Representative benchmark results from the latest passing run:

- `1024 labels`: `baseline cpuFrame=3.332ms gpu=2.646ms uploaded=886272B`, `instanced cpuFrame=2.589ms gpu=2.021ms uploaded=221584B`, `visible-index cpuFrame=1.934ms gpu=2.258ms uploaded=18496B`, `chunked cpuFrame=1.884ms gpu=2.384ms uploaded=18496B`, `packed cpuFrame=1.807ms gpu=2.251ms uploaded=32B`
- `4096 labels`: `baseline cpuFrame=5.386ms gpu=3.066ms uploaded=1818048B`, `instanced cpuFrame=3.909ms gpu=2.250ms uploaded=454528B`, `visible-index cpuFrame=3.666ms gpu=2.767ms uploaded=37908B`, `chunked cpuFrame=1.982ms gpu=2.841ms uploaded=37908B`, `packed cpuFrame=2.975ms gpu=3.056ms uploaded=32B`
- `16384 labels`: `baseline cpuFrame=8.639ms gpu=2.735ms uploaded=1818048B`, `instanced cpuFrame=5.793ms gpu=2.621ms uploaded=454528B`, `visible-index cpuFrame=4.668ms gpu=2.543ms uploaded=37908B`, `chunked cpuFrame=2.543ms gpu=3.030ms uploaded=37908B`, `packed cpuFrame=4.820ms gpu=5.061ms uploaded=32B`

## Current App State

What exists now:

- pure `luma.gl` + WebGPU app
- fullscreen canvas
- button-only pan, zoom, and reset controls
- button-panel renderer switching for `baseline`, `instanced`, `packed`, `visible-index`, and `chunked`
- CPU-generated world-space grid
- atlas-backed text labels with explicit comparison modes
- centered static benchmark dataset `static-benchmark-v2` shared across all benchmark routes
- visible-glyph index draw path
- chunked visibility filtering with visible chunk metrics
- CPU and GPU benchmark metrics exposed through browser datasets and `browser.log`

What does not exist yet:

- decluttering
- accepted-label metrics after declutter
- SDF/MSDF text
- GPU-assisted visibility filtering

## Important Repo Rules

- Keep this repo framework-free unless a human explicitly asks otherwise.
- Do not add `three.js`, `deck.gl`, or `MapLibre` unless explicitly requested.
- Keep the pure `luma.gl` + WebGPU direction.
- Do not add a WebGL fallback.
- Keep `npm run lint`, `npm run build`, and `npm test` passing.

## Key Files

- `src/app.ts`
  App shell, UI panels, benchmark route, and render loop.
- `src/camera.ts`
  2D camera math.
- `src/grid.ts`
  CPU-built grid renderer.
- `src/data/labels.ts`
  Demo labels.
- `src/data/static-benchmark.ts`
  Static benchmark dataset builder with centered prefix ordering.
- `src/text/atlas.ts`
  Canvas 2D glyph atlas generation.
- `src/text/layout.ts`
  Label-to-glyph layout.
- `src/text/renderer.ts`
  Shared atlas resources plus the `baseline`, `instanced`, `packed`, `visible-index`, and `chunked` renderer modes.
- `src/perf.ts`
  CPU and GPU frame timing support.
- `scripts/test.ts`
  Headed Chrome browser test.

## Version Notes

- Current verified luma set: `9.3.0-alpha.10`
- These packages currently require `npm install --legacy-peer-deps`

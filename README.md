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
- verifies label visibility changes with zoom
- creates an intentional browser error ping and checks that it is written to `browser.log`
- runs a benchmark route on a synthetic 1024-label dataset
- writes `browser.log`
- saves `browser.png`

Current benchmark route used by the test:

`/?dataset=benchmark&benchmark=1&gpuTiming=1&labelCount=1024&benchmarkFrames=28`

## Current App State

What exists now:

- pure `luma.gl` + WebGPU app
- fullscreen canvas
- button-only pan, zoom, and reset controls
- CPU-generated world-space grid
- atlas-backed text labels
- synthetic benchmark dataset
- CPU and GPU benchmark metrics exposed through browser datasets and `browser.log`

What does not exist yet:

- chunked label visibility
- decluttering
- packed static glyph buffers
- visible-glyph index draw path
- SDF/MSDF text

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
  Demo labels and synthetic benchmark label generator.
- `src/text/atlas.ts`
  Canvas 2D glyph atlas generation.
- `src/text/layout.ts`
  Label-to-glyph layout.
- `src/text/renderer.ts`
  Current atlas-backed text renderer.
- `src/perf.ts`
  CPU and GPU frame timing support.
- `scripts/test.ts`
  Headed Chrome browser test.

## Version Notes

- Current verified luma set: `9.3.0-alpha.10`
- These packages currently require `npm install --legacy-peer-deps`

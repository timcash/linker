# Linker

Minimal Vite + TypeScript app with a fullscreen Three.js canvas and a Puppeteer smoke test.

## Current Local Dev URL

If the dev server is already running in this workspace, use:

`http://127.0.0.1:5173/`

If it is not running, start it with:

```bash
npm run dev -- --host 127.0.0.1
```

## Stack

- Vite
- TypeScript
- Three.js
- Puppeteer

No React. The app is intentionally small.

## Project Layout

- `index.html`: loads the app entry module
- `src/main.ts`: creates the Three.js scene, camera, lights, renderer, and animation loop
- `src/style.css`: makes the canvas fill the viewport
- `scripts/test.mjs`: starts a Vite server and checks the canvas with Puppeteer

## Commands

```bash
npm install
npm run dev -- --host 127.0.0.1
npm run build
npm test
```

## For LLM Agents

This repo is meant to stay simple. When changing it:

- Keep it framework-free unless a human explicitly asks for a framework.
- Preserve a fullscreen WebGL canvas unless the request says otherwise.
- Prefer editing `src/main.ts` and `src/style.css` instead of adding abstraction layers.
- Keep dependencies minimal.
- Run `npm run build` after code changes.
- Run `npm test` when canvas behavior or boot flow changes.

## Test Contract

The Puppeteer smoke test currently verifies:

- The app boots without a page error.
- A `canvas` element is rendered.
- The canvas width matches `window.innerWidth`.
- The canvas height matches `window.innerHeight`.

If you change rendering structure, keep those guarantees or update the test deliberately.

## Notes For Future Changes

- Vite dev defaults to port `5173` unless that port is busy.
- The production bundle is currently large because it includes Three.js; that is expected for this minimal setup.
- `src/main.ts` includes HMR cleanup so reloading does not leave old renderers attached.

# Linker

Linker is a `luma.gl` + WebGPU workplane viewer and editor with aligned `12x12x12` label grids, multi-workplane stack navigation, and a compact mobile-style control pad.

## 0. Target Workflow

Linker is moving from a stacked workplane editor toward a DAG workplane tool. The target build workflow is test-first and slice-based. Use this README for the short working loop, and use [PLAN.md](PLAN.md) for the full DAG architecture, test ladder, screenshot contract, and renderer performance plan.

The supervised agent loop now also supports an isolated worker `git worktree` so the worker can edit and run checks without touching the main tree:

```powershell
.\agent.ps1 -Worktree -Once -Browser
```

After a run, review the worker diff bundle and apply it back to root only if it looks right:

```powershell
# inspect the latest run folder under .codex-loop\runs\<run-id>\
.\agent.ps1 -PromoteRun <run-id>
```

That loop is task-driven now: every run writes `.codex-loop/current-task.json`, `.codex-loop/current-task.md`, and `.codex-loop/next-task-ideas.md` so the worker and monitor stay on one explicit job at a time. The loop is expected to review `README.md` and `PLAN.md` first, then leave behind a per-run `monitor-steps.md` checklist confirming README review, PLAN review, test-first progress, code usage in tests, logs review, screenshot review, and scope control. All local test and loop logging now rolls into the root `test.log`, including Vite server output, Puppeteer browser console/page errors, smoke-test output, GitHub Pages live-smoke output, and agent-loop worker/monitor command logs. The per-run `check-results.json` file now also records which required docs were updated so the monitor can verify docs sync directly instead of inferring it from the diff, and focused browser commands now judge unexpected structured errors only from their own session so earlier exploratory failures do not poison later loop checks.

The repo now also has a `/tasks` route for reviewing the loop itself. It renders HTML tables from `public/tasks-data.json` and shows:

- the current loop state and active task packet
- the task ladder and next task ideas
- run history with worker status, monitor decision, local browser smoke, and live GitHub Pages smoke
- every monitor review step and its evidence

You can smoke-test that route directly with:

```bash
npm run test:browser:tasks
```

The repo also now has a `/readme` route that renders `README.md` in a live preview shell with the same typography direction used by `cad-pga`, so repo notes can be checked in-browser instead of only in GitHub markdown.

The current loop rule is stricter now: every worker iteration should also update `README.md` and `PLAN.md` so the docs stay in sync with the latest code, tests, monitor findings, and next-step guidance.

```bash
# DAG target workflow from PLAN.md

# 1. Pick one slice from PLAN.md and keep the smallest test green first.
npm run test:dag:static                           # target command to add for pure DAG model/layout slices
npm run lint

# 2. Prove the first DAG render slice.
npm run test:browser -- --flow dag-view-smoke     # target focused DAG render flow
npm run lint

# 3. Prove the DAG control-pad slice.
npm run test:browser -- --flow dag-control-pad    # target focused DAG controls flow
npm run lint

# 4. Prove the canonical DAG source-of-truth flow.
npm run test:browser -- --flow dag-network-build  # target end-to-end DAG build flow
npm run lint

# 5. At milestone boundaries, run the broader repo checks.
npm run test:browser
npm run build
```

The commands above are the target DAG workflow described in [PLAN.md](PLAN.md). The currently available repo commands are listed below.

Current DAG slice status:

- `Slice 1` DAG validation primitives are green through `npm run test:dag:static`
- `Slice 2` integer DAG layout is green through `npm run test:dag:static`
- `Slice 3` DAG edge geometry is green through `npm run test:dag:static`
- `Slice 4` canonical five-workplane network fixture is green through `npm run test:dag:static`
- `Slice 5` DAG view smoke coverage is green through `npm run test:browser -- --flow dag-view-smoke`
- `Slice 6` projected LOD reconstruction is green through `npm run test:dag:static` and `npm run test:browser -- --flow dag-view-smoke`

Current checkpoint:

- the pure DAG model, layout, edge geometry, and canonical five-workplane fixture are in place
- the browser can now boot the canonical DAG fixture, switch to `3d-mode`, render `5` DAG workplanes plus `6` DAG edges, and keep workplane selection stable
- the DAG browser data contract has started through `dagRootWorkplaneId`, `dagNodeCount`, `dagEdgeCount`, active DAG position fields, visible DAG counts, and `dagLayoutFingerprint`
- projected workplane spans now classify close, mid, far, and universe LOD states, and the canonical DAG fixture now buckets nodes deterministically in pure tests
- the focused DAG smoke can now reconstruct a zoomed-out root overview as `graph-point` nodes and a closer selected-workplane view as `title-only` nodes from exported browser workplane and stack-camera state

What to do next:

1. Export the active DAG LOD bucket counts directly through browser datasets instead of reconstructing them inside the smoke flow.
2. Tighten the current task packet so `scripts/test/dag-view-smoke.ts` reads those exported root and selected bucket fields directly from browser state.
3. Extend `Slice 6` from the current `graph-point` and `title-only` proof toward `label-points` and `full-workplane` coverage only after the dataset contract is stable.
4. Keep the focused loop narrow:
   `npm run test:dag:static`
   `npm run lint`
   `npm run test:browser -- --flow dag-view-smoke`
   `npm run test:live -- --url https://timcash.github.io/linker/`

## 1. Screenshot and Links

<!-- README_SHOWCASE:START -->

<table>
  <tr>
    <td align="center"><a href="https://timcash.github.io/linker/"><img src="./readme/screenshots/boot-ready.png" alt="Linker boot-ready mobile view" width="220" /></a><br/><sub>Boot</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/?cameraLabel=wp-1%3A2%3A1%3A1&demoLayers=12&demoPreset=classic&labelSet=demo&stageMode=2d-mode&workplane=wp-1"><img src="./readme/screenshots/focus-zoom.png" alt="Linker classic grid zoom interaction" width="220" /></a><br/><sub>Zoom</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/?cameraLabel=wp-3%3A1%3A6%3A6&demoPreset=editor-lab&labelSet=demo&stageMode=2d-mode&workplane=wp-3"><img src="./readme/screenshots/editor-link.png" alt="Linker editor ranked selection and link flow" width="220" /></a><br/><sub>Link</sub></td>
  </tr>
  <tr>
    <td align="center"><a href="https://timcash.github.io/linker/?cameraLabel=wp-3%3A1%3A6%3A6&demoPreset=editor-lab&labelSet=demo&stageMode=2d-mode&workplane=wp-3"><img src="./readme/screenshots/workplane-spawn.png" alt="Linker workplane lifecycle controls" width="220" /></a><br/><sub>Spawn</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/?cameraLabel=wp-3%3A1%3A6%3A6&demoPreset=workplane-showcase&labelSet=demo&stageMode=3d-mode&workplane=wp-3"><img src="./readme/screenshots/stack-view.png" alt="Linker five-workplane stack view" width="220" /></a><br/><sub>Stack</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/?cameraLabel=wp-3%3A1%3A6%3A6&demoPreset=workplane-showcase&labelSet=demo&stageMode=3d-mode&workplane=wp-3"><img src="./readme/screenshots/stack-orbit.png" alt="Linker stack orbit interaction" width="220" /></a><br/><sub>Orbit</sub></td>
  </tr>
</table>

- Live root: [timcash.github.io/linker](https://timcash.github.io/linker/)
- GitHub repository: [github.com/timcash/linker](https://github.com/timcash/linker)

Each screenshot opens a live route with a preset `demoPreset` and `cameraLabel`.
<!-- README_SHOWCASE:END -->

Local dev URL: `http://127.0.0.1:5173/`

Docs routes:

- `/tasks/`
- `/readme/`

To choose the dataset and focused label on the live page, only change these query params:

```text
demoPreset=classic|editor-lab|workplane-showcase
cameraLabel=workplane-id:layer:row:column
```

Example:

```text
https://timcash.github.io/linker/?demoPreset=editor-lab&cameraLabel=wp-3:1:6:6
```

## 2. Command Line Interface

```bash
npm install --legacy-peer-deps

npm run dev -- --host 127.0.0.1
npm run lint
npm run build
npm run build:pages
npm run preview -- --host 127.0.0.1

npm run test:dag:static
npm run test:browser -- --flow dag-view-smoke
npm run test:browser:readme
npm run test:browser:tasks
npm run test:browser
npm run test:preview
npm run test:live -- --url https://timcash.github.io/linker/
npm run test:live -- --url https://timcash.github.io/linker/ --allow-unsupported
npm test

npm run perf:trace -- --stage-mode 3d-mode --label-set benchmark --label-count 4096 --orbit-count 1
npm run perf:orbit-stutter -- --label-set benchmark --label-count 4096 --segment-count 3
```

## 3. Domain Language

- `label key`: the canonical id format `workplane-id:layer:row:column`, for example `wp-3:2:6:12`
- `workplane id`: the `wp-N` id for one workplane
- `layer`, `row`, `column`: the canonical navigation axes inside a workplane
- `grid cell`: one `row,column` slot on a workplane
- `label stack`: all authored layers for one grid cell
- `grid stack`: the full `12x12x12` lattice for one workplane
- `plane-stack`: the ordered multi-workplane document
- `active workplane`: the selected workplane in the `plane-stack`
- `plane-focus view`: the single-workplane `2d-mode`
- `stack view`: the multi-workplane `3d-mode`
- `bridge link`: a link between different workplanes
- `local link`: a link inside one workplane
- `editor cursor`: the current editable `workplane/layer/row/column`
- `ghost slot`: an empty adjacent grid cell shown as a creation target
- `ranked selection`: the ordered label selection used for link creation
- `control pad section`: one named container inside the 3x3 bottom pad: `navigate`, `stage`, or `edit`
- `status strip`: the compact live table at the top of the screen

## 4. UI Panels

- `status strip`: the top telemetry table with the live stage stats
- `navigate controls`: the default bottom 3x3 container for zoom and movement
- `stage controls`: the bottom 3x3 container for `2d-mode`, `3d-mode`, and workplane switching
- `edit controls`: the bottom 3x3 container with the label input, selection toggle, link, unlink, remove, and clear actions
- `toggle button`: the bottom-right button that cycles `navigate -> stage -> edit`
- `editor overlays`: the selection box, ranked-selection badges, and ghost-slot markers drawn over the canvas

## 5. Code Index

- `src/main.ts`: app entry point
- `src/readme-page.ts`: live markdown preview route for `README.md`
- `src/app.ts`: WebGPU boot, plane-stack state, input handling, render loop, and dataset exports
- `src/style.css`: static overlay grid for the status strip, fullscreen canvas, and bottom control pad
- `src/stage-chrome.ts`: DOM shell for the status strip and 3x3 control pad
- `src/stage-panels.ts`: sync logic for the `navigate`, `stage`, and `edit` control containers
- `src/stage-config.ts`: query parsing for `demoPreset` and `cameraLabel`
- `src/stage-session.ts`: boot hydration and default dataset selection
- `src/plane-stack.ts`: document/session helpers across workplanes
- `src/dag-document.ts`: DAG document types, validation helpers, and topological checks
- `src/dag-layout.ts`: integer DAG coordinate to world-space layout helpers
- `src/dag-view.ts`: DAG-aware 3D scene assembly for compatibility-mode stack rendering
- `src/stack-view.ts`: stacked 3D scene composition and bridge-link routing
- `src/stage-editor.ts`: cursor motion, ghost slots, ranked selection, and scene edits
- `src/stage-editor-overlay.ts`: DOM overlays for cursor, selection, and ghost slots
- `src/label-key.ts`: `workplane-id:layer:row:column` key builder and parser
- `src/data/labels.ts`: classic grid dataset builders
- `src/data/editor-lab.ts`: large editor demo dataset
- `src/data/network-dag.ts`: canonical five-workplane DAG fixture data from `PLAN.md`
- `src/data/workplane-showcase.ts`: five-workplane showcase dataset
- `src/data/workplane-grid-stack.ts`: shared five-workplane `12x12x12` grid builder
- `src/data/links.ts`: canonical link builders
- `src/text/layer.ts`: text visibility, glyph packing, and draw submission
- `src/line/layer.ts`: line visibility and draw submission
- `src/perf.ts`: CPU and GPU frame telemetry
- `scripts/test.ts`: browser test entry point
- `scripts/test-dag-static.ts`: focused static DAG command entry point
- `scripts/test-preview.ts`: production-bundle smoke test
- `scripts/test-live.ts`: deployed-site smoke test
- `scripts/test/dag-view-smoke.ts`: focused browser DAG render smoke flow
- `scripts/test/`: browser helpers, smoke helpers, and step-based interaction coverage

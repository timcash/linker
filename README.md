# Linker

Linker is a `luma.gl` + WebGPU DAG workplane viewer and editor with aligned `12x12x12` label grids, `rank/lane/depth` 3D navigation, a compact mobile-style menu-first control pad, a browser `/codex` mailboard that talks to the shared `gmail-agent` daemon through one Cloudflare Access unlock flow, and a browser `/logs` terminal page for timestamped history with source-line filters.

## 1. Live Onboarding

First-time GitHub Pages visits now boot from `demoPreset=dag-empty` and replace the top stats strip with an `onboard-panel`. The guided run starts on the bottom `Menu` pad and uses the same visible buttons and label input that Linker exposes to the user:

- open `Map`, `Stage`, `DAG`, `CRUD`, and `View` from the menu-first 3x3 control hub
- create and rename a local label stack on the root workplane
- create, remove, and clear a local label selection and local link
- demonstrate `child`, `parent`, and leaf `delete` DAG CRUD
- build the full `1-4-4-3` twelve-workplane DAG from zero data
- autogrid each downstream `rank slice` into a readable two-depth `lane x depth` grid instead of piling every child into one flat lane
- add real local labels and links onto multiple authored workplanes so the deep zoom bands reveal actual content
- move a leaf across `rank`, `lane`, and `depth`, then settle it back onto the rails
- distinguish `Local Link` on `CRUD` from `Child Link` and `Parent Link` on `DAG`, with the `Menu` hub now labeling `Local Links`, `DAG Links`, `2D <-> 3D`, and `Pan + Zoom`
- switch to the dedicated `View` pad for text and line rendering choices without overflowing the `CRUD` grid
- hand workplane selection off through smooth 2D and 3D camera motion instead of snapping between workplanes
- enter `3d-mode`, use discrete `Zoom +` and `Zoom -` steps to travel through the reachable `graph-point`, `title-only`, `label-point`, and closest 3D `full-workplane` band, then hand off into `plane-focus` detail and return to the title-only DAG overview
- finish on the root-focused 3D DAG overview with the `Menu` pad reopened for manual exploration
- write one ordered screenshot per onboarding step into [`artifacts/test-screenshots/`](./artifacts/test-screenshots/) so the walkthrough can be reviewed visually step by step

Current proven invariant:

- `npm run test:browser` is green and now means the hosted-style onboarding proof
- `npm run test:browser:onboarding` stays green as the explicit onboarding alias
- `npm run test:browser:logs` is green for the xterm.js `/logs/` history and filter route
- `npm run test:browser:codex` is green for the `/codex/` mailboard unlock, inbox filter, mark-read, reply, and compose screenshot proof
- `npm run test:browser:dag-network-build` is green for the canonical zero-data 2D + 3D interaction proof
- `npm run test:browser:suite` is green for the broader browser matrix around the onboarding-first product path
- `npm run test:dag:static` is green for pure DAG validation, layout, edge, and model mutation rules
- `npm run build:pages` is green for the deployable GitHub Pages bundle
- workplane switches now animate through a camera handoff in both `plane-focus view` and the 3D DAG overview
- the default twelve-workplane DAG boot now uses the same deterministic rank-slice autogrid as zero-data authoring, so each downstream rank reads as a visible `lane x depth` grid in 3D
- the regular `dag-rank-fanout` boot now reuses the same authored local labels and local links that the onboarding walkthrough leaves behind, so `?onboarding=0` and the finished walkthrough land on the same dataset
- the onboarding proof now records `28` ordered screenshots, from `intro` through `complete`, in `artifacts/test-screenshots`

Current focused diagnostic to keep explicit:

- `npm run test:browser -- --flow dag-zoom-journey` is temporarily out of the shared suite while its five-workplane zoom-band expectation is recalibrated; the onboarding-first path remains the default product proof

Replay and skip:

- the hosted root auto-runs onboarding on a true first visit
- `?onboarding=1` forces a replay
- `?onboarding=0` skips the intro and boots the regular DAG route
- after a completion or a skip, Linker stores a local completion flag and later hosted visits return to the normal DAG overview

Focused working loop:

```bash
npm run test:dag:static
npm run lint
npm run test:browser
npm run test:browser:logs
npm run test:browser:dag-network-build
npm run test:browser:dag-rank-fanout
npm run test:browser:suite
npm run build:pages
npm run test:live -- --url https://timcash.github.io/linker/ --expect-onboarding
```

`README.md` is now the repo-level source of truth for the live product path, the working loop, the domain language, the UI panels, and the current open review notes.

Current review queue:

- the zero-data `dag-network-build` flow remains the clearest end-to-end CRUD proof for local labels, local links, workplane creation, leaf delete, `rank/lane/depth`, and 2D/3D mode handoff
- the hosted onboarding screenshots under `artifacts/test-screenshots/` remain the visual contract for each guided step from empty root to finished `1-4-4-3` DAG
- direct 3D workplane picking plus explicit DAG edge create/remove between already-existing workplanes are still the main product gaps
- every publish should still end with a live pass over `/`, `/codex/`, `/readme/`, and `/logs/`
- `/codex/` on GitHub Pages is expected to render as a locked mailboard until the hosted Cloudflare Access mail origin is reachable from this machine

## 2. Screenshot and Links

<!-- README_SHOWCASE:START -->

<table>
  <tr>
    <td align="center"><a href="https://timcash.github.io/linker/"><img src="./readme/screenshots/boot-ready.png" alt="Linker default DAG boot on the twelve-workplane overview" width="220" /></a><br/><sub>Boot</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/?demoPreset=dag-rank-fanout&stageMode=3d-mode&workplane=wp-1&cameraLabel=wp-1%3A1%3A1%3A1"><img src="./readme/screenshots/dag-rank-fanout.png" alt="Linker twelve-workplane DAG overview" width="220" /></a><br/><sub>DAG Build</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/?demoPreset=dag-rank-fanout&stageMode=3d-mode&workplane=wp-10&cameraLabel=wp-10%3A1%3A1%3A1"><img src="./readme/screenshots/dag-zoom-detail.png" alt="Linker DAG zoom into readable workplane detail" width="220" /></a><br/><sub>Zoom Detail</sub></td>
    <td align="center"><a href="https://timcash.github.io/linker/codex/"><img src="./readme/screenshots/codex-mailboard.png" alt="Linker codex mailboard route" width="220" /></a><br/><sub>Codex</sub></td>
  </tr>
</table>

- Live root: [timcash.github.io/linker](https://timcash.github.io/linker/)
- GitHub repository: [github.com/timcash/linker](https://github.com/timcash/linker)

The live root now opens into the automated onboarding walkthrough on a first visit, then settles on the same DAG-first product path shown in the screenshots below.
<!-- README_SHOWCASE:END -->

Local dev URL: `http://127.0.0.1:5173/`

Docs routes:

- `/auth/`
- `/codex/`
- `/logs/`
- `/tasks/`
- `/readme/`

To choose the dataset and focused label on the live page, only change these query params:

```text
onboarding=0|1
demoPreset=classic|dag-empty|dag-rank-fanout|editor-lab
cameraLabel=workplane-id:layer:row:column
```

Example:

```text
https://timcash.github.io/linker/?demoPreset=dag-rank-fanout&cameraLabel=wp-10:1:1:1
```

`/codex/` on GitHub Pages stays static and now uses one Cloudflare Access unlock step to reach the shared `gmail-agent` mail API. For local development:

```bash
Copy-Item .env.codex.local.example .env.local
cd ..\\gmail-agent
npm run codex:daemon
cd ..\\linker
npm run dev -- --host 127.0.0.1
```

The Linker browser app now defaults to `http://127.0.0.1:4192` for `/codex/` in local development. To reach this machine from GitHub Pages through Cloudflare, the shared `gmail-agent` daemon needs to publish the mail API at the single public origin:

```bash
https://codex.dialtone.earth
```

To prove the shared mailbox sync from this repo itself, run:

```bash
npm run test:codex:mail-sync
```

That command checks the sibling `gmail-agent` auth state, starts the shared daemon if needed, calls the live `/api/mail/*` surface, and writes a proof artifact to `artifacts/codex-mail-sync-proof.json` when the local Gmail sync is healthy.

## 3. CLI Workflow

```bash
npm install --legacy-peer-deps

npm run dev -- --host 127.0.0.1
npm run lint
npm run build
npm run build:pages
npm run preview -- --host 127.0.0.1

cd ..\\gmail-agent
npm run codex:daemon
npm test
cd ..\\linker

npm run test:dag:static
npm run test:browser:boot
npm run test:browser:auth
npm run test:browser:codex
npm run test:browser:dag-control-pad
npm run test:browser:dag-network-build
npm run test:browser:logs
npm run test:browser:onboarding
npm run test:browser:dag-rank-fanout
npm run test:browser:dag-rank-fanout:open
npm run test:browser:dag-zoom-journey
npm run test:browser -- --flow dag-view-smoke
npm run test:browser:readme
npm run test:browser:suite
npm run test:browser:tasks
npm run test:browser:zero-data
npm run test:codex:mail-sync
npm run test:browser
npm run test:preview
npm run test:live -- --url https://timcash.github.io/linker/
npm run test:live -- --url https://timcash.github.io/linker/ --expect-onboarding
npm run test:live -- --url https://timcash.github.io/linker/codex/
npm run test:live -- --url https://timcash.github.io/linker/ --allow-unsupported
npm test

npm run perf:trace -- --stage-mode 3d-mode --label-set benchmark --label-count 4096 --orbit-count 1
npm run perf:orbit-stutter -- --label-set benchmark --label-count 4096 --segment-count 3
```

## 4. Domain Language

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
- `workplane node`: one workplane treated as a DAG node in global `3d-mode`
- `rank`: the left-to-right dependency stage for a workplane node; the UX term for global DAG `column`
- `lane`: the top-to-bottom slot inside a rank; the UX term for global DAG `row`
- `depth`: the front-to-back slot inside a rank; the UX term for global DAG `layer`
- `rank slice`: the shared placement surface for all workplane nodes in one rank
- `rank-slice autogrid`: the deterministic downstream fill order that places new DAG children across a fixed `lane x depth` grid within one rank slice
- `child fanout`: the set of direct child workplanes spread across the next rank slice
- `autoplacement`: the deterministic rule that picks the next lane and depth slot for a newly created child within the downstream rank slice; the current default fills two depth rails before opening a new lane
- `DAG rails`: the snapped integer `rank/lane/depth` placement grid used in `3d-mode`
- `zoom band`: one discrete 3D DAG level of detail used by the `Zoom +` and `Zoom -` controls: `graph-point`, `title-only`, `label-points`, or `full-workplane`
- `menu pad`: the bottom 3x3 hub that routes the user into the other control pads
- `control pad section`: one named container inside the bottom pad: `menu`, `map`, `stage`, `dag`, `crud`, or `view`
- `map controls`: the user-facing name for the camera and cursor movement pad; the internal page key remains `navigate`
- `crud controls`: the user-facing name for the label typing and edit pad; the internal page key remains `edit`
- `view controls`: the user-facing name for the rendering-style pad for text and line strategies
- `status strip`: the compact live table at the top of the screen
- `onboard panel`: the guided walkthrough panel that temporarily replaces the status strip on first-run GitHub Pages visits
- `mailboard`: the `/codex/` mailbox UI backed by the shared `gmail-agent` daemon
- `mail view`: the currently selected mailbox filter on the `/codex/` bottom pad
- `thread row`: one visible mailbox summary in the `/codex/` list
- `message pane`: the selected thread detail area on `/codex/`
- `compose box`: the reply or new-mail text surface on `/codex/`

## 5. UI Panels

- `status strip`: the top telemetry table with the live stage stats
- `onboard panel`: the temporary top panel used during the automated first-run walkthrough; it replaces the status strip until the intro completes or is dismissed
- `menu pad`: the default bottom 3x3 hub with one entry button for each main control pad: `Map`, `Stage`, `DAG`, `CRUD`, and `View`, plus passive cue chips for `Local Links`, `DAG Links`, `2D <-> 3D`, and `Pan + Zoom`
- `map controls`: the bottom 3x3 container for zoom, orbit, and 2D cursor movement
- `stage controls`: the bottom 3x3 container for `2d-mode`, `3d-mode`, workplane switching, and root focus when a DAG is active
- `dag controls`: the bottom 3x3 container for `child link`, `parent link`, and `rank/lane/depth` DAG placement moves
- `crud controls`: the bottom input-grid container with one label input row plus two `3x3` action rows for selection, local linking, unlinking, removing, clearing, and returning to `Menu`
- `view controls`: the bottom 3x3 container for `Sharp`, `Soft`, `Step`, `Arc`, and `Orbit`
- `menu button`: the bottom-right button on the active pads that returns the user to the `Menu` hub
- `editor overlays`: the selection box, ranked-selection badges, and ghost-slot markers drawn over the canvas
- `mail meta cards`: the `/codex/` top status cards for mailbox, health, and current mail view
- `thread list`: the `/codex/` scrollable list of mailbox thread summaries
- `message pane`: the `/codex/` conversation view with message text and task history
- `compose panel`: the `/codex/` new-mail form that opens inside the message pane
- `mail pad`: the `/codex/` bottom 3x3 pad for view switching plus `Refresh`, `Compose`, and `Mark Read`

## 6. Code Index

- `src/main.ts`: app entry point
- `src/auth-page.ts`: Cloudflare Access auth/status route modeled on the cad-pga Legion page
- `src/codex-page.ts`: `/codex/` route shell that mounts the mailboard UI inside the shared docs navigation
- `src/codex/CodexMailboardPage.ts`: codex route controller for Cloudflare Access unlock, mailbox loading, view switching, reply, and compose
- `src/codex/CodexMailClient.ts`: browser client for the shared `gmail-agent` mail API
- `src/codex/CodexMailboardView.ts`: mobile-first monochrome mailboard DOM, thread list, message pane, and bottom 3x3 mail pad
- `src/codex/codexMailboard.css`: `/codex/` mailboard layout and mobile-to-desktop route styling
- `src/logs-page.ts`: `/logs/` route shell that mounts the browser log terminal UI inside the shared docs navigation
- `src/logs/log-model.ts`: browser log entry types, source-line parsing, CLI command parsing, and filter helpers
- `src/logs/log-store.ts`: local browser log capture, console wrapping, localStorage history, and global store access
- `src/logs/LogsTerminalPage.ts`: logs route controller for filters, history, follow mode, and dataset exports
- `src/logs/LogsTerminalView.ts`: xterm.js-backed browser log terminal UI and command input handling
- `src/readme-page.ts`: live markdown preview route for `README.md`
- `src/app.ts`: WebGPU boot, plane-stack state, discrete DAG zoom-band stepping, input handling, render loop, and dataset exports
- `src/projector.ts`: plane-focus and stack-camera projection, including eased 3D orbit-target handoff between workplanes and tighter onboarding-first DAG framing
- `src/style.css`: static overlay grid for the status strip, fullscreen canvas, and bottom menu-first control pad
- `src/stage-chrome.ts`: DOM shell for the status strip, `onboard-panel`, the monochrome `Menu` hub, the strict `CRUD` input-grid, and the `View` pad
- `src/stage-panels.ts`: sync logic for the `menu`, `map`, `stage`, `dag`, `crud`, and `view` control containers
- `src/stage-config.ts`: query parsing for `demoPreset`, `cameraLabel`, and hosted onboarding
- `src/stage-session.ts`: boot hydration and default dataset selection
- `src/plane-stack.ts`: document/session helpers across workplanes, including DAG authoring, leaf delete, and rank-slice child autogrid placement
- `src/dag-document.ts`: DAG document types, validation helpers, and topological checks
- `src/dag-layout.ts`: integer DAG coordinate to world-space layout helpers for `rank/lane/depth` slices
- `src/dag-view.ts`: DAG-aware 3D scene assembly, shared LOD thresholds, brighter monochrome overview rendering, and compatibility-mode stack rendering
- `src/stack-view.ts`: stacked 3D scene composition and bridge-link routing
- `src/stage-editor.ts`: cursor motion, ghost slots, ranked selection, and scene edits
- `src/stage-editor-overlay.ts`: DOM overlays for cursor, selection, and ghost slots
- `src/label-key.ts`: `workplane-id:layer:row:column` key builder and parser
- `src/data/labels.ts`: classic grid dataset builders
- `src/data/dag-rank-fanout.ts`: default twelve-workplane DAG dataset, now arranged as downstream rank-slice grids, plus layout fingerprint helpers
- `src/data/editor-lab.ts`: large editor demo dataset
- `src/data/network-dag.ts`: canonical five-workplane DAG fixture data used by the seeded smoke and static DAG checks
- `src/data/workplane-grid-stack.ts`: shared five-workplane `12x12x12` grid builder
- `src/data/links.ts`: canonical link builders
- `.env.codex.local.example`: local example env for pointing Linker at the shared `gmail-agent` mail API
- `src/text/layer.ts`: text visibility, glyph packing, and draw submission
- `src/line/layer.ts`: line visibility and draw submission
- `src/perf.ts`: CPU and GPU frame telemetry
- `scripts/test.ts`: browser test entry point
- `scripts/test/codex-page-smoke.ts`: focused `/codex/` browser route proof
- `scripts/test/logs-page-smoke.ts`: focused `/logs/` browser route proof for stored history, source filtering, and CLI follow mode
- `scripts/test/dag-control-pad.ts`: focused zero-data DAG authoring flow
- `scripts/test/dag-network-build.ts`: canonical zero-data end-to-end DAG interaction flow across 2D workplane CRUD and 3D DAG CRUD
- `scripts/test/onboarding-walkthrough.ts`: first-run hosted onboarding proof from an empty root to the final twelve-workplane 3D DAG, with one screenshot artifact per onboarding step
- `scripts/test/dag-rank-fanout.ts`: focused zero-data twelve-workplane rank-fanout authoring flow
- `scripts/test/dag-zoom-journey.ts`: screenshot-backed DAG zoom-band and 3D-to-2D return proof
- `scripts/test-dag-static.ts`: focused static DAG command entry point
- `scripts/test-preview.ts`: production-bundle smoke test
- `scripts/test-live.ts`: deployed-site smoke test
- `scripts/test/dag-view-smoke.ts`: focused browser DAG render smoke flow
- `scripts/test/`: browser helpers, smoke helpers, and step-based interaction coverage

# Linker

Linker is a `luma.gl` + WebGPU workplane viewer and editor with aligned `12x12x12` label grids, multi-workplane stack navigation, and a compact mobile-style control pad.

## 0. Screenshot and Links

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

To choose the dataset and focused label on the live page, only change these query params:

```text
demoPreset=classic|editor-lab|workplane-showcase
cameraLabel=workplane-id:layer:row:column
```

Example:

```text
https://timcash.github.io/linker/?demoPreset=editor-lab&cameraLabel=wp-3:1:6:6
```

## 1. Command Line Interface

```bash
npm install --legacy-peer-deps

npm run dev -- --host 127.0.0.1
npm run lint
npm run build
npm run build:pages
npm run preview -- --host 127.0.0.1

npm run test:browser
npm run test:preview
npm run test:live -- --url https://timcash.github.io/linker/
npm run test:live -- --url https://timcash.github.io/linker/ --allow-unsupported
npm test

npm run perf:trace -- --stage-mode 3d-mode --label-set benchmark --label-count 4096 --orbit-count 1
npm run perf:orbit-stutter -- --label-set benchmark --label-count 4096 --segment-count 3
```

## 2. Domain Language

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

## 3. UI Panels

- `status strip`: the top telemetry table with the live stage stats
- `navigate controls`: the default bottom 3x3 container for zoom and movement
- `stage controls`: the bottom 3x3 container for `2d-mode`, `3d-mode`, and workplane switching
- `edit controls`: the bottom 3x3 container with the label input, selection toggle, link, unlink, remove, and clear actions
- `toggle button`: the bottom-right button that cycles `navigate -> stage -> edit`
- `editor overlays`: the selection box, ranked-selection badges, and ghost-slot markers drawn over the canvas

## 4. Code Index

- `src/main.ts`: app entry point
- `src/app.ts`: WebGPU boot, plane-stack state, input handling, render loop, and dataset exports
- `src/style.css`: static overlay grid for the status strip, fullscreen canvas, and bottom control pad
- `src/stage-chrome.ts`: DOM shell for the status strip and 3x3 control pad
- `src/stage-panels.ts`: sync logic for the `navigate`, `stage`, and `edit` control containers
- `src/stage-config.ts`: query parsing for `demoPreset` and `cameraLabel`
- `src/stage-session.ts`: boot hydration and default dataset selection
- `src/plane-stack.ts`: document/session helpers across workplanes
- `src/stack-view.ts`: stacked 3D scene composition and bridge-link routing
- `src/stage-editor.ts`: cursor motion, ghost slots, ranked selection, and scene edits
- `src/stage-editor-overlay.ts`: DOM overlays for cursor, selection, and ghost slots
- `src/label-key.ts`: `workplane-id:layer:row:column` key builder and parser
- `src/data/labels.ts`: classic grid dataset builders
- `src/data/editor-lab.ts`: large editor demo dataset
- `src/data/workplane-showcase.ts`: five-workplane showcase dataset
- `src/data/workplane-grid-stack.ts`: shared five-workplane `12x12x12` grid builder
- `src/data/links.ts`: canonical link builders
- `src/text/layer.ts`: text visibility, glyph packing, and draw submission
- `src/line/layer.ts`: line visibility and draw submission
- `src/perf.ts`: CPU and GPU frame telemetry
- `scripts/test.ts`: browser test entry point
- `scripts/test-preview.ts`: production-bundle smoke test
- `scripts/test-live.ts`: deployed-site smoke test
- `scripts/test/`: browser helpers, smoke helpers, and step-based interaction coverage

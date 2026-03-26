# Layout Strategy Plan

## Current Pipeline

- `src/data/demo-label-set.csv` is the text inventory for the demo label set.
- `src/data/labels.ts` parses one root text item per row, then expands each root into a three-level hierarchy with generated `location`, `size`, `zoomLevel`, `zoomRange`, and color data.
- `src/app.ts` reads the active strategy state, builds the demo labels, and passes them into `TextLayer`.
- `src/text/layout.ts` turns those label `location` values into glyph placements, so a layout strategy belongs before glyph layout, not inside a render strategy.

## First Layout Strategy Goal

- Treat the CSV as content, not positioned geometry.
- A layout strategy should rewrite only the generated `location` values for the CSV-sourced text items when an operator presses a button.
- Keep text content, hierarchy expansion, zoom windows, palette behavior, and text strategies unchanged.
- Keep the current stepped column arrangement as the default reference layout so alternate strategies have a stable baseline.

## First Pass Surface

- `column-ramp`: the existing `12`-column stepped reference layout.
- `scan-grid`: the first alternate layout strategy that repacks the same hierarchy into a scan-grid arrangement.
- `Strategy View`: a new top-right panel that swaps the bottom-left strategy surface between `Text Strategy` buttons and `Layout Strategy` buttons.
- `layoutStrategy` route state plus `document.body.dataset` layout telemetry make relayout changes inspectable and testable.

## Follow-on Work

- Decide whether future layout strategies stay runtime-only or need an export path into a richer CSV format with explicit coordinates.
- Add a compact operator view for comparing layout fingerprints or anchor positions if the canvas alone is too indirect.
- If persistent layout authoring becomes a requirement, add a Node-side export tool instead of trying to write repo files from the browser runtime.

# PLAN

## Goal

Rebuild the default demo label-set as a hierarchical left-to-right map:

- `12` columns
- column counts `1..12`
- `78` top-level root labels total
- `2` nested zoom-in levels for every root label

## Layout Model

Use the demo CSV as the root-label source only.

- one CSV row = one top-level root label
- the layout engine places those roots into `12` columns from left to right
- column `1` has `1` root
- column `2` has `2` roots
- continue until column `12` has `12` roots
- each root gets a medium-zoom child label
- each root gets a close-zoom detail label

This creates a deterministic `3`-level hierarchy:

1. root label
2. zoom-in child label
3. close-read detail label

## Sentinel Labels

Keep these labels behaviorally stable for tests and manual checks:

- `BUTTON PAN`
  visible at the default zoom and hidden after zooming in
- `LUMA TEXT`
  hidden at the default zoom and revealed at the first zoom-in level
- `WORLD VIEW`
  hidden at the default zoom and revealed after zooming out

## Implementation Steps

1. Replace the old fixed scatter demo layout in `src/data/labels.ts`.
2. Fill the new root list from `src/data/demo-label-set.csv`.
3. Generate child and detail labels programmatically from each root.
4. Keep deterministic zoom windows for root, child, and detail levels.
5. Preserve the sentinel labels above with explicit special cases.
6. Update the README so the CSV section describes the hierarchical layout.
7. Verify the browser suite still covers zoom-window behavior correctly.

## Verification

Run:

- `npm run lint`
- `npm run build`
- `npm test`

Manual visual checks:

- the demo route reads as a left-to-right hierarchy at the default zoom
- zooming in reveals child labels and then detail labels
- zooming out reveals `WORLD VIEW`
- the default dataset still feels legible and spatially intentional

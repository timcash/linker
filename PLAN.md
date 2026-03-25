# PLAN

## Goal

Expand `Linker` from a text submission lab into a broader text rendering lab with additional strategies inspired by:

- `deck.gl` `TextLayer`
  Atlas-backed glyph quads, optional SDF atlas generation, shared atlas management.
- `MapLibre`
  Glyph atlas packing, shaping, collision-aware placement, and SDF text shading tuned for zoom.

Success means:

- every new strategy plugs into the existing `text-layer` lifecycle
- strategies remain selectable via `textStrategy=...`
- benchmark and demo routes keep working with deterministic inputs
- tests clearly separate "same output as baseline" strategies from "intentionally different placement" strategies

## Current Repo Model

The current repo already follows the same broad family as `deck.gl`:

- [src/text/charset.ts](/Users/user/linker/src/text/charset.ts#L1)
  Builds a static character set from the active labels.
- [src/text/atlas.ts](/Users/user/linker/src/text/atlas.ts#L18)
  Builds one bitmap glyph atlas with Canvas 2D.
- [src/text/layout.ts](/Users/user/linker/src/text/layout.ts#L5)
  Expands labels into centered per-glyph placements.
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L365)
  Owns the atlas texture, strategy selection, visibility work, and draw calls.
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L433)
  Switches between `baseline`, `instanced`, `packed`, `visible-index`, and `chunked`.

This means the lowest-risk next step is not "become MapLibre all at once." It is:

1. keep the atlas + quad model
2. improve atlas generation and shading
3. then improve layout and placement
4. only after that consider GPU-driven culling or more advanced placement

## Recommended Order

Build new strategies in this order:

1. `sdf-instanced`
2. `sdf-visible-index`
3. `dynamic-atlas`
4. `symbol-lite`
5. `compute-visible-index`

This order keeps each step isolated and benchmarkable.

## Strategy Roadmap

### 1. `sdf-instanced`

Purpose:

- add the `deck.gl`-style SDF text path without changing current CPU visibility behavior
- keep geometry simple so debugging remains easy

Closest reference:

- `deck.gl` `TextLayer` + `MultiIconLayer`

How it should work:

- atlas generation creates SDF glyphs instead of plain bitmap glyphs
- the strategy still uses the existing visible-glyph CPU pass
- drawing stays instanced, one quad per visible glyph
- the fragment shader interprets the atlas alpha as distance, not coverage
- outline and halo settings become possible

Files to touch:

- [src/text/types.ts](/Users/user/linker/src/text/types.ts#L1)
  Add `sdf-instanced` to `TEXT_STRATEGIES` and `TEXT_STRATEGY_OPTIONS`.
- [src/text/atlas.ts](/Users/user/linker/src/text/atlas.ts#L18)
  Split bitmap atlas generation from SDF atlas generation.
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L54)
  Add a new WGSL shader for SDF text and a new strategy class.
- [src/app.ts](/Users/user/linker/src/app.ts#L737)
  The button panel is driven from `TEXT_STRATEGY_OPTIONS`, so this should update automatically once the option exists.

Implementation notes:

- introduce an atlas mode concept such as `bitmap | sdf`
- add SDF atlas metadata:
  - `radius`
  - `cutoff`
  - `smoothing`
  - optional `outlineWidth`
  - optional `outlineColor`
- if using `TinySDF`, store enough per-glyph metrics to align glyphs vertically
- keep the current `GlyphPlacement` structure if possible so only the shader changes

Why this first:

- it improves visual quality
- it stays close to the current architecture
- it gives a clean comparison against `instanced`

Expected test behavior:

- visible label count should match `baseline`
- visible glyph count should match `baseline`
- canvas pixels may differ slightly from bitmap paths, so do not require exact baseline pixel signatures

### 2. `sdf-visible-index`

Purpose:

- combine the better-looking SDF atlas with the most efficient current submission path

Closest reference:

- `deck.gl` atlas-backed quads for rendering
- current repo `visible-index` path for submission

How it should work:

- reuse the `visible-index` storage-buffer design
- reuse the SDF atlas from `sdf-instanced`
- only upload camera uniforms and visible glyph indices per frame
- draw visible glyphs as instances using the storage-buffer glyph records

Files to touch:

- [src/text/types.ts](/Users/user/linker/src/text/types.ts#L1)
- [src/text/atlas.ts](/Users/user/linker/src/text/atlas.ts#L18)
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L189)

Implementation notes:

- do not fork visibility logic unless necessary
- prefer sharing the existing `VisibleIndexTextStrategy` with an atlas/shader mode switch
- this is likely the best "production-ish" path if text remains screen-aligned

Expected test behavior:

- visible label count should match `baseline`
- visible glyph count should match `baseline`
- upload cost should be close to current `visible-index`
- submitted vertex count should remain `visibleGlyphCount * 4`

### 3. `dynamic-atlas`

Purpose:

- move from "build one atlas up front" toward `deck.gl`'s atlas-manager model
- allow broader character sets and late glyph introduction without rebuilding everything blindly

Closest reference:

- `deck.gl` `FontAtlasManager`

How it should work:

- start with the current label-derived character set
- allow missing glyphs to trigger atlas growth
- version the atlas so dependent buffers or shaders can react when it changes
- cache atlas builds by font settings where practical

Files to touch:

- [src/text/charset.ts](/Users/user/linker/src/text/charset.ts#L1)
- [src/text/atlas.ts](/Users/user/linker/src/text/atlas.ts#L18)
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L375)

Implementation notes:

- first pass can keep one atlas and rebuild on demand
- second pass can introduce atlas caching keyed by:
  - font family
  - font weight
  - atlas mode
  - SDF settings
- expose telemetry for:
  - atlas rebuild count
  - atlas width and height
  - atlas glyph count
  - atlas bytes

Expected test behavior:

- current demo and benchmark routes should still build one atlas deterministically
- add a focused test fixture with at least one late-added glyph or alternate label-set

### 4. `symbol-lite`

Purpose:

- add the first genuinely `MapLibre`-like path
- improve layout and placement, not just submission

Closest reference:

- `MapLibre` shaping and symbol placement, but simplified for this repo

How it should work:

- keep the current world-anchor model
- add a shaping pass that outputs richer per-label layout
- add optional multi-line layout and basic justification
- add collision boxes per label
- resolve overlapping labels deterministically before building visible glyph indices

This should be called `symbol-lite` because it is not full MapLibre:

- no tiles
- no glyph PBF loading
- no line-following labels yet
- no full bidi engine unless added later

Files to touch:

- [src/text/layout.ts](/Users/user/linker/src/text/layout.ts#L5)
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L1014)
- likely add new files:
  - `src/text/shaping.ts`
  - `src/text/collision.ts`

Implementation notes:

- start with label-level collision, not glyph-level collision
- define a `PlacedLabel` structure before expanding to glyph quads
- keep collision resolution deterministic:
  - stable input order
  - stable tie-breaking by label id
  - optional priority based on zoom range or font size
- add only one new feature at a time:
  1. multi-line wrap
  2. label collision
  3. priority
  4. optional alternate anchors

Expected test behavior:

- do not compare visible label counts to `baseline` once collision is enabled
- instead compare against strategy-specific invariants:
  - output is deterministic
  - overlapping labels reduce in dense scenes
  - visible label counts change predictably with zoom

### 5. `compute-visible-index`

Purpose:

- explore a more GPU-driven path using WebGPU more aggressively

Closest reference:

- not directly from `deck.gl` or `MapLibre`
- this is the repo's own advanced research branch

How it should work:

- glyph records stay resident on the GPU
- a compute pass writes visible glyph indices into a storage buffer
- draw uses that compacted visible index buffer
- optional later step:
  indirect draw if the API path is stable and measurable

Files to touch:

- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L868)
- likely add:
  - `src/text/compute.ts`

Implementation notes:

- only attempt this after `visible-index` telemetry is solid
- keep a CPU fallback path for correctness checks
- validate CPU-visible vs GPU-visible counts on the same camera trace

Expected test behavior:

- compare visible glyph counts against CPU `visible-index`
- allow tiny timing differences, but not count differences

## Refactor Before Adding Many More Modes

Before adding three or more new strategies, reduce pressure in [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L1).

Recommended extraction:

- `src/text/shaders/bitmap-text.wgsl`
- `src/text/shaders/sdf-text.wgsl`
- `src/text/strategies/baseline.ts`
- `src/text/strategies/instanced.ts`
- `src/text/strategies/packed.ts`
- `src/text/strategies/visible-index.ts`
- `src/text/strategies/shared.ts`

Keep `TextLayer` as the orchestration point:

- atlas creation
- layout preparation
- strategy selection
- shared telemetry export

## Concrete Add-Strategy Checklist

Use this checklist for every new text strategy:

1. Add the new mode in [src/text/types.ts](/Users/user/linker/src/text/types.ts#L3).
2. Add or reuse atlas generation logic in [src/text/atlas.ts](/Users/user/linker/src/text/atlas.ts#L18).
3. Add the shader and strategy implementation in [src/text/layer.ts](/Users/user/linker/src/text/layer.ts#L433) or extracted strategy files.
4. Wire the strategy into `TextLayer.createStrategy`.
5. Confirm the render-panel button appears through `TEXT_STRATEGY_OPTIONS`.
6. Export any new telemetry needed for comparison.
7. Extend the browser suite.
8. Run the quality gate.

## Testing Plan

### Shared Smoke Tests

Every new strategy should pass:

- app boots to `ready`
- `document.body.dataset.textStrategy` reports the new mode
- the render-panel button exists and toggles correctly
- demo route still uses the shared preset label-set
- benchmark route still uses the shared benchmark label-set

Relevant files:

- [src/app.ts](/Users/user/linker/src/app.ts#L737)
- [scripts/test.ts](/Users/user/linker/scripts/test.ts#L346)

### Demo Visibility Tests

Use the existing demo route tests for strategies that should preserve current placement:

- `sdf-instanced`
- `sdf-visible-index`
- `dynamic-atlas`

For these, assert:

- visible label count matches `baseline`
- visible glyph count matches `baseline`
- zoom-window behavior matches the sentinel labels already used by the suite

Relevant file:

- [scripts/test.ts](/Users/user/linker/scripts/test.ts#L1336)

### Large-Scale Sweep Tests

Every strategy should run through the existing large-scale sweep:

- `1024`
- `4096`
- optionally `16384` if the strategy is stable enough for benchmarks

For strategies expected to preserve placement, compare against `baseline`:

- visible label count
- visible glyph count

For strategies that intentionally change placement, compare against their own invariants:

- counts are deterministic across runs
- zoom sweep transitions are sensible
- visibility enters both shown and hidden states

Relevant file:

- [scripts/test.ts](/Users/user/linker/scripts/test.ts#L1433)

### Benchmark Expectations

Add strategy-specific assertions instead of one generic rule.

Examples:

- `sdf-instanced`
  Per-frame upload should look like `instanced`, plus no extra atlas upload after startup.
- `sdf-visible-index`
  Per-frame upload should look like `visible-index`.
- `dynamic-atlas`
  Atlas rebuild count should remain `0` on the static benchmark label-set once warmed.
- `symbol-lite`
  Visible label count may be lower than `baseline` in dense scenes because collision is intentional.
- `compute-visible-index`
  Visible glyph count should match CPU `visible-index`.

Relevant file:

- [scripts/test.ts](/Users/user/linker/scripts/test.ts#L1523)

### New Strategy-Specific Tests To Add

Add focused test fixtures instead of only benchmarking the main routes.

For SDF paths:

- zoom way in and ensure edge quality remains readable
- compare low-zoom and high-zoom screenshots for stability
- assert outline and halo options produce non-empty output if enabled

For dynamic atlas:

- load a fixture label-set with a small initial charset
- switch to a label-set with extra characters
- assert atlas rebuild count increments once
- assert no missing glyphs remain visible after rebuild

For symbol-lite:

- add a dense overlapping label fixture
- assert collision reduces visible labels deterministically
- add a simple wrapped multi-line fixture
- assert line count and visible label sample match expectations

For compute-visible-index:

- compare visible glyph count against CPU `visible-index` on the same camera trace
- compare submitted glyph count as well

## Telemetry To Add

Current telemetry is already useful, but new strategies need a bit more.

Add, when relevant:

- `atlasMode`
- `atlasWidth`
- `atlasHeight`
- `atlasGlyphCount`
- `atlasBytes`
- `atlasRebuildCount`
- `layoutPassMs`
- `visibilityPassMs`
- `collisionPassMs`
- `shapingPassMs`

Expose these only if they stay deterministic enough to compare meaningfully.

## What Not To Do First

Do not start by cloning the full `MapLibre` stack.

Avoid these as the first step:

- glyph PBF loading
- tile-aware symbol buckets
- line-following labels
- full bidi and complex shaping
- GPU-only collision from day one

Those can come later, but they will make the repo harder to reason about before the simpler wins land.

## External Reference Files

These are the most useful upstream files to read before implementing new strategies here.

### `deck.gl` References

- `examples/website/text/app.tsx`
  https://github.com/visgl/deck.gl/blob/9.2-release/examples/website/text/app.tsx
  Useful for the high-level wiring: `TextLayer` over a `MapLibre` basemap with collision filtering.
- `modules/layers/src/text-layer/text-layer.ts`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/text-layer.ts
  Useful for understanding how `TextLayer` turns strings into per-character offsets, updates the font atlas, and delegates rendering to a glyph-quad sublayer.
- `modules/layers/src/text-layer/font-atlas-manager.ts`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/font-atlas-manager.ts
  Useful for atlas lifecycle design: charset growth, atlas caching, and optional `TinySDF` generation.
- `modules/layers/src/text-layer/multi-icon-layer/multi-icon-layer.ts`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/multi-icon-layer/multi-icon-layer.ts
  Useful for the SDF shader path, smoothing, and outline handling layered on top of icon-quad rendering.
- `modules/layers/src/icon-layer/icon-layer.ts`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/icon-layer/icon-layer.ts
  Useful for the luma.gl model itself: instanced quad geometry, texture binding, and per-instance icon rect data.

### `MapLibre` References

- `src/render/glyph_manager.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/glyph_manager.ts
  Useful for glyph sourcing strategy: local `TinySDF` fallback, glyph caching, and font-stack handling.
- `src/render/glyph_atlas.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/glyph_atlas.ts
  Useful for atlas packing structure and glyph-position bookkeeping.
- `src/symbol/shaping.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/shaping.ts
  Useful for the shape-before-draw mindset: line breaking, justification, vertical handling, and bidi integration points.
- `src/render/draw_symbol.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/draw_symbol.ts
  Useful for symbol rendering flow, variable anchor updates, and how placement state feeds the draw path.
- `src/render/program/symbol_program.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/program/symbol_program.ts
  Useful for SDF-specific uniforms such as gamma scaling, halo control, and text-vs-icon shader configuration.
- `src/style/load_glyph_range.ts`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/style/load_glyph_range.ts
  Useful if the repo ever experiments with server-backed glyph ranges instead of fully local atlas generation.

How to use these references:

- read `deck.gl` first when adding atlas-backed or SDF-backed quad strategies
- read `MapLibre` first when adding shaping, collision, anchor selection, or broader glyph sourcing
- only copy the concepts that fit this repo's smaller deterministic architecture

## First Concrete Milestone

If only one follow-up task is chosen, make it:

1. add `sdf-instanced`
2. add `sdf-visible-index`
3. benchmark both against `instanced` and `visible-index`

That produces the cleanest next comparison:

- same layout
- same visibility behavior
- improved text quality
- clear per-frame upload tradeoffs

## Verification

Run:

- `npm run lint`
- `npm run build`
- `npm test`

Manual checks:

- demo route can switch into every new strategy without reload errors
- benchmark route completes for every strategy added
- visible label and glyph telemetry remain believable while panning and zooming
- strategies meant to be equivalent to `baseline` stay visually aligned with it
- strategies meant to differ do so for a clear reason, not because of drift or bugs

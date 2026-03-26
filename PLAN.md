# PLAN

## Note To Next LLM

The current workspace already includes these changes:

- `README.md` was shortened and reorganized.
- `scripts/test.ts` was split into numbered step files under `scripts/test/`.
- The old large `scripts/test/shared.ts` support file was broken into:
  - `scripts/test/types.ts`
  - `scripts/test/browser.ts`
  - `scripts/test/assertions.ts`
  - `scripts/test/unit.ts`
  - with `scripts/test/shared.ts` now acting as a small barrel file.
- `npm test` passed after the refactor.

## Review Target

The label size / transparency logic lives in the main runtime code, not the tests.

Relevant files:

- `src/data/labels.ts`
- `src/text/layout.ts`
- `src/text/zoom.ts`
- `src/text/layer.ts`

## What The Current Code Does

- Base label sizes are defined in `src/data/labels.ts`:
  - demo root labels use `size: 0.26`
  - demo child labels use `size: 0.28`
- `src/text/layout.ts` uses `label.size` to compute glyph width, height, and offsets.
- `src/text/zoom.ts` defines the zoom-window helpers:
  - `isZoomVisible()`
  - `getZoomScale()`
  - `getZoomOpacity()`
- `src/text/layer.ts` duplicates the same zoom scale / opacity math inside multiple WGSL shader blocks.

## Findings

1. There is still a hard pop at the edge of the zoom band.

- `isZoomVisible()` hides labels completely once zoom moves outside the band.
- But at the exact edge of the band:
  - `getZoomScale()` still returns `MIN_ZOOM_SCALE` (`0.72`)
  - `getZoomOpacity()` still returns `MIN_ZOOM_OPACITY` (`0.18`)
- Result: labels fade and shrink partway, then disappear abruptly instead of fading fully out.

2. The zoom math is duplicated between TypeScript and WGSL.

- CPU-side helpers live in `src/text/zoom.ts`
- Equivalent shader helpers are repeated in `src/text/layer.ts`
- Any change to the zoom behavior has to stay synchronized across both implementations.

3. Visual tuning is spread across multiple files.

- Base size presets are in `src/data/labels.ts`
- Geometry scaling starts in `src/text/layout.ts`
- Dynamic zoom scaling / opacity is in `src/text/zoom.ts`
- Shader application of that logic is in `src/text/layer.ts`

This makes the behavior harder to tune than it should be.

## Recommended Next Steps

1. Decide the intended edge behavior.

- If the goal is a truly smooth fade-in / fade-out, opacity should likely reach `0` at the band edge instead of `0.18`, or the visibility gate should be widened so the fade can complete before the hard cutoff.

2. Reduce the duplication risk.

- Keep a single authoritative description of the zoom-band behavior.
- If the WGSL must remain inline, generate the shader snippet from shared constants / formulas or at least isolate the repeated shader helper code in one reusable builder.

3. Add targeted edge tests for zoom semantics.

- Test exact lower bound
- Test exact upper bound
- Test just inside the bound
- Test just outside the bound
- Verify both visibility and the expected scale / opacity values

The new split test helpers already include zoom-band unit tests in `scripts/test/unit.ts`, so that is the natural place to extend coverage.

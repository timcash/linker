# CPU Frame-Time Reduction Plan

Research snapshot: 2026-03-30

## Goal

Reduce per-frame CPU time in both `plane-focus view` and `stack view`, with the main target being active `3d-mode` camera motion.

The key rule for this plan is:

- camera movement should update uniforms, not rebuild scene geometry on the CPU

## Current Reading Of This Codebase

The main CPU hotspots are no longer the always-on frame loop. They are the camera-motion paths that still rebuild projected geometry in JavaScript:

- `src/text/layer.ts`
  - `analyzeVisibleGlyphs(...)`
  - `buildVisibleGlyphInstances(...)`
  - per-frame writes of `origin`, `basisX`, `basisY`, `depth`, `uvRect`, and `color`
- `src/line/layer.ts`
  - `buildLineMesh(...)`
  - curve sampling, per-point projection, and ribbon tessellation on every camera change
- `src/projector.ts`
  - the current contract exposes point projection only, which encourages CPU-side projection loops

Recent controller work already removed a major steady-state cost:

- `src/app.ts` now renders on invalidation instead of spinning a permanent `requestAnimationFrame` loop
- layer caches already skip CPU rebuilds when the projection fingerprint is unchanged

That means the next gains have to come from changing the data flow, not from adding more cache checks around the current screen-space rebuild path.

## External Findings

### MapLibre GL JS

MapLibre’s symbol pipeline separates expensive symbol preparation from foreground drawing:

- `SymbolBucket.populate(...)` gathers glyph and icon dependencies before draw time
- `performSymbolLayout(...)` prepares symbol data before foreground rendering
- foreground placement then uses collision data plus camera state to decide visibility, and collided symbols are hidden with a dynamic opacity buffer

Relevant source/docs:

- `symbol_bucket.ts` documents the pipeline from dependency gathering to layout to foreground placement
- `draw_symbol.ts` shows that draw uses prepared buffers plus dynamic layout and opacity buffers
- the style spec uses SDF glyph ranges loaded in 256-codepoint blocks
- MapLibre custom layers are redraw-on-demand through `Map.triggerRepaint()`, not a required permanent render loop

Implication for Linker:

- keep immutable glyph data and mutable camera/visibility data separate
- avoid rebuilding full glyph quads when only the `stack-camera` changes
- prefer a small dynamic buffer or uniform update over large per-glyph CPU rebuilds

### deck.gl TextLayer

deck.gl’s `TextLayer` is a strong reference for browser-side GPU text:

- text is rendered as a `characters` sublayer backed by `MultiIconLayer`
- the layer supports binary attributes and `startIndices` for variable-length strings
- font atlases are cached and reused
- the layer exposes `billboard` instead of forcing camera-facing behavior in application code
- the docs explicitly note that font atlas creation is CPU-intensive, especially with SDF enabled

Implication for Linker:

- treat text as static binary buffers plus a compact indexing/layout layer
- pre-pack text data once per scene or per workplane, not once per frame
- cache atlases aggressively and never rebuild them during camera motion
- move orientation choice into shader-space or instance attributes, not CPU screen-space basis math

### Relevant Papers

1. Chris Green, “Improved Alpha-Tested Magnification for Vector Textures and Special Effects” (Valve, 2007)
   - argues for SDF because it is simple, high-performance, integrates into existing GPU pipelines, and relies on ordinary filtered textures
2. Chlumský, Sloup, Šimeček, “Improved Corners with Multi-Channel Signed Distance Fields” (Computer Graphics Forum, 2018)
   - keeps the rendering path simple and efficient while improving sharp corners
3. Chanwutk et al., “Fast and Flexible Overlap Detection” (IEEE VIS, 2021)
   - occupancy bitmaps reduce overlap detection cost and make it less dependent on scene complexity

Implication for Linker:

- stay on an atlas-based GPU text path
- if quality becomes a blocker after the CPU rewrite, consider `msdf` as a later quality upgrade, not as the first performance move
- if label/workplane overlap management becomes expensive, use coarse occupancy structures rather than per-glyph brute force

## Strategic Direction

Linker should move from:

- CPU-projected screen-space glyph quads
- CPU-tessellated screen-space line ribbons

to:

- world-space or workplane-space instance data uploaded once
- a shared camera/view-projection uniform path
- GPU projection in the vertex shader

The target architecture is much closer to:

- MapLibre’s prepared symbol buffers + dynamic draw-time state
- deck.gl’s binary attributes + instanced rendering

## Platform Constraint

This renderer stays `luma.gl` + `WebGPU` only.

Rules:

- keep device creation on `@luma.gl/webgpu` with `type: 'webgpu'`
- do not add `@luma.gl/webgl`
- do not use `type: 'best-available'`
- keep shader authoring in WGSL through `Model({source: ...})`
- prefer `ShaderInputs`, bindings, and uniform buffers over ad hoc `setUniforms()` patterns
- prefer `@luma.gl/core`, `@luma.gl/engine`, `@luma.gl/webgpu`, and `@luma.gl/shadertools` APIs over raw WebGPU handles
- only drop to raw `GPUDevice` or other `.handle` objects if luma.gl cannot express a required feature, and isolate that seam in one file

Current repo status:

- `src/app.ts` already creates the device with `type: 'webgpu'` and `adapters: [webgpuAdapter]`
- `package.json` currently includes `@luma.gl/core`, `@luma.gl/engine`, `@luma.gl/shadertools`, and `@luma.gl/webgpu`
- current render code uses luma `Model`, `Buffer`, `GPUGeometry`, `DynamicTexture`, and `QuerySet`
- current shaders already use unified WGSL `source:` instead of `vs`/`fs`

Helpful luma.gl docs:

- installing and adapter selection:
  - https://luma.gl/docs/developer-guide/installing/
  - https://luma.gl/docs/api-guide/gpu/gpu-initialization
- WebGPU adapter overview:
  - https://luma.gl/docs/api-reference/webgpu/
- `Model` and WGSL draw pipeline:
  - https://luma.gl/docs/api-reference/engine/model
- shader uniform/binding management:
  - https://luma.gl/docs/api-reference/engine/shader-inputs/
- profiling and GPU timestamps:
  - https://luma.gl/docs/developer-guide/profiling

## Plan

### Step 1. Add A Real Performance Baseline

We need hard numbers before the larger renderer rewrite.

Work:

- extend the benchmark route to record:
  - idle `plane-focus view`
  - idle `stack view`
  - active orbit in `stack view`
  - active pan/zoom in `plane-focus view`
- split CPU timings into at least:
  - controller / snapshot / DOM
  - text update
  - line update
  - draw submission
- add a browser perf script that drives deterministic camera traces and writes a JSON artifact

Success criteria:

- we can state exact baseline averages and p95 values for CPU frame time
- we can attribute most motion-time CPU cost to named subsystems

### Step 2. Replace Screen-Space Text Projection With Workplane-Space Instances

This is the highest-value change.

Current problem:

- `src/text/layer.ts` projects every visible glyph on the CPU when the camera changes
- the layer sorts visible glyphs and allocates fresh typed arrays during motion

Target model:

- precompute immutable glyph records per workplane:
  - anchor in workplane space
  - local glyph quad offset/size
  - plane basis
  - atlas UV rect
  - base color
- upload these once and reuse them
- update only:
  - camera/view-projection uniforms
  - workplane visibility/highlight state
  - optional per-label opacity/highlight buffers

Implementation notes:

- extend `StageProjector` so it can provide camera matrices or equivalent packed uniform data
- stop using CPU-computed `instanceOrigin`, `instanceBasisX`, `instanceBasisY` as per-frame outputs
- let the vertex shader project workplane-local glyph vertices into clip space
- keep `sdf-instanced` as the only text strategy
- draw in workplane order instead of globally sorting every glyph by CPU-computed depth

Success criteria:

- active `stack-camera` motion no longer calls per-glyph CPU projection
- per-frame text uploads shrink to uniforms and tiny dynamic state only
- text motion cost becomes nearly independent of glyph count

### Step 3. Replace Screen-Space Line Tessellation With World-Space Or Workplane-Space Geometry

Current problem:

- `src/line/layer.ts` resamples curves, projects points, and rebuilds ribbon triangles on camera motion

Target model:

- precompute static line geometry in workplane space
- choose one of these two paths:
  - preferred: segment-instanced line rendering with shader-side extrusion
  - fallback: pre-tessellated world-space ribbons built once per scene and only re-uploaded when links change

Rules:

- camera motion must not rebuild line vertex arrays
- line highlighting for the active label should be a compact per-link state update, not a full mesh rebuild

Success criteria:

- line CPU cost during orbit drops sharply
- line geometry upload only happens on scene edits, workplane changes, or strategy changes

### Step 4. Move Rare Heavy Work Off The Main Thread

MapLibre’s worker split is a useful reference here.

Good worker candidates:

- atlas generation or atlas expansion
- label layout / glyph record packing after text edits
- future collision or overlap preprocessing
- large scene import / workplane spawn preprocessing

Rules:

- frame rendering stays on the main thread
- scene edits may be async, but camera motion must never block on text packing

Success criteria:

- text edits can still rebuild resources without stalling unrelated interaction
- large atlas or layout changes stop creating visible main-thread hitches

### Step 5. Add Coarse Visibility And Overlap Structures

This is only needed after steps 2 and 3 are in place.

Possible additions:

- workplane-level visibility masks
- label-level bounding volumes for coarse frustum rejection
- occupancy bitmap style overlap detection if `stack view` text clutter still requires dynamic suppression

Rules:

- do not add a full per-frame global label-placement solver unless the benchmark proves it is necessary
- prefer coarse culling first, overlap suppression second

Success criteria:

- visible work per frame scales with visible workplanes and visible labels, not total scene size

### Step 6. Keep Observability Cheap

The benchmark and dataset surface should not become the next bottleneck.

Work:

- throttle or sample expensive stats text updates if needed
- keep `writeStageSnapshot(...)` and benchmark dataset writes diff-based
- avoid serializing large strings every frame during camera motion

Success criteria:

- debug observability remains useful without materially inflating CPU frame time

## Order Of Implementation

Use this order:

1. baseline and benchmark split
2. text renderer rewrite
3. line renderer rewrite
4. worker/off-main-thread preprocessing
5. coarse visibility and overlap control
6. observability cleanup after the main renderer shifts land

This order is deliberate:

- text is the largest current CPU sink
- line CPU work is real but secondary
- workerization before the data-flow rewrite would mostly hide the wrong architecture

## Agent-Ready Work Split

Use small write scopes. Each agent should own one slice and avoid editing files outside that slice unless a shared type seam absolutely requires it.

### Slice A. Perf Baseline And Trace Output

Primary files:

- `src/app.ts`
- `src/stage-snapshot.ts`
- `scripts/test.ts`
- `scripts/test/setup.ts`
- new `scripts/perf/trace.ts`
- optional new `src/perf/frame-timer.ts`

Responsibilities:

- add subsystem timings for controller, text update, line update, and draw submission
- add a deterministic camera trace runner for `plane-focus view` and `stack view`
- write JSON perf artifacts that can be diffed in CI or locally

Helpful code and resources:

- local render loop and snapshot surface:
  - `src/app.ts`
  - `src/stage-snapshot.ts`
- redraw-on-demand reference:
  - https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/
- luma profiling reference:
  - https://luma.gl/docs/developer-guide/profiling

Do not own:

- `src/text/layer.ts`
- `src/line/layer.ts`

Small starter sketch:

```ts
export type FrameTimingSample = {
  controllerMs: number;
  textMs: number;
  lineMs: number;
  drawMs: number;
  totalCpuMs: number;
  frameLabel: 'plane-focus-idle' | 'stack-idle' | 'plane-focus-pan' | 'stack-orbit';
};

export class FrameTimer {
  private readonly marks = new Map<string, number>();

  mark(name: string): void {
    this.marks.set(name, performance.now());
  }

  measure(start: string, end: string): number {
    return Math.max(0, (this.marks.get(end) ?? 0) - (this.marks.get(start) ?? 0));
  }
}
```

### Slice B. Projector Uniform Contract

Primary files:

- `src/projector.ts`
- `src/scene-space.ts`
- optional new `src/render/camera-uniforms.ts`

Responsibilities:

- extend `StageProjector` so layers can read camera matrices and viewport uniforms
- keep the existing high-level domain language: `plane-focus view`, `stack view`, `workplane`
- preserve the current point-projection helpers during the migration, but stop making them the only contract

Helpful code and resources:

- local camera and scene-space seams:
  - `src/projector.ts`
  - `src/scene-space.ts`
  - `src/stack-camera.ts`
- perspective and uniform-driven reference patterns:
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/draw_symbol.ts
  - https://deck.gl/docs/developer-guide/custom-layers/layer-attributes
- luma uniform and model references:
  - https://luma.gl/docs/api-reference/engine/model
  - https://luma.gl/docs/api-reference/engine/shader-inputs/

Do not own:

- `src/text/layer.ts`
- `src/line/layer.ts`

Small starter sketch:

```ts
export type ProjectorUniforms = {
  viewProjectionMatrix: Float32Array;
  viewportSize: Float32Array;
  cameraPosition: Float32Array;
};

export type ProjectorShaderProps = {
  camera: {
    viewProjectionMatrix: number[];
    viewportSize: number[];
    cameraPosition: number[];
  };
};

export type StageProjector = {
  readonly centerX: number;
  readonly centerY: number;
  readonly pixelsPerWorldUnit: number;
  readonly zoom: number;
  getProjectionFingerprint: (viewport: ViewportSize) => string;
  getProjectorUniforms: (viewport: ViewportSize) => ProjectorUniforms;
  projectWorldPoint: (point: StageWorldPoint, viewport: ViewportSize) => ScreenPoint;
  projectWorldPointToClip: (point: StageWorldPoint, viewport: ViewportSize) => ClipPoint;
};
```

Small starter sketch using luma `ShaderInputs`:

```ts
import {ShaderInputs} from '@luma.gl/engine';

const shaderInputs = new ShaderInputs<ProjectorShaderProps>({
  camera: {
    uniformTypes: {
      viewProjectionMatrix: 'mat4x4<f32>',
      viewportSize: 'vec2<f32>',
      cameraPosition: 'vec3<f32>',
    },
  },
});

shaderInputs.setProps({
  camera: {
    viewProjectionMatrix: Array.from(projectorUniforms.viewProjectionMatrix),
    viewportSize: Array.from(projectorUniforms.viewportSize),
    cameraPosition: Array.from(projectorUniforms.cameraPosition),
  },
});

model.setShaderInputs(shaderInputs);
model.updateShaderInputs();
```

### Slice C. GPU Text Rewrite

Primary files:

- `src/text/layer.ts`
- `src/text/layout.ts`
- `src/text/types.ts`
- new `src/text/glyph-instance-pack.ts`
- new `src/text/text-uniforms.ts`
- optional cleanup in `src/text/projection.ts`

Responsibilities:

- replace per-frame CPU-projected glyph quads with workplane-space glyph instances
- keep `sdf-instanced` as the only text path
- make camera motion update uniforms and tiny dynamic state only

Helpful code and resources:

- local text path to replace:
  - `src/text/layer.ts`
  - `src/text/layout.ts`
  - `src/text/projection.ts`
- upstream references:
  - https://deck.gl/docs/api-reference/layers/text-layer
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/text-layer.ts
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/font-atlas-manager.ts
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/symbol_bucket.ts
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/draw_symbol.ts
  - https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf
- luma implementation references:
  - https://luma.gl/docs/api-reference/engine/model
  - https://luma.gl/docs/api-reference/engine/shader-inputs/
  - https://luma.gl/docs/api-reference/webgpu/

Do not own:

- `src/line/layer.ts`
- `src/app.ts` except for tiny wiring changes

Small starter sketch for packed glyph data:

```ts
export type WorkplaneGlyphInstance = {
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  planeBasisX: [number, number, number];
  planeBasisY: [number, number, number];
  glyphOffset: [number, number];
  glyphSize: [number, number];
  uvRect: [number, number, number, number];
  color: [number, number, number, number];
  workplaneIndex: number;
};

export function packGlyphInstances(labels: LabelDefinition[]): Float32Array {
  const packed: number[] = [];
  for (const label of labels) {
    for (const glyph of label.glyphs) {
      packed.push(
        glyph.anchor.x,
        glyph.anchor.y,
        glyph.anchor.z,
        ...glyph.planeBasisX,
        ...glyph.planeBasisY,
        glyph.offsetX,
        glyph.offsetY,
        glyph.width,
        glyph.height,
        ...glyph.uvRect,
        ...glyph.color,
        glyph.workplaneIndex,
      );
    }
  }
  return new Float32Array(packed);
}
```

Small starter sketch for the vertex path:

```wgsl
struct CameraUniforms {
  viewProjectionMatrix: mat4x4<f32>,
  viewportSize: vec2<f32>,
  padding: vec2<f32>,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  let worldPosition =
    inputs.instanceAnchor +
    inputs.instancePlaneBasisX * (inputs.glyphOffset.x + inputs.unitPosition.x * inputs.glyphSize.x) +
    inputs.instancePlaneBasisY * (inputs.glyphOffset.y + inputs.unitPosition.y * inputs.glyphSize.y);

  outputs.clipPosition = camera.viewProjectionMatrix * vec4<f32>(worldPosition, 1.0);
  outputs.uv = mix(inputs.instanceUvRect.xy, inputs.instanceUvRect.zw, inputs.unitUv);
  outputs.color = inputs.instanceColor;
  return outputs;
}
```

Small starter sketch for luma model setup:

```ts
const model = new Model(device, {
  id: 'workplane-text',
  source: WORKPLANE_TEXT_SHADER,
  geometry: new GPUGeometry({
    topology: 'triangle-strip',
    vertexCount: 4,
    bufferLayout: [
      {name: 'unitPosition', format: 'float32x2'},
      {name: 'unitUv', format: 'float32x2'},
      {name: 'instanceAnchor', format: 'float32x3', stepMode: 'instance'},
      {name: 'instancePlaneBasisX', format: 'float32x3', stepMode: 'instance'},
      {name: 'instancePlaneBasisY', format: 'float32x3', stepMode: 'instance'},
    ],
    attributes: {
      unitPosition: unitPositionBuffer,
      unitUv: unitUvBuffer,
      instanceAnchor: anchorBuffer,
      instancePlaneBasisX: planeBasisXBuffer,
      instancePlaneBasisY: planeBasisYBuffer,
    },
  }),
  shaderInputs,
  bindings: {
    glyphAtlas: atlasTexture,
    glyphAtlasSampler: atlasSampler,
  },
  parameters: {
    depthCompare: 'less-equal',
    depthWriteEnabled: false,
    blend: true,
  },
});
```

### Slice D. GPU Line Rewrite

Primary files:

- `src/line/layer.ts`
- `src/line/curves.ts`
- `src/line/types.ts`
- new `src/line/segment-instance-pack.ts`
- optional new `src/line/line-uniforms.ts`

Responsibilities:

- stop rebuilding screen-space ribbons during camera motion
- move line geometry to workplane-space or world-space segment instances
- keep active-label highlight state as a compact update

Helpful code and resources:

- local line path to replace:
  - `src/line/layer.ts`
  - `src/line/curves.ts`
- upstream references:
  - https://deck.gl/docs/developer-guide/custom-layers/layer-attributes
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/text-layer.ts
- luma implementation references:
  - https://luma.gl/docs/api-reference/engine/model
  - https://luma.gl/docs/api-reference/engine/shader-inputs/

Do not own:

- `src/text/layer.ts`
- `src/projector.ts` except for shared camera uniform types

Small starter sketch:

```ts
export type LineSegmentInstance = {
  start: [number, number, number];
  end: [number, number, number];
  halfWidth: number;
  color: [number, number, number, number];
  linkIndex: number;
};

export function packLineSegments(links: LinkDefinition[]): Float32Array {
  const packed: number[] = [];
  for (const link of links) {
    const points = sampleLineCurve(link, 'curved', 24);
    for (let i = 0; i < points.length - 1; i += 1) {
      const start = points[i];
      const end = points[i + 1];
      packed.push(
        start.x, start.y, start.z ?? 0,
        end.x, end.y, end.z ?? 0,
        link.lineWidth * 0.5,
        ...link.color,
        i,
      );
    }
  }
  return new Float32Array(packed);
}
```

### Slice E. Worker And Async Preprocessing

Primary files:

- new `src/text/text-worker.ts`
- new `src/text/text-worker-types.ts`
- `src/text/layer.ts`
- `src/app.ts`

Responsibilities:

- move atlas expansion and glyph record packing off the main thread
- keep rendering synchronous once buffers are ready
- avoid blocking camera motion on workplane text edits

Helpful code and resources:

- local async boundaries:
  - `src/app.ts`
  - `src/text/layer.ts`
- worker/reference material:
  - https://maplibre.org/maplibre-native/docs/book/design/ten-thousand-foot-view.html
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/symbol_bucket.ts
- luma profiling reference:
  - https://luma.gl/docs/developer-guide/profiling

Do not own:

- `src/line/layer.ts`
- `src/projector.ts`

Small starter sketch:

```ts
export type TextWorkerRequest =
  | {type: 'pack-workplane-glyphs'; labels: LabelDefinition[]}
  | {type: 'expand-atlas'; characters: string[]};

export type TextWorkerResponse =
  | {type: 'glyph-pack-ready'; packed: ArrayBuffer}
  | {type: 'atlas-ready'; imageBitmap: ImageBitmap};

self.onmessage = async (event: MessageEvent<TextWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'pack-workplane-glyphs') {
    const packed = packGlyphInstances(request.labels);
    self.postMessage({type: 'glyph-pack-ready', packed: packed.buffer}, [packed.buffer]);
  }
};
```

### Slice F. Coarse Visibility And Cheap Observability

Primary files:

- `src/stage-snapshot.ts`
- `src/app.ts`
- new `src/render/workplane-visibility.ts`
- optional new `scripts/perf/report.ts`

Responsibilities:

- add workplane-level visibility masks and optional label-level coarse culling
- keep stats and benchmark output diff-based and cheap
- avoid turning observability into the next hot path

Helpful code and resources:

- local observability and view state:
  - `src/stage-snapshot.ts`
  - `src/app.ts`
  - `src/stack-view.ts`
- overlap and culling references:
  - https://idl.cs.washington.edu/files/2021-FastLabels-VIS.pdf
  - https://deck.gl/docs/api-reference/core/attribute-manager
- luma profiling reference:
  - https://luma.gl/docs/developer-guide/profiling

Do not own:

- `src/text/layer.ts` packed layout format
- `src/line/layer.ts` segment packing format

Small starter sketch:

```ts
export type WorkplaneVisibilityMask = Uint8Array;

export function buildWorkplaneVisibilityMask(
  workplanes: readonly {bounds: SceneBounds3D}[],
  projector: StageProjector,
  viewport: ViewportSize,
): WorkplaneVisibilityMask {
  const mask = new Uint8Array(workplanes.length);
  for (let i = 0; i < workplanes.length; i += 1) {
    mask[i] = intersectsViewport(workplanes[i].bounds, projector, viewport) ? 1 : 0;
  }
  return mask;
}
```

## Recommended Parallelization

Once the perf baseline exists, parallelize like this:

1. one agent on Slice B (`src/projector.ts` uniform seam)
2. one agent on Slice C (`src/text/*` GPU text rewrite)
3. one agent on Slice D (`src/line/*` GPU line rewrite)

Then land Slice E and Slice F after the new data flow is stable.

Rules for parallel agents:

- Slice B owns shared camera uniform types first
- Slice C and Slice D should consume that seam, not invent competing matrix formats
- `src/app.ts` should be touched last for final wiring and integration
- remove dead CPU projection helpers only after the GPU paths are green

## Helpful Code To Read First

If an agent is starting cold, these are the fastest high-value entry points in the current codebase:

- `src/projector.ts`
- `src/text/layer.ts`
- `src/line/layer.ts`
- `src/app.ts`
- `src/scene-space.ts`
- `src/stack-camera.ts`

If an agent is using external references, start with these:

- luma install and WebGPU adapter:
  - https://luma.gl/docs/developer-guide/installing/
  - https://luma.gl/docs/api-reference/webgpu/
- luma `Model` and `ShaderInputs`:
  - https://luma.gl/docs/api-reference/engine/model
  - https://luma.gl/docs/api-reference/engine/shader-inputs/
- luma profiling:
  - https://luma.gl/docs/developer-guide/profiling
- MapLibre symbol preparation:
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/symbol_bucket.ts
- MapLibre symbol draw path:
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/draw_symbol.ts
- deck.gl `TextLayer`:
  - https://deck.gl/docs/api-reference/layers/text-layer
- deck.gl `TextLayer` source:
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/text-layer.ts
- deck.gl atlas management:
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/font-atlas-manager.ts
- Valve SDF paper:
  - https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf

## Acceptance Criteria

The plan is successful when all of these are true:

- idle CPU frame time in both modes stays near the controller-only floor
- active `stack view` orbit cost is dominated by GPU work, not JS projection loops
- per-frame text CPU cost does not scale linearly with visible glyph count during camera motion
- per-frame line CPU cost does not scale linearly with visible link count during camera motion
- workplane switching and text edits still behave correctly in both `plane-focus view` and `stack view`
- `npm test` stays green throughout

## Non-Goals

- adding a second text strategy
- changing the domain language away from `plane-stack`, `workplane`, `plane-focus view`, and `stack view`
- redesigning the UX while doing renderer work
- adding arbitrary new label-placement behavior before the benchmark justifies it

## Sources

- MapLibre GL JS `SymbolBucket` pipeline:
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/data/bucket/symbol_bucket.ts
- MapLibre GL JS symbol draw path:
  - https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/draw_symbol.ts
- MapLibre GL JS custom layer redraw contract:
  - https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/
- MapLibre Style Spec glyphs:
  - https://maplibre.org/maplibre-style-spec/glyphs/
- MapLibre Native design notes on glyph atlas and worker/render split:
  - https://maplibre.org/maplibre-native/docs/book/design/ten-thousand-foot-view.html
- deck.gl TextLayer docs:
  - https://deck.gl/docs/api-reference/layers/text-layer
- deck.gl TextLayer source:
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/text-layer.ts
- deck.gl FontAtlasManager source:
  - https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/font-atlas-manager.ts
- deck.gl layer attributes guide:
  - https://deck.gl/docs/developer-guide/custom-layers/layer-attributes
- deck.gl AttributeManager:
  - https://deck.gl/docs/api-reference/core/attribute-manager
- Chris Green, Valve 2007:
  - https://steamcdn-a.akamaihd.net/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf
- Chlumský et al., 2018:
  - https://dcgi.fel.cvut.cz/en/publications/2018/sloup-cgf-msdf/
- Chanwutk et al., 2021:
  - https://idl.cs.washington.edu/files/2021-FastLabels-VIS.pdf

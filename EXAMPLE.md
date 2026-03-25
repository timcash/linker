# EXAMPLE

This file shows, at a high level, how to add more text rendering capabilities to this repo using only `luma.gl` and WebGPU.

These examples are intentionally:

- architectural, not drop-in
- aligned with the current repo structure
- focused on how to compose buffers, textures, shaders, and passes

Start with these local files:

- [src/text/types.ts](/Users/user/linker/src/text/types.ts)
- [src/text/atlas.ts](/Users/user/linker/src/text/atlas.ts)
- [src/text/layout.ts](/Users/user/linker/src/text/layout.ts)
- [src/text/layer.ts](/Users/user/linker/src/text/layer.ts)

Useful upstream references:

- `deck.gl` `TextLayer`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/text-layer.ts
- `deck.gl` `FontAtlasManager`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/font-atlas-manager.ts
- `deck.gl` `MultiIconLayer`
  https://github.com/visgl/deck.gl/blob/9.2-release/modules/layers/src/text-layer/multi-icon-layer/multi-icon-layer.ts
- `MapLibre` `glyph_manager`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/glyph_manager.ts
- `MapLibre` `glyph_atlas`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/glyph_atlas.ts
- `MapLibre` `shaping`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/shaping.ts
- `MapLibre` `draw_symbol`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/draw_symbol.ts
- `MapLibre` `symbol_program`
  https://github.com/maplibre/maplibre-gl-js/blob/main/src/render/program/symbol_program.ts

## Current Model

Today the repo already does this:

1. build a bitmap atlas with Canvas 2D
2. expand labels into glyph placements
3. upload atlas pixels as one GPU texture
4. draw glyph quads through one of several strategies

At a high level, the current structure looks like this:

```ts
const atlas = buildGlyphAtlas(getCharacterSetFromLabels(labels));
const layout = layoutLabels(labels, atlas);

const resources = {
  texture: new DynamicTexture(device, {
    data: {
      data: atlas.imageData,
      width: atlas.width,
      height: atlas.height,
      format: 'rgba8unorm',
    },
    format: 'rgba8unorm',
    width: atlas.width,
    height: atlas.height,
    mipmaps: false,
  }),
  layout,
  glyphRecordData: buildGlyphRecordData(layout.glyphs),
  chunkIndex: buildGlyphChunkIndex(layout.glyphs),
};

const strategy = createStrategy(mode, device, resources);
```

Everything below keeps that general shape, but swaps out how the atlas is built, how labels are placed, and how visible glyphs are submitted.

## Example 1: `sdf-instanced`

Goal:

- keep the current CPU visibility pass
- switch the atlas from bitmap alpha coverage to SDF alpha distance
- draw one instanced quad per visible glyph

This is the closest `deck.gl`-style upgrade.

### Step 1: add a strategy mode

```ts
// src/text/types.ts
export const TEXT_STRATEGIES = [
  'baseline',
  'instanced',
  'packed',
  'visible-index',
  'chunked',
  'sdf-instanced',
] as const;

export type AtlasMode = 'bitmap' | 'sdf';

export type GlyphAtlas = {
  mode: AtlasMode;
  width: number;
  height: number;
  imageData: Uint8ClampedArray;
  ascent: number;
  descent: number;
  lineHeight: number;
  padding: number;
  radius?: number;
  cutoff?: number;
  smoothing?: number;
  metrics: Map<string, GlyphMetric>;
};
```

### Step 2: split atlas building into bitmap and SDF variants

```ts
// src/text/atlas.ts
type BuildGlyphAtlasOptions = {
  mode: 'bitmap' | 'sdf';
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  padding?: number;
  radius?: number;
  cutoff?: number;
  smoothing?: number;
};

export function buildGlyphAtlas(
  characterSet: string[],
  options: BuildGlyphAtlasOptions,
): GlyphAtlas {
  if (options.mode === 'sdf') {
    return buildSdfGlyphAtlas(characterSet, options);
  }

  return buildBitmapGlyphAtlas(characterSet, options);
}

function buildSdfGlyphAtlas(
  characterSet: string[],
  options: BuildGlyphAtlasOptions,
): GlyphAtlas {
  const tinySdf = new TinySDF({
    fontSize: options.fontSize ?? 48,
    buffer: options.padding ?? 8,
    radius: options.radius ?? 12,
    cutoff: options.cutoff ?? 0.25,
    fontFamily: options.fontFamily ?? 'monospace',
    fontWeight: `${options.fontWeight ?? 600}`,
  });

  // 1. reserve atlas cells
  // 2. draw each glyph through tiny-sdf
  // 3. write the distance values into alpha
  // 4. store per-glyph width/height/advance/baseline offsets

  return {
    mode: 'sdf',
    width,
    height,
    imageData,
    ascent,
    descent,
    lineHeight,
    padding,
    radius: options.radius ?? 12,
    cutoff: options.cutoff ?? 0.25,
    smoothing: options.smoothing ?? 0.1,
    metrics,
  };
}
```

### Step 3: add an SDF shader

The key difference is the fragment shader. Instead of treating `texel.a` as direct coverage, treat it as a distance field and reconstruct coverage from a threshold.

```wgsl
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct SdfUniforms {
  viewportSize: vec2<f32>,
  radius: f32,
  smoothing: f32,
  cutoff: f32,
  outlineWidth: f32,
  padding: vec3<f32>,
  fillColor: vec4<f32>,
  outlineColor: vec4<f32>,
}

@group(0) @binding(2) var<uniform> sdf: SdfUniforms;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @location(2) instanceRect: vec4<f32>,
  @location(3) instanceUvRect: vec4<f32>,
  @location(4) instanceColor: vec4<f32>,
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
}

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / sdf.viewportSize.x) * 2.0 - 1.0,
    1.0 - (position.y / sdf.viewportSize.y) * 2.0,
  );
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  let screenPosition = inputs.instanceRect.xy + inputs.unitPosition * inputs.instanceRect.zw;
  outputs.clipPosition = vec4<f32>(screenToClip(screenPosition), 0.0, 1.0);
  outputs.uv = inputs.instanceUvRect.xy + inputs.unitUv * (inputs.instanceUvRect.zw - inputs.instanceUvRect.xy);
  outputs.color = inputs.instanceColor;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let distance = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv).a;
  let fillAlpha = smoothstep(
    sdf.cutoff - sdf.smoothing,
    sdf.cutoff + sdf.smoothing,
    distance,
  );

  if (fillAlpha < 0.001) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, fillAlpha * inputs.color.a);
}
```

### Step 4: implement the strategy

This can largely clone the current `InstancedTextStrategy` shape.

```ts
class SdfInstancedTextStrategy implements TextLayerStrategy {
  private readonly unitPositionBuffer;
  private readonly unitUvBuffer;
  private readonly sdfBuffer;
  private readonly model: Model;
  private rectBuffer;
  private uvRectBuffer;
  private colorBuffer;

  constructor(
    private readonly device: Device,
    private readonly resources: PreparedTextResources,
  ) {
    this.unitPositionBuffer = createStaticVertexBuffer(device, 'text-sdf-unit-pos', UNIT_QUAD_POSITIONS);
    this.unitUvBuffer = createStaticVertexBuffer(device, 'text-sdf-unit-uv', UNIT_QUAD_UVS);
    this.sdfBuffer = device.createBuffer({
      id: 'text-sdf-uniforms',
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: 64,
    });

    this.rectBuffer = createDynamicInstanceBuffer(device, 'text-sdf-rects', 1, 4);
    this.uvRectBuffer = createDynamicInstanceBuffer(device, 'text-sdf-uv-rects', 1, 4);
    this.colorBuffer = createDynamicInstanceBuffer(device, 'text-sdf-colors', 1, 4);

    this.model = new Model(device, {
      id: 'atlas-text-sdf-instanced',
      source: SDF_INSTANCED_TEXT_SHADER,
      geometry: this.createGeometry(),
      bindings: {
        glyphAtlas: resources.texture,
        sdf: this.sdfBuffer,
      },
      vertexCount: 4,
      instanceCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const visibility = analyzeGlyphVisibility(this.resources, camera, viewport, {
      collectVisibleGlyphs: true,
      collectVisibleGlyphIndices: false,
      useChunkedSearch: false,
    });

    const instances = buildVisibleGlyphInstances(visibility.visibleGlyphs);
    this.rectBuffer.write(instances.rects);
    this.uvRectBuffer.write(instances.uvRects);
    this.colorBuffer.write(instances.colors);
    this.sdfBuffer.write(buildSdfUniforms(viewport, this.resources.atlas));
    this.model.setInstanceCount(instances.instanceCount);
  }
}
```

## Example 2: `sdf-visible-index`

Goal:

- keep the SDF atlas
- keep all glyph records resident on the GPU
- upload only camera uniforms and visible glyph indices per frame

This is likely the cleanest next high-performance path for the current repo.

### Glyph record layout

```ts
type GlyphRecord = {
  anchorX: number;
  anchorY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  minZoom: number;
  maxZoom: number;
  colorR: number;
  colorG: number;
  colorB: number;
  colorA: number;
};

function buildGlyphRecordData(glyphs: GlyphPlacement[]): Float32Array {
  const values: number[] = [];

  for (const glyph of glyphs) {
    values.push(
      glyph.anchorX, glyph.anchorY, glyph.offsetX, glyph.offsetY,
      glyph.width, glyph.height, glyph.u0, glyph.v0,
      glyph.u1, glyph.v1, glyph.minZoom, glyph.maxZoom,
      ...glyph.color,
    );
  }

  return new Float32Array(values);
}
```

### Draw model

```ts
class SdfVisibleIndexTextStrategy implements TextLayerStrategy {
  private readonly cameraBuffer;
  private readonly sdfBuffer;
  private readonly glyphRecordBuffer;
  private readonly visibleIndexBuffer;
  private readonly model: Model;

  constructor(
    private readonly device: Device,
    private readonly resources: PreparedTextResources,
  ) {
    this.cameraBuffer = device.createBuffer({
      id: 'text-sdf-visible-index-camera',
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: 32,
    });

    this.sdfBuffer = device.createBuffer({
      id: 'text-sdf-visible-index-uniforms',
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: 64,
    });

    this.glyphRecordBuffer = device.createBuffer({
      id: 'text-sdf-visible-index-records',
      usage: Buffer.STORAGE,
      data: resources.glyphRecordData,
    });

    this.visibleIndexBuffer = device.createBuffer({
      id: 'text-sdf-visible-index-visible',
      usage: Buffer.STORAGE | Buffer.COPY_DST,
      byteLength: 4,
    });

    this.model = new Model(device, {
      id: 'text-sdf-visible-index',
      source: SDF_INDEXED_TEXT_SHADER,
      geometry: createUnitQuadGeometry(),
      bindings: {
        glyphAtlas: resources.texture,
        camera: this.cameraBuffer,
        sdf: this.sdfBuffer,
        glyphRecords: this.glyphRecordBuffer,
        visibleGlyphIndices: this.visibleIndexBuffer,
      },
      vertexCount: 4,
      instanceCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const visibility = analyzeGlyphVisibility(this.resources, camera, viewport, {
      collectVisibleGlyphs: false,
      collectVisibleGlyphIndices: true,
      useChunkedSearch: false,
    });

    const visibleIndices = new Uint32Array(visibility.visibleGlyphIndices);
    this.cameraBuffer.write(buildCameraUniforms(camera, viewport));
    this.sdfBuffer.write(buildSdfUniforms(viewport, this.resources.atlas));
    this.visibleIndexBuffer.write(visibleIndices);
    this.model.setInstanceCount(visibleIndices.length);
  }
}
```

### Indexed SDF shader shape

```wgsl
struct CameraUniforms {
  center: vec2<f32>,
  viewportSize: vec2<f32>,
  scale: f32,
  zoom: f32,
  padding: vec2<f32>,
}

struct GlyphRecord {
  anchorAndOffset: vec4<f32>,
  sizeAndUv0: vec4<f32>,
  uv1AndZoom: vec4<f32>,
  color: vec4<f32>,
}

@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;
@group(0) @binding(2) var<uniform> camera: CameraUniforms;
@group(0) @binding(3) var<uniform> sdf: SdfUniforms;
@group(0) @binding(4) var<storage, read> glyphRecords: array<GlyphRecord>;
@group(0) @binding(5) var<storage, read> visibleGlyphIndices: array<u32>;

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  let glyphIndex = visibleGlyphIndices[inputs.instanceIndex];
  let glyph = glyphRecords[glyphIndex];

  // same world-to-screen work as current visible-index path
  // same UV interpolation as current visible-index path
  // fragment shader uses SDF alpha reconstruction instead of bitmap alpha
}
```

## Example 3: `dynamic-atlas`

Goal:

- grow the atlas over time instead of assuming the full charset is known forever
- make atlas building look more like `deck.gl`'s `FontAtlasManager`

### Atlas manager shape

```ts
type FontSettings = {
  fontFamily: string;
  fontWeight: string | number;
  fontSize: number;
  padding: number;
  mode: 'bitmap' | 'sdf';
  radius?: number;
  cutoff?: number;
  smoothing?: number;
};

class GlyphAtlasManager {
  private currentAtlas: GlyphAtlas | null = null;
  private currentCharacterSet = new Set<string>();
  private cache = new Map<string, GlyphAtlas>();
  private version = 0;

  get atlas(): GlyphAtlas | null {
    return this.currentAtlas;
  }

  get atlasVersion(): number {
    return this.version;
  }

  update(characterSet: Iterable<string>, settings: FontSettings): boolean {
    const requestedSet = new Set(characterSet);
    const cacheKey = buildAtlasCacheKey(requestedSet, settings);
    const cachedAtlas = this.cache.get(cacheKey);

    if (cachedAtlas) {
      this.currentAtlas = cachedAtlas;
      this.currentCharacterSet = requestedSet;
      return false;
    }

    const needsRebuild = hasNewCharacters(requestedSet, this.currentCharacterSet) || !this.currentAtlas;
    if (!needsRebuild) {
      return false;
    }

    this.currentAtlas = buildGlyphAtlas([...requestedSet].sort(), settings);
    this.currentCharacterSet = requestedSet;
    this.cache.set(cacheKey, this.currentAtlas);
    this.version += 1;
    return true;
  }
}
```

### TextLayer orchestration

```ts
class TextLayer {
  private atlasManager = new GlyphAtlasManager();

  constructor(device: Device, labels: LabelDefinition[], mode: TextStrategy) {
    const characterSet = getCharacterSetFromLabels(labels);
    this.atlasManager.update(characterSet, {
      mode: 'sdf',
      fontFamily: 'monospace',
      fontWeight: 600,
      fontSize: 48,
      padding: 8,
      radius: 12,
      cutoff: 0.25,
      smoothing: 0.1,
    });

    const atlas = this.atlasManager.atlas!;
    const layout = layoutLabels(labels, atlas);
    this.resources = createPreparedTextResources(device, atlas, layout);
  }

  updateLabels(nextLabels: LabelDefinition[]): void {
    const didAtlasChange = this.atlasManager.update(
      getCharacterSetFromLabels(nextLabels),
      this.currentFontSettings,
    );

    if (didAtlasChange) {
      const atlas = this.atlasManager.atlas!;
      this.resources.texture.destroy();
      this.resources.texture = uploadAtlasTexture(this.device, atlas);
      this.resources.layout = layoutLabels(nextLabels, atlas);
      this.resources.glyphRecordData = buildGlyphRecordData(this.resources.layout.glyphs);
    }
  }
}
```

## Example 4: `symbol-lite`

Goal:

- move toward `MapLibre`-style shape-before-draw and place-before-draw behavior
- keep the repo deterministic and much simpler than full map-style symbol rendering

The core change is to stop treating layout as "expand each label into centered glyphs immediately." Instead:

1. shape a label
2. build one collision box for the shaped label
3. resolve placement
4. only then expand placed labels to glyph quads

### Add a shaped-label layer

```ts
type ShapedGlyph = {
  character: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

type ShapedLabel = {
  labelId: number;
  text: string;
  anchorX: number;
  anchorY: number;
  minZoom: number;
  maxZoom: number;
  width: number;
  height: number;
  glyphs: ShapedGlyph[];
};

function shapeLabels(labels: LabelDefinition[], atlas: GlyphAtlas): ShapedLabel[] {
  return labels.map((label, labelId) => {
    // 1. split into lines
    // 2. measure each line
    // 3. compute justified glyph offsets
    // 4. return one shaped label with many shaped glyphs
    return shapeSingleLabel(label, labelId, atlas);
  });
}
```

### Add a placement pass

```ts
type PlacedLabel = ShapedLabel & {
  placedAnchorX: number;
  placedAnchorY: number;
};

function placeLabels(
  shapedLabels: ShapedLabel[],
  camera: Camera2D,
  viewport: ViewportSize,
): PlacedLabel[] {
  const accepted: PlacedLabel[] = [];
  const occupied: ScreenRect[] = [];

  for (const label of shapedLabels) {
    const candidate = projectLabelToScreen(label, camera, viewport);

    if (candidate.screenBounds.right < 0 || candidate.screenBounds.left > viewport.width) {
      continue;
    }

    if (intersectsAny(candidate.screenBounds, occupied)) {
      continue;
    }

    occupied.push(candidate.screenBounds);
    accepted.push({
      ...label,
      placedAnchorX: label.anchorX,
      placedAnchorY: label.anchorY,
    });
  }

  return accepted;
}
```

### Expand placed labels into glyph placements

```ts
function expandPlacedLabelsToGlyphs(placedLabels: PlacedLabel[]): GlyphPlacement[] {
  const glyphs: GlyphPlacement[] = [];

  for (const label of placedLabels) {
    for (const glyph of label.glyphs) {
      glyphs.push({
        labelId: label.labelId,
        labelText: label.text,
        anchorX: label.placedAnchorX,
        anchorY: label.placedAnchorY,
        minZoom: label.minZoom,
        maxZoom: label.maxZoom,
        offsetX: glyph.offsetX,
        offsetY: glyph.offsetY,
        width: glyph.width,
        height: glyph.height,
        u0: glyph.u0,
        v0: glyph.v0,
        u1: glyph.u1,
        v1: glyph.v1,
        color: [1, 1, 1, 1],
      });
    }
  }

  return glyphs;
}
```

This lets the draw path stay mostly unchanged while the shaping and placement become more `MapLibre`-like.

## Example 5: `compute-visible-index`

Goal:

- stop building visible glyph indices on the CPU
- let a compute pass produce the visible index list

This is not from `deck.gl` or `MapLibre`. It is a natural WebGPU extension of the repo’s current `visible-index` path.

### Pass layout

```ts
function drawTextFrame(device: Device, camera: Camera2D, viewport: ViewportSize): void {
  updateCameraUniforms(camera, viewport);

  // pass 1
  runVisibilityComputePass({
    glyphRecordBuffer,
    cameraBuffer,
    visibleIndexCountBuffer,
    visibleIndexBuffer,
  });

  // optional pass 2
  // read back count or use indirect draw if stable

  // pass 3
  drawVisibleGlyphs({
    glyphAtlas,
    glyphRecordBuffer,
    visibleIndexBuffer,
    visibleIndexCountBuffer,
  });
}
```

### Compute shader shape

This shows the algorithm, not exact production WGSL.

```wgsl
struct CameraUniforms {
  center: vec2<f32>,
  viewportSize: vec2<f32>,
  scale: f32,
  zoom: f32,
  padding: vec2<f32>,
}

struct GlyphRecord {
  anchorAndOffset: vec4<f32>,
  sizeAndUv0: vec4<f32>,
  uv1AndZoom: vec4<f32>,
  color: vec4<f32>,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> glyphRecords: array<GlyphRecord>;
@group(0) @binding(2) var<storage, read_write> visibleCount: atomic<u32>;
@group(0) @binding(3) var<storage, read_write> visibleIndices: array<u32>;

@compute @workgroup_size(64)
fn computeMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= arrayLength(&glyphRecords)) {
    return;
  }

  let glyph = glyphRecords[index];
  let anchor = glyph.anchorAndOffset.xy;
  let offset = glyph.anchorAndOffset.zw;
  let size = glyph.sizeAndUv0.xy;
  let zoomRange = glyph.uv1AndZoom.zw;

  if (camera.zoom < zoomRange.x || camera.zoom > zoomRange.y) {
    return;
  }

  let anchorScreen = vec2<f32>(
    (anchor.x - camera.center.x) * camera.scale + camera.viewportSize.x * 0.5,
    (camera.center.y - anchor.y) * camera.scale + camera.viewportSize.y * 0.5,
  );

  let rectMin = anchorScreen + offset;
  let rectMax = rectMin + size;
  let visible =
    rectMax.x >= -8.0 &&
    rectMin.x <= camera.viewportSize.x + 8.0 &&
    rectMax.y >= -8.0 &&
    rectMin.y <= camera.viewportSize.y + 8.0;

  if (!visible) {
    return;
  }

  let outputIndex = atomicAdd(&visibleCount, 1u);
  visibleIndices[outputIndex] = index;
}
```

### luma.gl orchestration shape

```ts
class ComputeVisibleIndexTextStrategy implements TextLayerStrategy {
  update(camera: Camera2D, viewport: ViewportSize): void {
    this.cameraBuffer.write(buildCameraUniforms(camera, viewport));
    this.visibleCountBuffer.write(new Uint32Array([0]));

    const commandEncoder = this.device.createCommandEncoder();

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.visibilityPipeline);
    computePass.setBindings(this.visibilityBindings);
    computePass.dispatchWorkgroups(Math.ceil(this.glyphCount / 64));
    computePass.end();

    const renderPass = commandEncoder.beginRenderPass(this.renderPassProps);
    this.model.draw(renderPass);
    renderPass.end();

    this.device.submit(commandEncoder.finish());
  }
}
```

The exact `luma.gl` API surface for compute wiring may evolve with the version in use. The important part is the pass split:

- camera uniforms written first
- compute pass fills visible indices
- render pass consumes the visible indices

## Example 6: strategy wiring

At the repo level, every new mode should follow this pattern:

```ts
// src/text/layer.ts
private createStrategy(mode: TextStrategy): TextLayerStrategy {
  switch (mode) {
    case 'sdf-instanced':
      return new SdfInstancedTextStrategy(this.device, this.resources);
    case 'sdf-visible-index':
      return new SdfVisibleIndexTextStrategy(this.device, this.resources);
    case 'symbol-lite':
      return new SymbolLiteTextStrategy(this.device, this.resources);
    case 'compute-visible-index':
      return new ComputeVisibleIndexTextStrategy(this.device, this.resources);
    case 'instanced':
      return new InstancedTextStrategy(this.device, this.resources);
    case 'packed':
      return new PackedTextStrategy(this.device, this.resources);
    case 'visible-index':
      return new VisibleIndexTextStrategy(this.device, this.resources, 'visible-index', false);
    case 'chunked':
      return new VisibleIndexTextStrategy(this.device, this.resources, 'chunked', true);
    case 'baseline':
    default:
      return new BaselineTextStrategy(this.device, this.resources);
  }
}
```

## Example 7: test shape

Each new strategy should participate in the existing strategy loops in `scripts/test.ts`.

At a high level, keep the tests like this:

```ts
for (const textStrategy of getTextStrategies()) {
  await switchTextStrategy(page, textStrategy);

  const state = await readTextState(page);
  assert.equal(state.textStrategy, textStrategy);

  if (preservesPlacement(textStrategy)) {
    assert.equal(state.visibleLabelCount, baseline.visibleLabelCount);
    assert.equal(state.visibleGlyphCount, baseline.visibleGlyphCount);
  }

  if (textStrategy === 'symbol-lite') {
    assert.ok(state.visibleLabelCount <= baseline.visibleLabelCount);
  }

  if (textStrategy === 'compute-visible-index') {
    assert.equal(state.visibleGlyphCount, cpuVisibleIndex.visibleGlyphCount);
  }
}
```

For SDF-specific tests, add one zoomed-in screenshot check:

```ts
await switchTextStrategy(page, 'sdf-instanced');
await zoomTo(page, 3.5);
const signature = await getCanvasPixelSignature(page);
assert.ok(signature.alphaCoverage > 0, 'SDF text should produce visible pixels when zoomed in.');
```

## Practical Build Order

If implementing for real, do it in this order:

1. `sdf-instanced`
2. `sdf-visible-index`
3. `dynamic-atlas`
4. `symbol-lite`
5. `compute-visible-index`

That order keeps risk under control:

- first improve shader quality
- then improve submission efficiency
- then improve atlas lifecycle
- then improve placement behavior
- only then move visibility fully onto the GPU

## Summary

The essential mental model is:

```text
labels
-> charset
-> atlas
-> shape/layout
-> placement/visibility
-> glyph records
-> GPU buffers
-> render or compute+render passes
```

`deck.gl` is most useful for:

- atlas-backed glyph quad rendering
- SDF atlas generation
- luma.gl instanced draw structure

`MapLibre` is most useful for:

- shaping
- collision-aware placement
- variable anchors
- more advanced SDF text behavior

This repo can reproduce the useful parts of both systems without leaving `luma.gl` and WebGPU, as long as each capability is added as one deterministic layer at a time.

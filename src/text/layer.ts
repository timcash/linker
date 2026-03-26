import {Buffer, type Device} from '@luma.gl/core';
import {DynamicTexture, GPUGeometry, Model} from '@luma.gl/engine';

import {type Camera2D, type ViewportSize} from '../camera';
import {buildGlyphAtlas} from './atlas';
import {getCharacterSetFromLabels} from './charset';
import {layoutLabels} from './layout';
import {
  getMaxVisibleZoom,
  getMinVisibleZoom,
  getZoomScale,
  isZoomVisible,
  MIN_ZOOM_SCALE,
} from './zoom';
import type {
  GlyphAtlas,
  GlyphPlacement,
  LabelDefinition,
  TextLayerStats,
  TextLayout,
  TextStrategy,
} from './types';

const BASELINE_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct VertexInputs {
  @location(0) position: vec2<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) color: vec4<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  outputs.clipPosition = vec4<f32>(inputs.position, 0.0, 1.0);
  outputs.uv = inputs.uv;
  outputs.color = inputs.color;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let texel = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv);
  let alpha = texel.a * inputs.color.a;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const INSTANCED_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct FrameUniforms {
  viewportSize: vec2<f32>,
  padding: vec2<f32>,
}

@group(0) @binding(2) var<uniform> frame: FrameUniforms;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @location(2) instanceRect: vec4<f32>,
  @location(3) instanceUvRect: vec4<f32>,
  @location(4) instanceColor: vec4<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / frame.viewportSize.x) * 2.0 - 1.0,
    1.0 - (position.y / frame.viewportSize.y) * 2.0,
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
  let texel = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv);
  let alpha = texel.a * inputs.color.a;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const SDF_INSTANCED_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct FrameUniforms {
  viewportSize: vec2<f32>,
  padding: vec2<f32>,
}

struct SdfUniforms {
  cutoff: f32,
  smoothing: f32,
  padding: vec2<f32>,
}

@group(0) @binding(2) var<uniform> frame: FrameUniforms;
@group(0) @binding(3) var<uniform> sdf: SdfUniforms;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @location(2) instanceRect: vec4<f32>,
  @location(3) instanceUvRect: vec4<f32>,
  @location(4) instanceColor: vec4<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / frame.viewportSize.x) * 2.0 - 1.0,
    1.0 - (position.y / frame.viewportSize.y) * 2.0,
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
  let edgeWidth = sdf.smoothing;
  let alpha = smoothstep(sdf.cutoff - edgeWidth, sdf.cutoff + edgeWidth, distance) * inputs.color.a;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const PACKED_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct CameraUniforms {
  center: vec2<f32>,
  viewportSize: vec2<f32>,
  scale: f32,
  zoom: f32,
  padding: vec2<f32>,
}

@group(0) @binding(2) var<uniform> camera: CameraUniforms;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @location(2) instanceAnchor: vec2<f32>,
  @location(3) instanceRect: vec4<f32>,
  @location(4) instanceUvRect: vec4<f32>,
  @location(5) instanceColor: vec4<f32>,
  @location(6) instanceZoomStyle: vec2<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / camera.viewportSize.x) * 2.0 - 1.0,
    1.0 - (position.y / camera.viewportSize.y) * 2.0,
  );
}

fn isZoomVisible(zoom: f32, zoomStyle: vec2<f32>) -> bool {
  let zoomRange = max(zoomStyle.y, 0.0);
  return abs(zoom - zoomStyle.x) <= zoomRange;
}

fn getZoomScale(zoom: f32, zoomStyle: vec2<f32>) -> f32 {
  let zoomRange = max(zoomStyle.y, 0.0);

  if (zoomRange <= 0.0001) {
    return 1.0;
  }

  let emphasis = clamp(1.0 - abs(zoom - zoomStyle.x) / zoomRange, 0.0, 1.0);
  return ${MIN_ZOOM_SCALE} + (1.0 - ${MIN_ZOOM_SCALE}) * emphasis;
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  let anchorScreen = vec2<f32>(
    (inputs.instanceAnchor.x - camera.center.x) * camera.scale + camera.viewportSize.x * 0.5,
    (camera.center.y - inputs.instanceAnchor.y) * camera.scale + camera.viewportSize.y * 0.5,
  );
  let zoomScale = getZoomScale(camera.zoom, inputs.instanceZoomStyle);
  let scaledOffset = inputs.instanceRect.xy * zoomScale;
  let scaledSize = inputs.instanceRect.zw * zoomScale;
  let rectMin = anchorScreen + scaledOffset;
  let rectMax = rectMin + scaledSize;
  let zoomVisible = isZoomVisible(camera.zoom, inputs.instanceZoomStyle);
  let boundsVisible =
    rectMax.x >= -8.0 &&
    rectMin.x <= camera.viewportSize.x + 8.0 &&
    rectMax.y >= -8.0 &&
    rectMin.y <= camera.viewportSize.y + 8.0;
  let visible = zoomVisible && boundsVisible;
  var screenPosition = rectMin + inputs.unitPosition * scaledSize;

  if (!visible) {
    screenPosition = vec2<f32>(-4096.0, -4096.0);
  }

  outputs.clipPosition = vec4<f32>(screenToClip(screenPosition), 0.0, 1.0);
  outputs.uv = inputs.instanceUvRect.xy + inputs.unitUv * (inputs.instanceUvRect.zw - inputs.instanceUvRect.xy);
  outputs.color = select(vec4<f32>(0.0), inputs.instanceColor, visible);
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let texel = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv);
  let alpha = texel.a * inputs.color.a;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const INDEXED_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

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

@group(0) @binding(2) var<uniform> camera: CameraUniforms;
@group(0) @binding(3) var<storage, read> glyphRecords: array<GlyphRecord>;
@group(0) @binding(4) var<storage, read> visibleGlyphIndices: array<u32>;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @builtin(instance_index) instanceIndex: u32,
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / camera.viewportSize.x) * 2.0 - 1.0,
    1.0 - (position.y / camera.viewportSize.y) * 2.0,
  );
}

fn getZoomScale(zoom: f32, zoomStyle: vec2<f32>) -> f32 {
  let zoomRange = max(zoomStyle.y, 0.0);

  if (zoomRange <= 0.0001) {
    return 1.0;
  }

  let emphasis = clamp(1.0 - abs(zoom - zoomStyle.x) / zoomRange, 0.0, 1.0);
  return ${MIN_ZOOM_SCALE} + (1.0 - ${MIN_ZOOM_SCALE}) * emphasis;
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  let glyphIndex = visibleGlyphIndices[inputs.instanceIndex];
  let glyph = glyphRecords[glyphIndex];
  let anchor = glyph.anchorAndOffset.xy;
  let offset = glyph.anchorAndOffset.zw;
  let size = glyph.sizeAndUv0.xy;
  let uv0 = glyph.sizeAndUv0.zw;
  let uv1 = glyph.uv1AndZoom.xy;
  let zoomStyle = glyph.uv1AndZoom.zw;
  let zoomScale = getZoomScale(camera.zoom, zoomStyle);
  let anchorScreen = vec2<f32>(
    (anchor.x - camera.center.x) * camera.scale + camera.viewportSize.x * 0.5,
    (camera.center.y - anchor.y) * camera.scale + camera.viewportSize.y * 0.5,
  );
  let screenPosition = anchorScreen + offset * zoomScale + inputs.unitPosition * size * zoomScale;

  outputs.clipPosition = vec4<f32>(screenToClip(screenPosition), 0.0, 1.0);
  outputs.uv = uv0 + inputs.unitUv * (uv1 - uv0);
  outputs.color = glyph.color;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let texel = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv);
  let alpha = texel.a * inputs.color.a;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const SDF_INDEXED_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct CameraUniforms {
  center: vec2<f32>,
  viewportSize: vec2<f32>,
  scale: f32,
  zoom: f32,
  padding: vec2<f32>,
}

struct SdfUniforms {
  cutoff: f32,
  smoothing: f32,
  padding: vec2<f32>,
}

struct GlyphRecord {
  anchorAndOffset: vec4<f32>,
  sizeAndUv0: vec4<f32>,
  uv1AndZoom: vec4<f32>,
  color: vec4<f32>,
}

@group(0) @binding(2) var<uniform> camera: CameraUniforms;
@group(0) @binding(3) var<uniform> sdf: SdfUniforms;
@group(0) @binding(4) var<storage, read> glyphRecords: array<GlyphRecord>;
@group(0) @binding(5) var<storage, read> visibleGlyphIndices: array<u32>;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @builtin(instance_index) instanceIndex: u32,
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / camera.viewportSize.x) * 2.0 - 1.0,
    1.0 - (position.y / camera.viewportSize.y) * 2.0,
  );
}

fn getZoomScale(zoom: f32, zoomStyle: vec2<f32>) -> f32 {
  let zoomRange = max(zoomStyle.y, 0.0);

  if (zoomRange <= 0.0001) {
    return 1.0;
  }

  let emphasis = clamp(1.0 - abs(zoom - zoomStyle.x) / zoomRange, 0.0, 1.0);
  return ${MIN_ZOOM_SCALE} + (1.0 - ${MIN_ZOOM_SCALE}) * emphasis;
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  let glyphIndex = visibleGlyphIndices[inputs.instanceIndex];
  let glyph = glyphRecords[glyphIndex];
  let anchor = glyph.anchorAndOffset.xy;
  let offset = glyph.anchorAndOffset.zw;
  let size = glyph.sizeAndUv0.xy;
  let uv0 = glyph.sizeAndUv0.zw;
  let uv1 = glyph.uv1AndZoom.xy;
  let zoomStyle = glyph.uv1AndZoom.zw;
  let zoomScale = getZoomScale(camera.zoom, zoomStyle);
  let anchorScreen = vec2<f32>(
    (anchor.x - camera.center.x) * camera.scale + camera.viewportSize.x * 0.5,
    (camera.center.y - anchor.y) * camera.scale + camera.viewportSize.y * 0.5,
  );
  let screenPosition = anchorScreen + offset * zoomScale + inputs.unitPosition * size * zoomScale;

  outputs.clipPosition = vec4<f32>(screenToClip(screenPosition), 0.0, 1.0);
  outputs.uv = uv0 + inputs.unitUv * (uv1 - uv0);
  outputs.color = glyph.color;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let distance = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv).a;
  let edgeWidth = sdf.smoothing;
  let alpha = smoothstep(sdf.cutoff - edgeWidth, sdf.cutoff + edgeWidth, distance) * inputs.color.a;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const TEXT_BLEND_PARAMETERS = {
  depthWriteEnabled: false,
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;

const UNIT_QUAD_POSITIONS = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  1, 1,
]);

const UNIT_QUAD_UVS = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  1, 1,
]);

const CHUNK_WORLD_SIZE = 6;
const MAX_VISIBLE_LABEL_SAMPLE = 24;
const VIEWPORT_BOUNDS_PADDING = 8;
const VIEWPORT_UNIFORM_BYTES = 4 * Float32Array.BYTES_PER_ELEMENT;
const CAMERA_UNIFORM_BYTES = 8 * Float32Array.BYTES_PER_ELEMENT;
const SDF_UNIFORM_BYTES = 4 * Float32Array.BYTES_PER_ELEMENT;

type PreparedTextResources = {
  atlas: GlyphAtlas;
  chunkIndex: GlyphChunkIndex;
  glyphRecordData: Float32Array;
  layout: TextLayout;
  maxScreenExtentX: number;
  maxScreenExtentY: number;
  texture: DynamicTexture;
};

type PreparedTextResourceSet = {
  bitmap: PreparedTextResources;
  sdf: PreparedTextResources;
};

type GlyphChunk = {
  glyphIndices: Uint32Array;
  maxAnchorX: number;
  maxAnchorY: number;
  maxVisibleZoom: number;
  minAnchorX: number;
  minAnchorY: number;
  minVisibleZoom: number;
};

type GlyphChunkIndex = {
  chunks: GlyphChunk[];
};

type VisibleGlyph = GlyphPlacement & {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type GlyphVisibilityResult = {
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleGlyphIndices: number[];
  visibleGlyphs: VisibleGlyph[];
  visibleLabelCount: number;
  visibleLabels: string[];
};

type TextMesh = {
  colors: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
  vertexCount: number;
};

type VisibleGlyphInstances = {
  colors: Float32Array;
  instanceCount: number;
  rects: Float32Array;
  uvRects: Float32Array;
};

type PackedGlyphInstances = {
  anchors: Float32Array;
  colors: Float32Array;
  rects: Float32Array;
  uvRects: Float32Array;
  zoomStyles: Float32Array;
};

type TextLayerStrategy = {
  destroy: () => void;
  draw: (renderPass: Parameters<Model['draw']>[0]) => void;
  getStats: () => TextLayerStats;
  update: (camera: Camera2D, viewport: ViewportSize) => void;
};

export class TextLayer {
  private readonly resources: PreparedTextResourceSet;
  private mode: TextStrategy;
  private strategy: TextLayerStrategy;

  constructor(
    private readonly device: Device,
    labels: LabelDefinition[],
    mode: TextStrategy = 'baseline',
  ) {
    const characterSet = getCharacterSetFromLabels(labels);

    this.resources = {
      bitmap: createPreparedTextResources(
        device,
        labels,
        buildGlyphAtlas(characterSet, {mode: 'bitmap'}),
      ),
      sdf: createPreparedTextResources(
        device,
        labels,
        buildGlyphAtlas(characterSet, {mode: 'sdf'}),
      ),
    };
    this.mode = mode;
    this.strategy = this.createStrategy(mode);
  }

  get ready(): Promise<void> {
    return Promise.all([
      this.resources.bitmap.texture.ready,
      this.resources.sdf.texture.ready,
    ]).then(() => undefined);
  }

  destroy(): void {
    this.strategy.destroy();
    this.resources.bitmap.texture.destroy();
    this.resources.sdf.texture.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    this.strategy.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.strategy.getStats();
  }

  setMode(mode: TextStrategy): void {
    if (mode === this.mode) {
      return;
    }

    this.strategy.destroy();
    this.mode = mode;
    this.strategy = this.createStrategy(mode);
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    this.strategy.update(camera, viewport);
  }

  private createStrategy(mode: TextStrategy): TextLayerStrategy {
    switch (mode) {
      case 'instanced':
        return new InstancedTextStrategy(this.device, this.resources.bitmap, 'instanced');
      case 'sdf-instanced':
        return new InstancedTextStrategy(this.device, this.resources.sdf, 'sdf-instanced');
      case 'packed':
        return new PackedTextStrategy(this.device, this.resources.bitmap);
      case 'visible-index':
        return new VisibleIndexTextStrategy(
          this.device,
          this.resources.bitmap,
          'visible-index',
          false,
          false,
        );
      case 'chunked':
        return new VisibleIndexTextStrategy(
          this.device,
          this.resources.bitmap,
          'chunked',
          true,
          false,
        );
      case 'sdf-visible-index':
        return new VisibleIndexTextStrategy(
          this.device,
          this.resources.sdf,
          'sdf-visible-index',
          false,
          true,
        );
      case 'baseline':
      default:
        return new BaselineTextStrategy(this.device, this.resources.bitmap);
    }
  }
}

class BaselineTextStrategy implements TextLayerStrategy {
  private readonly model: Model;
  private positionBuffer;
  private uvBuffer;
  private colorBuffer;
  private capacity = 6;
  private stats: TextLayerStats;

  constructor(
    private readonly device: Device,
    private readonly resources: PreparedTextResources,
  ) {
    this.positionBuffer = device.createBuffer({
      id: 'text-positions-baseline',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.uvBuffer = device.createBuffer({
      id: 'text-uvs-baseline',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.colorBuffer = device.createBuffer({
      id: 'text-colors-baseline',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.model = new Model(device, {
      id: 'atlas-text-baseline',
      source: BASELINE_TEXT_SHADER,
      geometry: this.createGeometry(this.capacity),
      bindings: {
        glyphAtlas: this.resources.texture,
      },
      vertexCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
    this.stats = createEmptyTextLayerStats(this.resources.layout, 'baseline');
  }

  destroy(): void {
    this.model.destroy();
    this.positionBuffer.destroy();
    this.uvBuffer.destroy();
    this.colorBuffer.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.visibleGlyphCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.stats;
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const visibility = analyzeGlyphVisibility(this.resources, camera, viewport, {
      collectVisibleGlyphs: true,
      collectVisibleGlyphIndices: false,
      useChunkedSearch: false,
    });
    const mesh = buildTextMesh(visibility.visibleGlyphs, viewport);

    if (mesh.vertexCount > this.capacity) {
      this.capacity = mesh.vertexCount;
      this.positionBuffer.destroy();
      this.uvBuffer.destroy();
      this.colorBuffer.destroy();

      this.positionBuffer = this.device.createBuffer({
        id: 'text-positions-baseline',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.uvBuffer = this.device.createBuffer({
        id: 'text-uvs-baseline',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.colorBuffer = this.device.createBuffer({
        id: 'text-colors-baseline',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      });

      this.model.setGeometry(this.createGeometry(this.capacity));
    }

    if (mesh.vertexCount === 0) {
      this.model.setVertexCount(0);
      this.stats = createTextLayerStats(this.resources.layout, 'baseline', visibility, 0, 0, 0);
      return;
    }

    this.positionBuffer.write(mesh.positions);
    this.uvBuffer.write(mesh.uvs);
    this.colorBuffer.write(mesh.colors);
    this.model.setVertexCount(mesh.vertexCount);

    this.stats = createTextLayerStats(
      this.resources.layout,
      'baseline',
      visibility,
      mesh.positions.byteLength + mesh.uvs.byteLength + mesh.colors.byteLength,
      mesh.vertexCount,
      visibility.visibleGlyphCount,
    );
  }

  private createGeometry(vertexCount: number): GPUGeometry {
    return new GPUGeometry({
      topology: 'triangle-list',
      vertexCount,
      bufferLayout: [
        {name: 'position', format: 'float32x2'},
        {name: 'uv', format: 'float32x2'},
        {name: 'color', format: 'float32x4'},
      ],
      attributes: {
        position: this.positionBuffer,
        uv: this.uvBuffer,
        color: this.colorBuffer,
      },
    });
  }
}

class InstancedTextStrategy implements TextLayerStrategy {
  private readonly unitPositionBuffer;
  private readonly unitUvBuffer;
  private readonly viewportBuffer;
  private readonly sdfBuffer;
  private readonly model: Model;
  private readonly mode: 'instanced' | 'sdf-instanced';
  private rectBuffer;
  private uvRectBuffer;
  private colorBuffer;
  private capacity = 1;
  private stats: TextLayerStats;

  constructor(
    private readonly device: Device,
    private readonly resources: PreparedTextResources,
    mode: 'instanced' | 'sdf-instanced',
  ) {
    this.mode = mode;
    const usesSdf = mode === 'sdf-instanced';

    this.unitPositionBuffer = createStaticVertexBuffer(device, `text-${mode}-unit-positions`, UNIT_QUAD_POSITIONS);
    this.unitUvBuffer = createStaticVertexBuffer(device, `text-${mode}-unit-uvs`, UNIT_QUAD_UVS);
    this.viewportBuffer = device.createBuffer({
      id: `text-${mode}-frame`,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: VIEWPORT_UNIFORM_BYTES,
    });
    this.sdfBuffer = usesSdf
      ? device.createBuffer({
          id: `text-${mode}-sdf`,
          usage: Buffer.UNIFORM | Buffer.COPY_DST,
          byteLength: SDF_UNIFORM_BYTES,
        })
      : undefined;
    this.rectBuffer = device.createBuffer({
      id: `text-${mode}-rects`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.uvRectBuffer = device.createBuffer({
      id: `text-${mode}-uv-rects`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.colorBuffer = device.createBuffer({
      id: `text-${mode}-colors`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
    });
    const bindings: Record<string, DynamicTexture | Buffer> = {
      glyphAtlas: this.resources.texture,
      frame: this.viewportBuffer,
    };

    if (this.sdfBuffer) {
      bindings.sdf = this.sdfBuffer;
    }

    this.model = new Model(device, {
      id: `atlas-text-${mode}`,
      source: usesSdf ? SDF_INSTANCED_TEXT_SHADER : INSTANCED_TEXT_SHADER,
      geometry: this.createGeometry(),
      bindings,
      vertexCount: 4,
      instanceCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
    this.stats = createEmptyTextLayerStats(this.resources.layout, mode);
  }

  destroy(): void {
    this.model.destroy();
    this.unitPositionBuffer.destroy();
    this.unitUvBuffer.destroy();
    this.viewportBuffer.destroy();
    this.sdfBuffer?.destroy();
    this.rectBuffer.destroy();
    this.uvRectBuffer.destroy();
    this.colorBuffer.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.visibleGlyphCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.stats;
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const visibility = analyzeGlyphVisibility(this.resources, camera, viewport, {
      collectVisibleGlyphs: true,
      collectVisibleGlyphIndices: false,
      useChunkedSearch: false,
    });
    const instances = buildVisibleGlyphInstances(visibility.visibleGlyphs);

    if (instances.instanceCount > this.capacity) {
      this.capacity = instances.instanceCount;
      this.rectBuffer.destroy();
      this.uvRectBuffer.destroy();
      this.colorBuffer.destroy();

      this.rectBuffer = this.device.createBuffer({
        id: `text-${this.mode}-rects`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.uvRectBuffer = this.device.createBuffer({
        id: `text-${this.mode}-uv-rects`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.colorBuffer = this.device.createBuffer({
        id: `text-${this.mode}-colors`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      });
      // Swap only the resized instance buffers. Rebuilding the geometry would destroy
      // the shared unit quad buffers that this strategy keeps for its full lifetime.
      this.model.setAttributes({
        instanceColor: this.colorBuffer,
        instanceRect: this.rectBuffer,
        instanceUvRect: this.uvRectBuffer,
      });
    }

    if (instances.instanceCount === 0) {
      this.model.setInstanceCount(0);
      this.stats = createTextLayerStats(this.resources.layout, this.mode, visibility, 0, 0, 0);
      return;
    }

    this.viewportBuffer.write(new Float32Array([viewport.width, viewport.height, 0, 0]));
    this.sdfBuffer?.write(buildSdfUniformData(this.resources.atlas));
    this.rectBuffer.write(instances.rects);
    this.uvRectBuffer.write(instances.uvRects);
    this.colorBuffer.write(instances.colors);
    this.model.setInstanceCount(instances.instanceCount);

    this.stats = createTextLayerStats(
      this.resources.layout,
      this.mode,
      visibility,
      VIEWPORT_UNIFORM_BYTES +
        (this.sdfBuffer ? SDF_UNIFORM_BYTES : 0) +
        instances.rects.byteLength +
        instances.uvRects.byteLength +
        instances.colors.byteLength,
      instances.instanceCount * 4,
      instances.instanceCount,
    );
  }

  private createGeometry(): GPUGeometry {
    return new GPUGeometry({
      topology: 'triangle-strip',
      vertexCount: 4,
      bufferLayout: [
        {name: 'unitPosition', format: 'float32x2'},
        {name: 'unitUv', format: 'float32x2'},
        {name: 'instanceRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceUvRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceColor', format: 'float32x4', stepMode: 'instance'},
      ],
      attributes: {
        unitPosition: this.unitPositionBuffer,
        unitUv: this.unitUvBuffer,
        instanceRect: this.rectBuffer,
        instanceUvRect: this.uvRectBuffer,
        instanceColor: this.colorBuffer,
      },
    });
  }
}

class PackedTextStrategy implements TextLayerStrategy {
  private readonly unitPositionBuffer;
  private readonly unitUvBuffer;
  private readonly anchorBuffer;
  private readonly rectBuffer;
  private readonly uvRectBuffer;
  private readonly colorBuffer;
  private readonly zoomStyleBuffer;
  private readonly cameraBuffer;
  private readonly model: Model;
  private stats: TextLayerStats;

  constructor(
    device: Device,
    private readonly resources: PreparedTextResources,
  ) {
    const instances = buildPackedGlyphInstances(this.resources.layout.glyphs);

    this.unitPositionBuffer = createStaticVertexBuffer(device, 'text-packed-unit-positions', UNIT_QUAD_POSITIONS);
    this.unitUvBuffer = createStaticVertexBuffer(device, 'text-packed-unit-uvs', UNIT_QUAD_UVS);
    this.anchorBuffer = createStaticVertexBuffer(device, 'text-packed-anchors', instances.anchors);
    this.rectBuffer = createStaticVertexBuffer(device, 'text-packed-rects', instances.rects);
    this.uvRectBuffer = createStaticVertexBuffer(device, 'text-packed-uv-rects', instances.uvRects);
    this.colorBuffer = createStaticVertexBuffer(device, 'text-packed-colors', instances.colors);
    this.zoomStyleBuffer = createStaticVertexBuffer(device, 'text-packed-zoom-styles', instances.zoomStyles);
    this.cameraBuffer = device.createBuffer({
      id: 'text-packed-camera',
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: CAMERA_UNIFORM_BYTES,
    });
    this.model = new Model(device, {
      id: 'atlas-text-packed',
      source: PACKED_TEXT_SHADER,
      geometry: this.createGeometry(),
      bindings: {
        glyphAtlas: this.resources.texture,
        camera: this.cameraBuffer,
      },
      vertexCount: 4,
      instanceCount: this.resources.layout.glyphCount,
      parameters: TEXT_BLEND_PARAMETERS,
    });
    this.stats = createEmptyTextLayerStats(this.resources.layout, 'packed');
  }

  destroy(): void {
    this.model.destroy();
    this.unitPositionBuffer.destroy();
    this.unitUvBuffer.destroy();
    this.anchorBuffer.destroy();
    this.rectBuffer.destroy();
    this.uvRectBuffer.destroy();
    this.colorBuffer.destroy();
    this.zoomStyleBuffer.destroy();
    this.cameraBuffer.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.visibleGlyphCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.stats;
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const visibility = analyzeGlyphVisibility(this.resources, camera, viewport, {
      collectVisibleGlyphs: false,
      collectVisibleGlyphIndices: false,
      useChunkedSearch: false,
    });

    if (visibility.visibleGlyphCount === 0) {
      this.stats = createTextLayerStats(this.resources.layout, 'packed', visibility, 0, 0, 0);
      return;
    }

    this.cameraBuffer.write(new Float32Array([
      camera.centerX,
      camera.centerY,
      viewport.width,
      viewport.height,
      camera.pixelsPerWorldUnit,
      camera.zoom,
      0,
      0,
    ]));

    this.stats = createTextLayerStats(
      this.resources.layout,
      'packed',
      visibility,
      CAMERA_UNIFORM_BYTES,
      this.resources.layout.glyphCount * 4,
      this.resources.layout.glyphCount,
    );
  }

  private createGeometry(): GPUGeometry {
    return new GPUGeometry({
      topology: 'triangle-strip',
      vertexCount: 4,
      bufferLayout: [
        {name: 'unitPosition', format: 'float32x2'},
        {name: 'unitUv', format: 'float32x2'},
        {name: 'instanceAnchor', format: 'float32x2', stepMode: 'instance'},
        {name: 'instanceRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceUvRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceColor', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceZoomStyle', format: 'float32x2', stepMode: 'instance'},
      ],
      attributes: {
        unitPosition: this.unitPositionBuffer,
        unitUv: this.unitUvBuffer,
        instanceAnchor: this.anchorBuffer,
        instanceRect: this.rectBuffer,
        instanceUvRect: this.uvRectBuffer,
        instanceColor: this.colorBuffer,
        instanceZoomStyle: this.zoomStyleBuffer,
      },
    });
  }
}

class VisibleIndexTextStrategy implements TextLayerStrategy {
  private readonly cameraBuffer;
  private readonly sdfBuffer;
  private readonly glyphRecordBuffer;
  private readonly model: Model;
  private readonly unitPositionBuffer;
  private readonly unitUvBuffer;
  private visibleIndexBuffer;
  private capacity = 1;
  private stats: TextLayerStats;

  constructor(
    private readonly device: Device,
    private readonly resources: PreparedTextResources,
    private readonly mode: 'visible-index' | 'chunked' | 'sdf-visible-index',
    private readonly useChunkedSearch: boolean,
    useSdf: boolean,
  ) {
    this.unitPositionBuffer = createStaticVertexBuffer(device, `text-${mode}-unit-positions`, UNIT_QUAD_POSITIONS);
    this.unitUvBuffer = createStaticVertexBuffer(device, `text-${mode}-unit-uvs`, UNIT_QUAD_UVS);
    this.cameraBuffer = device.createBuffer({
      id: `text-${mode}-camera`,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: CAMERA_UNIFORM_BYTES,
    });
    this.sdfBuffer = useSdf
      ? device.createBuffer({
          id: `text-${mode}-sdf`,
          usage: Buffer.UNIFORM | Buffer.COPY_DST,
          byteLength: SDF_UNIFORM_BYTES,
        })
      : undefined;
    this.glyphRecordBuffer = device.createBuffer({
      id: `text-${mode}-glyph-records`,
      usage: Buffer.STORAGE,
      data: this.resources.glyphRecordData,
    });
    this.visibleIndexBuffer = device.createBuffer({
      id: `text-${mode}-visible-indices`,
      usage: Buffer.STORAGE | Buffer.COPY_DST,
      byteLength: this.capacity * Uint32Array.BYTES_PER_ELEMENT,
    });
    this.model = new Model(device, {
      id: `atlas-text-${mode}`,
      source: useSdf ? SDF_INDEXED_TEXT_SHADER : INDEXED_TEXT_SHADER,
      geometry: this.createGeometry(),
      bindings: this.createBindings(),
      vertexCount: 4,
      instanceCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
    this.stats = createEmptyTextLayerStats(this.resources.layout, mode);
  }

  destroy(): void {
    this.model.destroy();
    this.unitPositionBuffer.destroy();
    this.unitUvBuffer.destroy();
    this.cameraBuffer.destroy();
    this.sdfBuffer?.destroy();
    this.glyphRecordBuffer.destroy();
    this.visibleIndexBuffer.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.visibleGlyphCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.stats;
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const visibility = analyzeGlyphVisibility(this.resources, camera, viewport, {
      collectVisibleGlyphs: false,
      collectVisibleGlyphIndices: true,
      useChunkedSearch: this.useChunkedSearch,
    });
    const visibleIndices = new Uint32Array(visibility.visibleGlyphIndices);

    if (visibleIndices.length > this.capacity) {
      this.capacity = visibleIndices.length;
      this.visibleIndexBuffer.destroy();
      this.visibleIndexBuffer = this.device.createBuffer({
        id: `text-${this.mode}-visible-indices`,
        usage: Buffer.STORAGE | Buffer.COPY_DST,
        byteLength: this.capacity * Uint32Array.BYTES_PER_ELEMENT,
      });
      this.model.setBindings(this.createBindings());
    }

    if (visibleIndices.length === 0) {
      this.model.setInstanceCount(0);
      this.stats = createTextLayerStats(this.resources.layout, this.mode, visibility, 0, 0, 0);
      return;
    }

    this.cameraBuffer.write(new Float32Array([
      camera.centerX,
      camera.centerY,
      viewport.width,
      viewport.height,
      camera.pixelsPerWorldUnit,
      camera.zoom,
      0,
      0,
    ]));
    this.sdfBuffer?.write(buildSdfUniformData(this.resources.atlas));
    this.visibleIndexBuffer.write(visibleIndices);
    this.model.setInstanceCount(visibleIndices.length);

    this.stats = createTextLayerStats(
      this.resources.layout,
      this.mode,
      visibility,
      CAMERA_UNIFORM_BYTES + (this.sdfBuffer ? SDF_UNIFORM_BYTES : 0) + visibleIndices.byteLength,
      visibleIndices.length * 4,
      visibleIndices.length,
    );
  }

  private createBindings(): Record<string, DynamicTexture | Buffer> {
    const bindings: Record<string, DynamicTexture | Buffer> = {
      glyphAtlas: this.resources.texture,
      camera: this.cameraBuffer,
      glyphRecords: this.glyphRecordBuffer,
      visibleGlyphIndices: this.visibleIndexBuffer,
    };

    if (this.sdfBuffer) {
      bindings.sdf = this.sdfBuffer;
    }

    return bindings;
  }

  private createGeometry(): GPUGeometry {
    return new GPUGeometry({
      topology: 'triangle-strip',
      vertexCount: 4,
      bufferLayout: [
        {name: 'unitPosition', format: 'float32x2'},
        {name: 'unitUv', format: 'float32x2'},
      ],
      attributes: {
        unitPosition: this.unitPositionBuffer,
        unitUv: this.unitUvBuffer,
      },
    });
  }
}

type VisibilityOptions = {
  collectVisibleGlyphIndices: boolean;
  collectVisibleGlyphs: boolean;
  useChunkedSearch: boolean;
};

function createPreparedTextResources(
  device: Device,
  labels: LabelDefinition[],
  atlas: GlyphAtlas,
): PreparedTextResources {
  const layout = layoutLabels(labels, atlas);

  return {
    atlas,
    chunkIndex: buildGlyphChunkIndex(layout.glyphs),
    glyphRecordData: buildGlyphRecordData(layout.glyphs),
    layout,
    maxScreenExtentX: getMaxScreenExtent(layout.glyphs, 'x'),
    maxScreenExtentY: getMaxScreenExtent(layout.glyphs, 'y'),
    texture: new DynamicTexture(device, {
      id: `text-atlas-${atlas.mode}`,
      data: {
        data: atlas.imageData,
        width: atlas.width,
        height: atlas.height,
        format: 'rgba8unorm',
      },
      format: 'rgba8unorm',
      height: atlas.height,
      mipmaps: false,
      width: atlas.width,
    }),
  };
}

function analyzeGlyphVisibility(
  resources: PreparedTextResources,
  camera: Camera2D,
  viewport: ViewportSize,
  options: VisibilityOptions,
): GlyphVisibilityResult {
  const {glyphs} = resources.layout;
  const visibleGlyphIndices: number[] = [];
  const visibleGlyphs: VisibleGlyph[] = [];
  const visibleLabelIds = new Set<number>();
  const visibleLabels: string[] = [];
  let visibleChunkCount = 0;
  let visibleGlyphCount = 0;

  if (options.useChunkedSearch) {
    const expandedBounds = getExpandedWorldBounds(resources, camera, viewport);

    for (const chunk of resources.chunkIndex.chunks) {
      if (camera.zoom < chunk.minVisibleZoom || camera.zoom > chunk.maxVisibleZoom) {
        continue;
      }

      if (
        chunk.maxAnchorX < expandedBounds.minX ||
        chunk.minAnchorX > expandedBounds.maxX ||
        chunk.maxAnchorY < expandedBounds.minY ||
        chunk.minAnchorY > expandedBounds.maxY
      ) {
        continue;
      }

      visibleChunkCount += 1;

      for (const glyphIndex of chunk.glyphIndices) {
        const visibility = inspectGlyph(glyphs[glyphIndex], camera, viewport);

        if (!visibility) {
          continue;
        }

        visibleGlyphCount += 1;
        recordVisibleLabel(glyphs[glyphIndex], visibleLabelIds, visibleLabels);

        if (options.collectVisibleGlyphIndices) {
          visibleGlyphIndices.push(glyphIndex);
        }

        if (options.collectVisibleGlyphs) {
          visibleGlyphs.push(visibility);
        }
      }
    }
  } else {
    for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
      const glyph = glyphs[glyphIndex];
      const visibility = inspectGlyph(glyph, camera, viewport);

      if (!visibility) {
        continue;
      }

      visibleGlyphCount += 1;
      recordVisibleLabel(glyph, visibleLabelIds, visibleLabels);

      if (options.collectVisibleGlyphIndices) {
        visibleGlyphIndices.push(glyphIndex);
      }

      if (options.collectVisibleGlyphs) {
        visibleGlyphs.push(visibility);
      }
    }
  }

  return {
    visibleChunkCount,
    visibleGlyphCount,
    visibleGlyphIndices,
    visibleGlyphs,
    visibleLabelCount: visibleLabelIds.size,
    visibleLabels,
  };
}

function buildGlyphChunkIndex(glyphs: GlyphPlacement[]): GlyphChunkIndex {
  const chunkMap = new Map<string, {
    glyphIndices: number[];
    maxAnchorX: number;
    maxAnchorY: number;
    maxVisibleZoom: number;
    minAnchorX: number;
    minAnchorY: number;
    minVisibleZoom: number;
  }>();

  for (let glyphIndex = 0; glyphIndex < glyphs.length; glyphIndex += 1) {
    const glyph = glyphs[glyphIndex];
    const chunkX = Math.floor(glyph.anchorX / CHUNK_WORLD_SIZE);
    const chunkY = Math.floor(glyph.anchorY / CHUNK_WORLD_SIZE);
    const chunkKey = `${chunkX}:${chunkY}`;
    const existingChunk = chunkMap.get(chunkKey);

    if (existingChunk) {
      existingChunk.glyphIndices.push(glyphIndex);
      existingChunk.minAnchorX = Math.min(existingChunk.minAnchorX, glyph.anchorX);
      existingChunk.maxAnchorX = Math.max(existingChunk.maxAnchorX, glyph.anchorX);
      existingChunk.minAnchorY = Math.min(existingChunk.minAnchorY, glyph.anchorY);
      existingChunk.maxAnchorY = Math.max(existingChunk.maxAnchorY, glyph.anchorY);
      existingChunk.minVisibleZoom = Math.min(
        existingChunk.minVisibleZoom,
        getMinVisibleZoom(glyph.zoomLevel, glyph.zoomRange),
      );
      existingChunk.maxVisibleZoom = Math.max(
        existingChunk.maxVisibleZoom,
        getMaxVisibleZoom(glyph.zoomLevel, glyph.zoomRange),
      );
      continue;
    }

    chunkMap.set(chunkKey, {
      glyphIndices: [glyphIndex],
      maxAnchorX: glyph.anchorX,
      maxAnchorY: glyph.anchorY,
      maxVisibleZoom: getMaxVisibleZoom(glyph.zoomLevel, glyph.zoomRange),
      minAnchorX: glyph.anchorX,
      minAnchorY: glyph.anchorY,
      minVisibleZoom: getMinVisibleZoom(glyph.zoomLevel, glyph.zoomRange),
    });
  }

  return {
    chunks: [...chunkMap.values()].map((chunk) => ({
      glyphIndices: new Uint32Array(chunk.glyphIndices),
      maxAnchorX: chunk.maxAnchorX,
      maxAnchorY: chunk.maxAnchorY,
      maxVisibleZoom: chunk.maxVisibleZoom,
      minAnchorX: chunk.minAnchorX,
      minAnchorY: chunk.minAnchorY,
      minVisibleZoom: chunk.minVisibleZoom,
    })),
  };
}

function buildGlyphRecordData(glyphs: GlyphPlacement[]): Float32Array {
  const recordData: number[] = [];

  for (const glyph of glyphs) {
    recordData.push(
      glyph.anchorX, glyph.anchorY, glyph.offsetX, glyph.offsetY,
      glyph.width, glyph.height, glyph.u0, glyph.v0,
      glyph.u1, glyph.v1, glyph.zoomLevel, glyph.zoomRange,
      ...glyph.color,
    );
  }

  return new Float32Array(recordData);
}

function buildTextMesh(visibleGlyphs: VisibleGlyph[], viewport: ViewportSize): TextMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];

  for (const glyph of visibleGlyphs) {
    const topLeft = screenToClip(glyph.left, glyph.top, viewport);
    const topRight = screenToClip(glyph.right, glyph.top, viewport);
    const bottomLeft = screenToClip(glyph.left, glyph.bottom, viewport);
    const bottomRight = screenToClip(glyph.right, glyph.bottom, viewport);

    positions.push(
      topLeft.x, topLeft.y,
      bottomLeft.x, bottomLeft.y,
      topRight.x, topRight.y,
      topRight.x, topRight.y,
      bottomLeft.x, bottomLeft.y,
      bottomRight.x, bottomRight.y,
    );

    uvs.push(
      glyph.u0, glyph.v0,
      glyph.u0, glyph.v1,
      glyph.u1, glyph.v0,
      glyph.u1, glyph.v0,
      glyph.u0, glyph.v1,
      glyph.u1, glyph.v1,
    );

    for (let vertex = 0; vertex < 6; vertex += 1) {
      colors.push(...glyph.color);
    }
  }

  return {
    colors: new Float32Array(colors),
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    vertexCount: positions.length / 2,
  };
}

function buildVisibleGlyphInstances(visibleGlyphs: VisibleGlyph[]): VisibleGlyphInstances {
  const rects: number[] = [];
  const uvRects: number[] = [];
  const colors: number[] = [];

  for (const glyph of visibleGlyphs) {
    rects.push(glyph.left, glyph.top, glyph.width, glyph.height);
    uvRects.push(glyph.u0, glyph.v0, glyph.u1, glyph.v1);
    colors.push(...glyph.color);
  }

  return {
    colors: new Float32Array(colors),
    instanceCount: visibleGlyphs.length,
    rects: new Float32Array(rects),
    uvRects: new Float32Array(uvRects),
  };
}

function buildPackedGlyphInstances(glyphs: GlyphPlacement[]): PackedGlyphInstances {
  const anchors: number[] = [];
  const rects: number[] = [];
  const uvRects: number[] = [];
  const colors: number[] = [];
  const zoomStyles: number[] = [];

  for (const glyph of glyphs) {
    anchors.push(glyph.anchorX, glyph.anchorY);
    rects.push(glyph.offsetX, glyph.offsetY, glyph.width, glyph.height);
    uvRects.push(glyph.u0, glyph.v0, glyph.u1, glyph.v1);
    colors.push(...glyph.color);
    zoomStyles.push(glyph.zoomLevel, glyph.zoomRange);
  }

  return {
    anchors: new Float32Array(anchors),
    colors: new Float32Array(colors),
    rects: new Float32Array(rects),
    uvRects: new Float32Array(uvRects),
    zoomStyles: new Float32Array(zoomStyles),
  };
}

function createEmptyTextLayerStats(
  layout: TextLayout,
  textStrategy: TextStrategy,
): TextLayerStats {
  return {
    bytesUploadedPerFrame: 0,
    glyphCount: layout.glyphCount,
    labelCount: layout.labelCount,
    textStrategy,
    submittedGlyphCount: 0,
    submittedVertexCount: 0,
    visibleChunkCount: 0,
    visibleGlyphCount: 0,
    visibleLabelCount: 0,
    visibleLabels: [],
  };
}

function createStaticVertexBuffer(
  device: Device,
  id: string,
  data: Float32Array,
) {
  return device.createBuffer({
    id,
    usage: Buffer.VERTEX,
    data,
  });
}

function buildSdfUniformData(atlas: GlyphAtlas): Float32Array {
  return new Float32Array([
    atlas.cutoff ?? 0.5,
    atlas.smoothing ?? 0.08,
    0,
    0,
  ]);
}

function createTextLayerStats(
  layout: TextLayout,
  textStrategy: TextStrategy,
  visibility: GlyphVisibilityResult,
  bytesUploadedPerFrame: number,
  submittedVertexCount: number,
  submittedGlyphCount: number,
): TextLayerStats {
  return {
    bytesUploadedPerFrame,
    glyphCount: layout.glyphCount,
    labelCount: layout.labelCount,
    textStrategy,
    submittedGlyphCount,
    submittedVertexCount,
    visibleChunkCount: visibility.visibleChunkCount,
    visibleGlyphCount: visibility.visibleGlyphCount,
    visibleLabelCount: visibility.visibleLabelCount,
    visibleLabels: visibility.visibleLabels,
  };
}

function getExpandedWorldBounds(
  resources: PreparedTextResources,
  camera: Camera2D,
  viewport: ViewportSize,
): {maxX: number; maxY: number; minX: number; minY: number} {
  const visibleBounds = camera.getVisibleWorldBounds(viewport);
  const paddingX = (resources.maxScreenExtentX + VIEWPORT_BOUNDS_PADDING) / camera.pixelsPerWorldUnit;
  const paddingY = (resources.maxScreenExtentY + VIEWPORT_BOUNDS_PADDING) / camera.pixelsPerWorldUnit;

  return {
    maxX: visibleBounds.maxX + paddingX,
    maxY: visibleBounds.maxY + paddingY,
    minX: visibleBounds.minX - paddingX,
    minY: visibleBounds.minY - paddingY,
  };
}

function getMaxScreenExtent(
  glyphs: GlyphPlacement[],
  axis: 'x' | 'y',
): number {
  let maxExtent = 0;

  for (const glyph of glyphs) {
    if (axis === 'x') {
      maxExtent = Math.max(maxExtent, Math.abs(glyph.offsetX), Math.abs(glyph.offsetX + glyph.width));
    } else {
      maxExtent = Math.max(maxExtent, Math.abs(glyph.offsetY), Math.abs(glyph.offsetY + glyph.height));
    }
  }

  return maxExtent;
}

function inspectGlyph(
  glyph: GlyphPlacement,
  camera: Camera2D,
  viewport: ViewportSize,
): VisibleGlyph | null {
  if (!isZoomVisible(camera.zoom, glyph.zoomLevel, glyph.zoomRange)) {
    return null;
  }

  const zoomScale = getZoomScale(camera.zoom, glyph.zoomLevel, glyph.zoomRange);
  const anchor = camera.worldToScreen({x: glyph.anchorX, y: glyph.anchorY}, viewport);
  const width = glyph.width * zoomScale;
  const height = glyph.height * zoomScale;
  const left = anchor.x + glyph.offsetX * zoomScale;
  const top = anchor.y + glyph.offsetY * zoomScale;
  const right = left + width;
  const bottom = top + height;

  if (
    right < -VIEWPORT_BOUNDS_PADDING ||
    left > viewport.width + VIEWPORT_BOUNDS_PADDING ||
    bottom < -VIEWPORT_BOUNDS_PADDING ||
    top > viewport.height + VIEWPORT_BOUNDS_PADDING
  ) {
    return null;
  }

  return {
    ...glyph,
    bottom,
    height,
    left,
    right,
    top,
    width,
  };
}

function recordVisibleLabel(
  glyph: GlyphPlacement,
  visibleLabelIds: Set<number>,
  visibleLabels: string[],
): void {
  if (visibleLabelIds.has(glyph.labelId)) {
    return;
  }

  visibleLabelIds.add(glyph.labelId);

  if (visibleLabels.length < MAX_VISIBLE_LABEL_SAMPLE) {
    visibleLabels.push(glyph.labelText);
  }
}

function screenToClip(x: number, y: number, viewport: ViewportSize): {x: number; y: number} {
  return {
    x: (x / viewport.width) * 2 - 1,
    y: 1 - (y / viewport.height) * 2,
  };
}

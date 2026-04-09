import {Buffer, type Device} from '@luma.gl/core';
import {DynamicTexture, GPUGeometry, Model} from '@luma.gl/engine';

import {type ViewportSize} from '../camera';
import {type ProjectorUniforms, type StageProjector} from '../projector';
import {buildGlyphAtlas} from './atlas';
import {getCharacterSetFromLabels} from './charset';
import {
  packGlyphInstances,
  type PackedGlyphInstances,
  type PackedGlyphLabelSummary,
} from './glyph-instance-pack';
import {layoutLabels, measureLabelBounds} from './layout';
import {
  projectGlyphQuadToScreen,
  projectLabelBoundsToScreen,
  type ProjectedPlaneQuad,
} from './projection';
import {getZoomOpacity, isZoomVisible} from './zoom';
import {DEFAULT_TEXT_STRATEGY} from './types';
import type {
  GlyphAtlas,
  GlyphPlacement,
  LabelDefinition,
  TextLayerStats,
  TextLayout,
  TextStrategy,
} from './types';

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
  @location(2) instanceOrigin: vec2<f32>,
  @location(3) instanceBasisX: vec2<f32>,
  @location(4) instanceBasisY: vec2<f32>,
  @location(5) instanceDepth: f32,
  @location(6) instanceUvRect: vec4<f32>,
  @location(7) instanceColor: vec4<f32>
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
  let screenPosition =
    inputs.instanceOrigin +
    inputs.unitPosition.x * inputs.instanceBasisX +
    inputs.unitPosition.y * inputs.instanceBasisY;
  outputs.clipPosition = vec4<f32>(screenToClip(screenPosition), inputs.instanceDepth, 1.0);
  outputs.uv = inputs.instanceUvRect.xy + inputs.unitUv * (inputs.instanceUvRect.zw - inputs.instanceUvRect.xy);
  outputs.color = inputs.instanceColor;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let distance = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv).a;
  let edgeWidth = max(sdf.smoothing, fwidth(distance));
  let alpha =
    smoothstep(sdf.cutoff - edgeWidth, sdf.cutoff + edgeWidth, distance) *
    inputs.color.a *
    sdf.padding.x;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const STACK_SDF_INSTANCED_TEXT_SHADER = /* wgsl */ `
@group(0) @binding(0) var glyphAtlas: texture_2d<f32>;
@group(0) @binding(1) var glyphAtlasSampler: sampler;

struct CameraUniforms {
  eye: vec4<f32>,
  right: vec4<f32>,
  up: vec4<f32>,
  forward: vec4<f32>,
  projection: vec4<f32>,
  viewportZoom: vec4<f32>,
}

struct SdfUniforms {
  cutoff: f32,
  smoothing: f32,
  padding: vec2<f32>,
}

@group(0) @binding(2) var<uniform> camera: CameraUniforms;
@group(0) @binding(3) var<uniform> sdf: SdfUniforms;

struct VertexInputs {
  @location(0) unitPosition: vec2<f32>,
  @location(1) unitUv: vec2<f32>,
  @location(2) instanceAnchor: vec3<f32>,
  @location(3) instancePlaneBasisX: vec3<f32>,
  @location(4) instancePlaneBasisY: vec3<f32>,
  @location(5) instanceGlyphRect: vec4<f32>,
  @location(6) instanceUvRect: vec4<f32>,
  @location(7) instanceColor: vec4<f32>,
  @location(8) instanceZoomBand: vec2<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>
}

const BASIS_VECTOR_EPSILON: f32 = 0.0001;
const MIN_ZOOM_OPACITY: f32 = 0.18;
const DOT_SCALE: f32 = 0.2;
const LABEL_SCALE: f32 = 0.5;
const EXIT_FADE_SCALE: f32 = 2.8;
const EXIT_HIDE_SCALE: f32 = 4.5;

fn screenToClip(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x / camera.viewportZoom.x) * 2.0 - 1.0,
    1.0 - (position.y / camera.viewportZoom.y) * 2.0,
  );
}

fn clipToScreen(position: vec2<f32>) -> vec2<f32> {
  return vec2<f32>(
    (position.x + 1.0) * camera.viewportZoom.x * 0.5,
    (1.0 - position.y) * camera.viewportZoom.y * 0.5,
  );
}

fn projectWorldPoint(point: vec3<f32>) -> vec3<f32> {
  let relative = point - camera.eye.xyz;
  let depth = max(camera.projection.z, dot(relative, camera.forward.xyz));
  let cameraX = dot(relative, camera.right.xyz);
  let cameraY = dot(relative, camera.up.xyz);

  return vec3<f32>(
    cameraX / (depth * camera.projection.x * camera.projection.y),
    cameraY / (depth * camera.projection.x),
    clamp(
      (depth - camera.projection.z) / max(0.0001, camera.projection.w - camera.projection.z),
      0.0,
      1.0,
    ),
  );
}

fn projectBasisUnit(
  anchorWorld: vec3<f32>,
  anchorScreen: vec2<f32>,
  planeBasis: vec3<f32>,
  fallback: vec2<f32>,
) -> vec2<f32> {
  let targetScreen = clipToScreen(projectWorldPoint(anchorWorld + planeBasis).xy);
  let basis = targetScreen - anchorScreen;
  let basisLength = sqrt(basis.x * basis.x + basis.y * basis.y);

  if (basisLength <= BASIS_VECTOR_EPSILON) {
    return fallback;
  }

  return basis / basisLength;
}

fn getZoomScale(zoom: f32, zoomLevel: f32) -> f32 {
  return exp2(zoom - zoomLevel);
}

fn normalizeBetween(value: f32, start: f32, end: f32) -> f32 {
  if (abs(end - start) <= BASIS_VECTOR_EPSILON) {
    return select(0.0, 1.0, value >= end);
  }

  return clamp((value - start) / (end - start), 0.0, 1.0);
}

fn getZoomEmphasis(scale: f32) -> f32 {
  let enter = smoothstep(0.0, 1.0, normalizeBetween(scale, DOT_SCALE, LABEL_SCALE));
  let exit = smoothstep(0.0, 1.0, normalizeBetween(scale, EXIT_HIDE_SCALE, EXIT_FADE_SCALE));
  return min(enter, exit);
}

fn getZoomOpacity(zoom: f32, zoomLevel: f32, zoomRange: f32) -> f32 {
  let visibleRange = max(0.0, zoomRange);

  if (zoom < zoomLevel - visibleRange || zoom > zoomLevel + visibleRange) {
    return 0.0;
  }

  let emphasis = getZoomEmphasis(getZoomScale(zoom, zoomLevel));

  if (emphasis >= 0.9999) {
    return 1.0;
  }

  return MIN_ZOOM_OPACITY + (1.0 - MIN_ZOOM_OPACITY) * emphasis;
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  let zoomScale = getZoomScale(camera.viewportZoom.z, inputs.instanceZoomBand.x);
  let zoomOpacity = getZoomOpacity(camera.viewportZoom.z, inputs.instanceZoomBand.x, inputs.instanceZoomBand.y);
  let anchorClip = projectWorldPoint(inputs.instanceAnchor);
  let anchorScreen = clipToScreen(anchorClip.xy);
  let basisXUnit = projectBasisUnit(inputs.instanceAnchor, anchorScreen, inputs.instancePlaneBasisX, vec2<f32>(1.0, 0.0));
  let basisYUnit = projectBasisUnit(inputs.instanceAnchor, anchorScreen, inputs.instancePlaneBasisY, vec2<f32>(0.0, 1.0));
  let glyphOffset = inputs.instanceGlyphRect.xy;
  let glyphSize = inputs.instanceGlyphRect.zw;
  let screenOrigin =
    anchorScreen +
    basisXUnit * glyphOffset.x * zoomScale +
    basisYUnit * glyphOffset.y * zoomScale;
  let screenPosition =
    screenOrigin +
    basisXUnit * (inputs.unitPosition.x * glyphSize.x * zoomScale) +
    basisYUnit * (inputs.unitPosition.y * glyphSize.y * zoomScale);

  outputs.clipPosition = vec4<f32>(screenToClip(screenPosition), anchorClip.z, 1.0);
  outputs.uv = inputs.instanceUvRect.xy + inputs.unitUv * (inputs.instanceUvRect.zw - inputs.instanceUvRect.xy);
  outputs.color = vec4<f32>(inputs.instanceColor.rgb, inputs.instanceColor.a * zoomOpacity);
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let distance = textureSample(glyphAtlas, glyphAtlasSampler, inputs.uv).a;
  let edgeWidth = max(sdf.smoothing, fwidth(distance));
  let alpha =
    smoothstep(sdf.cutoff - edgeWidth, sdf.cutoff + edgeWidth, distance) *
    inputs.color.a *
    sdf.padding.x;

  if (alpha < 0.01) {
    discard;
  }

  return vec4<f32>(inputs.color.rgb, alpha);
}
`;

const TEXT_BLEND_PARAMETERS = {
  depthCompare: 'less-equal',
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

const INTERLEAVED_UNIT_QUAD = new Float32Array([
  0, 0, 0, 0,
  1, 0, 1, 0,
  0, 1, 0, 1,
  1, 1, 1, 1,
]);

const MAX_VISIBLE_LABEL_SAMPLE = 24;
const VIEWPORT_BOUNDS_PADDING = 8;
const CAMERA_UNIFORM_FLOAT_COUNT = 24;
const CAMERA_UNIFORM_BYTES = CAMERA_UNIFORM_FLOAT_COUNT * Float32Array.BYTES_PER_ELEMENT;
const VIEWPORT_UNIFORM_BYTES = 4 * Float32Array.BYTES_PER_ELEMENT;
const SDF_UNIFORM_BYTES = 4 * Float32Array.BYTES_PER_ELEMENT;
const FOCUSED_LABEL_ALPHA_SCALE = 1.18;
const FOCUSED_LABEL_BRIGHTEN = 0.26;

type PreparedTextResources = {
  atlas: GlyphAtlas;
  layout: TextLayout;
  texture: DynamicTexture;
};

type VisibleGlyph = GlyphPlacement & ProjectedPlaneQuad;

type GlyphVisibilityResult = {
  visibleGlyphCount: number;
  visibleGlyphs: VisibleGlyph[];
  visibleLabelCount: number;
  visibleLabels: string[];
};

type TextVisibilitySummary = {
  visibleGlyphCount: number;
  visibleLabelCount: number;
  visibleLabels: string[];
};

type VisibleGlyphInstances = {
  basisXs: Float32Array;
  basisYs: Float32Array;
  colors: Float32Array;
  depths: Float32Array;
  instanceCount: number;
  origins: Float32Array;
  uvRects: Float32Array;
};

type TextLayerStrategy = {
  destroy: () => void;
  draw: (renderPass: Parameters<Model['draw']>[0]) => void;
  getStats: () => TextLayerStats;
  supportsSelectedLabelEmphasis: boolean;
  update: (projector: StageProjector, viewport: ViewportSize, activeLabelKey: string | null) => void;
};

export class TextLayer {
  private resources: PreparedTextResources;
  private strategy: TextLayerStrategy;
  private mode: TextStrategy;

  constructor(
    private readonly device: Device,
    labels: LabelDefinition[],
    mode: TextStrategy = DEFAULT_TEXT_STRATEGY,
  ) {
    this.mode = mode;
    const characterSet = getCharacterSetFromLabels(labels);

    this.resources = createPreparedTextResources(
      device,
      labels,
      buildGlyphAtlas(characterSet, {mode: 'sdf'}),
    );
    this.strategy = this.createStrategy(mode);
  }

  get ready(): Promise<void> {
    return this.resources.texture.ready.then(() => undefined);
  }

  destroy(): void {
    this.strategy.destroy();
    this.resources.texture.destroy();
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

    this.mode = mode;
    this.strategy.destroy();
    this.strategy = this.createStrategy(mode);
  }

  setLayoutLabels(labels: LabelDefinition[]): void {
    this.strategy.destroy();
    this.resources = relayoutPreparedTextResources(this.resources, labels);
    this.strategy = this.createStrategy(this.mode);
  }

  update(projector: StageProjector, viewport: ViewportSize, activeLabelKey: string | null = null): void {
    const renderableActiveLabelKey = this.strategy.supportsSelectedLabelEmphasis
      ? activeLabelKey
      : null;

    this.strategy.update(projector, viewport, renderableActiveLabelKey);
  }

  getLabelScreenBounds(
    label: LabelDefinition,
    projector: StageProjector,
    viewport: ViewportSize,
  ): {bottom: number; height: number; left: number; right: number; top: number; width: number} | null {
    const bounds = measureLabelBounds(label, this.resources.atlas);

    const quad = projectLabelBoundsToScreen(bounds, projector, viewport);

    if (!quad) {
      return null;
    }

    return {
      bottom: quad.bottom,
      height: quad.bottom - quad.top,
      left: quad.left,
      right: quad.right,
      top: quad.top,
      width: quad.right - quad.left,
    };
  }

  private createStrategy(mode: TextStrategy): TextLayerStrategy {
    return new HybridTextStrategy(this.device, this.resources, mode);
  }
}

class HybridTextStrategy implements TextLayerStrategy {
  readonly supportsSelectedLabelEmphasis = true;
  private readonly planeFocusStrategy: TextLayerStrategy;
  private readonly stackStrategy: TextLayerStrategy;
  private activeStrategy: TextLayerStrategy;

  constructor(
    device: Device,
    resources: PreparedTextResources,
    mode: TextStrategy,
  ) {
    this.planeFocusStrategy = new InstancedTextStrategy(device, resources, mode);
    this.stackStrategy = new StackTextStrategy(device, resources, mode);
    this.activeStrategy = this.planeFocusStrategy;
  }

  destroy(): void {
    this.planeFocusStrategy.destroy();
    this.stackStrategy.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    this.activeStrategy.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.activeStrategy.getStats();
  }

  update(projector: StageProjector, viewport: ViewportSize, activeLabelKey: string | null): void {
    this.activeStrategy =
      projector.kind === 'stack-camera'
        ? this.stackStrategy
        : this.planeFocusStrategy;

    this.activeStrategy.update(projector, viewport, activeLabelKey);
  }
}

class InstancedTextStrategy implements TextLayerStrategy {
  readonly supportsSelectedLabelEmphasis = true;
  private readonly unitPositionBuffer;
  private readonly unitUvBuffer;
  private readonly viewportBuffer;
  private readonly sdfBuffer;
  private readonly sdfUniformData: Float32Array;
  private readonly model: Model;
  private originBuffer;
  private basisXBuffer;
  private basisYBuffer;
  private depthBuffer;
  private uvRectBuffer;
  private colorBuffer;
  private capacity = 1;
  private projectionFingerprint = '';
  private activeLabelKey: string | null = null;
  private stats: TextLayerStats;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(
    private readonly device: Device,
    private readonly resources: PreparedTextResources,
    private readonly mode: TextStrategy,
  ) {
    this.unitPositionBuffer = createStaticVertexBuffer(device, `text-${mode}-unit-positions`, UNIT_QUAD_POSITIONS);
    this.unitUvBuffer = createStaticVertexBuffer(device, `text-${mode}-unit-uvs`, UNIT_QUAD_UVS);
    this.viewportBuffer = device.createBuffer({
      id: `text-${mode}-frame`,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: VIEWPORT_UNIFORM_BYTES,
    });
    this.sdfBuffer = device.createBuffer({
      id: `text-${mode}-sdf`,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: SDF_UNIFORM_BYTES,
    });
    this.sdfUniformData = buildSdfUniformData(this.resources.atlas, this.mode);
    this.originBuffer = device.createBuffer({
      id: `text-${mode}-origins`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.basisXBuffer = device.createBuffer({
      id: `text-${mode}-basis-x`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.basisYBuffer = device.createBuffer({
      id: `text-${mode}-basis-y`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.depthBuffer = device.createBuffer({
      id: `text-${mode}-depth`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * Float32Array.BYTES_PER_ELEMENT,
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
      sdf: this.sdfBuffer,
    };

    this.model = new Model(device, {
      id: `atlas-text-${mode}`,
      source: SDF_INSTANCED_TEXT_SHADER,
      geometry: this.createGeometry(),
      bindings,
      vertexCount: 4,
      instanceCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
    this.sdfBuffer.write(this.sdfUniformData);
    this.stats = createEmptyTextLayerStats(this.resources.layout, mode);
  }

  destroy(): void {
    this.model.destroy();
    this.unitPositionBuffer.destroy();
    this.unitUvBuffer.destroy();
    this.viewportBuffer.destroy();
    this.sdfBuffer.destroy();
    this.originBuffer.destroy();
    this.basisXBuffer.destroy();
    this.basisYBuffer.destroy();
    this.depthBuffer.destroy();
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

  update(projector: StageProjector, viewport: ViewportSize, activeLabelKey: string | null): void {
    const projectionFingerprint = projector.getProjectionFingerprint(viewport);

    if (
      projectionFingerprint === this.projectionFingerprint &&
      activeLabelKey === this.activeLabelKey
    ) {
      return;
    }

    const visibility = analyzeVisibleGlyphs(this.resources, projector, viewport, activeLabelKey);
    const instances = buildVisibleGlyphInstances(visibility.visibleGlyphs);
    this.projectionFingerprint = projectionFingerprint;
    this.activeLabelKey = activeLabelKey;

    if (instances.instanceCount > this.capacity) {
      this.capacity = instances.instanceCount;
      this.originBuffer.destroy();
      this.basisXBuffer.destroy();
      this.basisYBuffer.destroy();
      this.depthBuffer.destroy();
      this.uvRectBuffer.destroy();
      this.colorBuffer.destroy();

      this.originBuffer = this.device.createBuffer({
        id: `text-${this.mode}-origins`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.basisXBuffer = this.device.createBuffer({
        id: `text-${this.mode}-basis-x`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.basisYBuffer = this.device.createBuffer({
        id: `text-${this.mode}-basis-y`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.depthBuffer = this.device.createBuffer({
        id: `text-${this.mode}-depth`,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * Float32Array.BYTES_PER_ELEMENT,
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
        instanceBasisX: this.basisXBuffer,
        instanceBasisY: this.basisYBuffer,
        instanceColor: this.colorBuffer,
        instanceDepth: this.depthBuffer,
        instanceOrigin: this.originBuffer,
        instanceUvRect: this.uvRectBuffer,
      });
    }

    if (instances.instanceCount === 0) {
      this.model.setInstanceCount(0);
      this.stats = createTextLayerStats(this.resources.layout, this.mode, visibility, 0, 0, 0);
      return;
    }

    let uploadedBytes = 0;

    if (viewport.width !== this.viewportWidth || viewport.height !== this.viewportHeight) {
      this.viewportWidth = viewport.width;
      this.viewportHeight = viewport.height;
      this.viewportBuffer.write(new Float32Array([viewport.width, viewport.height, 0, 0]));
      uploadedBytes += VIEWPORT_UNIFORM_BYTES;
    }
    this.originBuffer.write(instances.origins);
    this.basisXBuffer.write(instances.basisXs);
    this.basisYBuffer.write(instances.basisYs);
    this.depthBuffer.write(instances.depths);
    this.uvRectBuffer.write(instances.uvRects);
    this.colorBuffer.write(instances.colors);
    this.model.setInstanceCount(instances.instanceCount);

    this.stats = createTextLayerStats(
      this.resources.layout,
      this.mode,
      visibility,
      uploadedBytes +
        instances.origins.byteLength +
        instances.basisXs.byteLength +
        instances.basisYs.byteLength +
        instances.depths.byteLength +
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
        {name: 'instanceOrigin', format: 'float32x2', stepMode: 'instance'},
        {name: 'instanceBasisX', format: 'float32x2', stepMode: 'instance'},
        {name: 'instanceBasisY', format: 'float32x2', stepMode: 'instance'},
        {name: 'instanceDepth', format: 'float32', stepMode: 'instance'},
        {name: 'instanceUvRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceColor', format: 'float32x4', stepMode: 'instance'},
      ],
      attributes: {
        unitPosition: this.unitPositionBuffer,
        unitUv: this.unitUvBuffer,
        instanceOrigin: this.originBuffer,
        instanceBasisX: this.basisXBuffer,
        instanceBasisY: this.basisYBuffer,
        instanceDepth: this.depthBuffer,
        instanceUvRect: this.uvRectBuffer,
        instanceColor: this.colorBuffer,
      },
    });
  }
}

class StackTextStrategy implements TextLayerStrategy {
  readonly supportsSelectedLabelEmphasis = true;
  private readonly unitQuadBuffer;
  private readonly anchorBuffer;
  private readonly planeBasisXBuffer;
  private readonly planeBasisYBuffer;
  private readonly glyphRectBuffer;
  private readonly uvRectBuffer;
  private readonly colorBuffer;
  private readonly zoomBandBuffer;
  private readonly cameraBuffer;
  private readonly sdfBuffer;
  private readonly sdfUniformData: Float32Array;
  private readonly packedGlyphs: PackedGlyphInstances;
  private readonly baseColorData: Float32Array;
  private readonly model: Model;
  private projectionFingerprint = '';
  private activeLabelKey: string | null = null;
  private stats: TextLayerStats;

  constructor(
    device: Device,
    private readonly resources: PreparedTextResources,
    private readonly mode: TextStrategy,
  ) {
    this.packedGlyphs = packGlyphInstances(resources.layout);
    this.baseColorData = this.packedGlyphs.colors.slice();
    this.unitQuadBuffer = createStaticVertexBuffer(
      device,
      `text-${mode}-stack-unit-quad`,
      INTERLEAVED_UNIT_QUAD,
      Buffer.VERTEX,
    );
    this.anchorBuffer = createStaticVertexBuffer(device, `text-${mode}-stack-anchors`, this.packedGlyphs.anchors, Buffer.VERTEX);
    this.planeBasisXBuffer = createStaticVertexBuffer(
      device,
      `text-${mode}-stack-plane-basis-x`,
      this.packedGlyphs.planeBasisXs,
      Buffer.VERTEX,
    );
    this.planeBasisYBuffer = createStaticVertexBuffer(
      device,
      `text-${mode}-stack-plane-basis-y`,
      this.packedGlyphs.planeBasisYs,
      Buffer.VERTEX,
    );
    this.glyphRectBuffer = createStaticVertexBuffer(
      device,
      `text-${mode}-stack-glyph-rects`,
      this.packedGlyphs.glyphRects,
      Buffer.VERTEX,
    );
    this.uvRectBuffer = createStaticVertexBuffer(
      device,
      `text-${mode}-stack-uv-rects`,
      this.packedGlyphs.uvRects,
      Buffer.VERTEX,
    );
    this.colorBuffer = device.createBuffer({
      id: `text-${mode}-stack-colors`,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      data: this.baseColorData,
    });
    this.cameraBuffer = device.createBuffer({
      id: `text-${mode}-stack-camera`,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: CAMERA_UNIFORM_BYTES,
    });
    this.sdfBuffer = device.createBuffer({
      id: `text-${mode}-stack-sdf`,
      usage: Buffer.UNIFORM | Buffer.COPY_DST,
      byteLength: SDF_UNIFORM_BYTES,
    });
    this.sdfUniformData = buildSdfUniformData(this.resources.atlas, this.mode);
    this.zoomBandBuffer = createStaticVertexBuffer(
      device,
      `text-${mode}-stack-zoom-bands`,
      this.packedGlyphs.zoomBands,
      Buffer.VERTEX,
    );
    const bindings: Record<string, DynamicTexture | Buffer> = {
      glyphAtlas: this.resources.texture,
      camera: this.cameraBuffer,
      sdf: this.sdfBuffer,
    };

    this.model = new Model(device, {
      id: `atlas-text-${mode}-stack`,
      source: STACK_SDF_INSTANCED_TEXT_SHADER,
      geometry: this.createGeometry(),
      bindings,
      vertexCount: 4,
      instanceCount: 0,
      parameters: TEXT_BLEND_PARAMETERS,
    });
    this.sdfBuffer.write(this.sdfUniformData);
    this.stats = createEmptyTextLayerStats(this.resources.layout, mode);
  }

  destroy(): void {
    this.model.destroy();
    this.unitQuadBuffer.destroy();
    this.anchorBuffer.destroy();
    this.planeBasisXBuffer.destroy();
    this.planeBasisYBuffer.destroy();
    this.glyphRectBuffer.destroy();
    this.uvRectBuffer.destroy();
    this.colorBuffer.destroy();
    this.zoomBandBuffer.destroy();
    this.cameraBuffer.destroy();
    this.sdfBuffer.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.submittedGlyphCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): TextLayerStats {
    return this.stats;
  }

  update(projector: StageProjector, viewport: ViewportSize, activeLabelKey: string | null): void {
    const projectionFingerprint = projector.getProjectionFingerprint(viewport);
    const cameraChanged = projectionFingerprint !== this.projectionFingerprint;
    const activeLabelChanged = activeLabelKey !== this.activeLabelKey;

    if (!cameraChanged && !activeLabelChanged) {
      return;
    }

    const visibility = summarizeStackVisibleLabels(this.packedGlyphs.labelSummaries, projector.zoom);
    let uploadedBytes = 0;

    if (cameraChanged) {
      this.cameraBuffer.write(buildCameraUniformData(projector.getProjectorUniforms(viewport)));
      uploadedBytes += CAMERA_UNIFORM_BYTES;
      this.projectionFingerprint = projectionFingerprint;
    }

    if (activeLabelChanged) {
      const colorData =
        activeLabelKey === null
          ? this.baseColorData
          : buildFocusedGlyphColorData(this.resources.layout.glyphs, activeLabelKey);

      this.colorBuffer.write(colorData);
      uploadedBytes += colorData.byteLength;
      this.activeLabelKey = activeLabelKey;
    }

    const instanceCount = visibility.visibleGlyphCount > 0
      ? this.packedGlyphs.instanceCount
      : 0;

    this.model.setInstanceCount(instanceCount);
    this.stats = createTextLayerStats(
      this.resources.layout,
      this.mode,
      visibility,
      uploadedBytes,
      instanceCount * 4,
      instanceCount,
    );
  }

  private createGeometry(): GPUGeometry {
    return new GPUGeometry({
      topology: 'triangle-strip',
      vertexCount: 4,
      bufferLayout: [
        {
          name: 'unitQuad',
          byteStride: 4 * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            {attribute: 'unitPosition', format: 'float32x2', byteOffset: 0},
            {
              attribute: 'unitUv',
              format: 'float32x2',
              byteOffset: 2 * Float32Array.BYTES_PER_ELEMENT,
            },
          ],
        },
        {name: 'instanceAnchor', format: 'float32x3', stepMode: 'instance'},
        {name: 'instancePlaneBasisX', format: 'float32x3', stepMode: 'instance'},
        {name: 'instancePlaneBasisY', format: 'float32x3', stepMode: 'instance'},
        {name: 'instanceGlyphRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceUvRect', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceColor', format: 'float32x4', stepMode: 'instance'},
        {name: 'instanceZoomBand', format: 'float32x2', stepMode: 'instance'},
      ],
      attributes: {
        unitQuad: this.unitQuadBuffer,
        instanceAnchor: this.anchorBuffer,
        instancePlaneBasisX: this.planeBasisXBuffer,
        instancePlaneBasisY: this.planeBasisYBuffer,
        instanceGlyphRect: this.glyphRectBuffer,
        instanceUvRect: this.uvRectBuffer,
        instanceColor: this.colorBuffer,
        instanceZoomBand: this.zoomBandBuffer,
      },
    });
  }
}

function createPreparedTextResources(
  device: Device,
  labels: LabelDefinition[],
  atlas: GlyphAtlas,
): PreparedTextResources {
  const layout = layoutLabels(labels, atlas);

  return {
    atlas,
    layout,
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

function relayoutPreparedTextResources(
  resources: PreparedTextResources,
  labels: LabelDefinition[],
): PreparedTextResources {
  const layout = layoutLabels(labels, resources.atlas);

  return {
    ...resources,
    layout,
  };
}

function analyzeVisibleGlyphs(
  resources: PreparedTextResources,
  projector: StageProjector,
  viewport: ViewportSize,
  activeLabelKey: string | null,
): GlyphVisibilityResult {
  const {glyphs} = resources.layout;
  const visibleGlyphs: VisibleGlyph[] = [];
  const visibleLabelIds = new Set<number>();
  const visibleLabels: string[] = [];
  let visibleGlyphCount = 0;
  for (const glyph of glyphs) {
    const visibility = inspectGlyph(glyph, projector, viewport, activeLabelKey);

    if (!visibility) {
      continue;
    }

    visibleGlyphCount += 1;
    visibleGlyphs.push(visibility);
    recordVisibleLabel(glyph, visibleLabelIds, visibleLabels);
  }

  visibleGlyphs.sort((left, right) => right.depth - left.depth);

  return {
    visibleGlyphCount,
    visibleGlyphs,
    visibleLabelCount: visibleLabelIds.size,
    visibleLabels,
  };
}

function buildVisibleGlyphInstances(visibleGlyphs: VisibleGlyph[]): VisibleGlyphInstances {
  const instanceCount = visibleGlyphs.length;
  const origins = new Float32Array(instanceCount * 2);
  const basisXs = new Float32Array(instanceCount * 2);
  const basisYs = new Float32Array(instanceCount * 2);
  const uvRects = new Float32Array(instanceCount * 4);
  const colors = new Float32Array(instanceCount * 4);
  const depths = new Float32Array(instanceCount);

  for (let index = 0; index < instanceCount; index += 1) {
    const glyph = visibleGlyphs[index];

    if (!glyph) {
      continue;
    }

    const originIndex = index * 2;
    const rectIndex = index * 4;

    origins[originIndex] = glyph.origin.x;
    origins[originIndex + 1] = glyph.origin.y;
    basisXs[originIndex] = glyph.basisX.x;
    basisXs[originIndex + 1] = glyph.basisX.y;
    basisYs[originIndex] = glyph.basisY.x;
    basisYs[originIndex + 1] = glyph.basisY.y;
    depths[index] = glyph.depth;
    uvRects[rectIndex] = glyph.u0;
    uvRects[rectIndex + 1] = glyph.v0;
    uvRects[rectIndex + 2] = glyph.u1;
    uvRects[rectIndex + 3] = glyph.v1;
    colors[rectIndex] = glyph.color[0];
    colors[rectIndex + 1] = glyph.color[1];
    colors[rectIndex + 2] = glyph.color[2];
    colors[rectIndex + 3] = glyph.color[3];
  }

  return {
    basisXs,
    basisYs,
    colors,
    depths,
    instanceCount,
    origins,
    uvRects,
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
  usage: number = Buffer.VERTEX,
) {
  return device.createBuffer({
    id,
    usage,
    data,
  });
}

function buildSdfUniformData(atlas: GlyphAtlas, textStrategy: TextStrategy): Float32Array {
  const cutoff = atlas.cutoff ?? 0.5;
  const smoothing = atlas.smoothing ?? 0.08;

  if (textStrategy === 'sdf-soft') {
    return new Float32Array([
      cutoff - 0.08,
      smoothing * 2.6,
      0.82,
      0,
    ]);
  }

  return new Float32Array([
    cutoff,
    smoothing,
    1,
    0,
  ]);
}

function buildCameraUniformData(projectorUniforms: ProjectorUniforms): Float32Array {
  return new Float32Array([
    projectorUniforms.eye.x,
    projectorUniforms.eye.y,
    projectorUniforms.eye.z,
    0,
    projectorUniforms.right.x,
    projectorUniforms.right.y,
    projectorUniforms.right.z,
    0,
    projectorUniforms.up.x,
    projectorUniforms.up.y,
    projectorUniforms.up.z,
    0,
    projectorUniforms.forward.x,
    projectorUniforms.forward.y,
    projectorUniforms.forward.z,
    0,
    projectorUniforms.tanHalfFovY,
    projectorUniforms.aspect,
    projectorUniforms.near,
    projectorUniforms.far,
    projectorUniforms.viewportWidth,
    projectorUniforms.viewportHeight,
    projectorUniforms.zoom,
    0,
  ]);
}

function summarizeStackVisibleLabels(
  labelSummaries: PackedGlyphLabelSummary[],
  zoom: number,
): TextVisibilitySummary {
  const visibleLabels: string[] = [];
  let visibleGlyphCount = 0;
  let visibleLabelCount = 0;

  for (const summary of labelSummaries) {
    if (!isZoomVisible(zoom, summary.zoomLevel, summary.zoomRange)) {
      continue;
    }

    visibleGlyphCount += summary.glyphCount;
    visibleLabelCount += 1;

    if (visibleLabels.length < MAX_VISIBLE_LABEL_SAMPLE) {
      visibleLabels.push(summary.labelText);
    }
  }

  return {
    visibleGlyphCount,
    visibleLabelCount,
    visibleLabels,
  };
}

function buildFocusedGlyphColorData(
  glyphs: GlyphPlacement[],
  activeLabelKey: string,
): Float32Array {
  const colors = new Float32Array(glyphs.length * 4);

  for (let index = 0; index < glyphs.length; index += 1) {
    const glyph = glyphs[index];

    if (!glyph) {
      continue;
    }

    const color = getRenderedGlyphColor(glyph, 1, activeLabelKey);
    const colorIndex = index * 4;

    colors[colorIndex] = color[0];
    colors[colorIndex + 1] = color[1];
    colors[colorIndex + 2] = color[2];
    colors[colorIndex + 3] = color[3];
  }

  return colors;
}

function createTextLayerStats(
  layout: TextLayout,
  textStrategy: TextStrategy,
  visibility: TextVisibilitySummary,
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
    visibleChunkCount: 0,
    visibleGlyphCount: visibility.visibleGlyphCount,
    visibleLabelCount: visibility.visibleLabelCount,
    visibleLabels: visibility.visibleLabels,
  };
}

function inspectGlyph(
  glyph: GlyphPlacement,
  projector: StageProjector,
  viewport: ViewportSize,
  activeLabelKey: string | null,
): VisibleGlyph | null {
  const zoomOpacity = getZoomOpacity(projector.zoom, glyph.zoomLevel, glyph.zoomRange);
  const quad = projectGlyphQuadToScreen(glyph, projector, viewport);

  if (!quad) {
    return null;
  }

  const {bottom, left, right, top} = quad;

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
    basisX: quad.basisX,
    basisY: quad.basisY,
    bottom,
    color: getRenderedGlyphColor(glyph, zoomOpacity, activeLabelKey),
    depth: quad.depth,
    left,
    origin: quad.origin,
    right,
    top,
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

function getRenderedGlyphColor(
  glyph: GlyphPlacement,
  zoomOpacity: number,
  activeLabelKey: string | null,
): GlyphPlacement['color'] {
  const alpha = glyph.color[3] * zoomOpacity;

  if (glyph.labelKey !== activeLabelKey) {
    return [glyph.color[0], glyph.color[1], glyph.color[2], alpha];
  }

  return [
    mixColorChannel(glyph.color[0], FOCUSED_LABEL_BRIGHTEN),
    mixColorChannel(glyph.color[1], FOCUSED_LABEL_BRIGHTEN),
    mixColorChannel(glyph.color[2], FOCUSED_LABEL_BRIGHTEN),
    Math.min(1, alpha * FOCUSED_LABEL_ALPHA_SCALE),
  ];
}

function mixColorChannel(value: number, brightenAmount: number): number {
  return value + (1 - value) * brightenAmount;
}

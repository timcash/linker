import {Buffer, type Device} from '@luma.gl/core';
import {DynamicTexture, GPUGeometry, Model} from '@luma.gl/engine';

import {type ViewportSize} from '../camera';
import {type StageProjector} from '../projector';
import {buildGlyphAtlas} from './atlas';
import {getCharacterSetFromLabels} from './charset';
import {layoutLabels, measureLabelBounds} from './layout';
import {
  projectGlyphQuadToScreen,
  projectLabelBoundsToScreen,
  type ProjectedPlaneQuad,
} from './projection';
import {getZoomOpacity} from './zoom';
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
  let alpha = smoothstep(sdf.cutoff - edgeWidth, sdf.cutoff + edgeWidth, distance) * inputs.color.a;

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

const MAX_VISIBLE_LABEL_SAMPLE = 24;
const VIEWPORT_BOUNDS_PADDING = 8;
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

  constructor(
    private readonly device: Device,
    labels: LabelDefinition[],
    mode: TextStrategy = DEFAULT_TEXT_STRATEGY,
  ) {
    void mode;
    const characterSet = getCharacterSetFromLabels(labels);

    this.resources = createPreparedTextResources(
      device,
      labels,
      buildGlyphAtlas(characterSet, {mode: 'sdf'}),
    );
    this.strategy = this.createStrategy();
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
    void mode;
  }

  setLayoutLabels(labels: LabelDefinition[]): void {
    this.strategy.destroy();
    this.resources = relayoutPreparedTextResources(this.resources, labels);
    this.strategy = this.createStrategy();
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

  private createStrategy(): TextLayerStrategy {
    return new InstancedTextStrategy(this.device, this.resources, 'sdf-instanced');
  }
}

class InstancedTextStrategy implements TextLayerStrategy {
  readonly supportsSelectedLabelEmphasis = true;
  private readonly unitPositionBuffer;
  private readonly unitUvBuffer;
  private readonly viewportBuffer;
  private readonly sdfBuffer;
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

    this.viewportBuffer.write(new Float32Array([viewport.width, viewport.height, 0, 0]));
    this.sdfBuffer.write(buildSdfUniformData(this.resources.atlas));
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
      VIEWPORT_UNIFORM_BYTES +
        SDF_UNIFORM_BYTES +
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
  const origins: number[] = [];
  const basisXs: number[] = [];
  const basisYs: number[] = [];
  const uvRects: number[] = [];
  const colors: number[] = [];
  const depths: number[] = [];

  for (const glyph of visibleGlyphs) {
    origins.push(glyph.origin.x, glyph.origin.y);
    basisXs.push(glyph.basisX.x, glyph.basisX.y);
    basisYs.push(glyph.basisY.x, glyph.basisY.y);
    depths.push(glyph.depth);
    uvRects.push(glyph.u0, glyph.v0, glyph.u1, glyph.v1);
    colors.push(...glyph.color);
  }

  return {
    basisXs: new Float32Array(basisXs),
    basisYs: new Float32Array(basisYs),
    colors: new Float32Array(colors),
    depths: new Float32Array(depths),
    instanceCount: visibleGlyphs.length,
    origins: new Float32Array(origins),
    uvRects: new Float32Array(uvRects),
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

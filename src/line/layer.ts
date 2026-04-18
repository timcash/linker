import {Buffer, type Device} from '@luma.gl/core';
import {GPUGeometry, Model} from '@luma.gl/engine';

import {type ScreenPoint, type ViewportSize} from '../camera';
import {type StageProjector} from '../projector';
import type {LabelDefinition} from '../text/types';
import {getZoomOpacity, isZoomVisible} from '../text/zoom';
import {sampleLineCurve} from './curves';
import {DEFAULT_LINE_STRATEGY} from './types';
import type {LinkDefinition, LineLayerStats, LineStrategy} from './types';

const LINE_SHADER = /* wgsl */ `
struct VertexInputs {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) color: vec4<f32>
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  outputs.clipPosition = vec4<f32>(inputs.position, 1.0);
  outputs.color = inputs.color;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  if (inputs.color.a < 0.01) {
    discard;
  }

  return inputs.color;
}
`;

const LINE_BLEND_PARAMETERS = {
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

const VIEWPORT_PADDING = 24;
const DIMMED_LINK_ALPHA_SCALE = 0.6;
const DIMMED_LINK_RGB_SCALE = 0.64;
const INPUT_LINK_ALPHA_SCALE = 1.72;
const INPUT_LINK_BRIGHTEN = 0.22;
const OUTPUT_LINK_ALPHA_SCALE = 1.9;
const OUTPUT_LINK_BRIGHTEN = 0.3;

type LineMesh = {
  colors: Float32Array;
  curveFingerprint: string;
  dimmedLinkCount: number;
  highlightedInputLinkCount: number;
  highlightedOutputLinkCount: number;
  positions: Float32Array;
  vertexCount: number;
  visibleLinkCount: number;
};

type FocusedLinkState = 'dimmed' | 'input' | 'normal' | 'output';
type ProjectedLinePoint = {
  clipZ: number;
  screen: ScreenPoint;
};

export class LineLayer {
  private positionBuffer;
  private colorBuffer;
  private model: Model;
  private capacity = 6;
  private projectionFingerprint = '';
  private activeLabelKey: string | null = null;
  private links: LinkDefinition[];
  private mode: LineStrategy;
  private stats: LineLayerStats;

  constructor(
    private readonly device: Device,
    links: LinkDefinition[],
    mode: LineStrategy = DEFAULT_LINE_STRATEGY,
  ) {
    this.links = links;
    this.mode = mode;
    this.positionBuffer = device.createBuffer({
      id: 'line-positions',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 3 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.colorBuffer = device.createBuffer({
      id: 'line-colors',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.model = new Model(device, {
      id: 'network-lines',
      source: LINE_SHADER,
      geometry: this.createGeometry(this.capacity),
      vertexCount: 0,
      parameters: LINE_BLEND_PARAMETERS,
    });
    this.stats = createEmptyLineLayerStats(this.links, this.mode);
  }

  destroy(): void {
    this.model.destroy();
    this.positionBuffer.destroy();
    this.colorBuffer.destroy();
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.lineVisibleLinkCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): LineLayerStats {
    return this.stats;
  }

  setLinks(links: LinkDefinition[]): void {
    this.links = links;
    this.projectionFingerprint = '';
    this.activeLabelKey = null;
    this.stats = createEmptyLineLayerStats(this.links, this.mode);
  }

  setMode(mode: LineStrategy): void {
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.projectionFingerprint = '';
    this.activeLabelKey = null;
    this.stats = createEmptyLineLayerStats(this.links, this.mode);
  }

  update(projector: StageProjector, viewport: ViewportSize, activeLabel: LabelDefinition | null = null): void {
    const projectionFingerprint = projector.getProjectionFingerprint(viewport);
    const activeLabelKey = activeLabel?.navigation?.key ?? null;

    if (
      projectionFingerprint === this.projectionFingerprint &&
      activeLabelKey === this.activeLabelKey
    ) {
      return;
    }

    const mesh = buildLineMesh(this.links, this.mode, projector, viewport, activeLabel);
    this.projectionFingerprint = projectionFingerprint;
    this.activeLabelKey = activeLabelKey;

    if (mesh.vertexCount > this.capacity) {
      this.capacity = mesh.vertexCount;
      this.positionBuffer.destroy();
      this.colorBuffer.destroy();

      this.positionBuffer = this.device.createBuffer({
        id: 'line-positions',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 3 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.colorBuffer = this.device.createBuffer({
        id: 'line-colors',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      });

      this.model.setGeometry(this.createGeometry(this.capacity));
    }

    if (mesh.vertexCount === 0) {
      this.model.setVertexCount(0);
      this.stats = createLineLayerStats(this.links, this.mode, mesh);
      return;
    }

    this.positionBuffer.write(mesh.positions);
    this.colorBuffer.write(mesh.colors);
    this.model.setVertexCount(mesh.vertexCount);
    this.stats = createLineLayerStats(this.links, this.mode, mesh);
  }

  private createGeometry(vertexCount: number): GPUGeometry {
    return new GPUGeometry({
      topology: 'triangle-list',
      vertexCount,
      bufferLayout: [
        {name: 'position', format: 'float32x3'},
        {name: 'color', format: 'float32x4'},
      ],
      attributes: {
        position: this.positionBuffer,
        color: this.colorBuffer,
      },
    });
  }
}

function buildLineMesh(
  links: LinkDefinition[],
  mode: LineStrategy,
  projector: StageProjector,
  viewport: ViewportSize,
  activeLabel: LabelDefinition | null,
): LineMesh {
  if (viewport.width <= 0 || viewport.height <= 0 || links.length === 0) {
    return createEmptyLineMesh();
  }

  const inputLinkKeys = activeLabel ? new Set(activeLabel.inputLinkKeys) : null;
  const outputLinkKeys = activeLabel ? new Set(activeLabel.outputLinkKeys) : null;
  const hasActiveLabel = activeLabel !== null;
  const positions: number[] = [];
  const colors: number[] = [];
  let dimmedLinkCount = 0;
  let highlightedInputLinkCount = 0;
  let highlightedOutputLinkCount = 0;
  let visibleLinkCount = 0;

  for (const link of links) {
    if (!isZoomVisible(projector.zoom, link.zoomLevel, link.zoomRange)) {
      continue;
    }

    const alpha = link.color[3] * getZoomOpacity(projector.zoom, link.zoomLevel, link.zoomRange);

    if (alpha <= 0.01) {
      continue;
    }

    const focusedLinkState = getFocusedLinkState(link, inputLinkKeys, outputLinkKeys, hasActiveLabel);

    const curvePoints = sampleLineCurve(link, mode, getLineSegmentCount(mode));
    const projectedPoints = curvePoints.map((point) => ({
      clipZ: projector.projectWorldPointToClip(point, viewport).z,
      screen: projector.projectWorldPoint(point, viewport),
    }));
    const screenPoints = projectedPoints.map((point) => point.screen);

    if (!curveTouchesViewport(screenPoints, viewport, link.lineWidth + VIEWPORT_PADDING)) {
      continue;
    }

    appendRibbonMesh(
      projectedPoints,
      link.lineWidth,
      getRenderedLinkColor(link.color, alpha, focusedLinkState),
      positions,
      colors,
      viewport,
    );

    switch (focusedLinkState) {
      case 'input':
        highlightedInputLinkCount += 1;
        break;
      case 'output':
        highlightedOutputLinkCount += 1;
        break;
      case 'dimmed':
        dimmedLinkCount += 1;
        break;
      default:
        break;
    }

    visibleLinkCount += 1;
  }

  if (positions.length === 0) {
    return createEmptyLineMesh();
  }

  return {
    colors: new Float32Array(colors),
    curveFingerprint: createCurveFingerprint(positions),
    dimmedLinkCount,
    highlightedInputLinkCount,
    highlightedOutputLinkCount,
    positions: new Float32Array(positions),
    vertexCount: positions.length / 3,
    visibleLinkCount,
  };
}

function appendRibbonMesh(
  projectedPoints: ProjectedLinePoint[],
  lineWidth: number,
  color: [number, number, number, number],
  positions: number[],
  colors: number[],
  viewport: ViewportSize,
): void {
  if (projectedPoints.length < 2) {
    return;
  }

  const halfWidth = lineWidth * 0.5;

  for (let pointIndex = 0; pointIndex < projectedPoints.length - 1; pointIndex += 1) {
    const startPoint = projectedPoints[pointIndex];
    const endPoint = projectedPoints[pointIndex + 1];
    const start = startPoint?.screen;
    const end = endPoint?.screen;

    if (!start || !end || !startPoint || !endPoint) {
      continue;
    }

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);

    if (length <= 0.0001) {
      continue;
    }

    const normalX = (-dy / length) * halfWidth;
    const normalY = (dx / length) * halfWidth;

    const startLeft = screenToClip(
      {x: start.x + normalX, y: start.y + normalY},
      viewport,
    );
    const startRight = screenToClip(
      {x: start.x - normalX, y: start.y - normalY},
      viewport,
    );
    const endLeft = screenToClip(
      {x: end.x + normalX, y: end.y + normalY},
      viewport,
    );
    const endRight = screenToClip(
      {x: end.x - normalX, y: end.y - normalY},
      viewport,
    );

    positions.push(
      startLeft.x, startLeft.y, startPoint.clipZ,
      startRight.x, startRight.y, startPoint.clipZ,
      endLeft.x, endLeft.y, endPoint.clipZ,
      endLeft.x, endLeft.y, endPoint.clipZ,
      startRight.x, startRight.y, startPoint.clipZ,
      endRight.x, endRight.y, endPoint.clipZ,
    );
    colors.push(...color, ...color, ...color, ...color, ...color, ...color);
  }
}

function curveTouchesViewport(
  screenPoints: ScreenPoint[],
  viewport: ViewportSize,
  padding: number,
): boolean {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of screenPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return (
    maxX >= -padding &&
    minX <= viewport.width + padding &&
    maxY >= -padding &&
    minY <= viewport.height + padding
  );
}

function screenToClip(point: ScreenPoint, viewport: ViewportSize): {x: number; y: number} {
  return {
    x: (point.x / viewport.width) * 2 - 1,
    y: 1 - (point.y / viewport.height) * 2,
  };
}

function getLineSegmentCount(mode: LineStrategy): number {
  switch (mode) {
    case 'orbit-links':
      return 36;
    case 'arc-links':
      return 32;
    case 'rounded-step-links':
    default:
      return 24;
  }
}

function createCurveFingerprint(positions: number[]): string {
  let weightedX = 0;
  let weightedY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const weight = index + 1;
    weightedX += x * weight;
    weightedY += y * weight;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  return [
    positions.length / 3,
    weightedX.toFixed(3),
    weightedY.toFixed(3),
    minX.toFixed(3),
    maxX.toFixed(3),
    minY.toFixed(3),
    maxY.toFixed(3),
  ].join(':');
}

function createEmptyLineMesh(): LineMesh {
  return {
    colors: new Float32Array(),
    curveFingerprint: '0:0:0:0:0:0:0',
    dimmedLinkCount: 0,
    highlightedInputLinkCount: 0,
    highlightedOutputLinkCount: 0,
    positions: new Float32Array(),
    vertexCount: 0,
    visibleLinkCount: 0,
  };
}

function createEmptyLineLayerStats(
  links: LinkDefinition[],
  mode: LineStrategy,
): LineLayerStats {
  return {
    curveFingerprint: '0:0:0:0:0:0:0',
    lineDimmedLinkCount: 0,
    lineHighlightedInputLinkCount: 0,
    lineHighlightedOutputLinkCount: 0,
    lineLinkCount: links.length,
    lineStrategy: mode,
    lineVisibleLinkCount: 0,
    submittedVertexCount: 0,
  };
}

function createLineLayerStats(
  links: LinkDefinition[],
  mode: LineStrategy,
  mesh: LineMesh,
): LineLayerStats {
  return {
    curveFingerprint: mesh.curveFingerprint,
    lineDimmedLinkCount: mesh.dimmedLinkCount,
    lineHighlightedInputLinkCount: mesh.highlightedInputLinkCount,
    lineHighlightedOutputLinkCount: mesh.highlightedOutputLinkCount,
    lineLinkCount: links.length,
    lineStrategy: mode,
    lineVisibleLinkCount: mesh.visibleLinkCount,
    submittedVertexCount: mesh.vertexCount,
  };
}

function getFocusedLinkState(
  link: LinkDefinition,
  inputLinkKeys: Set<string> | null,
  outputLinkKeys: Set<string> | null,
  hasActiveLabel: boolean,
): FocusedLinkState {
  if (outputLinkKeys?.has(link.linkKey)) {
    return 'output';
  }

  if (inputLinkKeys?.has(link.linkKey)) {
    return 'input';
  }

  return hasActiveLabel ? 'dimmed' : 'normal';
}

function getRenderedLinkColor(
  color: LinkDefinition['color'],
  alpha: number,
  focusedLinkState: FocusedLinkState,
): [number, number, number, number] {
  switch (focusedLinkState) {
    case 'input':
      return brightenLinkColor(color, alpha, INPUT_LINK_ALPHA_SCALE, INPUT_LINK_BRIGHTEN);
    case 'output':
      return brightenLinkColor(color, alpha, OUTPUT_LINK_ALPHA_SCALE, OUTPUT_LINK_BRIGHTEN);
    case 'dimmed':
      return [
        color[0] * DIMMED_LINK_RGB_SCALE,
        color[1] * DIMMED_LINK_RGB_SCALE,
        color[2] * DIMMED_LINK_RGB_SCALE,
        alpha * DIMMED_LINK_ALPHA_SCALE,
      ];
    case 'normal':
    default:
      return [color[0], color[1], color[2], alpha];
  }
}

function brightenLinkColor(
  color: LinkDefinition['color'],
  alpha: number,
  alphaScale: number,
  brightenAmount: number,
): [number, number, number, number] {
  return [
    mixChannel(color[0], brightenAmount),
    mixChannel(color[1], brightenAmount),
    mixChannel(color[2], brightenAmount),
    Math.min(1, alpha * alphaScale),
  ];
}

function mixChannel(value: number, brightenAmount: number): number {
  return value + (1 - value) * brightenAmount;
}

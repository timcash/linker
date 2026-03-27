import {Buffer, type Device} from '@luma.gl/core';
import {GPUGeometry, Model} from '@luma.gl/engine';

import {type Camera2D, type ScreenPoint, type ViewportSize} from '../camera';
import {getZoomOpacity, isZoomVisible} from '../text/zoom';
import {sampleLineCurve} from './curves';
import {DEFAULT_LINE_STRATEGY} from './types';
import type {LinkDefinition, LineLayerStats, LineStrategy} from './types';

const LINE_SHADER = /* wgsl */ `
struct VertexInputs {
  @location(0) position: vec2<f32>,
  @location(1) color: vec4<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) color: vec4<f32>
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  outputs.clipPosition = vec4<f32>(inputs.position, 0.0, 1.0);
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

type LineMesh = {
  colors: Float32Array;
  curveFingerprint: string;
  positions: Float32Array;
  vertexCount: number;
  visibleLinkCount: number;
};

export class LineLayer {
  private positionBuffer;
  private colorBuffer;
  private model: Model;
  private capacity = 6;
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
      byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
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
    this.stats = createEmptyLineLayerStats(this.links, this.mode);
  }

  setMode(mode: LineStrategy): void {
    if (mode === this.mode) {
      return;
    }

    this.mode = mode;
    this.stats = createEmptyLineLayerStats(this.links, this.mode);
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    const mesh = buildLineMesh(this.links, this.mode, camera, viewport);

    if (mesh.vertexCount > this.capacity) {
      this.capacity = mesh.vertexCount;
      this.positionBuffer.destroy();
      this.colorBuffer.destroy();

      this.positionBuffer = this.device.createBuffer({
        id: 'line-positions',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
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
        {name: 'position', format: 'float32x2'},
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
  camera: Camera2D,
  viewport: ViewportSize,
): LineMesh {
  if (viewport.width <= 0 || viewport.height <= 0 || links.length === 0) {
    return createEmptyLineMesh();
  }

  const positions: number[] = [];
  const colors: number[] = [];
  let visibleLinkCount = 0;

  for (const link of links) {
    if (!isZoomVisible(camera.zoom, link.zoomLevel, link.zoomRange)) {
      continue;
    }

    const alpha = link.color[3] * getZoomOpacity(camera.zoom, link.zoomLevel, link.zoomRange);

    if (alpha <= 0.01) {
      continue;
    }

    const curvePoints = sampleLineCurve(link, mode, getLineSegmentCount(mode));
    const screenPoints = curvePoints.map((point) => camera.worldToScreen(point, viewport));

    if (!curveTouchesViewport(screenPoints, viewport, link.lineWidth + VIEWPORT_PADDING)) {
      continue;
    }

    appendRibbonMesh(
      screenPoints,
      link.lineWidth,
      [link.color[0], link.color[1], link.color[2], alpha],
      positions,
      colors,
      viewport,
    );
    visibleLinkCount += 1;
  }

  if (positions.length === 0) {
    return createEmptyLineMesh();
  }

  return {
    colors: new Float32Array(colors),
    curveFingerprint: createCurveFingerprint(positions),
    positions: new Float32Array(positions),
    vertexCount: positions.length / 2,
    visibleLinkCount,
  };
}

function appendRibbonMesh(
  screenPoints: ScreenPoint[],
  lineWidth: number,
  color: [number, number, number, number],
  positions: number[],
  colors: number[],
  viewport: ViewportSize,
): void {
  if (screenPoints.length < 2) {
    return;
  }

  const halfWidth = lineWidth * 0.5;

  for (let pointIndex = 0; pointIndex < screenPoints.length - 1; pointIndex += 1) {
    const start = screenPoints[pointIndex];
    const end = screenPoints[pointIndex + 1];

    if (!start || !end) {
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
      startLeft.x,
      startLeft.y,
      startRight.x,
      startRight.y,
      endLeft.x,
      endLeft.y,
      endLeft.x,
      endLeft.y,
      startRight.x,
      startRight.y,
      endRight.x,
      endRight.y,
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
  void mode;
  return 20;
}

function createCurveFingerprint(positions: number[]): string {
  let weightedX = 0;
  let weightedY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < positions.length; index += 2) {
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
    positions.length / 2,
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
    lineLinkCount: links.length,
    lineStrategy: mode,
    lineVisibleLinkCount: mesh.visibleLinkCount,
    submittedVertexCount: mesh.vertexCount,
  };
}

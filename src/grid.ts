import {Buffer, type Device} from '@luma.gl/core';
import {GPUGeometry, Model} from '@luma.gl/engine';

import {type ViewportSize} from './camera';
import {type StageProjector} from './projector';

const GRID_SHADER = /* wgsl */ `
struct VertexInputs {
  @location(0) position: vec2<f32>,
  @location(1) color: vec3<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) color: vec3<f32>
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
  return vec4<f32>(inputs.color, 1.0);
}
`;

const MINOR_COLOR: [number, number, number] = [0.14, 0.14, 0.14];
const MAJOR_COLOR: [number, number, number] = [0.26, 0.26, 0.26];
const AXIS_X_COLOR: [number, number, number] = [0.4, 0.4, 0.4];
const AXIS_Y_COLOR: [number, number, number] = [0.4, 0.4, 0.4];

type GridMesh = {
  positions: Float32Array;
  colors: Float32Array;
  vertexCount: number;
  stats: GridStats;
};

export type GridStats = {
  vertexCount: number;
  minorSpacing: number;
  majorSpacing: number;
  verticalLines: number;
  horizontalLines: number;
};

export class GridLayer {
  private model: Model;
  private positionBuffer;
  private colorBuffer;
  private capacity = 0;
  private projectionFingerprint = '';
  private stats: GridStats = {
    vertexCount: 0,
    minorSpacing: 1,
    majorSpacing: 5,
    verticalLines: 0,
    horizontalLines: 0,
  };

  constructor(private readonly device: Device) {
    this.positionBuffer = device.createBuffer({
      id: 'grid-positions',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: 4 * Float32Array.BYTES_PER_ELEMENT,
    });

    this.colorBuffer = device.createBuffer({
      id: 'grid-colors',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: 6 * Float32Array.BYTES_PER_ELEMENT,
    });

    this.capacity = 2;

    this.model = new Model(device, {
      id: 'debug-grid',
      source: GRID_SHADER,
      geometry: this.createGeometry(this.capacity),
      vertexCount: 0,
      parameters: {
        depthWriteEnabled: false,
      },
    });
  }

  destroy(): void {
    this.model.destroy();
  }

  update(projector: StageProjector, viewport: ViewportSize): void {
    const projectionFingerprint = projector.getProjectionFingerprint(viewport);

    if (projectionFingerprint === this.projectionFingerprint) {
      return;
    }

    const mesh = buildGridMesh(projector, viewport);
    this.projectionFingerprint = projectionFingerprint;
    this.stats = mesh.stats;

    if (mesh.vertexCount > this.capacity) {
      this.capacity = mesh.vertexCount;
      this.positionBuffer.destroy();
      this.colorBuffer.destroy();

      this.positionBuffer = this.device.createBuffer({
        id: 'grid-positions',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });

      this.colorBuffer = this.device.createBuffer({
        id: 'grid-colors',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 3 * Float32Array.BYTES_PER_ELEMENT,
      });

      this.model.setGeometry(this.createGeometry(this.capacity));
    }

    if (mesh.vertexCount === 0) {
      this.model.setVertexCount(0);
      return;
    }

    this.positionBuffer.write(mesh.positions);
    this.colorBuffer.write(mesh.colors);
    this.model.setVertexCount(mesh.vertexCount);
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (this.stats.vertexCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): GridStats {
    return this.stats;
  }

  private createGeometry(vertexCount: number): GPUGeometry {
    return new GPUGeometry({
      topology: 'line-list',
      vertexCount,
      bufferLayout: [
        {name: 'position', format: 'float32x2'},
        {name: 'color', format: 'float32x3'},
      ],
      attributes: {
        position: this.positionBuffer,
        color: this.colorBuffer,
      },
    });
  }
}

function buildGridMesh(projector: StageProjector, viewport: ViewportSize): GridMesh {
  if (viewport.width <= 0 || viewport.height <= 0) {
    return {
      positions: new Float32Array(),
      colors: new Float32Array(),
      vertexCount: 0,
      stats: {
        vertexCount: 0,
        minorSpacing: 1,
        majorSpacing: 5,
        verticalLines: 0,
        horizontalLines: 0,
      },
    };
  }

  const bounds = projector.getVisibleWorldBounds(viewport);
  const targetSpacingInPixels = 72;
  const minorSpacing = niceStep(targetSpacingInPixels / projector.pixelsPerWorldUnit);
  const majorSpacing = minorSpacing * 5;

  const positions: number[] = [];
  const colors: number[] = [];

  let verticalLines = 0;
  let horizontalLines = 0;

  const minColumn = Math.floor(bounds.minX / minorSpacing) - 1;
  const maxColumn = Math.ceil(bounds.maxX / minorSpacing) + 1;

  for (let column = minColumn; column <= maxColumn; column += 1) {
    const x = column * minorSpacing;
    const color =
      column === 0 ? AXIS_Y_COLOR : column % 5 === 0 ? MAJOR_COLOR : MINOR_COLOR;
    addLine(
      projector,
      viewport,
      {x, y: bounds.minY - minorSpacing},
      {x, y: bounds.maxY + minorSpacing},
      color,
      positions,
      colors,
    );
    verticalLines += 1;
  }

  const minRow = Math.floor(bounds.minY / minorSpacing) - 1;
  const maxRow = Math.ceil(bounds.maxY / minorSpacing) + 1;

  for (let row = minRow; row <= maxRow; row += 1) {
    const y = row * minorSpacing;
    const color =
      row === 0 ? AXIS_X_COLOR : row % 5 === 0 ? MAJOR_COLOR : MINOR_COLOR;
    addLine(
      projector,
      viewport,
      {x: bounds.minX - minorSpacing, y},
      {x: bounds.maxX + minorSpacing, y},
      color,
      positions,
      colors,
    );
    horizontalLines += 1;
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    vertexCount: positions.length / 2,
    stats: {
      vertexCount: positions.length / 2,
      minorSpacing,
      majorSpacing,
      verticalLines,
      horizontalLines,
    },
  };
}

function addLine(
  projector: StageProjector,
  viewport: ViewportSize,
  start: {x: number; y: number},
  end: {x: number; y: number},
  color: [number, number, number],
  positions: number[],
  colors: number[],
): void {
  const clipStart = projector.projectWorldPointToClip(start, viewport);
  const clipEnd = projector.projectWorldPointToClip(end, viewport);

  positions.push(clipStart.x, clipStart.y, clipEnd.x, clipEnd.y);
  colors.push(...color, ...color);
}

function niceStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;

  if (fraction <= 1) {
    return exponent;
  }

  if (fraction <= 2) {
    return 2 * exponent;
  }

  if (fraction <= 5) {
    return 5 * exponent;
  }

  return 10 * exponent;
}

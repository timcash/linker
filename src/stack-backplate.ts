import {Buffer, type Device} from '@luma.gl/core';
import {GPUGeometry, Model} from '@luma.gl/engine';

import {type ViewportSize} from './camera';
import {type StageProjector} from './projector';
import {type StackBackplate} from './stack-view';

const STACK_BACKPLATE_SHADER = /* wgsl */ `
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

const BACKPLATE_BLEND_PARAMETERS = {
  depthCompare: 'less-equal',
  depthWriteEnabled: true,
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
} as const;

type BackplateMesh = {
  fillColors: Float32Array;
  fillPositions: Float32Array;
  fillVertexCount: number;
  outlineColors: Float32Array;
  outlinePositions: Float32Array;
  outlineVertexCount: number;
};

export class StackBackplateLayer {
  private fillModel: Model;
  private outlineModel: Model;
  private fillPositionBuffer;
  private fillColorBuffer;
  private outlinePositionBuffer;
  private outlineColorBuffer;
  private fillCapacity = 6;
  private outlineCapacity = 8;
  private projectionFingerprint = '';
  private backplates: StackBackplate[] = [];

  constructor(private readonly device: Device) {
    this.fillPositionBuffer = this.createDynamicBuffer('stack-backplate-fill-positions', this.fillCapacity * 3);
    this.fillColorBuffer = this.createDynamicBuffer('stack-backplate-fill-colors', this.fillCapacity * 4);
    this.outlinePositionBuffer = this.createDynamicBuffer('stack-backplate-outline-positions', this.outlineCapacity * 3);
    this.outlineColorBuffer = this.createDynamicBuffer('stack-backplate-outline-colors', this.outlineCapacity * 4);

    this.fillModel = new Model(device, {
      id: 'stack-backplate-fill',
      source: STACK_BACKPLATE_SHADER,
      geometry: this.createGeometry('triangle-list', this.fillPositionBuffer, this.fillColorBuffer, this.fillCapacity),
      vertexCount: 0,
      parameters: BACKPLATE_BLEND_PARAMETERS,
    });
    this.outlineModel = new Model(device, {
      id: 'stack-backplate-outline',
      source: STACK_BACKPLATE_SHADER,
      geometry: this.createGeometry('line-list', this.outlinePositionBuffer, this.outlineColorBuffer, this.outlineCapacity),
      vertexCount: 0,
      parameters: BACKPLATE_BLEND_PARAMETERS,
    });
  }

  destroy(): void {
    this.fillModel.destroy();
    this.outlineModel.destroy();
    this.fillPositionBuffer.destroy();
    this.fillColorBuffer.destroy();
    this.outlinePositionBuffer.destroy();
    this.outlineColorBuffer.destroy();
  }

  update(
    projector: StageProjector,
    viewport: ViewportSize,
    backplates: StackBackplate[],
  ): void {
    const projectionFingerprint = projector.getProjectionFingerprint(viewport);

    if (
      projectionFingerprint === this.projectionFingerprint &&
      backplates === this.backplates
    ) {
      return;
    }

    const mesh = buildBackplateMesh(projector, viewport, backplates);
    this.projectionFingerprint = projectionFingerprint;
    this.backplates = backplates;

    if (mesh.fillVertexCount > this.fillCapacity) {
      this.fillCapacity = mesh.fillVertexCount;
      this.fillPositionBuffer.destroy();
      this.fillColorBuffer.destroy();
      this.fillPositionBuffer = this.createDynamicBuffer('stack-backplate-fill-positions', this.fillCapacity * 3);
      this.fillColorBuffer = this.createDynamicBuffer('stack-backplate-fill-colors', this.fillCapacity * 4);
      this.fillModel.setGeometry(
        this.createGeometry('triangle-list', this.fillPositionBuffer, this.fillColorBuffer, this.fillCapacity),
      );
    }

    if (mesh.outlineVertexCount > this.outlineCapacity) {
      this.outlineCapacity = mesh.outlineVertexCount;
      this.outlinePositionBuffer.destroy();
      this.outlineColorBuffer.destroy();
      this.outlinePositionBuffer = this.createDynamicBuffer('stack-backplate-outline-positions', this.outlineCapacity * 3);
      this.outlineColorBuffer = this.createDynamicBuffer('stack-backplate-outline-colors', this.outlineCapacity * 4);
      this.outlineModel.setGeometry(
        this.createGeometry('line-list', this.outlinePositionBuffer, this.outlineColorBuffer, this.outlineCapacity),
      );
    }

    this.fillPositionBuffer.write(mesh.fillPositions);
    this.fillColorBuffer.write(mesh.fillColors);
    this.fillModel.setVertexCount(mesh.fillVertexCount);
    this.outlinePositionBuffer.write(mesh.outlinePositions);
    this.outlineColorBuffer.write(mesh.outlineColors);
    this.outlineModel.setVertexCount(mesh.outlineVertexCount);
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    this.fillModel.draw(renderPass);
    this.outlineModel.draw(renderPass);
  }

  private createDynamicBuffer(id: string, scalarCount: number) {
    return this.device.createBuffer({
      id,
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: Math.max(1, scalarCount) * Float32Array.BYTES_PER_ELEMENT,
    });
  }

  private createGeometry(
    topology: 'line-list' | 'triangle-list',
    positionBuffer: ReturnType<Device['createBuffer']>,
    colorBuffer: ReturnType<Device['createBuffer']>,
    vertexCount: number,
  ): GPUGeometry {
    return new GPUGeometry({
      topology,
      vertexCount,
      bufferLayout: [
        {name: 'position', format: 'float32x3'},
        {name: 'color', format: 'float32x4'},
      ],
      attributes: {
        position: positionBuffer,
        color: colorBuffer,
      },
    });
  }
}

function buildBackplateMesh(
  projector: StageProjector,
  viewport: ViewportSize,
  backplates: StackBackplate[],
): BackplateMesh {
  const fillPositions: number[] = [];
  const fillColors: number[] = [];
  const outlinePositions: number[] = [];
  const outlineColors: number[] = [];

  for (const backplate of backplates) {
    const [topLeft, topRight, bottomRight, bottomLeft] = backplate.corners.map((corner) =>
      projector.projectWorldPointToClip(corner, viewport),
    );

    fillPositions.push(
      topLeft.x, topLeft.y, topLeft.z,
      bottomLeft.x, bottomLeft.y, bottomLeft.z,
      topRight.x, topRight.y, topRight.z,
      topRight.x, topRight.y, topRight.z,
      bottomLeft.x, bottomLeft.y, bottomLeft.z,
      bottomRight.x, bottomRight.y, bottomRight.z,
    );
    for (let vertexIndex = 0; vertexIndex < 6; vertexIndex += 1) {
      fillColors.push(...backplate.fillColor);
    }

    outlinePositions.push(
      topLeft.x, topLeft.y, topLeft.z,
      topRight.x, topRight.y, topRight.z,
      topRight.x, topRight.y, topRight.z,
      bottomRight.x, bottomRight.y, bottomRight.z,
      bottomRight.x, bottomRight.y, bottomRight.z,
      bottomLeft.x, bottomLeft.y, bottomLeft.z,
      bottomLeft.x, bottomLeft.y, bottomLeft.z,
      topLeft.x, topLeft.y, topLeft.z,
    );
    for (let vertexIndex = 0; vertexIndex < 8; vertexIndex += 1) {
      outlineColors.push(...backplate.outlineColor);
    }
  }

  return {
    fillColors: new Float32Array(fillColors),
    fillPositions: new Float32Array(fillPositions),
    fillVertexCount: fillPositions.length / 3,
    outlineColors: new Float32Array(outlineColors),
    outlinePositions: new Float32Array(outlinePositions),
    outlineVertexCount: outlinePositions.length / 3,
  };
}

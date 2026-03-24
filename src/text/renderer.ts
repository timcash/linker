import {Buffer, type Device} from '@luma.gl/core';
import {DynamicTexture, GPUGeometry, Model} from '@luma.gl/engine';

import {type Camera2D, type ViewportSize} from '../camera';
import type {LabelDefinition, TextRendererStats} from './types';
import {buildGlyphAtlas} from './atlas';
import {getCharacterSetFromLabels} from './charset';
import {layoutLabels} from './layout';

const TEXT_SHADER = /* wgsl */ `
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

type TextMesh = {
  colors: Float32Array;
  positions: Float32Array;
  uvs: Float32Array;
  vertexCount: number;
  visibleLabelCount: number;
  visibleLabels: string[];
  visibleGlyphCount: number;
};

const MAX_VISIBLE_LABEL_SAMPLE = 24;

export class TextRenderer {
  private readonly layout;
  private readonly texture: DynamicTexture;
  private readonly model: Model;
  private positionBuffer;
  private uvBuffer;
  private colorBuffer;
  private capacity = 0;
  private stats: TextRendererStats;

  constructor(device: Device, labels: LabelDefinition[]) {
    const atlas = buildGlyphAtlas(getCharacterSetFromLabels(labels));
    this.layout = layoutLabels(labels, atlas);
    this.texture = new DynamicTexture(device, {
      id: 'text-atlas',
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
    });

    this.positionBuffer = device.createBuffer({
      id: 'text-positions',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: 6 * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.uvBuffer = device.createBuffer({
      id: 'text-uvs',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: 6 * 2 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.colorBuffer = device.createBuffer({
      id: 'text-colors',
      usage: Buffer.VERTEX | Buffer.COPY_DST,
      byteLength: 6 * 4 * Float32Array.BYTES_PER_ELEMENT,
    });
    this.capacity = 6;

    this.model = new Model(device, {
      id: 'atlas-text',
      source: TEXT_SHADER,
      geometry: this.createGeometry(this.capacity),
      bindings: {
        glyphAtlas: this.texture,
      },
      vertexCount: 0,
      parameters: {
        depthWriteEnabled: false,
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha',
      },
    });

    this.stats = {
      labelCount: this.layout.labelCount,
      glyphCount: this.layout.glyphCount,
      visibleLabelCount: 0,
      visibleLabels: [],
      visibleGlyphCount: 0,
    };
  }

  get ready(): Promise<void> {
    return this.texture.ready.then(() => undefined);
  }

  destroy(): void {
    this.model.destroy();
    this.texture.destroy();
    this.positionBuffer.destroy();
    this.uvBuffer.destroy();
    this.colorBuffer.destroy();
  }

  update(camera: Camera2D, viewport: ViewportSize): void {
    if (!this.texture.isReady) {
      this.model.setVertexCount(0);
      return;
    }

    const mesh = buildTextMesh(this.layout.glyphs, camera, viewport);

    this.stats = {
      labelCount: this.layout.labelCount,
      glyphCount: this.layout.glyphCount,
      visibleLabelCount: mesh.visibleLabelCount,
      visibleLabels: mesh.visibleLabels,
      visibleGlyphCount: mesh.visibleGlyphCount,
    };

    if (mesh.vertexCount > this.capacity) {
      this.capacity = mesh.vertexCount;

      this.positionBuffer.destroy();
      this.uvBuffer.destroy();
      this.colorBuffer.destroy();

      this.positionBuffer = this.model.device.createBuffer({
        id: 'text-positions',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.uvBuffer = this.model.device.createBuffer({
        id: 'text-uvs',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 2 * Float32Array.BYTES_PER_ELEMENT,
      });
      this.colorBuffer = this.model.device.createBuffer({
        id: 'text-colors',
        usage: Buffer.VERTEX | Buffer.COPY_DST,
        byteLength: this.capacity * 4 * Float32Array.BYTES_PER_ELEMENT,
      });

      this.model.setGeometry(this.createGeometry(this.capacity));
    }

    if (mesh.vertexCount === 0) {
      this.model.setVertexCount(0);
      return;
    }

    this.positionBuffer.write(mesh.positions);
    this.uvBuffer.write(mesh.uvs);
    this.colorBuffer.write(mesh.colors);
    this.model.setVertexCount(mesh.vertexCount);
  }

  draw(renderPass: Parameters<Model['draw']>[0]): void {
    if (!this.texture.isReady || this.stats.visibleGlyphCount === 0) {
      return;
    }

    this.model.draw(renderPass);
  }

  getStats(): TextRendererStats {
    return this.stats;
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

function buildTextMesh(
  glyphs: ReturnType<typeof layoutLabels>['glyphs'],
  camera: Camera2D,
  viewport: ViewportSize,
): TextMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const visibleLabelIds = new Set<number>();
  const visibleLabels: string[] = [];
  let visibleGlyphCount = 0;

  for (const glyph of glyphs) {
    if (camera.zoom < glyph.minZoom || camera.zoom > glyph.maxZoom) {
      continue;
    }

    const anchor = camera.worldToScreen({x: glyph.anchorX, y: glyph.anchorY}, viewport);
    const left = anchor.x + glyph.offsetX;
    const top = anchor.y + glyph.offsetY;
    const right = left + glyph.width;
    const bottom = top + glyph.height;

    if (right < -8 || left > viewport.width + 8 || bottom < -8 || top > viewport.height + 8) {
      continue;
    }

    visibleGlyphCount += 1;
    if (!visibleLabelIds.has(glyph.labelId)) {
      visibleLabelIds.add(glyph.labelId);

      if (visibleLabels.length < MAX_VISIBLE_LABEL_SAMPLE) {
        visibleLabels.push(glyph.labelText);
      }
    }

    const topLeft = screenToClip(left, top, viewport);
    const topRight = screenToClip(right, top, viewport);
    const bottomLeft = screenToClip(left, bottom, viewport);
    const bottomRight = screenToClip(right, bottom, viewport);

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
    visibleLabelCount: visibleLabelIds.size,
    visibleLabels,
    visibleGlyphCount,
  };
}

function screenToClip(x: number, y: number, viewport: ViewportSize): {x: number; y: number} {
  return {
    x: (x / viewport.width) * 2 - 1,
    y: 1 - (y / viewport.height) * 2,
  };
}

import type {GlyphPlacement, LabelPlaneBasis, TextLayout} from './types';

const DEFAULT_PLANE_BASIS_X: LabelPlaneBasis = {x: 1, y: 0, z: 0};
const DEFAULT_PLANE_BASIS_Y: LabelPlaneBasis = {x: 0, y: -1, z: 0};

export type PackedGlyphLabelSummary = {
  glyphCount: number;
  labelText: string;
  zoomLevel: number;
  zoomRange: number;
};

export type PackedGlyphInstances = {
  anchors: Float32Array;
  colors: Float32Array;
  glyphRects: Float32Array;
  instanceCount: number;
  labelSummaries: PackedGlyphLabelSummary[];
  planeBasisXs: Float32Array;
  planeBasisYs: Float32Array;
  uvRects: Float32Array;
  zoomBands: Float32Array;
};

export function packGlyphInstances(layout: TextLayout): PackedGlyphInstances {
  const instanceCount = layout.glyphs.length;
  const anchors = new Float32Array(instanceCount * 3);
  const planeBasisXs = new Float32Array(instanceCount * 3);
  const planeBasisYs = new Float32Array(instanceCount * 3);
  const glyphRects = new Float32Array(instanceCount * 4);
  const uvRects = new Float32Array(instanceCount * 4);
  const colors = new Float32Array(instanceCount * 4);
  const zoomBands = new Float32Array(instanceCount * 2);
  const labelSummaries: PackedGlyphLabelSummary[] = [];
  let activeLabelId = -1;
  let activeLabelSummary: PackedGlyphLabelSummary | null = null;

  for (let index = 0; index < instanceCount; index += 1) {
    const glyph = layout.glyphs[index];

    if (!glyph) {
      continue;
    }

    if (glyph.labelId !== activeLabelId) {
      if (activeLabelSummary) {
        labelSummaries.push(activeLabelSummary);
      }

      activeLabelId = glyph.labelId;
      activeLabelSummary = {
        glyphCount: 0,
        labelText: glyph.labelText,
        zoomLevel: glyph.zoomLevel,
        zoomRange: glyph.zoomRange,
      };
    }

    if (activeLabelSummary) {
      activeLabelSummary.glyphCount += 1;
    }

    packGlyphInstance(
      glyph,
      index,
      anchors,
      planeBasisXs,
      planeBasisYs,
      glyphRects,
      uvRects,
      colors,
      zoomBands,
    );
  }

  if (activeLabelSummary) {
    labelSummaries.push(activeLabelSummary);
  }

  return {
    anchors,
    colors,
    glyphRects,
    instanceCount,
    labelSummaries,
    planeBasisXs,
    planeBasisYs,
    uvRects,
    zoomBands,
  };
}

function packGlyphInstance(
  glyph: GlyphPlacement,
  index: number,
  anchors: Float32Array,
  planeBasisXs: Float32Array,
  planeBasisYs: Float32Array,
  glyphRects: Float32Array,
  uvRects: Float32Array,
  colors: Float32Array,
  zoomBands: Float32Array,
): void {
  const anchorIndex = index * 3;
  const rectIndex = index * 4;
  const zoomIndex = index * 2;
  const planeBasisX = glyph.planeBasisX ?? DEFAULT_PLANE_BASIS_X;
  const planeBasisY = glyph.planeBasisY ?? DEFAULT_PLANE_BASIS_Y;

  anchors[anchorIndex] = glyph.anchorX;
  anchors[anchorIndex + 1] = glyph.anchorY;
  anchors[anchorIndex + 2] = glyph.anchorZ;

  planeBasisXs[anchorIndex] = planeBasisX.x;
  planeBasisXs[anchorIndex + 1] = planeBasisX.y;
  planeBasisXs[anchorIndex + 2] = planeBasisX.z ?? 0;

  planeBasisYs[anchorIndex] = planeBasisY.x;
  planeBasisYs[anchorIndex + 1] = planeBasisY.y;
  planeBasisYs[anchorIndex + 2] = planeBasisY.z ?? 0;

  glyphRects[rectIndex] = glyph.offsetX;
  glyphRects[rectIndex + 1] = glyph.offsetY;
  glyphRects[rectIndex + 2] = glyph.width;
  glyphRects[rectIndex + 3] = glyph.height;

  uvRects[rectIndex] = glyph.u0;
  uvRects[rectIndex + 1] = glyph.v0;
  uvRects[rectIndex + 2] = glyph.u1;
  uvRects[rectIndex + 3] = glyph.v1;

  colors[rectIndex] = glyph.color[0];
  colors[rectIndex + 1] = glyph.color[1];
  colors[rectIndex + 2] = glyph.color[2];
  colors[rectIndex + 3] = glyph.color[3];

  zoomBands[zoomIndex] = glyph.zoomLevel;
  zoomBands[zoomIndex + 1] = glyph.zoomRange;
}

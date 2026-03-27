import type {GlyphAtlas, GlyphPlacement, LabelBounds, LabelDefinition, TextLayout} from './types';

const DEFAULT_LABEL_COLOR = [0.92, 0.96, 1, 1] as const;
type MeasuredGlyphPlacement = Pick<
  GlyphPlacement,
  'height' | 'offsetX' | 'offsetY' | 'u0' | 'u1' | 'v0' | 'v1' | 'width'
>;

type MeasuredLabelLayout = {
  bounds: LabelBounds;
  glyphs: MeasuredGlyphPlacement[];
};

export function layoutLabels(labels: LabelDefinition[], atlas: GlyphAtlas): TextLayout {
  const glyphs: GlyphPlacement[] = [];

  labels.forEach((label, labelId) => {
    const color = label.color ?? [...DEFAULT_LABEL_COLOR];
    const measuredLabel = measureLabelLayout(label, atlas);

    for (const glyph of measuredLabel.glyphs) {
      glyphs.push({
        labelId,
        anchorX: label.location.x,
        anchorY: label.location.y,
        labelText: label.text,
        offsetX: glyph.offsetX,
        offsetY: glyph.offsetY,
        width: glyph.width,
        height: glyph.height,
        u0: glyph.u0,
        v0: glyph.v0,
        u1: glyph.u1,
        v1: glyph.v1,
        color: [...color],
        zoomLevel: label.zoomLevel,
        zoomRange: label.zoomRange,
      });
    }
  });

  return {
    labelCount: labels.length,
    glyphCount: glyphs.length,
    glyphs,
  };
}

export function measureLabelBounds(label: LabelDefinition, atlas: GlyphAtlas): LabelBounds {
  return measureLabelLayout(label, atlas).bounds;
}

function measureLabelLayout(label: LabelDefinition, atlas: GlyphAtlas): MeasuredLabelLayout {
  const glyphs: MeasuredGlyphPlacement[] = [];
  const characters = [...label.text];
  const scale = label.size;
  const totalAdvance = characters.reduce((sum, character) => {
    const glyphMetric = atlas.metrics.get(character);
    return sum + (glyphMetric?.advance ?? 0) * scale;
  }, 0);
  const labelKey = label.navigation?.key ?? label.text;
  let penX = -totalAdvance / 2;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let hasGlyphs = false;

  for (const character of characters) {
    const glyphMetric = atlas.metrics.get(character);

    if (!glyphMetric) {
      continue;
    }

    const offsetX = penX - atlas.padding * scale;
    const offsetY = -(atlas.ascent + atlas.padding) * scale;
    const width = glyphMetric.width * scale;
    const height = glyphMetric.height * scale;

    glyphs.push({
      offsetX,
      offsetY,
      width,
      height,
      u0: glyphMetric.u0,
      v0: glyphMetric.v0,
      u1: glyphMetric.u1,
      v1: glyphMetric.v1,
    });

    if (!hasGlyphs) {
      minX = offsetX;
      minY = offsetY;
      maxX = offsetX + width;
      maxY = offsetY + height;
      hasGlyphs = true;
    } else {
      minX = Math.min(minX, offsetX);
      minY = Math.min(minY, offsetY);
      maxX = Math.max(maxX, offsetX + width);
      maxY = Math.max(maxY, offsetY + height);
    }

    penX += glyphMetric.advance * scale;
  }

  return {
    bounds: {
      anchorX: label.location.x,
      anchorY: label.location.y,
      labelKey,
      labelText: label.text,
      maxX,
      maxY,
      minX,
      minY,
      zoomLevel: label.zoomLevel,
      zoomRange: label.zoomRange,
    },
    glyphs,
  };
}

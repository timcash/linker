import type {GlyphAtlas, GlyphPlacement, LabelDefinition, TextLayout} from './types';

const DEFAULT_LABEL_COLOR = [0.92, 0.96, 1, 1] as const;

export function layoutLabels(labels: LabelDefinition[], atlas: GlyphAtlas): TextLayout {
  const glyphs: GlyphPlacement[] = [];

  labels.forEach((label, labelId) => {
    const characters = [...label.text];
    const scale = label.size;
    const color = label.color ?? [...DEFAULT_LABEL_COLOR];
    const totalAdvance = characters.reduce((sum, character) => {
      const glyphMetric = atlas.metrics.get(character);
      return sum + (glyphMetric?.advance ?? 0) * scale;
    }, 0);

    let penX = -totalAdvance / 2;

    for (const character of characters) {
      const glyphMetric = atlas.metrics.get(character);

      if (!glyphMetric) {
        continue;
      }

      glyphs.push({
        labelId,
        anchorX: label.location.x,
        anchorY: label.location.y,
        labelText: label.text,
        offsetX: penX - atlas.padding * scale,
        offsetY: -(atlas.ascent + atlas.padding) * scale,
        width: glyphMetric.width * scale,
        height: glyphMetric.height * scale,
        u0: glyphMetric.u0,
        v0: glyphMetric.v0,
        u1: glyphMetric.u1,
        v1: glyphMetric.v1,
        color: [...color],
        zoomLevel: label.zoomLevel,
        zoomRange: label.zoomRange,
      });

      penX += glyphMetric.advance * scale;
    }
  });

  return {
    labelCount: labels.length,
    glyphCount: glyphs.length,
    glyphs,
  };
}

import type {GlyphAtlas, GlyphMetric} from './types';

const ATLAS_WIDTH = 512;
const FONT_SIZE = 48;
const FONT_FAMILY = 'monospace';
const PADDING = 12;

type PendingGlyph = {
  actualBoundingBoxLeft: number;
  advance: number;
  cellHeight: number;
  cellWidth: number;
  character: string;
  drawX: number;
  rowY: number;
};

export function buildGlyphAtlas(characterSet: string[]): GlyphAtlas {
  const scratchCanvas = document.createElement('canvas');
  const scratchContext = scratchCanvas.getContext('2d');

  if (!scratchContext) {
    throw new Error('Canvas 2D context is unavailable for glyph atlas generation.');
  }

  configureGlyphContext(scratchContext);

  const baselineMetrics = scratchContext.measureText('Mg');
  const ascent = Math.ceil(baselineMetrics.actualBoundingBoxAscent || FONT_SIZE * 0.8);
  const descent = Math.ceil(baselineMetrics.actualBoundingBoxDescent || FONT_SIZE * 0.2);
  const lineHeight = ascent + descent;

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  const pendingGlyphs: PendingGlyph[] = [];

  for (const character of characterSet) {
    const metrics = scratchContext.measureText(character);
    const advance = Math.max(1, Math.ceil(metrics.width || FONT_SIZE * 0.35));
    const actualBoundingBoxLeft = Math.ceil(metrics.actualBoundingBoxLeft || 0);
    const actualBoundingBoxRight = Math.ceil(metrics.actualBoundingBoxRight || metrics.width || 0);
    const drawWidth = Math.max(1, actualBoundingBoxLeft + actualBoundingBoxRight);
    const cellWidth = Math.max(advance, drawWidth) + PADDING * 2;
    const cellHeight = lineHeight + PADDING * 2;

    if (cursorX + cellWidth > ATLAS_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }

    pendingGlyphs.push({
      actualBoundingBoxLeft,
      advance,
      cellHeight,
      cellWidth,
      character,
      drawX: cursorX,
      rowY: cursorY,
    });

    cursorX += cellWidth;
    rowHeight = Math.max(rowHeight, cellHeight);
  }

  const atlasHeight = Math.max(cursorY + rowHeight, lineHeight + PADDING * 2);
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_WIDTH;
  atlasCanvas.height = atlasHeight;

  const atlasContext = atlasCanvas.getContext('2d');

  if (!atlasContext) {
    throw new Error('Canvas 2D context is unavailable for glyph atlas drawing.');
  }

  configureGlyphContext(atlasContext);
  atlasContext.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);

  const glyphMetrics = new Map<string, GlyphMetric>();

  for (const pendingGlyph of pendingGlyphs) {
    const baselineX = pendingGlyph.drawX + PADDING + pendingGlyph.actualBoundingBoxLeft;
    const baselineY = pendingGlyph.rowY + PADDING + ascent;

    atlasContext.fillText(pendingGlyph.character, baselineX, baselineY);

    const u0 = pendingGlyph.drawX / atlasCanvas.width;
    const u1 = (pendingGlyph.drawX + pendingGlyph.cellWidth) / atlasCanvas.width;
    const v0 = pendingGlyph.rowY / atlasCanvas.height;
    const v1 = (pendingGlyph.rowY + pendingGlyph.cellHeight) / atlasCanvas.height;

    glyphMetrics.set(pendingGlyph.character, {
      character: pendingGlyph.character,
      advance: pendingGlyph.advance,
      width: pendingGlyph.cellWidth,
      height: pendingGlyph.cellHeight,
      u0,
      v0,
      u1,
      v1,
    });
  }

  return {
    canvas: atlasCanvas,
    height: atlasCanvas.height,
    imageData: atlasContext.getImageData(0, 0, atlasCanvas.width, atlasCanvas.height).data,
    ascent,
    descent,
    lineHeight,
    padding: PADDING,
    metrics: glyphMetrics,
    width: atlasCanvas.width,
  };
}

function configureGlyphContext(context: CanvasRenderingContext2D): void {
  context.font = `600 ${FONT_SIZE}px ${FONT_FAMILY}`;
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#ffffff';
  context.imageSmoothingEnabled = true;
}

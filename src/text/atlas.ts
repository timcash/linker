import type {AtlasMode, GlyphAtlas, GlyphMetric} from './types';

const ATLAS_WIDTH = 512;
const FONT_SIZE = 48;
const FONT_FAMILY = 'monospace';
const PADDING = 12;
const SDF_RADIUS = Math.max(1, PADDING - 2);
const SDF_CUTOFF = 0.5;
const SDF_SMOOTHING = 0.08;
const DISTANCE_FIELD_INF = 1e12;

type BuildGlyphAtlasOptions = {
  mode?: AtlasMode;
};

type PendingGlyph = {
  actualBoundingBoxLeft: number;
  advance: number;
  cellHeight: number;
  cellWidth: number;
  character: string;
  drawX: number;
  rowY: number;
};

type GlyphAtlasLayout = {
  ascent: number;
  atlasHeight: number;
  descent: number;
  lineHeight: number;
  pendingGlyphs: PendingGlyph[];
};

export function buildGlyphAtlas(
  characterSet: string[],
  options: BuildGlyphAtlasOptions = {},
): GlyphAtlas {
  const mode = options.mode ?? 'bitmap';
  const scratchCanvas = document.createElement('canvas');
  const scratchContext = scratchCanvas.getContext('2d');

  if (!scratchContext) {
    throw new Error('Canvas 2D context is unavailable for glyph atlas generation.');
  }

  configureGlyphContext(scratchContext);

  const layout = measureGlyphAtlasLayout(characterSet, scratchContext);

  return mode === 'sdf' ? buildSdfGlyphAtlas(layout) : buildBitmapGlyphAtlas(layout);
}

function measureGlyphAtlasLayout(
  characterSet: string[],
  context: CanvasRenderingContext2D,
): GlyphAtlasLayout {
  const baselineMetrics = context.measureText('Mg');
  const ascent = Math.ceil(baselineMetrics.actualBoundingBoxAscent || FONT_SIZE * 0.8);
  const descent = Math.ceil(baselineMetrics.actualBoundingBoxDescent || FONT_SIZE * 0.2);
  const lineHeight = ascent + descent;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  const pendingGlyphs: PendingGlyph[] = [];

  for (const character of characterSet) {
    const metrics = context.measureText(character);
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

  return {
    ascent,
    atlasHeight: Math.max(cursorY + rowHeight, lineHeight + PADDING * 2),
    descent,
    lineHeight,
    pendingGlyphs,
  };
}

function buildBitmapGlyphAtlas(layout: GlyphAtlasLayout): GlyphAtlas {
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_WIDTH;
  atlasCanvas.height = layout.atlasHeight;

  const atlasContext = atlasCanvas.getContext('2d');

  if (!atlasContext) {
    throw new Error('Canvas 2D context is unavailable for glyph atlas drawing.');
  }

  configureGlyphContext(atlasContext);
  atlasContext.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);

  const glyphMetrics = new Map<string, GlyphMetric>();

  for (const pendingGlyph of layout.pendingGlyphs) {
    const baselineX = pendingGlyph.drawX + PADDING + pendingGlyph.actualBoundingBoxLeft;
    const baselineY = pendingGlyph.rowY + PADDING + layout.ascent;

    atlasContext.fillText(pendingGlyph.character, baselineX, baselineY);
    glyphMetrics.set(
      pendingGlyph.character,
      createGlyphMetric(pendingGlyph, atlasCanvas.width, atlasCanvas.height),
    );
  }

  return {
    canvas: atlasCanvas,
    height: atlasCanvas.height,
    imageData: atlasContext.getImageData(0, 0, atlasCanvas.width, atlasCanvas.height).data,
    mode: 'bitmap',
    ascent: layout.ascent,
    descent: layout.descent,
    lineHeight: layout.lineHeight,
    padding: PADDING,
    metrics: glyphMetrics,
    width: atlasCanvas.width,
  };
}

function buildSdfGlyphAtlas(layout: GlyphAtlasLayout): GlyphAtlas {
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = ATLAS_WIDTH;
  atlasCanvas.height = layout.atlasHeight;

  const atlasContext = atlasCanvas.getContext('2d');
  const glyphCanvas = document.createElement('canvas');
  const glyphContext = glyphCanvas.getContext('2d');

  if (!atlasContext || !glyphContext) {
    throw new Error('Canvas 2D context is unavailable for glyph atlas drawing.');
  }

  const atlasPixels = new Uint8ClampedArray(atlasCanvas.width * atlasCanvas.height * 4);
  const glyphMetrics = new Map<string, GlyphMetric>();

  for (const pendingGlyph of layout.pendingGlyphs) {
    glyphCanvas.width = pendingGlyph.cellWidth;
    glyphCanvas.height = pendingGlyph.cellHeight;
    configureGlyphContext(glyphContext);
    glyphContext.clearRect(0, 0, glyphCanvas.width, glyphCanvas.height);
    glyphContext.fillText(
      pendingGlyph.character,
      PADDING + pendingGlyph.actualBoundingBoxLeft,
      PADDING + layout.ascent,
    );

    const glyphBitmap = glyphContext.getImageData(0, 0, glyphCanvas.width, glyphCanvas.height);
    const sdfAlpha = buildGlyphSdfAlpha(glyphBitmap.data, glyphCanvas.width, glyphCanvas.height);

    writeGlyphSdfToAtlas(
      atlasPixels,
      atlasCanvas.width,
      pendingGlyph.drawX,
      pendingGlyph.rowY,
      glyphCanvas.width,
      glyphCanvas.height,
      sdfAlpha,
    );
    glyphMetrics.set(
      pendingGlyph.character,
      createGlyphMetric(pendingGlyph, atlasCanvas.width, atlasCanvas.height),
    );
  }

  atlasContext.putImageData(new ImageData(atlasPixels, atlasCanvas.width, atlasCanvas.height), 0, 0);

  return {
    canvas: atlasCanvas,
    height: atlasCanvas.height,
    imageData: atlasPixels,
    mode: 'sdf',
    ascent: layout.ascent,
    cutoff: SDF_CUTOFF,
    descent: layout.descent,
    lineHeight: layout.lineHeight,
    padding: PADDING,
    radius: SDF_RADIUS,
    smoothing: SDF_SMOOTHING,
    metrics: glyphMetrics,
    width: atlasCanvas.width,
  };
}

function buildGlyphSdfAlpha(
  bitmap: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8ClampedArray {
  const pixelCount = width * height;
  const foregroundDistances = new Float64Array(pixelCount);
  const backgroundDistances = new Float64Array(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const alpha = bitmap[pixelIndex * 4 + 3];
    const isInside = alpha >= 128;

    foregroundDistances[pixelIndex] = isInside ? 0 : DISTANCE_FIELD_INF;
    backgroundDistances[pixelIndex] = isInside ? DISTANCE_FIELD_INF : 0;
  }

  transformDistanceField(foregroundDistances, width, height);
  transformDistanceField(backgroundDistances, width, height);

  const sdfAlpha = new Uint8ClampedArray(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const signedDistance =
      Math.sqrt(backgroundDistances[pixelIndex]) - Math.sqrt(foregroundDistances[pixelIndex]);
    const normalized = clamp(0.5 + signedDistance / (SDF_RADIUS * 2), 0, 1);
    sdfAlpha[pixelIndex] = Math.round(normalized * 255);
  }

  return sdfAlpha;
}

function writeGlyphSdfToAtlas(
  atlasPixels: Uint8ClampedArray,
  atlasWidth: number,
  offsetX: number,
  offsetY: number,
  glyphWidth: number,
  glyphHeight: number,
  sdfAlpha: Uint8ClampedArray,
): void {
  for (let y = 0; y < glyphHeight; y += 1) {
    for (let x = 0; x < glyphWidth; x += 1) {
      const glyphIndex = y * glyphWidth + x;
      const atlasIndex = ((offsetY + y) * atlasWidth + offsetX + x) * 4;
      const alpha = sdfAlpha[glyphIndex];

      atlasPixels[atlasIndex] = 255;
      atlasPixels[atlasIndex + 1] = 255;
      atlasPixels[atlasIndex + 2] = 255;
      atlasPixels[atlasIndex + 3] = alpha;
    }
  }
}

function transformDistanceField(data: Float64Array, width: number, height: number): void {
  const maxDimension = Math.max(width, height);
  const working = new Float64Array(maxDimension);
  const distances = new Float64Array(maxDimension);
  const envelope = new Int32Array(maxDimension);
  const boundaries = new Float64Array(maxDimension + 1);
  const intermediate = new Float64Array(width * height);

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      working[y] = data[y * width + x];
    }

    transformDistanceField1d(working, height, distances, envelope, boundaries);

    for (let y = 0; y < height; y += 1) {
      intermediate[y * width + x] = distances[y];
    }
  }

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      working[x] = intermediate[rowOffset + x];
    }

    transformDistanceField1d(working, width, distances, envelope, boundaries);

    for (let x = 0; x < width; x += 1) {
      data[rowOffset + x] = distances[x];
    }
  }
}

function transformDistanceField1d(
  values: Float64Array,
  count: number,
  distances: Float64Array,
  envelope: Int32Array,
  boundaries: Float64Array,
): void {
  let hullSize = 0;
  envelope[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;

  for (let index = 1; index < count; index += 1) {
    let intersection = computeDistanceFieldIntersection(values, index, envelope[hullSize]);

    while (intersection <= boundaries[hullSize]) {
      hullSize -= 1;
      intersection = computeDistanceFieldIntersection(values, index, envelope[hullSize]);
    }

    hullSize += 1;
    envelope[hullSize] = index;
    boundaries[hullSize] = intersection;
    boundaries[hullSize + 1] = Number.POSITIVE_INFINITY;
  }

  hullSize = 0;

  for (let index = 0; index < count; index += 1) {
    while (boundaries[hullSize + 1] < index) {
      hullSize += 1;
    }

    const delta = index - envelope[hullSize];
    distances[index] = delta * delta + values[envelope[hullSize]];
  }
}

function computeDistanceFieldIntersection(
  values: Float64Array,
  leftIndex: number,
  rightIndex: number,
): number {
  return (
    (values[leftIndex] + leftIndex * leftIndex - (values[rightIndex] + rightIndex * rightIndex)) /
    (leftIndex * 2 - rightIndex * 2)
  );
}

function createGlyphMetric(
  pendingGlyph: PendingGlyph,
  atlasWidth: number,
  atlasHeight: number,
): GlyphMetric {
  const u0 = pendingGlyph.drawX / atlasWidth;
  const u1 = (pendingGlyph.drawX + pendingGlyph.cellWidth) / atlasWidth;
  const v0 = pendingGlyph.rowY / atlasHeight;
  const v1 = (pendingGlyph.rowY + pendingGlyph.cellHeight) / atlasHeight;

  return {
    character: pendingGlyph.character,
    advance: pendingGlyph.advance,
    width: pendingGlyph.cellWidth,
    height: pendingGlyph.cellHeight,
    u0,
    v0,
    u1,
    v1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function configureGlyphContext(context: CanvasRenderingContext2D): void {
  context.font = `600 ${FONT_SIZE}px ${FONT_FAMILY}`;
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.fillStyle = '#ffffff';
  context.imageSmoothingEnabled = true;
}

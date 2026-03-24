export type RgbaColor = [number, number, number, number];

export type LabelLocation = {
  x: number;
  y: number;
};

export type LabelDefinition = {
  color?: RgbaColor;
  location: LabelLocation;
  maxZoom: number;
  minZoom: number;
  size: number;
  text: string;
};

export type GlyphMetric = {
  character: string;
  advance: number;
  width: number;
  height: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

export type GlyphAtlas = {
  canvas: HTMLCanvasElement;
  height: number;
  imageData: Uint8ClampedArray;
  ascent: number;
  descent: number;
  lineHeight: number;
  padding: number;
  metrics: Map<string, GlyphMetric>;
  width: number;
};

export type GlyphPlacement = {
  labelId: number;
  anchorX: number;
  anchorY: number;
  labelText: string;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  maxZoom: number;
  minZoom: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  color: RgbaColor;
};

export type TextLayout = {
  labelCount: number;
  glyphCount: number;
  glyphs: GlyphPlacement[];
};

export type TextRendererStats = {
  labelCount: number;
  glyphCount: number;
  visibleLabelCount: number;
  visibleLabels: string[];
  visibleGlyphCount: number;
};

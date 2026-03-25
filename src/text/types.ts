export type RgbaColor = [number, number, number, number];

export const RENDERER_MODES = [
  'baseline',
  'instanced',
  'packed',
  'visible-index',
  'chunked',
] as const;

export type RendererMode = (typeof RENDERER_MODES)[number];
export type TextStrategy = RendererMode;
export const TEXT_STRATEGIES = RENDERER_MODES;

export const RENDERER_MODE_OPTIONS = [
  {mode: 'baseline', label: 'Baseline'},
  {mode: 'instanced', label: 'Instanced'},
  {mode: 'packed', label: 'Packed'},
  {mode: 'visible-index', label: 'Visible Index'},
  {mode: 'chunked', label: 'Chunked'},
] as const satisfies ReadonlyArray<{mode: RendererMode; label: string}>;
export const TEXT_STRATEGY_OPTIONS = RENDERER_MODE_OPTIONS;

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
  bytesUploadedPerFrame: number;
  labelCount: number;
  glyphCount: number;
  rendererMode: RendererMode;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleLabelCount: number;
  visibleLabels: string[];
  visibleGlyphCount: number;
};

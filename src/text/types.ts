export type RgbaColor = [number, number, number, number];

export const TEXT_STRATEGIES = [
  'baseline',
  'instanced',
  'packed',
  'visible-index',
  'chunked',
  'sdf-instanced',
  'sdf-visible-index',
] as const;

export type TextStrategy = (typeof TEXT_STRATEGIES)[number];

export const TEXT_STRATEGY_OPTIONS = [
  {mode: 'baseline', label: 'Baseline'},
  {mode: 'instanced', label: 'Instanced'},
  {mode: 'packed', label: 'Packed'},
  {mode: 'visible-index', label: 'Visible Index'},
  {mode: 'chunked', label: 'Chunked'},
  {mode: 'sdf-instanced', label: 'SDF Instanced'},
  {mode: 'sdf-visible-index', label: 'SDF Visible Index'},
] as const satisfies ReadonlyArray<{mode: TextStrategy; label: string}>;

export type AtlasMode = 'bitmap' | 'sdf';

export type LabelLocation = {
  x: number;
  y: number;
};

export type LabelDefinition = {
  color?: RgbaColor;
  location: LabelLocation;
  size: number;
  text: string;
  zoomLevel: number;
  zoomRange: number;
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
  mode: AtlasMode;
  ascent: number;
  cutoff?: number;
  descent: number;
  lineHeight: number;
  padding: number;
  radius?: number;
  smoothing?: number;
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
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  color: RgbaColor;
  zoomLevel: number;
  zoomRange: number;
};

export type TextLayout = {
  labelCount: number;
  glyphCount: number;
  glyphs: GlyphPlacement[];
};

export type TextLayerStats = {
  bytesUploadedPerFrame: number;
  labelCount: number;
  glyphCount: number;
  textStrategy: TextStrategy;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleLabelCount: number;
  visibleLabels: string[];
  visibleGlyphCount: number;
};

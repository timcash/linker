export type RgbaColor = [number, number, number, number];

export type TextStrategy = 'sdf-instanced';

export const TEXT_STRATEGIES = [
  'sdf-instanced',
] as const satisfies ReadonlyArray<TextStrategy>;

export const DEFAULT_TEXT_STRATEGY: TextStrategy = 'sdf-instanced';

export const TEXT_STRATEGY_OPTIONS = [
  {mode: 'sdf-instanced', label: 'SDF Instanced'},
] as const satisfies ReadonlyArray<{mode: TextStrategy; label: string}>;

export type AtlasMode = 'bitmap' | 'sdf';

export type LabelLocation = {
  x: number;
  y: number;
  z?: number;
};

export type LabelPlaneBasis = LabelLocation;

export type LabelNavigation = {
  key: string;
  column: number;
  row: number;
  layer: number;
  workplaneId: string;
};

export type LabelBounds = {
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  labelKey: string;
  labelText: string;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  planeBasisX?: LabelPlaneBasis;
  planeBasisY?: LabelPlaneBasis;
  zoomLevel: number;
  zoomRange: number;
};

export type LabelDefinition = {
  color?: RgbaColor;
  inputLinkKeys: string[];
  location: LabelLocation;
  navigation?: LabelNavigation;
  outputLinkKeys: string[];
  planeBasisX?: LabelPlaneBasis;
  planeBasisY?: LabelPlaneBasis;
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
  labelKey: string;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
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
  planeBasisX?: LabelPlaneBasis;
  planeBasisY?: LabelPlaneBasis;
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

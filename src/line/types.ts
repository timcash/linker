import type {LabelLocation, RgbaColor} from '../text/types';

export const LINE_STRATEGIES = ['arc-links', 'fan-links', 'orbit-links'] as const;

export type LineStrategy = (typeof LINE_STRATEGIES)[number];

export const DEFAULT_LINE_STRATEGY: LineStrategy = 'arc-links';

export const LINE_STRATEGY_OPTIONS = [
  {mode: 'arc-links', label: 'Arc Links'},
  {mode: 'fan-links', label: 'Fan Links'},
  {mode: 'orbit-links', label: 'Orbit Links'},
] as const satisfies ReadonlyArray<{mode: LineStrategy; label: string}>;

export type LineDefinition = {
  bendDirection: -1 | 1;
  color: RgbaColor;
  curveBias: number;
  curveDepth: number;
  curveLift: number;
  end: LabelLocation;
  lineWidth: number;
  start: LabelLocation;
  zoomLevel: number;
  zoomRange: number;
};

export type LineLayerStats = {
  curveFingerprint: string;
  lineLinkCount: number;
  lineStrategy: LineStrategy;
  lineVisibleLinkCount: number;
  submittedVertexCount: number;
};

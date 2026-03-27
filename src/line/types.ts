import type {LabelLocation, RgbaColor} from '../text/types';

export const LINK_POINTS = [
  'top-center',
  'right-center',
  'bottom-center',
  'left-center',
] as const;

export type LinkPoint = (typeof LINK_POINTS)[number];

export const LINE_STRATEGIES = ['rounded-step-links'] as const;

export type LineStrategy = (typeof LINE_STRATEGIES)[number];

export const DEFAULT_LINE_STRATEGY: LineStrategy = 'rounded-step-links';

export const LINE_STRATEGY_OPTIONS = [
  {mode: 'rounded-step-links', label: 'Rounded Step Links'},
] as const satisfies ReadonlyArray<{mode: LineStrategy; label: string}>;

export type LinkDefinition = {
  bendDirection: -1 | 1;
  color: RgbaColor;
  curveBias: number;
  curveDepth: number;
  curveLift: number;
  end: LabelLocation;
  endLinkPoint: LinkPoint;
  lineWidth: number;
  start: LabelLocation;
  startLinkPoint: LinkPoint;
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

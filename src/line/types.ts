import type {LabelLocation, RgbaColor} from '../text/types';

export const LINK_POINTS = [
  'top-center',
  'right-center',
  'bottom-center',
  'left-center',
] as const;

export type LinkPoint = (typeof LINK_POINTS)[number];

export const LINE_STRATEGIES = [
  'rounded-step-links',
  'arc-links',
  'orbit-links',
] as const;

export type LineStrategy = (typeof LINE_STRATEGIES)[number];

export const DEFAULT_LINE_STRATEGY: LineStrategy = 'rounded-step-links';

export const LINE_STRATEGY_OPTIONS = [
  {mode: 'rounded-step-links', label: 'Step'},
  {mode: 'arc-links', label: 'Arc'},
  {mode: 'orbit-links', label: 'Orbit'},
] as const satisfies ReadonlyArray<{mode: LineStrategy; label: string}>;

export type LinkDefinition = {
  bendDirection: -1 | 1;
  color: RgbaColor;
  curveBias: number;
  curveDepth: number;
  curveLift: number;
  inputLabelKey: string;
  inputLinkPoint: LinkPoint;
  inputLocation: LabelLocation;
  linkKey: string;
  lineWidth: number;
  outputLabelKey: string;
  outputLinkPoint: LinkPoint;
  outputLocation: LabelLocation;
  zoomLevel: number;
  zoomRange: number;
};

export type LineLayerStats = {
  curveFingerprint: string;
  lineDimmedLinkCount: number;
  lineHighlightedInputLinkCount: number;
  lineHighlightedOutputLinkCount: number;
  lineLinkCount: number;
  lineStrategy: LineStrategy;
  lineVisibleLinkCount: number;
  submittedVertexCount: number;
};

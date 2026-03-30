import {type ScreenPoint, type ViewportSize} from '../camera';
import {type StageProjector} from '../projector';
import type {
  GlyphPlacement,
  LabelBounds,
  LabelLocation,
  LabelPlaneBasis,
} from './types';
import {getZoomScale, isZoomVisible} from './zoom';

const DEFAULT_PLANE_BASIS_X: LabelPlaneBasis = {x: 1, y: 0, z: 0};
const DEFAULT_PLANE_BASIS_Y: LabelPlaneBasis = {x: 0, y: -1, z: 0};
const DEFAULT_SCREEN_BASIS_X: ScreenPoint = {x: 1, y: 0};
const DEFAULT_SCREEN_BASIS_Y: ScreenPoint = {x: 0, y: 1};
const BASIS_VECTOR_EPSILON = 0.0001;

type PlaneTextBox = {
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  planeBasisX?: LabelPlaneBasis;
  planeBasisY?: LabelPlaneBasis;
  zoomLevel: number;
  zoomRange: number;
};

export type ProjectedPlaneQuad = {
  basisX: ScreenPoint;
  basisY: ScreenPoint;
  bottom: number;
  depth: number;
  left: number;
  origin: ScreenPoint;
  right: number;
  top: number;
};

export function projectGlyphQuadToScreen(
  glyph: GlyphPlacement,
  projector: StageProjector,
  viewport: ViewportSize,
): ProjectedPlaneQuad | null {
  return projectPlaneTextBoxToScreen(
    {
      anchorX: glyph.anchorX,
      anchorY: glyph.anchorY,
      anchorZ: glyph.anchorZ,
      maxX: glyph.offsetX + glyph.width,
      maxY: glyph.offsetY + glyph.height,
      minX: glyph.offsetX,
      minY: glyph.offsetY,
      planeBasisX: glyph.planeBasisX,
      planeBasisY: glyph.planeBasisY,
      zoomLevel: glyph.zoomLevel,
      zoomRange: glyph.zoomRange,
    },
    projector,
    viewport,
  );
}

export function projectLabelBoundsToScreen(
  bounds: LabelBounds,
  projector: StageProjector,
  viewport: ViewportSize,
): ProjectedPlaneQuad | null {
  return projectPlaneTextBoxToScreen(bounds, projector, viewport);
}

function projectPlaneTextBoxToScreen(
  box: PlaneTextBox,
  projector: StageProjector,
  viewport: ViewportSize,
): ProjectedPlaneQuad | null {
  if (!isZoomVisible(projector.zoom, box.zoomLevel, box.zoomRange)) {
    return null;
  }

  const zoomScale = getZoomScale(projector.zoom, box.zoomLevel, box.zoomRange);
  const anchor = projector.projectWorldPoint(
    {x: box.anchorX, y: box.anchorY, z: box.anchorZ},
    viewport,
  );
  const anchorClip = projector.projectWorldPointToClip(
    {x: box.anchorX, y: box.anchorY, z: box.anchorZ},
    viewport,
  );
  const basisXUnit = getProjectedBasisUnit(
    box.anchorX,
    box.anchorY,
    box.anchorZ,
    box.planeBasisX ?? DEFAULT_PLANE_BASIS_X,
    projector,
    viewport,
    DEFAULT_SCREEN_BASIS_X,
  );
  const basisYUnit = getProjectedBasisUnit(
    box.anchorX,
    box.anchorY,
    box.anchorZ,
    box.planeBasisY ?? DEFAULT_PLANE_BASIS_Y,
    projector,
    viewport,
    DEFAULT_SCREEN_BASIS_Y,
  );
  const origin = {
    x: anchor.x + basisXUnit.x * box.minX * zoomScale + basisYUnit.x * box.minY * zoomScale,
    y: anchor.y + basisXUnit.y * box.minX * zoomScale + basisYUnit.y * box.minY * zoomScale,
  };
  const basisX = scaleScreenVector(basisXUnit, (box.maxX - box.minX) * zoomScale);
  const basisY = scaleScreenVector(basisYUnit, (box.maxY - box.minY) * zoomScale);
  const bounds = measureProjectedQuadBounds(origin, basisX, basisY);

  return {
    basisX,
    basisY,
    bottom: bounds.bottom,
    depth: anchorClip.z,
    left: bounds.left,
    origin,
    right: bounds.right,
    top: bounds.top,
  };
}

function getProjectedBasisUnit(
  anchorX: number,
  anchorY: number,
  anchorZ: number,
  planeBasis: LabelLocation,
  projector: StageProjector,
  viewport: ViewportSize,
  fallback: ScreenPoint,
): ScreenPoint {
  const anchor = projector.projectWorldPoint({x: anchorX, y: anchorY, z: anchorZ}, viewport);
  const target = projector.projectWorldPoint(
    {
      x: anchorX + planeBasis.x,
      y: anchorY + planeBasis.y,
      z: anchorZ + (planeBasis.z ?? 0),
    },
    viewport,
  );
  const basis = {
    x: target.x - anchor.x,
    y: target.y - anchor.y,
  };
  const length = Math.hypot(basis.x, basis.y);

  if (length <= BASIS_VECTOR_EPSILON) {
    return fallback;
  }

  return {
    x: basis.x / length,
    y: basis.y / length,
  };
}

function measureProjectedQuadBounds(
  origin: ScreenPoint,
  basisX: ScreenPoint,
  basisY: ScreenPoint,
): {bottom: number; left: number; right: number; top: number} {
  const topRight = addScreenPoints(origin, basisX);
  const bottomLeft = addScreenPoints(origin, basisY);
  const bottomRight = addScreenPoints(topRight, basisY);
  const xs = [origin.x, topRight.x, bottomLeft.x, bottomRight.x];
  const ys = [origin.y, topRight.y, bottomLeft.y, bottomRight.y];

  return {
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
  };
}

function addScreenPoints(
  left: ScreenPoint,
  right: ScreenPoint,
): ScreenPoint {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
  };
}

function scaleScreenVector(
  vector: ScreenPoint,
  scalar: number,
): ScreenPoint {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
  };
}

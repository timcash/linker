import type {WorldPoint} from '../camera';
import type {LineDefinition, LineStrategy} from './types';

type Vec2 = WorldPoint;

export function sampleLineCurve(
  link: LineDefinition,
  strategy: LineStrategy,
  segmentCount: number,
): Vec2[] {
  const safeSegmentCount = Math.max(4, segmentCount);
  const points: Vec2[] = [];

  for (let segmentIndex = 0; segmentIndex <= safeSegmentCount; segmentIndex += 1) {
    const t = segmentIndex / safeSegmentCount;
    points.push(sampleLinePoint(link, strategy, t));
  }

  return points;
}

function sampleLinePoint(
  link: LineDefinition,
  strategy: LineStrategy,
  t: number,
): Vec2 {
  switch (strategy) {
    case 'fan-links':
      return sampleFanLinks(link, t);
    case 'orbit-links':
      return sampleOrbitLinks(link, t);
    case 'arc-links':
    default:
      return sampleArcLinks(link, t);
  }
}

function sampleArcLinks(link: LineDefinition, t: number): Vec2 {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const base = lerpVec2(link.start, link.end, t);
  const curveAmplitude = getCurveAmplitude(link);
  const tangentDrift = (t - 0.5) * link.curveBias * getLinkDistance(link) * 0.18;
  const normalOffset = Math.sin(Math.PI * t) * curveAmplitude * link.bendDirection;

  return {
    x: base.x + normal.x * normalOffset + tangent.x * tangentDrift,
    y: base.y + normal.y * normalOffset + tangent.y * tangentDrift,
  };
}

function sampleFanLinks(link: LineDefinition, t: number): Vec2 {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const distance = getLinkDistance(link);
  const curveAmplitude = getCurveAmplitude(link) * 1.14;
  const startHandle = distance * (0.2 + link.curveBias * 0.45);
  const endHandle = distance * (0.08 + link.curveBias * 0.18);
  const control1 = {
    x:
      link.start.x +
      tangent.x * startHandle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.start.y +
      tangent.y * startHandle +
      normal.y * curveAmplitude * link.bendDirection,
  };
  const control2 = {
    x:
      link.end.x -
      tangent.x * endHandle +
      normal.x * curveAmplitude * link.bendDirection * 0.38,
    y:
      link.end.y -
      tangent.y * endHandle +
      normal.y * curveAmplitude * link.bendDirection * 0.38,
  };

  return cubicBezier(link.start, control1, control2, link.end, t);
}

function sampleOrbitLinks(link: LineDefinition, t: number): Vec2 {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const distance = getLinkDistance(link);
  const curveAmplitude = getCurveAmplitude(link) * 1.28;
  const handle = distance * (0.17 + link.curveBias * 0.22);
  const control1 = {
    x:
      link.start.x +
      tangent.x * handle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.start.y +
      tangent.y * handle +
      normal.y * curveAmplitude * link.bendDirection,
  };
  const control2 = {
    x:
      link.end.x -
      tangent.x * handle -
      normal.x * curveAmplitude * link.bendDirection * 0.82,
    y:
      link.end.y -
      tangent.y * handle -
      normal.y * curveAmplitude * link.bendDirection * 0.82,
  };

  return cubicBezier(link.start, control1, control2, link.end, t);
}

function cubicBezier(
  start: Vec2,
  control1: Vec2,
  control2: Vec2,
  end: Vec2,
  t: number,
): Vec2 {
  const inverse = 1 - t;
  const inverseSquared = inverse * inverse;
  const tSquared = t * t;
  const startWeight = inverseSquared * inverse;
  const control1Weight = 3 * inverseSquared * t;
  const control2Weight = 3 * inverse * tSquared;
  const endWeight = tSquared * t;

  return {
    x:
      start.x * startWeight +
      control1.x * control1Weight +
      control2.x * control2Weight +
      end.x * endWeight,
    y:
      start.y * startWeight +
      control1.y * control1Weight +
      control2.y * control2Weight +
      end.y * endWeight,
  };
}

function lerpVec2(start: Vec2, end: Vec2, t: number): Vec2 {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function getCurveAmplitude(link: LineDefinition): number {
  return getLinkDistance(link) * link.curveDepth + link.curveLift;
}

function getLinkDistance(link: Pick<LineDefinition, 'start' | 'end'>): number {
  return Math.hypot(link.end.x - link.start.x, link.end.y - link.start.y);
}

function getLinkTangent(link: Pick<LineDefinition, 'start' | 'end'>): Vec2 {
  const distance = getLinkDistance(link);

  if (distance <= 0.0001) {
    return {x: 1, y: 0};
  }

  return {
    x: (link.end.x - link.start.x) / distance,
    y: (link.end.y - link.start.y) / distance,
  };
}

function getLinkNormal(link: Pick<LineDefinition, 'start' | 'end'>): Vec2 {
  const tangent = getLinkTangent(link);

  return {
    x: -tangent.y,
    y: tangent.x,
  };
}

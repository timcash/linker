import type {WorldPoint} from '../camera';
import type {LinkDefinition, LinkPoint, LineStrategy} from './types';

type Vec2 = WorldPoint;
const CUBIC_ARC_HANDLE_RATIO = 0.5522847498307936;

export function sampleLineCurve(
  link: LinkDefinition,
  strategy: LineStrategy,
  segmentCount: number,
): Vec2[] {
  const safeSegmentCount = Math.max(4, segmentCount);

  if (strategy === 'rounded-step-links') {
    return sampleRoundedStepLinks(link, safeSegmentCount);
  }

  const points: Vec2[] = [];

  for (let segmentIndex = 0; segmentIndex <= safeSegmentCount; segmentIndex += 1) {
    const t = segmentIndex / safeSegmentCount;
    points.push(sampleLinePoint(link, strategy, t));
  }

  return points;
}

function sampleLinePoint(
  link: LinkDefinition,
  strategy: LineStrategy,
  t: number,
): Vec2 {
  switch (strategy) {
    case 'cubic-links':
      return sampleCubicLinks(link, t);
    case 'fan-links':
      return sampleFanLinks(link, t);
    case 'orbit-links':
      return sampleOrbitLinks(link, t);
    case 'arc-links':
    default:
      return sampleArcLinks(link, t);
  }
}

function sampleRoundedStepLinks(link: LinkDefinition, segmentCount: number): Vec2[] {
  const routePoints = getRoundedStepRoute(link);

  if (routePoints.length <= 2) {
    return routePoints;
  }

  return sampleRoundedPolyline(
    routePoints,
    segmentCount,
    getRoundedStepCornerRadius(link, routePoints),
  );
}

function sampleArcLinks(link: LinkDefinition, t: number): Vec2 {
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

function sampleCubicLinks(link: LinkDefinition, t: number): Vec2 {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const distance = getLinkDistance(link);
  const curveAmplitude = getCurveAmplitude(link) * 1.1;
  const handle = distance * (0.18 + link.curveBias * 0.28);
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
      tangent.x * handle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.end.y -
      tangent.y * handle +
      normal.y * curveAmplitude * link.bendDirection,
  };

  return cubicBezier(link.start, control1, control2, link.end, t);
}

function sampleFanLinks(link: LinkDefinition, t: number): Vec2 {
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

function sampleOrbitLinks(link: LinkDefinition, t: number): Vec2 {
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

function getRoundedStepRoute(link: LinkDefinition): Vec2[] {
  const startAxis = getLinkPointAxis(link.startLinkPoint);
  const endAxis = getLinkPointAxis(link.endLinkPoint);

  if (startAxis === 'horizontal' && endAxis === 'horizontal') {
    if (
      Math.abs(link.end.x - link.start.x) <= 0.0001 ||
      Math.abs(link.end.y - link.start.y) <= 0.0001
    ) {
      return [link.start, link.end];
    }

    const leadWeight = clamp(0.36 + link.curveBias * 0.18, 0.32, 0.46);
    const bendX = link.start.x + (link.end.x - link.start.x) * leadWeight;

    return createRoutePoints(
      link.start,
      {x: bendX, y: link.start.y},
      {x: bendX, y: link.end.y},
      link.end,
    );
  }

  if (startAxis === 'vertical' && endAxis === 'vertical') {
    if (
      Math.abs(link.end.y - link.start.y) <= 0.0001 ||
      Math.abs(link.end.x - link.start.x) <= 0.0001
    ) {
      return [link.start, link.end];
    }

    const leadWeight = clamp(0.36 + link.curveBias * 0.18, 0.32, 0.46);
    const bendY = link.start.y + (link.end.y - link.start.y) * leadWeight;

    return createRoutePoints(
      link.start,
      {x: link.start.x, y: bendY},
      {x: link.end.x, y: bendY},
      link.end,
    );
  }

  if (startAxis === 'horizontal') {
    return createRoutePoints(
      link.start,
      {x: link.end.x, y: link.start.y},
      link.end,
    );
  }

  return createRoutePoints(
    link.start,
    {x: link.start.x, y: link.end.y},
    link.end,
  );
}

function sampleRoundedPolyline(
  routePoints: Vec2[],
  segmentCount: number,
  cornerRadius: number,
): Vec2[] {
  if (routePoints.length <= 2 || cornerRadius <= 0.0001) {
    return routePoints;
  }

  const firstPoint = routePoints[0];

  if (!firstPoint) {
    return routePoints;
  }

  const sampledPoints: Vec2[] = [firstPoint];
  const cornerCount = Math.max(1, routePoints.length - 2);
  const cornerSegments = Math.max(4, Math.floor(segmentCount / cornerCount));

  for (let pointIndex = 1; pointIndex < routePoints.length - 1; pointIndex += 1) {
    const previous = routePoints[pointIndex - 1];
    const corner = routePoints[pointIndex];
    const next = routePoints[pointIndex + 1];

    if (!previous || !corner || !next) {
      continue;
    }

    const incoming = {
      x: corner.x - previous.x,
      y: corner.y - previous.y,
    };
    const outgoing = {
      x: next.x - corner.x,
      y: next.y - corner.y,
    };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);

    if (incomingLength <= 0.0001 || outgoingLength <= 0.0001) {
      pushUniquePoint(sampledPoints, corner);
      continue;
    }

    const effectiveRadius = Math.min(
      cornerRadius,
      incomingLength * 0.5,
      outgoingLength * 0.5,
    );

    if (effectiveRadius <= 0.0001) {
      pushUniquePoint(sampledPoints, corner);
      continue;
    }

    const incomingDirection = {
      x: incoming.x / incomingLength,
      y: incoming.y / incomingLength,
    };
    const outgoingDirection = {
      x: outgoing.x / outgoingLength,
      y: outgoing.y / outgoingLength,
    };
    const entry = {
      x: corner.x - incomingDirection.x * effectiveRadius,
      y: corner.y - incomingDirection.y * effectiveRadius,
    };
    const exit = {
      x: corner.x + outgoingDirection.x * effectiveRadius,
      y: corner.y + outgoingDirection.y * effectiveRadius,
    };
    const handleLength = effectiveRadius * CUBIC_ARC_HANDLE_RATIO;
    const control1 = {
      x: entry.x + incomingDirection.x * handleLength,
      y: entry.y + incomingDirection.y * handleLength,
    };
    const control2 = {
      x: exit.x - outgoingDirection.x * handleLength,
      y: exit.y - outgoingDirection.y * handleLength,
    };

    pushUniquePoint(sampledPoints, entry);
    appendCubicSegmentSamples(
      sampledPoints,
      entry,
      control1,
      control2,
      exit,
      cornerSegments,
    );
  }

  const lastPoint = routePoints[routePoints.length - 1];

  if (lastPoint) {
    pushUniquePoint(sampledPoints, lastPoint);
  }

  return sampledPoints;
}

function appendCubicSegmentSamples(
  sampledPoints: Vec2[],
  start: Vec2,
  control1: Vec2,
  control2: Vec2,
  end: Vec2,
  segmentCount: number,
): void {
  for (let segmentIndex = 1; segmentIndex <= segmentCount; segmentIndex += 1) {
    const t = segmentIndex / segmentCount;
    pushUniquePoint(sampledPoints, cubicBezier(start, control1, control2, end, t));
  }
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

function createRoutePoints(...points: Vec2[]): Vec2[] {
  const routePoints: Vec2[] = [];

  for (const point of points) {
    pushUniquePoint(routePoints, point);
  }

  return routePoints;
}

function getCurveAmplitude(link: LinkDefinition): number {
  return getLinkDistance(link) * link.curveDepth + link.curveLift;
}

function getRoundedStepCornerRadius(link: LinkDefinition, routePoints: Vec2[]): number {
  let minSegmentLength = Number.POSITIVE_INFINITY;

  for (let pointIndex = 0; pointIndex < routePoints.length - 1; pointIndex += 1) {
    const start = routePoints[pointIndex];
    const end = routePoints[pointIndex + 1];

    if (!start || !end) {
      continue;
    }

    minSegmentLength = Math.min(
      minSegmentLength,
      Math.hypot(end.x - start.x, end.y - start.y),
    );
  }

  if (!Number.isFinite(minSegmentLength) || minSegmentLength <= 0.0001) {
    return 0;
  }

  return clamp(
    minSegmentLength * (0.42 + link.curveBias * 0.16),
    0.04,
    0.22,
  );
}

function getLinkDistance(link: Pick<LinkDefinition, 'start' | 'end'>): number {
  return Math.hypot(link.end.x - link.start.x, link.end.y - link.start.y);
}

function getLinkTangent(link: Pick<LinkDefinition, 'start' | 'end'>): Vec2 {
  const distance = getLinkDistance(link);

  if (distance <= 0.0001) {
    return {x: 1, y: 0};
  }

  return {
    x: (link.end.x - link.start.x) / distance,
    y: (link.end.y - link.start.y) / distance,
  };
}

function getLinkNormal(link: Pick<LinkDefinition, 'start' | 'end'>): Vec2 {
  const tangent = getLinkTangent(link);

  return {
    x: -tangent.y,
    y: tangent.x,
  };
}

function getLinkPointAxis(linkPoint: LinkPoint): 'horizontal' | 'vertical' {
  switch (linkPoint) {
    case 'left-center':
    case 'right-center':
      return 'horizontal';
    case 'top-center':
    case 'bottom-center':
    default:
      return 'vertical';
  }
}

function pushUniquePoint(points: Vec2[], point: Vec2): void {
  const previous = points[points.length - 1];

  if (
    previous &&
    Math.abs(previous.x - point.x) <= 0.0001 &&
    Math.abs(previous.y - point.y) <= 0.0001
  ) {
    return;
  }

  points.push(point);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

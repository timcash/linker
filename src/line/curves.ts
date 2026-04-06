import type {LinkDefinition, LinkPoint, LineStrategy} from './types';

type CurvePoint = {
  x: number;
  y: number;
  z?: number;
};

type Vec2 = {
  x: number;
  y: number;
};

type SampleLinePointStrategy =
  | LineStrategy
  | 'arc-links'
  | 'cubic-links'
  | 'fan-links'
  | 'orbit-links';

const CUBIC_ARC_HANDLE_RATIO = 0.5522847498307936;

export function sampleLineCurve(
  link: LinkDefinition,
  strategy: LineStrategy,
  segmentCount: number,
): CurvePoint[] {
  const safeSegmentCount = Math.max(4, segmentCount);

  if (strategy === 'rounded-step-links') {
    return sampleRoundedStepLinks(link, safeSegmentCount);
  }

  const points: CurvePoint[] = [];

  for (let segmentIndex = 0; segmentIndex <= safeSegmentCount; segmentIndex += 1) {
    const t = segmentIndex / safeSegmentCount;
    points.push(sampleLinePoint(link, strategy, t));
  }

  return points;
}

function sampleLinePoint(
  link: LinkDefinition,
  strategy: SampleLinePointStrategy,
  t: number,
): CurvePoint {
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

function sampleRoundedStepLinks(link: LinkDefinition, segmentCount: number): CurvePoint[] {
  const routePoints = applyInterpolatedDepth(
    getRoundedStepRoute(link),
    link.outputLocation.z ?? 0,
    link.inputLocation.z ?? 0,
  );

  if (routePoints.length <= 2) {
    return routePoints;
  }

  return sampleRoundedPolyline(
    routePoints,
    segmentCount,
    getRoundedStepCornerRadius(link, routePoints),
  );
}

function sampleArcLinks(link: LinkDefinition, t: number): CurvePoint {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const base = lerpVec2(link.outputLocation, link.inputLocation, t);
  const curveAmplitude = getCurveAmplitude(link);
  const tangentDrift = (t - 0.5) * link.curveBias * getLinkDistance(link) * 0.18;
  const normalOffset = Math.sin(Math.PI * t) * curveAmplitude * link.bendDirection;

  return {
    x: base.x + normal.x * normalOffset + tangent.x * tangentDrift,
    y: base.y + normal.y * normalOffset + tangent.y * tangentDrift,
    z: base.z,
  };
}

function sampleCubicLinks(link: LinkDefinition, t: number): CurvePoint {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const distance = getLinkDistance(link);
  const curveAmplitude = getCurveAmplitude(link) * 1.1;
  const handle = distance * (0.18 + link.curveBias * 0.28);
  const control1 = {
    x:
      link.outputLocation.x +
      tangent.x * handle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.outputLocation.y +
      tangent.y * handle +
      normal.y * curveAmplitude * link.bendDirection,
    z: lerpNumber(link.outputLocation.z ?? 0, link.inputLocation.z ?? 0, 1 / 3),
  };
  const control2 = {
    x:
      link.inputLocation.x -
      tangent.x * handle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.inputLocation.y -
      tangent.y * handle +
      normal.y * curveAmplitude * link.bendDirection,
    z: lerpNumber(link.outputLocation.z ?? 0, link.inputLocation.z ?? 0, 2 / 3),
  };

  return cubicBezier(link.outputLocation, control1, control2, link.inputLocation, t);
}

function sampleFanLinks(link: LinkDefinition, t: number): CurvePoint {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const distance = getLinkDistance(link);
  const curveAmplitude = getCurveAmplitude(link) * 1.14;
  const startHandle = distance * (0.2 + link.curveBias * 0.45);
  const endHandle = distance * (0.08 + link.curveBias * 0.18);
  const control1 = {
    x:
      link.outputLocation.x +
      tangent.x * startHandle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.outputLocation.y +
      tangent.y * startHandle +
      normal.y * curveAmplitude * link.bendDirection,
    z: lerpNumber(link.outputLocation.z ?? 0, link.inputLocation.z ?? 0, 1 / 3),
  };
  const control2 = {
    x:
      link.inputLocation.x -
      tangent.x * endHandle +
      normal.x * curveAmplitude * link.bendDirection * 0.38,
    y:
      link.inputLocation.y -
      tangent.y * endHandle +
      normal.y * curveAmplitude * link.bendDirection * 0.38,
    z: lerpNumber(link.outputLocation.z ?? 0, link.inputLocation.z ?? 0, 2 / 3),
  };

  return cubicBezier(link.outputLocation, control1, control2, link.inputLocation, t);
}

function sampleOrbitLinks(link: LinkDefinition, t: number): CurvePoint {
  const tangent = getLinkTangent(link);
  const normal = getLinkNormal(link);
  const distance = getLinkDistance(link);
  const curveAmplitude = getCurveAmplitude(link) * 1.28;
  const handle = distance * (0.17 + link.curveBias * 0.22);
  const control1 = {
    x:
      link.outputLocation.x +
      tangent.x * handle +
      normal.x * curveAmplitude * link.bendDirection,
    y:
      link.outputLocation.y +
      tangent.y * handle +
      normal.y * curveAmplitude * link.bendDirection,
    z: lerpNumber(link.outputLocation.z ?? 0, link.inputLocation.z ?? 0, 1 / 3),
  };
  const control2 = {
    x:
      link.inputLocation.x -
      tangent.x * handle -
      normal.x * curveAmplitude * link.bendDirection * 0.82,
    y:
      link.inputLocation.y -
      tangent.y * handle -
      normal.y * curveAmplitude * link.bendDirection * 0.82,
    z: lerpNumber(link.outputLocation.z ?? 0, link.inputLocation.z ?? 0, 2 / 3),
  };

  return cubicBezier(link.outputLocation, control1, control2, link.inputLocation, t);
}

function getRoundedStepRoute(link: LinkDefinition): CurvePoint[] {
  const outputAxis = getLinkPointAxis(link.outputLinkPoint);
  const inputAxis = getLinkPointAxis(link.inputLinkPoint);

  if (outputAxis === 'horizontal' && inputAxis === 'horizontal') {
    if (
      Math.abs(link.inputLocation.x - link.outputLocation.x) <= 0.0001 ||
      Math.abs(link.inputLocation.y - link.outputLocation.y) <= 0.0001
    ) {
      return [link.outputLocation, link.inputLocation];
    }

    const leadWeight = clamp(0.36 + link.curveBias * 0.18, 0.32, 0.46);
    const bendX = link.outputLocation.x + (link.inputLocation.x - link.outputLocation.x) * leadWeight;

    return createRoutePoints(
      link.outputLocation,
      {x: bendX, y: link.outputLocation.y},
      {x: bendX, y: link.inputLocation.y},
      link.inputLocation,
    );
  }

  if (outputAxis === 'vertical' && inputAxis === 'vertical') {
    if (
      Math.abs(link.inputLocation.y - link.outputLocation.y) <= 0.0001 ||
      Math.abs(link.inputLocation.x - link.outputLocation.x) <= 0.0001
    ) {
      return [link.outputLocation, link.inputLocation];
    }

    const leadWeight = clamp(0.36 + link.curveBias * 0.18, 0.32, 0.46);
    const bendY = link.outputLocation.y + (link.inputLocation.y - link.outputLocation.y) * leadWeight;

    return createRoutePoints(
      link.outputLocation,
      {x: link.outputLocation.x, y: bendY},
      {x: link.inputLocation.x, y: bendY},
      link.inputLocation,
    );
  }

  if (outputAxis === 'horizontal') {
    return createRoutePoints(
      link.outputLocation,
      {x: link.inputLocation.x, y: link.outputLocation.y},
      link.inputLocation,
    );
  }

  return createRoutePoints(
    link.outputLocation,
    {x: link.outputLocation.x, y: link.inputLocation.y},
    link.inputLocation,
  );
}

function sampleRoundedPolyline(
  routePoints: CurvePoint[],
  segmentCount: number,
  cornerRadius: number,
): CurvePoint[] {
  if (routePoints.length <= 2 || cornerRadius <= 0.0001) {
    return routePoints;
  }

  const firstPoint = routePoints[0];

  if (!firstPoint) {
    return routePoints;
  }

  const sampledPoints: CurvePoint[] = [firstPoint];
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
      z: corner.z,
    };
    const exit = {
      x: corner.x + outgoingDirection.x * effectiveRadius,
      y: corner.y + outgoingDirection.y * effectiveRadius,
      z: corner.z,
    };
    const handleLength = effectiveRadius * CUBIC_ARC_HANDLE_RATIO;
    const control1 = {
      x: entry.x + incomingDirection.x * handleLength,
      y: entry.y + incomingDirection.y * handleLength,
      z: corner.z,
    };
    const control2 = {
      x: exit.x - outgoingDirection.x * handleLength,
      y: exit.y - outgoingDirection.y * handleLength,
      z: corner.z,
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
  sampledPoints: CurvePoint[],
  start: CurvePoint,
  control1: CurvePoint,
  control2: CurvePoint,
  end: CurvePoint,
  segmentCount: number,
): void {
  for (let segmentIndex = 1; segmentIndex <= segmentCount; segmentIndex += 1) {
    const t = segmentIndex / segmentCount;
    pushUniquePoint(sampledPoints, cubicBezier(start, control1, control2, end, t));
  }
}

function cubicBezier(
  start: CurvePoint,
  control1: CurvePoint,
  control2: CurvePoint,
  end: CurvePoint,
  t: number,
): CurvePoint {
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
    z:
      (start.z ?? 0) * startWeight +
      (control1.z ?? 0) * control1Weight +
      (control2.z ?? 0) * control2Weight +
      (end.z ?? 0) * endWeight,
  };
}

function lerpVec2(start: CurvePoint, end: CurvePoint, t: number): CurvePoint {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
    z: lerpNumber(start.z ?? 0, end.z ?? 0, t),
  };
}

function createRoutePoints(...points: CurvePoint[]): CurvePoint[] {
  const routePoints: CurvePoint[] = [];

  for (const point of points) {
    pushUniquePoint(routePoints, point);
  }

  return routePoints;
}

function getCurveAmplitude(link: LinkDefinition): number {
  return getLinkDistance(link) * link.curveDepth + link.curveLift;
}

function getRoundedStepCornerRadius(link: LinkDefinition, routePoints: CurvePoint[]): number {
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

function getLinkDistance(link: Pick<LinkDefinition, 'inputLocation' | 'outputLocation'>): number {
  return Math.hypot(link.inputLocation.x - link.outputLocation.x, link.inputLocation.y - link.outputLocation.y);
}

function getLinkTangent(link: Pick<LinkDefinition, 'inputLocation' | 'outputLocation'>): Vec2 {
  const distance = getLinkDistance(link);

  if (distance <= 0.0001) {
    return {x: 1, y: 0};
  }

  return {
    x: (link.inputLocation.x - link.outputLocation.x) / distance,
    y: (link.inputLocation.y - link.outputLocation.y) / distance,
  };
}

function getLinkNormal(link: Pick<LinkDefinition, 'inputLocation' | 'outputLocation'>): Vec2 {
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

function pushUniquePoint(points: CurvePoint[], point: CurvePoint): void {
  const previous = points[points.length - 1];

  if (
    previous &&
    Math.abs(previous.x - point.x) <= 0.0001 &&
    Math.abs(previous.y - point.y) <= 0.0001 &&
    Math.abs((previous.z ?? 0) - (point.z ?? 0)) <= 0.0001
  ) {
    return;
  }

  points.push(point);
}

function applyInterpolatedDepth(
  points: CurvePoint[],
  startZ: number,
  endZ: number,
): CurvePoint[] {
  if (points.length <= 1) {
    return points.map((point) => ({...point, z: startZ}));
  }

  return points.map((point, index) => ({
    ...point,
    z: lerpNumber(startZ, endZ, index / (points.length - 1)),
  }));
}

function lerpNumber(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

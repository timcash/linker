export type ScenePoint3D = {
  x: number;
  y: number;
  z: number;
};

export type SceneBounds3D = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type SceneVector3D = ScenePoint3D;

export function toScenePoint3D(
  point: {x: number; y: number; z?: number},
): ScenePoint3D {
  return {
    x: point.x,
    y: point.y,
    z: point.z ?? 0,
  };
}

export function addSceneVectors(
  left: ScenePoint3D,
  right: SceneVector3D,
): ScenePoint3D {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

export function subtractScenePoints(
  left: ScenePoint3D,
  right: ScenePoint3D,
): SceneVector3D {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

export function scaleSceneVector(
  vector: SceneVector3D,
  scalar: number,
): SceneVector3D {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

export function dotSceneVector(
  left: SceneVector3D,
  right: SceneVector3D,
): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

export function crossSceneVector(
  left: SceneVector3D,
  right: SceneVector3D,
): SceneVector3D {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

export function getSceneVectorLength(vector: SceneVector3D): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function normalizeSceneVector(
  vector: SceneVector3D,
  fallback: SceneVector3D,
): SceneVector3D {
  const length = getSceneVectorLength(vector);

  if (length <= 0.0001) {
    return fallback;
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

export function getSceneBoundsCenter(
  bounds: SceneBounds3D,
): ScenePoint3D {
  return {
    x: (bounds.minX + bounds.maxX) * 0.5,
    y: (bounds.minY + bounds.maxY) * 0.5,
    z: (bounds.minZ + bounds.maxZ) * 0.5,
  };
}

export function getSceneBoundsCorners(
  bounds: SceneBounds3D,
): ScenePoint3D[] {
  return [
    {x: bounds.minX, y: bounds.minY, z: bounds.minZ},
    {x: bounds.minX, y: bounds.minY, z: bounds.maxZ},
    {x: bounds.minX, y: bounds.maxY, z: bounds.minZ},
    {x: bounds.minX, y: bounds.maxY, z: bounds.maxZ},
    {x: bounds.maxX, y: bounds.minY, z: bounds.minZ},
    {x: bounds.maxX, y: bounds.minY, z: bounds.maxZ},
    {x: bounds.maxX, y: bounds.maxY, z: bounds.minZ},
    {x: bounds.maxX, y: bounds.maxY, z: bounds.maxZ},
  ];
}

export function normalizeSceneBounds(
  bounds: SceneBounds3D,
): SceneBounds3D {
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : -1;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : 1;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : -1;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 1;
  const minZ = Number.isFinite(bounds.minZ) ? bounds.minZ : -1;
  const maxZ = Number.isFinite(bounds.maxZ) ? bounds.maxZ : 1;

  return {
    minX: Math.min(minX, maxX - 0.0001),
    maxX: Math.max(maxX, minX + 0.0001),
    minY: Math.min(minY, maxY - 0.0001),
    maxY: Math.max(maxY, minY + 0.0001),
    minZ: Math.min(minZ, maxZ - 0.0001),
    maxZ: Math.max(maxZ, minZ + 0.0001),
  };
}

export function includeScenePointInBounds(
  bounds: SceneBounds3D | null,
  point: {x: number; y: number; z?: number},
): SceneBounds3D {
  const scenePoint = toScenePoint3D(point);

  if (!bounds) {
    return {
      minX: scenePoint.x,
      maxX: scenePoint.x,
      minY: scenePoint.y,
      maxY: scenePoint.y,
      minZ: scenePoint.z,
      maxZ: scenePoint.z,
    };
  }

  return {
    minX: Math.min(bounds.minX, scenePoint.x),
    maxX: Math.max(bounds.maxX, scenePoint.x),
    minY: Math.min(bounds.minY, scenePoint.y),
    maxY: Math.max(bounds.maxY, scenePoint.y),
    minZ: Math.min(bounds.minZ, scenePoint.z),
    maxZ: Math.max(bounds.maxZ, scenePoint.z),
  };
}

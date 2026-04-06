import {
  normalizeSceneVector,
  type SceneVector3D,
} from './scene-space';

export type StackCameraState = {
  azimuthRadians: number;
  distanceScale: number;
  elevationRadians: number;
};

const STACK_CAMERA_FORWARD_FALLBACK: SceneVector3D = {x: 0, y: 0, z: -1};
const DEFAULT_STACK_CAMERA_FORWARD = normalizeSceneVector(
  {x: -0.48, y: -0.42, z: -1},
  STACK_CAMERA_FORWARD_FALLBACK,
);
export const STACK_CAMERA_DISTANCE_SCALE_MIN = 0.55;
export const STACK_CAMERA_DISTANCE_SCALE_MAX = 3.5;
export const STACK_CAMERA_ELEVATION_MIN_RADIANS = -Math.PI * 0.45;
export const STACK_CAMERA_ELEVATION_MAX_RADIANS = Math.PI * 0.45;
const DEFAULT_STACK_CAMERA_AZIMUTH_RADIANS = Math.atan2(
  DEFAULT_STACK_CAMERA_FORWARD.x,
  -DEFAULT_STACK_CAMERA_FORWARD.z,
);
const DEFAULT_STACK_CAMERA_ELEVATION_RADIANS = Math.asin(
  clamp(DEFAULT_STACK_CAMERA_FORWARD.y, -1, 1),
);
const STACK_CAMERA_STATE_EPSILON = 0.0001;

export const DEFAULT_STACK_CAMERA_STATE: StackCameraState = {
  azimuthRadians: DEFAULT_STACK_CAMERA_AZIMUTH_RADIANS,
  distanceScale: 1,
  elevationRadians: DEFAULT_STACK_CAMERA_ELEVATION_RADIANS,
};

export function cloneStackCameraState(
  stackCamera: StackCameraState,
): StackCameraState {
  return {
    azimuthRadians: stackCamera.azimuthRadians,
    distanceScale: stackCamera.distanceScale,
    elevationRadians: stackCamera.elevationRadians,
  };
}

export function normalizeStackCameraState(
  stackCamera: Partial<StackCameraState> | null | undefined,
): StackCameraState {
  const azimuthRadians =
    typeof stackCamera?.azimuthRadians === 'number' && Number.isFinite(stackCamera.azimuthRadians)
      ? stackCamera.azimuthRadians
      : DEFAULT_STACK_CAMERA_STATE.azimuthRadians;
  const distanceScale =
    typeof stackCamera?.distanceScale === 'number' && Number.isFinite(stackCamera.distanceScale)
      ? stackCamera.distanceScale
      : DEFAULT_STACK_CAMERA_STATE.distanceScale;
  const elevationRadians =
    typeof stackCamera?.elevationRadians === 'number' && Number.isFinite(stackCamera.elevationRadians)
      ? stackCamera.elevationRadians
      : DEFAULT_STACK_CAMERA_STATE.elevationRadians;

  return {
    azimuthRadians: wrapRadians(azimuthRadians),
    distanceScale: clamp(
      distanceScale,
      STACK_CAMERA_DISTANCE_SCALE_MIN,
      STACK_CAMERA_DISTANCE_SCALE_MAX,
    ),
    elevationRadians: clamp(
      elevationRadians,
      STACK_CAMERA_ELEVATION_MIN_RADIANS,
      STACK_CAMERA_ELEVATION_MAX_RADIANS,
    ),
  };
}

export function orbitStackCamera(
  stackCamera: StackCameraState,
  deltaAzimuthRadians: number,
  deltaElevationRadians: number,
): StackCameraState {
  return normalizeStackCameraState({
    azimuthRadians: stackCamera.azimuthRadians + deltaAzimuthRadians,
    distanceScale: stackCamera.distanceScale,
    elevationRadians: stackCamera.elevationRadians + deltaElevationRadians,
  });
}

export function scaleStackCameraDistance(
  stackCamera: StackCameraState,
  factor: number,
): StackCameraState {
  if (!Number.isFinite(factor) || factor <= 0) {
    return cloneStackCameraState(stackCamera);
  }

  return normalizeStackCameraState({
    azimuthRadians: stackCamera.azimuthRadians,
    distanceScale: stackCamera.distanceScale * factor,
    elevationRadians: stackCamera.elevationRadians,
  });
}

export function getStackCameraForward(
  stackCamera: StackCameraState,
): SceneVector3D {
  const normalizedState = normalizeStackCameraState(stackCamera);
  const cosElevation = Math.cos(normalizedState.elevationRadians);

  return normalizeSceneVector(
    {
      x: Math.sin(normalizedState.azimuthRadians) * cosElevation,
      y: Math.sin(normalizedState.elevationRadians),
      z: -Math.cos(normalizedState.azimuthRadians) * cosElevation,
    },
    DEFAULT_STACK_CAMERA_FORWARD,
  );
}

export function isStackCameraAtDefault(
  stackCamera: StackCameraState,
): boolean {
  const normalizedState = normalizeStackCameraState(stackCamera);

  return (
    Math.abs(
      wrapRadians(
        normalizedState.azimuthRadians - DEFAULT_STACK_CAMERA_STATE.azimuthRadians,
      ),
    ) <= STACK_CAMERA_STATE_EPSILON &&
    Math.abs(
      normalizedState.elevationRadians - DEFAULT_STACK_CAMERA_STATE.elevationRadians,
    ) <= STACK_CAMERA_STATE_EPSILON &&
    Math.abs(
      normalizedState.distanceScale - DEFAULT_STACK_CAMERA_STATE.distanceScale,
    ) <= STACK_CAMERA_STATE_EPSILON
  );
}

function wrapRadians(value: number): number {
  const fullTurn = Math.PI * 2;
  let wrappedValue = (value + Math.PI) % fullTurn;

  if (wrappedValue < 0) {
    wrappedValue += fullTurn;
  }

  return wrappedValue - Math.PI;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

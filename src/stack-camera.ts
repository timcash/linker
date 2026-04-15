import {
  normalizeSceneVector,
  type SceneVector3D,
} from './scene-space';

export type StackCameraState = {
  azimuthRadians: number;
  distanceScale: number;
  elevationRadians: number;
};

const STACK_CAMERA_FOLLOW_RATE = 14;
const STACK_CAMERA_AZIMUTH_EPSILON = 0.0001;

const STACK_CAMERA_FORWARD_FALLBACK: SceneVector3D = {x: 0, y: 0, z: -1};
const DEFAULT_STACK_CAMERA_FORWARD = normalizeSceneVector(
  {x: -0.48, y: -0.42, z: -1},
  STACK_CAMERA_FORWARD_FALLBACK,
);
export const STACK_CAMERA_DISTANCE_SCALE_MIN = 0.18;
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

export class StackCameraAnimator {
  private currentState = cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE);
  private targetState = cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE);

  get isAnimating(): boolean {
    return !matchesStackCameraState(this.currentState, this.targetState);
  }

  getSnapshot(): StackCameraState {
    return cloneStackCameraState(this.currentState);
  }

  getTargetSnapshot(): StackCameraState {
    return cloneStackCameraState(this.targetState);
  }

  setView(stackCamera: StackCameraState): void {
    const normalizedState = normalizeStackCameraState(stackCamera);
    this.currentState = cloneStackCameraState(normalizedState);
    this.targetState = cloneStackCameraState(normalizedState);
  }

  setTargetView(stackCamera: StackCameraState): void {
    this.targetState = normalizeStackCameraState(stackCamera);
  }

  advance(deltaMs: number): boolean {
    if (!this.isAnimating) {
      return false;
    }

    const safeDeltaMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 16.67;
    const alpha = 1 - Math.exp((-safeDeltaMs * STACK_CAMERA_FOLLOW_RATE) / 1000);
    const azimuthDelta = wrapRadians(
      this.targetState.azimuthRadians - this.currentState.azimuthRadians,
    );

    this.currentState = normalizeStackCameraState({
      azimuthRadians: this.currentState.azimuthRadians + azimuthDelta * alpha,
      distanceScale: lerp(
        this.currentState.distanceScale,
        this.targetState.distanceScale,
        alpha,
      ),
      elevationRadians: lerp(
        this.currentState.elevationRadians,
        this.targetState.elevationRadians,
        alpha,
      ),
    });

    if (matchesStackCameraState(this.currentState, this.targetState)) {
      this.currentState = cloneStackCameraState(this.targetState);
    }

    return true;
  }
}

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

function matchesStackCameraState(
  currentState: StackCameraState,
  targetState: StackCameraState,
): boolean {
  return (
    Math.abs(
      wrapRadians(currentState.azimuthRadians - targetState.azimuthRadians),
    ) <= STACK_CAMERA_AZIMUTH_EPSILON &&
    Math.abs(currentState.elevationRadians - targetState.elevationRadians) <= STACK_CAMERA_STATE_EPSILON &&
    Math.abs(currentState.distanceScale - targetState.distanceScale) <= STACK_CAMERA_STATE_EPSILON
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

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

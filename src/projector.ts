import type {
  Camera2D,
  CameraSnapshot,
  ScreenPoint,
  ViewportSize,
  WorldBounds,
} from './camera';
import {
  addSceneVectors,
  crossSceneVector,
  dotSceneVector,
  getSceneBoundsCorners,
  getSceneBoundsCenter,
  normalizeSceneBounds,
  normalizeSceneVector,
  scaleSceneVector,
  subtractScenePoints,
  toScenePoint3D,
  type SceneBounds3D,
  type ScenePoint3D,
  type SceneVector3D,
} from './scene-space';
import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
  getStackCameraForward,
  normalizeStackCameraState,
  type StackCameraState,
} from './stack-camera';

const PROJECTOR_BASE_PIXELS_PER_WORLD_UNIT = 56;
const PLANE_FOCUS_FOV_Y_RADIANS = Math.PI / 3;
const STACK_CAMERA_FOV_Y_RADIANS = Math.PI / 3.3;
const STACK_CAMERA_PADDING = 1.08;
const STACK_CAMERA_NEAR = 0.1;
const STACK_CAMERA_FORWARD_FALLBACK: SceneVector3D = {x: 0, y: 0, z: -1};
const STACK_CAMERA_UP: SceneVector3D = {x: 0, y: 1, z: 0};
const STACK_CAMERA_SCREEN_PADDING_X_PX = 24;
const STACK_CAMERA_SCREEN_PADDING_Y_PX = 84;
const STACK_CAMERA_ORBIT_TARGET_FOLLOW_RATE = 10;
const STACK_CAMERA_ORBIT_TARGET_EPSILON = 0.0001;

export type StageWorldPoint = {
  x: number;
  y: number;
  z?: number;
};

export type ClipPoint = {
  x: number;
  y: number;
  z: number;
};

export type ProjectorKind = 'plane-focus' | 'stack-camera';

export type ProjectorUniforms = {
  aspect: number;
  eye: ScenePoint3D;
  far: number;
  forward: SceneVector3D;
  near: number;
  right: SceneVector3D;
  tanHalfFovY: number;
  up: SceneVector3D;
  viewportHeight: number;
  viewportWidth: number;
  zoom: number;
};

export type StageProjector = {
  readonly centerX: number;
  readonly centerY: number;
  readonly kind: ProjectorKind;
  readonly pixelsPerWorldUnit: number;
  readonly zoom: number;
  getProjectorUniforms: (viewport: ViewportSize) => ProjectorUniforms;
  getVisibleWorldBounds: (viewport: ViewportSize) => WorldBounds;
  getProjectionFingerprint: (viewport: ViewportSize) => string;
  projectWorldPoint: (point: StageWorldPoint, viewport: ViewportSize) => ScreenPoint;
  projectWorldPointToClip: (point: StageWorldPoint, viewport: ViewportSize) => ClipPoint;
};

export type PlaneFocusProjectorState = Pick<
  CameraSnapshot,
  'centerX' | 'centerY' | 'pixelsPerWorldUnit' | 'zoom'
>;

type PerspectiveCameraState = {
  eye: ScenePoint3D;
  far: number;
  fovYRadians: number;
  near: number;
  target: ScenePoint3D;
  up: SceneVector3D;
};

export class PlaneFocusProjector implements StageProjector {
  readonly kind = 'plane-focus' as const;

  constructor(private readonly camera: Camera2D) {}

  get centerX(): number {
    return this.camera.centerX;
  }

  get centerY(): number {
    return this.camera.centerY;
  }

  get pixelsPerWorldUnit(): number {
    return this.camera.pixelsPerWorldUnit;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  getVisibleWorldBounds(viewport: ViewportSize): WorldBounds {
    return getPlaneFocusVisibleWorldBounds(this.getState(), viewport);
  }

  getProjectorUniforms(viewport: ViewportSize): ProjectorUniforms {
    return getPerspectiveProjectorUniforms(
      getPlaneFocusPerspectiveCameraState(this.getState(), viewport),
      viewport,
      this.zoom,
    );
  }

  getProjectionFingerprint(viewport: ViewportSize): string {
    const state = this.getState();

    return [
      'plane-focus',
      viewport.width,
      viewport.height,
      state.centerX.toFixed(4),
      state.centerY.toFixed(4),
      state.zoom.toFixed(4),
    ].join(':');
  }

  projectWorldPoint(point: StageWorldPoint, viewport: ViewportSize): ScreenPoint {
    return projectPlaneFocusWorldPoint(this.getState(), point, viewport);
  }

  projectWorldPointToClip(point: StageWorldPoint, viewport: ViewportSize): ClipPoint {
    return projectPlaneFocusWorldPointToClip(this.getState(), point, viewport);
  }

  private getState(): PlaneFocusProjectorState {
    return {
      centerX: this.camera.centerX,
      centerY: this.camera.centerY,
      pixelsPerWorldUnit: this.camera.pixelsPerWorldUnit,
      zoom: this.camera.zoom,
    };
  }
}

export class StackCameraProjector implements StageProjector {
  readonly kind = 'stack-camera' as const;
  private currentOrbitTarget: ScenePoint3D = {x: 0, y: 0, z: 0};
  private sceneBounds: SceneBounds3D = {
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
    minZ: -1,
    maxZ: 1,
  };
  private viewport: ViewportSize = {
    width: 1280,
    height: 800,
  };
  private stackCamera: StackCameraState = cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE);
  private targetOrbitTarget: ScenePoint3D = {x: 0, y: 0, z: 0};

  get isAnimating(): boolean {
    return !matchesScenePoint3D(this.currentOrbitTarget, this.targetOrbitTarget);
  }

  get centerX(): number {
    return this.currentOrbitTarget.x;
  }

  get centerY(): number {
    return this.currentOrbitTarget.y;
  }

  get pixelsPerWorldUnit(): number {
    return measurePerspectivePixelsPerWorldUnit(
      this.getCameraState(this.viewport),
      this.sceneBounds,
      this.viewport,
    );
  }

  get zoom(): number {
    return Math.log2(
      this.getReferenceZoomPixelsPerWorldUnit(this.viewport) / PROJECTOR_BASE_PIXELS_PER_WORLD_UNIT,
    );
  }

  setSceneBounds(sceneBounds: SceneBounds3D): void {
    this.sceneBounds = normalizeSceneBounds(sceneBounds);
    this.currentOrbitTarget = clampOrbitTargetToSceneBounds(this.currentOrbitTarget, this.sceneBounds);
    this.targetOrbitTarget = clampOrbitTargetToSceneBounds(this.targetOrbitTarget, this.sceneBounds);
  }

  setOrbitTarget(orbitTarget: ScenePoint3D, options?: {immediate?: boolean}): void {
    const nextOrbitTarget = clampOrbitTargetToSceneBounds(orbitTarget, this.sceneBounds);

    this.targetOrbitTarget = nextOrbitTarget;

    if (options?.immediate) {
      this.currentOrbitTarget = nextOrbitTarget;
    }
  }

  setViewport(viewport: ViewportSize): void {
    this.viewport = {
      width: Math.max(1, viewport.width),
      height: Math.max(1, viewport.height),
    };
  }

  setStackCamera(stackCamera: StackCameraState): void {
    this.stackCamera = normalizeStackCameraState(stackCamera);
  }

  getStackCamera(): StackCameraState {
    return cloneStackCameraState(this.stackCamera);
  }

  advance(deltaMs: number): boolean {
    if (!this.isAnimating) {
      return false;
    }

    const safeDeltaMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 16.67;
    const alpha = 1 - Math.exp((-safeDeltaMs * STACK_CAMERA_ORBIT_TARGET_FOLLOW_RATE) / 1000);

    this.currentOrbitTarget = clampOrbitTargetToSceneBounds(
      {
        x: lerp(this.currentOrbitTarget.x, this.targetOrbitTarget.x, alpha),
        y: lerp(this.currentOrbitTarget.y, this.targetOrbitTarget.y, alpha),
        z: lerp(this.currentOrbitTarget.z, this.targetOrbitTarget.z, alpha),
      },
      this.sceneBounds,
    );

    if (matchesScenePoint3D(this.currentOrbitTarget, this.targetOrbitTarget)) {
      this.currentOrbitTarget = this.targetOrbitTarget;
    }

    return true;
  }

  getVisibleWorldBounds(viewport: ViewportSize): WorldBounds {
    const halfWidth = viewport.width / (2 * this.pixelsPerWorldUnit);
    const halfHeight = viewport.height / (2 * this.pixelsPerWorldUnit);

    return {
      minX: this.centerX - halfWidth,
      maxX: this.centerX + halfWidth,
      minY: this.centerY - halfHeight,
      maxY: this.centerY + halfHeight,
    };
  }

  getProjectorUniforms(viewport: ViewportSize): ProjectorUniforms {
    return getPerspectiveProjectorUniforms(
      this.getCameraState(viewport),
      viewport,
      this.zoom,
    );
  }

  getProjectionFingerprint(viewport: ViewportSize): string {
    return [
      'stack-camera',
      viewport.width,
      viewport.height,
      this.sceneBounds.minX.toFixed(3),
      this.sceneBounds.maxX.toFixed(3),
      this.sceneBounds.minY.toFixed(3),
      this.sceneBounds.maxY.toFixed(3),
      this.sceneBounds.minZ.toFixed(3),
      this.sceneBounds.maxZ.toFixed(3),
      this.stackCamera.azimuthRadians.toFixed(4),
      this.stackCamera.elevationRadians.toFixed(4),
      this.stackCamera.distanceScale.toFixed(4),
    ].join(':');
  }

  projectWorldPoint(point: StageWorldPoint, viewport: ViewportSize): ScreenPoint {
    return projectPerspectiveWorldPointToScreen(
      this.getCameraState(viewport),
      toScenePoint3D(point),
      viewport,
    );
  }

  projectWorldPointToClip(point: StageWorldPoint, viewport: ViewportSize): ClipPoint {
    return projectPerspectiveWorldPointToClip(
      this.getCameraState(viewport),
      toScenePoint3D(point),
      viewport,
    );
  }

  private getCameraState(viewport: ViewportSize): PerspectiveCameraState {
    return this.getCameraStateForStackCamera(viewport, this.stackCamera);
  }

  private getReferenceZoomPixelsPerWorldUnit(viewport: ViewportSize): number {
    return measurePerspectivePixelsPerWorldUnit(
      this.getCameraStateForStackCamera(
        viewport,
        {
          ...DEFAULT_STACK_CAMERA_STATE,
          distanceScale: this.stackCamera.distanceScale,
        },
        getSceneBoundsCenter(this.sceneBounds),
      ),
      this.sceneBounds,
      viewport,
    );
  }

  private getCameraStateForStackCamera(
    viewport: ViewportSize,
    stackCamera: StackCameraState,
    targetOverride?: ScenePoint3D,
  ): PerspectiveCameraState {
    const aspect = getSafeAspectRatio(viewport);
    const target = clampOrbitTargetToSceneBounds(
      targetOverride ?? this.currentOrbitTarget,
      this.sceneBounds,
    );
    const cameraBasis = getPerspectiveCameraBasis(
      getStackCameraForward(stackCamera),
      STACK_CAMERA_UP,
    );
    let horizontalExtent = 0;
    let verticalExtent = 0;
    let forwardExtent = 0;

    for (const corner of getSceneBoundsCorners(this.sceneBounds)) {
      const offset = subtractScenePoints(corner, target);
      horizontalExtent = Math.max(horizontalExtent, Math.abs(dotSceneVector(offset, cameraBasis.right)));
      verticalExtent = Math.max(verticalExtent, Math.abs(dotSceneVector(offset, cameraBasis.up)));
      forwardExtent = Math.max(forwardExtent, Math.abs(dotSceneVector(offset, cameraBasis.forward)));
    }

    const tanHalfFovY = Math.tan(STACK_CAMERA_FOV_Y_RADIANS * 0.5);
    const safeWidth = Math.max(1, viewport.width - STACK_CAMERA_SCREEN_PADDING_X_PX * 2);
    const safeHeight = Math.max(1, viewport.height - STACK_CAMERA_SCREEN_PADDING_Y_PX * 2);
    const widthScale = viewport.width / safeWidth;
    const heightScale = viewport.height / safeHeight;
    const requiredHorizontalDepth = horizontalExtent * widthScale / (tanHalfFovY * aspect);
    const requiredVerticalDepth = verticalExtent * heightScale / tanHalfFovY;
    const depthFromCenter =
      Math.max(requiredHorizontalDepth, requiredVerticalDepth, 1) *
        STACK_CAMERA_PADDING *
        stackCamera.distanceScale +
      forwardExtent;
    const eye = addSceneVectors(
      target,
      scaleSceneVector(cameraBasis.forward, -depthFromCenter),
    );

    return {
      eye,
      far: depthFromCenter + forwardExtent * 4 + 256,
      fovYRadians: STACK_CAMERA_FOV_Y_RADIANS,
      near: STACK_CAMERA_NEAR,
      target,
      up: STACK_CAMERA_UP,
    };
  }
}

export {StackCameraProjector as IsometricStackProjector};

function measurePerspectivePixelsPerWorldUnit(
  camera: PerspectiveCameraState,
  _sceneBounds: SceneBounds3D,
  viewport: ViewportSize,
): number {
  const start = projectPerspectiveWorldPointToScreen(camera, camera.target, viewport);
  const end = projectPerspectiveWorldPointToScreen(
    camera,
    {x: camera.target.x + 1, y: camera.target.y, z: camera.target.z},
    viewport,
  );

  return Math.max(0.0001, Math.hypot(end.x - start.x, end.y - start.y));
}

export function projectPlaneFocusWorldPoint(
  state: PlaneFocusProjectorState,
  point: StageWorldPoint,
  viewport: ViewportSize,
): ScreenPoint {
  return projectPerspectiveWorldPointToScreen(
    getPlaneFocusPerspectiveCameraState(state, viewport),
    toScenePoint3D(point),
    viewport,
  );
}

export function projectPlaneFocusWorldPointToClip(
  state: PlaneFocusProjectorState,
  point: StageWorldPoint,
  viewport: ViewportSize,
): ClipPoint {
  return projectPerspectiveWorldPointToClip(
    getPlaneFocusPerspectiveCameraState(state, viewport),
    toScenePoint3D(point),
    viewport,
  );
}

export function getPlaneFocusVisibleWorldBounds(
  state: PlaneFocusProjectorState,
  viewport: ViewportSize,
): WorldBounds {
  const halfWidth = viewport.width / (2 * state.pixelsPerWorldUnit);
  const halfHeight = viewport.height / (2 * state.pixelsPerWorldUnit);

  return {
    minX: state.centerX - halfWidth,
    maxX: state.centerX + halfWidth,
    minY: state.centerY - halfHeight,
    maxY: state.centerY + halfHeight,
  };
}

function getPlaneFocusPerspectiveCameraState(
  state: PlaneFocusProjectorState,
  viewport: ViewportSize,
): PerspectiveCameraState {
  const distance = getPlaneFocusCameraDistance(state.pixelsPerWorldUnit, viewport.height);

  return {
    eye: {x: state.centerX, y: state.centerY, z: distance},
    far: distance + 4096,
    fovYRadians: PLANE_FOCUS_FOV_Y_RADIANS,
    near: STACK_CAMERA_NEAR,
    target: {x: state.centerX, y: state.centerY, z: 0},
    up: STACK_CAMERA_UP,
  };
}

function getPlaneFocusCameraDistance(
  pixelsPerWorldUnit: number,
  viewportHeight: number,
): number {
  return viewportHeight / (2 * pixelsPerWorldUnit * Math.tan(PLANE_FOCUS_FOV_Y_RADIANS * 0.5));
}

function getPerspectiveProjectorUniforms(
  camera: PerspectiveCameraState,
  viewport: ViewportSize,
  zoom: number,
): ProjectorUniforms {
  const aspect = getSafeAspectRatio(viewport);
  const tanHalfFovY = Math.tan(camera.fovYRadians * 0.5);
  const basis = getPerspectiveCameraBasis(
    subtractScenePoints(camera.target, camera.eye),
    camera.up,
  );

  return {
    aspect,
    eye: camera.eye,
    far: camera.far,
    forward: basis.forward,
    near: camera.near,
    right: basis.right,
    tanHalfFovY,
    up: basis.up,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
    zoom,
  };
}

function projectPerspectiveWorldPointToScreen(
  camera: PerspectiveCameraState,
  point: ScenePoint3D,
  viewport: ViewportSize,
): ScreenPoint {
  const clip = projectPerspectiveWorldPointToClip(camera, point, viewport);

  return {
    x: (clip.x + 1) * viewport.width * 0.5,
    y: (1 - clip.y) * viewport.height * 0.5,
  };
}

function projectPerspectiveWorldPointToClip(
  camera: PerspectiveCameraState,
  point: ScenePoint3D,
  viewport: ViewportSize,
): ClipPoint {
  const aspect = getSafeAspectRatio(viewport);
  const tanHalfFovY = Math.tan(camera.fovYRadians * 0.5);
  const basis = getPerspectiveCameraBasis(
    subtractScenePoints(camera.target, camera.eye),
    camera.up,
  );
  const relative = subtractScenePoints(point, camera.eye);
  const depth = Math.max(camera.near, dotSceneVector(relative, basis.forward));
  const cameraX = dotSceneVector(relative, basis.right);
  const cameraY = dotSceneVector(relative, basis.up);

  return {
    x: cameraX / (depth * tanHalfFovY * aspect),
    y: cameraY / (depth * tanHalfFovY),
    z: clamp((depth - camera.near) / Math.max(0.0001, camera.far - camera.near), 0, 1),
  };
}

function getPerspectiveCameraBasis(
  forward: SceneVector3D,
  up: SceneVector3D,
): {forward: SceneVector3D; right: SceneVector3D; up: SceneVector3D} {
  const normalizedForward = normalizeSceneVector(forward, STACK_CAMERA_FORWARD_FALLBACK);
  const right = normalizeSceneVector(
    crossSceneVector(normalizedForward, up),
    {x: 1, y: 0, z: 0},
  );
  const normalizedUp = normalizeSceneVector(
    crossSceneVector(right, normalizedForward),
    STACK_CAMERA_UP,
  );

  return {
    forward: normalizedForward,
    right,
    up: normalizedUp,
  };
}

function getSafeAspectRatio(viewport: ViewportSize): number {
  return Math.max(0.0001, viewport.width / Math.max(1, viewport.height));
}

function matchesScenePoint3D(
  currentPoint: ScenePoint3D,
  targetPoint: ScenePoint3D,
): boolean {
  return (
    Math.abs(currentPoint.x - targetPoint.x) <= STACK_CAMERA_ORBIT_TARGET_EPSILON &&
    Math.abs(currentPoint.y - targetPoint.y) <= STACK_CAMERA_ORBIT_TARGET_EPSILON &&
    Math.abs(currentPoint.z - targetPoint.z) <= STACK_CAMERA_ORBIT_TARGET_EPSILON
  );
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampOrbitTargetToSceneBounds(
  orbitTarget: ScenePoint3D,
  sceneBounds: SceneBounds3D,
): ScenePoint3D {
  const normalizedBounds = normalizeSceneBounds(sceneBounds);

  return {
    x: clamp(orbitTarget.x, normalizedBounds.minX, normalizedBounds.maxX),
    y: clamp(orbitTarget.y, normalizedBounds.minY, normalizedBounds.maxY),
    z: clamp(orbitTarget.z, normalizedBounds.minZ, normalizedBounds.maxZ),
  };
}

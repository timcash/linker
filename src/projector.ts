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
  getSceneBoundsCenter,
  getSceneBoundsCorners,
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
const STACK_CAMERA_PADDING = 1.18;
const STACK_CAMERA_NEAR = 0.1;
const STACK_CAMERA_FORWARD_FALLBACK: SceneVector3D = {x: 0, y: 0, z: -1};
const STACK_CAMERA_UP: SceneVector3D = {x: 0, y: 1, z: 0};
const STACK_CAMERA_SCREEN_PADDING_PX = 96;

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

export type StageProjector = {
  readonly centerX: number;
  readonly centerY: number;
  readonly pixelsPerWorldUnit: number;
  readonly zoom: number;
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

  get centerX(): number {
    return getSceneBoundsCenter(this.sceneBounds).x;
  }

  get centerY(): number {
    return getSceneBoundsCenter(this.sceneBounds).y;
  }

  get pixelsPerWorldUnit(): number {
    const camera = this.getCameraState(this.viewport);
    const center = getSceneBoundsCenter(this.sceneBounds);
    const start = projectPerspectiveWorldPointToScreen(camera, center, this.viewport);
    const end = projectPerspectiveWorldPointToScreen(
      camera,
      {x: center.x + 1, y: center.y, z: center.z},
      this.viewport,
    );

    return Math.max(0.0001, Math.hypot(end.x - start.x, end.y - start.y));
  }

  get zoom(): number {
    return Math.log2(this.pixelsPerWorldUnit / PROJECTOR_BASE_PIXELS_PER_WORLD_UNIT);
  }

  setSceneBounds(sceneBounds: SceneBounds3D): void {
    this.sceneBounds = normalizeSceneBounds(sceneBounds);
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
    const aspect = getSafeAspectRatio(viewport);
    const center = getSceneBoundsCenter(this.sceneBounds);
    const cameraBasis = getPerspectiveCameraBasis(
      getStackCameraForward(this.stackCamera),
      STACK_CAMERA_UP,
    );
    let horizontalExtent = 0;
    let verticalExtent = 0;
    let forwardExtent = 0;

    for (const corner of getSceneBoundsCorners(this.sceneBounds)) {
      const offset = subtractScenePoints(corner, center);
      horizontalExtent = Math.max(horizontalExtent, Math.abs(dotSceneVector(offset, cameraBasis.right)));
      verticalExtent = Math.max(verticalExtent, Math.abs(dotSceneVector(offset, cameraBasis.up)));
      forwardExtent = Math.max(forwardExtent, Math.abs(dotSceneVector(offset, cameraBasis.forward)));
    }

    const tanHalfFovY = Math.tan(STACK_CAMERA_FOV_Y_RADIANS * 0.5);
    const safeWidth = Math.max(1, viewport.width - STACK_CAMERA_SCREEN_PADDING_PX * 2);
    const safeHeight = Math.max(1, viewport.height - STACK_CAMERA_SCREEN_PADDING_PX * 2);
    const widthScale = viewport.width / safeWidth;
    const heightScale = viewport.height / safeHeight;
    const requiredHorizontalDepth = horizontalExtent * widthScale / (tanHalfFovY * aspect);
    const requiredVerticalDepth = verticalExtent * heightScale / tanHalfFovY;
    const depthFromCenter =
      Math.max(requiredHorizontalDepth, requiredVerticalDepth, 1) * STACK_CAMERA_PADDING + forwardExtent;
    const eye = addSceneVectors(
      center,
      scaleSceneVector(cameraBasis.forward, -depthFromCenter),
    );

    return {
      eye,
      far: depthFromCenter + forwardExtent * 4 + 256,
      fovYRadians: STACK_CAMERA_FOV_Y_RADIANS,
      near: STACK_CAMERA_NEAR,
      target: center,
      up: STACK_CAMERA_UP,
    };
  }
}

export {StackCameraProjector as IsometricStackProjector};

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

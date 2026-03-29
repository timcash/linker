export type ViewportSize = {
  width: number;
  height: number;
};

export type ScreenPoint = {
  x: number;
  y: number;
};

export type WorldPoint = {
  x: number;
  y: number;
};

export type WorldBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type CameraSnapshot = {
  centerX: number;
  centerY: number;
  zoom: number;
  pixelsPerWorldUnit: number;
};

const BASE_PIXELS_PER_WORLD_UNIT = 56;
const MIN_ZOOM = 0;
const MAX_ZOOM = 40;
const WHEEL_SENSITIVITY = 0.0015;
const CAMERA_FOLLOW_RATE = 18;
const CAMERA_POSITION_EPSILON = 0.0001;
const CAMERA_ZOOM_EPSILON = 0.0001;

export class Camera2D {
  centerX = 0;
  centerY = 0;
  zoom = 0;
  private targetCenterX = 0;
  private targetCenterY = 0;
  private targetZoom = 0;

  get pixelsPerWorldUnit(): number {
    return getPixelsPerWorldUnit(this.zoom);
  }

  get isAnimating(): boolean {
    return !matchesCameraState(
      this.centerX,
      this.centerY,
      this.zoom,
      this.targetCenterX,
      this.targetCenterY,
      this.targetZoom,
    );
  }

  getSnapshot(): CameraSnapshot {
    return {
      centerX: this.centerX,
      centerY: this.centerY,
      zoom: this.zoom,
      pixelsPerWorldUnit: this.pixelsPerWorldUnit,
    };
  }

  getTargetSnapshot(): CameraSnapshot {
    return {
      centerX: this.targetCenterX,
      centerY: this.targetCenterY,
      zoom: this.targetZoom,
      pixelsPerWorldUnit: getPixelsPerWorldUnit(this.targetZoom),
    };
  }

  reset(): void {
    this.setTargetView(0, 0, 0);
  }

  setView(centerX: number, centerY: number, zoom: number): void {
    const clampedZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.centerX = centerX;
    this.centerY = centerY;
    this.zoom = clampedZoom;
    this.targetCenterX = centerX;
    this.targetCenterY = centerY;
    this.targetZoom = clampedZoom;
  }

  setTargetView(centerX: number, centerY: number, zoom: number): void {
    this.targetCenterX = centerX;
    this.targetCenterY = centerY;
    this.targetZoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  }

  advance(deltaMs: number): boolean {
    if (!this.isAnimating) {
      return false;
    }

    const safeDeltaMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 16.67;
    const alpha = 1 - Math.exp((-safeDeltaMs * CAMERA_FOLLOW_RATE) / 1000);

    this.centerX = lerp(this.centerX, this.targetCenterX, alpha);
    this.centerY = lerp(this.centerY, this.targetCenterY, alpha);
    this.zoom = lerp(this.zoom, this.targetZoom, alpha);

    if (
      matchesCameraState(
        this.centerX,
        this.centerY,
        this.zoom,
        this.targetCenterX,
        this.targetCenterY,
        this.targetZoom,
      )
    ) {
      this.centerX = this.targetCenterX;
      this.centerY = this.targetCenterY;
      this.zoom = this.targetZoom;
    }

    return true;
  }

  panByPixels(deltaX: number, deltaY: number): void {
    const inverseScale = 1 / getPixelsPerWorldUnit(this.targetZoom);
    this.targetCenterX -= deltaX * inverseScale;
    this.targetCenterY += deltaY * inverseScale;
  }

  zoomAtScreenPoint(deltaY: number, point: ScreenPoint, viewport: ViewportSize): void {
    const zoomBefore = this.targetZoom;
    const worldBefore = this.screenToWorldForState(
      point,
      viewport,
      this.targetCenterX,
      this.targetCenterY,
      this.targetZoom,
    );

    this.targetZoom = clamp(this.targetZoom - deltaY * WHEEL_SENSITIVITY, MIN_ZOOM, MAX_ZOOM);

    if (this.targetZoom === zoomBefore) {
      return;
    }

    const worldAfter = this.screenToWorldForState(
      point,
      viewport,
      this.targetCenterX,
      this.targetCenterY,
      this.targetZoom,
    );
    this.targetCenterX += worldBefore.x - worldAfter.x;
    this.targetCenterY += worldBefore.y - worldAfter.y;
  }

  worldToClip(point: WorldPoint, viewport: ViewportSize): WorldPoint {
    const screen = this.worldToScreen(point, viewport);
    return {
      x: (screen.x / viewport.width) * 2 - 1,
      y: 1 - (screen.y / viewport.height) * 2,
    };
  }

  worldToScreen(point: WorldPoint, viewport: ViewportSize): ScreenPoint {
    return this.worldToScreenForState(point, viewport, this.centerX, this.centerY, this.zoom);
  }

  screenToWorld(point: ScreenPoint, viewport: ViewportSize): WorldPoint {
    return this.screenToWorldForState(point, viewport, this.centerX, this.centerY, this.zoom);
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

  private worldToScreenForState(
    point: WorldPoint,
    viewport: ViewportSize,
    centerX: number,
    centerY: number,
    zoom: number,
  ): ScreenPoint {
    const scale = getPixelsPerWorldUnit(zoom);

    return {
      x: (point.x - centerX) * scale + viewport.width / 2,
      y: (centerY - point.y) * scale + viewport.height / 2,
    };
  }

  private screenToWorldForState(
    point: ScreenPoint,
    viewport: ViewportSize,
    centerX: number,
    centerY: number,
    zoom: number,
  ): WorldPoint {
    const scale = getPixelsPerWorldUnit(zoom);

    return {
      x: (point.x - viewport.width / 2) / scale + centerX,
      y: centerY - (point.y - viewport.height / 2) / scale,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getPixelsPerWorldUnit(zoom: number): number {
  return BASE_PIXELS_PER_WORLD_UNIT * 2 ** zoom;
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function matchesCameraState(
  centerX: number,
  centerY: number,
  zoom: number,
  targetCenterX: number,
  targetCenterY: number,
  targetZoom: number,
): boolean {
  return (
    Math.abs(centerX - targetCenterX) <= CAMERA_POSITION_EPSILON &&
    Math.abs(centerY - targetCenterY) <= CAMERA_POSITION_EPSILON &&
    Math.abs(zoom - targetZoom) <= CAMERA_ZOOM_EPSILON
  );
}

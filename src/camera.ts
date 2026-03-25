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
const MIN_ZOOM = -4;
const MAX_ZOOM = 6;
const WHEEL_SENSITIVITY = 0.0015;

export class Camera2D {
  centerX = 0;
  centerY = 0;
  zoom = 0;

  get pixelsPerWorldUnit(): number {
    return BASE_PIXELS_PER_WORLD_UNIT * 2 ** this.zoom;
  }

  getSnapshot(): CameraSnapshot {
    return {
      centerX: this.centerX,
      centerY: this.centerY,
      zoom: this.zoom,
      pixelsPerWorldUnit: this.pixelsPerWorldUnit,
    };
  }

  reset(): void {
    this.setView(0, 0, 0);
  }

  setView(centerX: number, centerY: number, zoom: number): void {
    this.centerX = centerX;
    this.centerY = centerY;
    this.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  }

  panByPixels(deltaX: number, deltaY: number): void {
    const inverseScale = 1 / this.pixelsPerWorldUnit;
    this.centerX -= deltaX * inverseScale;
    this.centerY += deltaY * inverseScale;
  }

  zoomAtScreenPoint(deltaY: number, point: ScreenPoint, viewport: ViewportSize): void {
    const zoomBefore = this.zoom;
    const worldBefore = this.screenToWorld(point, viewport);

    this.zoom = clamp(this.zoom - deltaY * WHEEL_SENSITIVITY, MIN_ZOOM, MAX_ZOOM);

    if (this.zoom === zoomBefore) {
      return;
    }

    const worldAfter = this.screenToWorld(point, viewport);
    this.centerX += worldBefore.x - worldAfter.x;
    this.centerY += worldBefore.y - worldAfter.y;
  }

  worldToClip(point: WorldPoint, viewport: ViewportSize): WorldPoint {
    const screen = this.worldToScreen(point, viewport);
    return {
      x: (screen.x / viewport.width) * 2 - 1,
      y: 1 - (screen.y / viewport.height) * 2,
    };
  }

  worldToScreen(point: WorldPoint, viewport: ViewportSize): ScreenPoint {
    const scale = this.pixelsPerWorldUnit;

    return {
      x: (point.x - this.centerX) * scale + viewport.width / 2,
      y: (this.centerY - point.y) * scale + viewport.height / 2,
    };
  }

  screenToWorld(point: ScreenPoint, viewport: ViewportSize): WorldPoint {
    const scale = this.pixelsPerWorldUnit;

    return {
      x: (point.x - viewport.width / 2) / scale + this.centerX,
      y: this.centerY - (point.y - viewport.height / 2) / scale,
    };
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
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

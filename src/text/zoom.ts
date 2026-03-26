export type ZoomBand = {
  zoomLevel: number;
  zoomRange: number;
};

export const MIN_ZOOM_SCALE = 0.72;

export function createZoomBand(minZoom: number, maxZoom: number): ZoomBand {
  return {
    zoomLevel: (minZoom + maxZoom) * 0.5,
    zoomRange: Math.max(0, (maxZoom - minZoom) * 0.5),
  };
}

export function getMinVisibleZoom(zoomLevel: number, zoomRange: number): number {
  return zoomLevel - Math.max(0, zoomRange);
}

export function getMaxVisibleZoom(zoomLevel: number, zoomRange: number): number {
  return zoomLevel + Math.max(0, zoomRange);
}

export function isZoomVisible(zoom: number, zoomLevel: number, zoomRange: number): boolean {
  return zoom >= getMinVisibleZoom(zoomLevel, zoomRange) && zoom <= getMaxVisibleZoom(zoomLevel, zoomRange);
}

export function getZoomScale(zoom: number, zoomLevel: number, zoomRange: number): number {
  const safeZoomRange = Math.max(0, zoomRange);

  if (safeZoomRange <= 0) {
    return 1;
  }

  const emphasis = clampNumber(1 - Math.abs(zoom - zoomLevel) / safeZoomRange, 0, 1);
  return MIN_ZOOM_SCALE + (1 - MIN_ZOOM_SCALE) * emphasis;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

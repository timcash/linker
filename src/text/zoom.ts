export type ZoomBand = {
  zoomLevel: number;
  zoomRange: number;
};

export const MIN_ZOOM_OPACITY = 0.18;
export const DOT_SCALE = 0.2;
export const LABEL_SCALE = 0.5;
export const EXIT_FADE_SCALE = 2.8;
export const EXIT_HIDE_SCALE = 4.5;

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

export function getZoomScale(zoom: number, zoomLevel: number, _zoomRange: number): number {
  void _zoomRange;
  return 2 ** (zoom - zoomLevel);
}

export function getZoomOpacity(zoom: number, zoomLevel: number, zoomRange: number): number {
  if (!isZoomVisible(zoom, zoomLevel, zoomRange)) {
    return 0;
  }

  const emphasis = getZoomEmphasis(getZoomScale(zoom, zoomLevel, zoomRange));

  if (emphasis === 1) {
    return 1;
  }

  return MIN_ZOOM_OPACITY + (1 - MIN_ZOOM_OPACITY) * emphasis;
}

function getZoomEmphasis(scale: number): number {
  const enter = smoothStep(normalizeBetween(scale, DOT_SCALE, LABEL_SCALE));
  const exit = smoothStep(normalizeBetween(scale, EXIT_HIDE_SCALE, EXIT_FADE_SCALE));

  return Math.min(enter, exit);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothStep(value: number): number {
  const clampedValue = clampNumber(value, 0, 1);
  return clampedValue * clampedValue * (3 - 2 * clampedValue);
}

function normalizeBetween(value: number, start: number, end: number): number {
  if (Math.abs(end - start) <= 0.0001) {
    return value >= end ? 1 : 0;
  }

  return clampNumber((value - start) / (end - start), 0, 1);
}

import type {LabelLocation} from './text/types';

export const GRID_LAYER_MAGNIFICATION = 3;
export const GRID_LAYER_ZOOM_STEP = Math.log2(GRID_LAYER_MAGNIFICATION);

export function createCenteredGridLocation(input: {
  column: number;
  columnOrigin: number;
  row: number;
  rowOrigin: number;
  stepX: number;
  stepY: number;
}): LabelLocation {
  const {column, columnOrigin, row, rowOrigin, stepX, stepY} = input;

  return {
    x: (column - columnOrigin) * stepX,
    y: (rowOrigin - row) * stepY,
  };
}

export function getLayerZoomLevel(
  baseZoomLevel: number,
  layer: number,
): number {
  if (layer <= 1) {
    return baseZoomLevel;
  }

  return baseZoomLevel + GRID_LAYER_ZOOM_STEP * (layer - 1);
}

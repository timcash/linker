import type {LabelDefinition} from '../text/types';
import {createZoomBand} from '../text/zoom';

const BENCHMARK_COLORS = [
  [0.88, 0.94, 1, 1],
  [0.8, 0.92, 1, 1],
  [0.93, 0.97, 1, 1],
  [0.84, 0.9, 1, 1],
] as const;

const BENCHMARK_ZOOM_WINDOWS = [
  {size: 0.92, ...createZoomBand(-4, 0.35)},
  {size: 0.78, ...createZoomBand(-0.2, 1.15)},
  {size: 0.68, ...createZoomBand(0.55, 2.4)},
  {size: 0.58, ...createZoomBand(1.2, 4)},
] as const;

const BENCHMARK_TEXT_VARIANTS = [
  'GRID NODE ALPHA',
  'VIEW TILE BRAVO',
  'GPU LABEL CHARLIE',
  'ZOOM BAND DELTA',
  'ANCHOR FIELD ECHO',
  'ATLAS RUN FOXTROT',
  'SCREEN PASS GOLF',
  'WORLD BLOCK HOTEL',
  'INDEX LIST INDIA',
  'CHUNK CELL JULIET',
  'TEXT LANE KILO',
  'DRAW SET LIMA',
  'MASK STEP MIKE',
  'FRAME PATH NOVEMBER',
  'PIXEL RING OSCAR',
  'LABEL STACK PAPA',
  'CAMERA SWEEP QUEBEC',
  'STATIC DATA ROMEO',
  'GPU QUERY SIERRA',
  'VIS TILE TANGO',
  'CLIP TEST UNIFORM',
  'DENSE GRID VECTOR',
  'ZOOM CHECK WHISKEY',
  'PAN LAYER XRAY',
  'TEXT FLOW YANKEE',
  'INDEX DRAW ZULU',
  'BAND PASS 01',
  'ATLAS TILE 02',
  'SCREEN LOOP 03',
  'WORLD GRID 04',
  'VISIBLE SET 05',
  'CHUNK PASS 06',
] as const;

const BENCHMARK_SPACING = 0.65;
const STATIC_BENCHMARK_MAX_LABEL_COUNT = 16384;

export const DEFAULT_BENCHMARK_LABEL_COUNT = 1024;
export const STATIC_BENCHMARK_COUNTS = [1024, 4096, 16384] as const;
export const STATIC_BENCHMARK_LABEL_SET_ID = 'static-benchmark-label-set-v2';

const STATIC_BENCHMARK_LABELS = createStaticBenchmarkLabels(STATIC_BENCHMARK_MAX_LABEL_COUNT);

export function getStaticBenchmarkLabels(count: number): LabelDefinition[] {
  const safeCount = Math.max(1, Math.min(STATIC_BENCHMARK_MAX_LABEL_COUNT, Math.floor(count)));
  return STATIC_BENCHMARK_LABELS.slice(0, safeCount);
}

function createStaticBenchmarkLabels(count: number): LabelDefinition[] {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const offsetX = (columns - 1) * BENCHMARK_SPACING * 0.5;
  const offsetY = (rows - 1) * BENCHMARK_SPACING * 0.5;
  const centerColumn = (columns - 1) * 0.5;
  const centerRow = (rows - 1) * 0.5;
  const cells: Array<{column: number; row: number; x: number; y: number}> = [];

  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    cells.push({
      column,
      row,
      x: column * BENCHMARK_SPACING - offsetX,
      y: offsetY - row * BENCHMARK_SPACING,
    });
  }

  cells.sort((left, right) => {
    const leftDx = Math.abs(left.column - centerColumn);
    const leftDy = Math.abs(left.row - centerRow);
    const rightDx = Math.abs(right.column - centerColumn);
    const rightDy = Math.abs(right.row - centerRow);
    const leftRing = Math.max(leftDx, leftDy);
    const rightRing = Math.max(rightDx, rightDy);

    if (leftRing !== rightRing) {
      return leftRing - rightRing;
    }

    const leftManhattan = leftDx + leftDy;
    const rightManhattan = rightDx + rightDy;

    if (leftManhattan !== rightManhattan) {
      return leftManhattan - rightManhattan;
    }

    if (left.row !== right.row) {
      return left.row - right.row;
    }

    return left.column - right.column;
  });

  return cells.map((cell, index) => {
    const styleIndex = index % BENCHMARK_ZOOM_WINDOWS.length;
    const style = BENCHMARK_ZOOM_WINDOWS[styleIndex];
    const textVariant = BENCHMARK_TEXT_VARIANTS[index % BENCHMARK_TEXT_VARIANTS.length];
    const clusterIndex = Math.floor(index / BENCHMARK_TEXT_VARIANTS.length);

    return {
      inputLinkKeys: [],
      text: `${textVariant} ${String(clusterIndex).padStart(3, '0')}`,
      location: {
        x: cell.x,
        y: cell.y,
      },
      outputLinkKeys: [],
      size: style.size,
      zoomLevel: style.zoomLevel,
      zoomRange: style.zoomRange,
      color: [...BENCHMARK_COLORS[styleIndex]] as LabelDefinition['color'],
    };
  });
}

import type {LabelDefinition} from '../text/types';

export const DEMO_LABELS: LabelDefinition[] = [
  {
    location: {x: -4.2, y: -2.7},
    maxZoom: 0.15,
    minZoom: -4,
    size: 1.1,
    text: 'BUTTON PAN',
  },
  {
    location: {x: 2.2, y: 0.25},
    maxZoom: 0.7,
    minZoom: -0.2,
    size: 1,
    text: 'WEBGPU LABEL',
    color: [0.96, 0.98, 1, 1],
  },
  {
    location: {x: 3.4, y: 2.45},
    maxZoom: 1.8,
    minZoom: 0.2,
    size: 1.1,
    text: 'LUMA TEXT',
    color: [0.78, 0.91, 1, 1],
  },
  {
    location: {x: 4.1, y: 1},
    maxZoom: 2.2,
    minZoom: 0.7,
    size: 0.9,
    text: 'MID DETAIL',
    color: [0.84, 0.95, 1, 1],
  },
  {
    location: {x: 4.4, y: -1.7},
    maxZoom: 4,
    minZoom: 0.95,
    size: 0.8,
    text: 'CLOSE READ',
    color: [0.92, 0.96, 1, 1],
  },
  {
    location: {x: 4.5, y: 3},
    maxZoom: -0.3,
    minZoom: -4,
    size: 1.2,
    text: 'WORLD VIEW',
    color: [0.87, 0.94, 1, 1],
  },
];

const BENCHMARK_COLORS = [
  [0.88, 0.94, 1, 1],
  [0.8, 0.92, 1, 1],
  [0.93, 0.97, 1, 1],
  [0.84, 0.9, 1, 1],
] as const;

const BENCHMARK_ZOOM_WINDOWS = [
  {minZoom: -4, maxZoom: 0.35, size: 0.92},
  {minZoom: -0.2, maxZoom: 1.15, size: 0.78},
  {minZoom: 0.55, maxZoom: 2.4, size: 0.68},
  {minZoom: 1.2, maxZoom: 4, size: 0.58},
] as const;

const BENCHMARK_SPACING = 0.65;

export const DEFAULT_BENCHMARK_LABEL_COUNT = 1024;

export function createBenchmarkLabels(count: number): LabelDefinition[] {
  const safeCount = Math.max(1, Math.floor(count));
  const columns = Math.ceil(Math.sqrt(safeCount));
  const rows = Math.ceil(safeCount / columns);
  const offsetX = (columns - 1) * BENCHMARK_SPACING * 0.5;
  const offsetY = (rows - 1) * BENCHMARK_SPACING * 0.5;
  const labels: LabelDefinition[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const styleIndex = index % BENCHMARK_ZOOM_WINDOWS.length;
    const style = BENCHMARK_ZOOM_WINDOWS[styleIndex];

    labels.push({
      text: `LABEL ${String(index).padStart(4, '0')}`,
      location: {
        x: column * BENCHMARK_SPACING - offsetX,
        y: offsetY - row * BENCHMARK_SPACING,
      },
      size: style.size,
      minZoom: style.minZoom,
      maxZoom: style.maxZoom,
      color: [...BENCHMARK_COLORS[styleIndex]] as LabelDefinition['color'],
    });
  }

  return labels;
}

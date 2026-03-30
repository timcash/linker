import {
  DEFAULT_LAYOUT_STRATEGY,
  layoutDemoEntries,
  type DemoHierarchyLocations,
  type DemoLayoutEntry,
  type LayoutStrategy,
} from './demo-layout';

import type {LabelDefinition, RgbaColor} from '../text/types';
import type {ZoomBand} from '../text/zoom';

type ZoomBandPreset = ZoomBand & {
  size: number;
};

type DemoHierarchyTexts = {
  child: string;
  root: string;
};

type DemoLabelEntry = {
  childWindow: ZoomBandPreset;
  hierarchyTexts: DemoHierarchyTexts;
  layoutEntry: DemoLayoutEntry;
  palette: (typeof DEMO_COLUMN_PALETTES)[number];
  rootWindow: ZoomBandPreset;
};

export {
  DEFAULT_LAYOUT_STRATEGY,
  LAYOUT_STRATEGIES,
  LAYOUT_STRATEGY_OPTIONS,
  type LayoutStrategy,
} from './demo-layout';

export const DEMO_SOURCE_COLUMN_COUNT = 12;
export const DEMO_ROWS_PER_SOURCE_COLUMN = 12;
export const DEMO_ROOT_LABEL_COUNT = DEMO_SOURCE_COLUMN_COUNT * DEMO_ROWS_PER_SOURCE_COLUMN;
export const MIN_DEMO_LAYER_COUNT = 2;
export const DEFAULT_DEMO_LAYER_COUNT = 12;
export const MAX_DEMO_LAYER_COUNT = 12;
export const DEMO_LABELS_PER_ROOT = DEFAULT_DEMO_LAYER_COUNT;
export const DEMO_LABEL_COUNT = DEMO_ROOT_LABEL_COUNT * DEMO_LABELS_PER_ROOT;

const DEMO_ROOT_WINDOW: ZoomBandPreset = {
  size: 0.26,
  zoomLevel: 0,
  zoomRange: 2.4,
};
const DEMO_CHILD_WINDOW: ZoomBandPreset = {
  size: 0.28,
  zoomLevel: 2,
  zoomRange: 2.4,
};

const DEMO_COLUMN_PALETTES: readonly [root: RgbaColor, child: RgbaColor][] = [
  [
    [0.92, 0.96, 1, 1],
    [0.78, 0.9, 1, 1],
  ],
  [
    [0.9, 0.95, 1, 1],
    [0.76, 0.88, 1, 1],
  ],
  [
    [0.88, 0.94, 1, 1],
    [0.74, 0.86, 1, 1],
  ],
  [
    [0.86, 0.93, 1, 1],
    [0.72, 0.84, 1, 1],
  ],
] as const;
const DEMO_ENTRIES = createDemoLabelEntries();

export const DEMO_LABELS: LabelDefinition[] = getDemoLabels();

export function getDemoLabels(
  layoutStrategy: LayoutStrategy = DEFAULT_LAYOUT_STRATEGY,
  layerCount: number = DEFAULT_DEMO_LAYER_COUNT,
): LabelDefinition[] {
  const normalizedLayerCount = normalizeDemoLayerCount(layerCount);
  const placement = layoutDemoEntries(
    DEMO_ENTRIES.map((entry) => entry.layoutEntry),
    layoutStrategy,
  );
  const labels: LabelDefinition[] = [];

  for (let layer = 1; layer <= normalizedLayerCount; layer += 1) {
    for (let index = 0; index < DEMO_ENTRIES.length; index += 1) {
      const entry = DEMO_ENTRIES[index];
      const locations = placement.locations[index];

      if (!entry || !locations) {
        continue;
      }

      labels.push(createDemoLayerLabel(entry, locations, layer, normalizedLayerCount));
    }
  }

  return labels;
}

export function getDemoLabelCount(layerCount: number = DEFAULT_DEMO_LAYER_COUNT): number {
  return DEMO_ROOT_LABEL_COUNT * normalizeDemoLayerCount(layerCount);
}

export function getDemoLayoutEntries(): DemoLayoutEntry[] {
  return DEMO_ENTRIES.map((entry) => entry.layoutEntry);
}

function createDemoLabelEntries(): DemoLabelEntry[] {
  const entries: DemoLabelEntry[] = [];

  for (let rowIndex = 0; rowIndex < DEMO_ROWS_PER_SOURCE_COLUMN; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < DEMO_SOURCE_COLUMN_COUNT; columnIndex += 1) {
      const hierarchyTexts = createDemoHierarchyTexts(columnIndex, rowIndex);

      entries.push({
        childWindow: DEMO_CHILD_WINDOW,
        hierarchyTexts,
        layoutEntry: {
          nodes: {
            root: {
              text: hierarchyTexts.root,
              size: DEMO_ROOT_WINDOW.size,
            },
            child: {
              text: hierarchyTexts.child,
              size: DEMO_CHILD_WINDOW.size,
            },
          },
          sourceColumnIndex: columnIndex,
          sourceRowIndex: rowIndex,
        },
        palette: DEMO_COLUMN_PALETTES[columnIndex % DEMO_COLUMN_PALETTES.length],
        rootWindow: DEMO_ROOT_WINDOW,
      });
    }
  }

  return entries;
}

function createDemoHierarchyTexts(columnIndex: number, rowIndex: number): DemoHierarchyTexts {
  const column = columnIndex + 1;
  const row = rowIndex + 1;

  return {
    root: `${column}:${row}:1`,
    child: `${column}:${row}:2`,
  };
}

function createDemoLayerLabel(
  entry: DemoLabelEntry,
  locations: DemoHierarchyLocations,
  layer: number,
  layerCount: number,
): LabelDefinition {
  const column = entry.layoutEntry.sourceColumnIndex + 1;
  const row = entry.layoutEntry.sourceRowIndex + 1;
  const key = `${column}:${row}:${layer}`;
  const layerWindow = getDemoLayerWindow(layer);
  const location = layer === 1 ? locations.root : locations.child;

  return {
    inputLinkKeys: [],
    text: key,
    location,
    navigation: {
      key,
      column,
      row,
      layer,
    },
    outputLinkKeys: [],
    size: layerWindow.size,
    zoomLevel: layerWindow.zoomLevel,
    zoomRange: layerWindow.zoomRange,
    color: getDemoLayerColor(entry.palette, layer, layerCount),
  };
}

function getDemoLayerWindow(layer: number): ZoomBandPreset {
  if (layer <= 1) {
    return DEMO_ROOT_WINDOW;
  }

  if (layer === 2) {
    return DEMO_CHILD_WINDOW;
  }

  return {
    size: DEMO_CHILD_WINDOW.size,
    zoomLevel: DEMO_CHILD_WINDOW.zoomLevel + (layer - 2),
    zoomRange: DEMO_CHILD_WINDOW.zoomRange,
  };
}

function getDemoLayerColor(
  palette: (typeof DEMO_COLUMN_PALETTES)[number],
  layer: number,
  layerCount: number,
): RgbaColor {
  if (layer <= 1) {
    return [...palette[0]];
  }

  const denominator = Math.max(1, layerCount - 1);
  const t = (layer - 1) / denominator;

  return mixColor(palette[0], palette[1], t);
}

function mixColor(left: RgbaColor, right: RgbaColor, t: number): RgbaColor {
  return [
    mixNumber(left[0], right[0], t),
    mixNumber(left[1], right[1], t),
    mixNumber(left[2], right[2], t),
    mixNumber(left[3], right[3], t),
  ];
}

function mixNumber(left: number, right: number, t: number): number {
  return left + (right - left) * clampNumber(t, 0, 1);
}

function normalizeDemoLayerCount(layerCount: number): number {
  return clampNumber(Math.round(layerCount), MIN_DEMO_LAYER_COUNT, MAX_DEMO_LAYER_COUNT);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

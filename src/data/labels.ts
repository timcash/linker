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
export const DEMO_LABELS_PER_ROOT = 2;
export const DEMO_LABEL_COUNT = DEMO_ROOT_LABEL_COUNT * DEMO_LABELS_PER_ROOT;

const DEMO_ROOT_WINDOW: ZoomBandPreset = {
  size: 0.26,
  zoomLevel: 0,
  zoomRange: 0.36,
};
const DEMO_CHILD_WINDOW: ZoomBandPreset = {
  size: 0.28,
  zoomLevel: 0.96,
  zoomRange: 0.48,
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

export function getDemoLabels(layoutStrategy: LayoutStrategy = DEFAULT_LAYOUT_STRATEGY): LabelDefinition[] {
  const placement = layoutDemoEntries(
    DEMO_ENTRIES.map((entry) => entry.layoutEntry),
    layoutStrategy,
  );
  const rootLabels = DEMO_ENTRIES.map((entry, index) => createDemoRootLabel(entry, placement.locations[index]));
  const childLabels = DEMO_ENTRIES.map((entry, index) => createDemoChildLabel(entry, placement.locations[index]));

  return [...rootLabels, ...childLabels];
}

export function getDemoLayoutEntries(): DemoLayoutEntry[] {
  return DEMO_ENTRIES.map((entry) => entry.layoutEntry);
}

function createDemoLabelEntries(): DemoLabelEntry[] {
  const entries: DemoLabelEntry[] = [];
  let rootIndex = 0;

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
          rootIndex,
          sourceColumnIndex: columnIndex,
          sourceRowIndex: rowIndex,
        },
        palette: DEMO_COLUMN_PALETTES[columnIndex % DEMO_COLUMN_PALETTES.length],
        rootWindow: DEMO_ROOT_WINDOW,
      });

      rootIndex += 1;
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

function createDemoRootLabel(
  entry: DemoLabelEntry,
  locations: DemoHierarchyLocations,
): LabelDefinition {
  return {
    text: entry.hierarchyTexts.root,
    location: locations.root,
    size: entry.rootWindow.size,
    zoomLevel: entry.rootWindow.zoomLevel,
    zoomRange: entry.rootWindow.zoomRange,
    color: entry.palette[0],
  };
}

function createDemoChildLabel(
  entry: DemoLabelEntry,
  locations: DemoHierarchyLocations,
): LabelDefinition {
  return {
    text: entry.hierarchyTexts.child,
    location: locations.child,
    size: entry.childWindow.size,
    zoomLevel: entry.childWindow.zoomLevel,
    zoomRange: entry.childWindow.zoomRange,
    color: entry.palette[1],
  };
}

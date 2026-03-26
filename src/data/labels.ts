import demoLabelSetCsv from './demo-label-set.csv?raw';

import type {LabelDefinition, LabelLocation, RgbaColor} from '../text/types';
import {createZoomBand, type ZoomBand} from '../text/zoom';

type ZoomBandPreset = ZoomBand & {
  size: number;
};

type DemoHierarchyLocations = {
  child: LabelLocation;
  detail: LabelLocation;
  root: LabelLocation;
};

type DemoHierarchyTexts = {
  child: string;
  detail: string;
  root: string;
};

export const LAYOUT_STRATEGIES = ['column-ramp', 'scan-grid'] as const;
export type LayoutStrategy = (typeof LAYOUT_STRATEGIES)[number];

export const LAYOUT_STRATEGY_OPTIONS = [
  {mode: 'column-ramp', label: 'Column Ramp'},
  {mode: 'scan-grid', label: 'Scan Grid'},
] as const satisfies ReadonlyArray<{mode: LayoutStrategy; label: string}>;

export const DEFAULT_LAYOUT_STRATEGY: LayoutStrategy = 'column-ramp';

const DEMO_COLUMN_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DEMO_ROOT_LABEL_COUNT = DEMO_COLUMN_COUNTS.reduce((sum, count) => sum + count, 0);
const DEMO_COLUMN_SPACING = 2.4;
const DEMO_TOP_Y = 6.1;
const DEMO_ROW_SPACING = 1.34;
const DEMO_CHILD_X_OFFSET = 0.48;
const DEMO_CHILD_Y_OFFSET = -0.18;
const DEMO_DETAIL_X_OFFSET = 0.94;
const DEMO_DETAIL_Y_OFFSET = -0.38;
const DEMO_SCAN_GRID_COLUMN_COUNT = 7;
const DEMO_SCAN_GRID_COLUMN_SPACING = 3.8;
const DEMO_SCAN_GRID_TOP_Y = 7.1;
const DEMO_SCAN_GRID_ROW_SPACING = 1.58;
const DEMO_SCAN_GRID_CHILD_Y_OFFSET = -0.34;
const DEMO_SCAN_GRID_DETAIL_Y_OFFSET = -0.7;
const DEMO_SCAN_GRID_STACK_X_OFFSET = 0.18;

const DEMO_ROOT_WINDOW = {size: 0.58, ...createZoomBand(-0.6, 0.15)};
const DEMO_CHILD_WINDOW = {size: 0.42, ...createZoomBand(0.2, 0.45)};
const DEMO_DETAIL_WINDOW = {size: 0.32, ...createZoomBand(0.95, 2.8)};
const DEMO_WORLD_WINDOW = {size: 0.68, ...createZoomBand(-4, -0.18)};

const DEMO_COLUMN_PALETTES: readonly [
  root: RgbaColor,
  child: RgbaColor,
  detail: RgbaColor,
][] = [
  [
    [0.92, 0.96, 1, 1],
    [0.83, 0.93, 1, 1],
    [0.76, 0.9, 1, 1],
  ],
  [
    [0.9, 0.95, 1, 1],
    [0.8, 0.92, 1, 1],
    [0.74, 0.88, 1, 1],
  ],
  [
    [0.88, 0.94, 1, 1],
    [0.79, 0.9, 1, 1],
    [0.72, 0.86, 1, 1],
  ],
  [
    [0.86, 0.93, 1, 1],
    [0.77, 0.89, 1, 1],
    [0.7, 0.85, 1, 1],
  ],
] as const;

const DEMO_FOCUS_SUFFIXES = [
  'ZOOM IN',
  'FOCUS',
  'DETAIL',
  'SUBSET',
  'CHILD',
  'INNER',
] as const;

const DEMO_DETAIL_SUFFIXES = [
  'CLOSE READ',
  'DEEP DETAIL',
  'LOCAL TILE',
  'INNER NODE',
  'DETAIL STACK',
  'FOCUS TILE',
] as const;

const DEMO_ROOT_TEXTS = parseSingleColumnCsv(demoLabelSetCsv);

export const DEMO_LABELS: LabelDefinition[] = getDemoLabels();

export function getDemoLabels(layoutStrategy: LayoutStrategy = DEFAULT_LAYOUT_STRATEGY): LabelDefinition[] {
  return createDemoLabels(DEMO_ROOT_TEXTS, layoutStrategy);
}

function createDemoLabels(rootTexts: string[], layoutStrategy: LayoutStrategy): LabelDefinition[] {
  const labels: LabelDefinition[] = [];
  let rootIndex = 0;

  for (let columnIndex = 0; columnIndex < DEMO_COLUMN_COUNTS.length; columnIndex += 1) {
    const columnCount = DEMO_COLUMN_COUNTS[columnIndex];

    for (let rowIndex = 0; rowIndex < columnCount; rowIndex += 1) {
      const rootText = rootTexts[rootIndex] ?? `DEMO ROOT ${String(rootIndex + 1).padStart(2, '0')}`;
      const hierarchyTexts = createDemoHierarchyTexts(rootText, rootIndex);
      const rootWindow = getRootZoomWindow(rootText);
      const palette = DEMO_COLUMN_PALETTES[
        getPaletteColumnIndex(rootIndex, columnIndex, layoutStrategy) % DEMO_COLUMN_PALETTES.length
      ];
      const hierarchyLocations = createDemoHierarchyLocations(
        layoutStrategy,
        rootIndex,
        columnIndex,
        rowIndex,
      );

      labels.push({
        text: hierarchyTexts.root,
        location: hierarchyLocations.root,
        size: rootWindow.size,
        zoomLevel: rootWindow.zoomLevel,
        zoomRange: rootWindow.zoomRange,
        color: palette[0],
      });

      labels.push({
        text: hierarchyTexts.child,
        location: hierarchyLocations.child,
        size: DEMO_CHILD_WINDOW.size,
        zoomLevel: DEMO_CHILD_WINDOW.zoomLevel,
        zoomRange: DEMO_CHILD_WINDOW.zoomRange,
        color: palette[1],
      });

      labels.push({
        text: hierarchyTexts.detail,
        location: hierarchyLocations.detail,
        size: DEMO_DETAIL_WINDOW.size,
        zoomLevel: DEMO_DETAIL_WINDOW.zoomLevel,
        zoomRange: DEMO_DETAIL_WINDOW.zoomRange,
        color: palette[2],
      });

      rootIndex += 1;
    }
  }

  return labels;
}

function createDemoHierarchyLocations(
  layoutStrategy: LayoutStrategy,
  rootIndex: number,
  columnIndex: number,
  rowIndex: number,
): DemoHierarchyLocations {
  switch (layoutStrategy) {
    case 'scan-grid':
      return createScanGridLocations(rootIndex);
    case 'column-ramp':
    default:
      return createColumnRampLocations(rootIndex, columnIndex, rowIndex);
  }
}

function createColumnRampLocations(
  rootIndex: number,
  columnIndex: number,
  rowIndex: number,
): DemoHierarchyLocations {
  const columnX = getDemoColumnX(columnIndex);
  const rootY = DEMO_TOP_Y - rowIndex * DEMO_ROW_SPACING;
  const childJitter = rootIndex % 2 === 0 ? 0 : 0.04;

  return {
    root: {x: columnX, y: rootY},
    child: {
      x: columnX + DEMO_CHILD_X_OFFSET,
      y: rootY + DEMO_CHILD_Y_OFFSET - childJitter,
    },
    detail: {
      x: columnX + DEMO_DETAIL_X_OFFSET,
      y: rootY + DEMO_DETAIL_Y_OFFSET - childJitter * 1.5,
    },
  };
}

function createScanGridLocations(rootIndex: number): DemoHierarchyLocations {
  const columnIndex = rootIndex % DEMO_SCAN_GRID_COLUMN_COUNT;
  const rowIndex = Math.floor(rootIndex / DEMO_SCAN_GRID_COLUMN_COUNT);
  const columnX = getScanGridColumnX(columnIndex);
  const rowWave = columnIndex % 2 === 0 ? 0 : -0.12;
  const rootY = DEMO_SCAN_GRID_TOP_Y - rowIndex * DEMO_SCAN_GRID_ROW_SPACING + rowWave;
  const stackOffsetX =
    rowIndex % 2 === 0 ? DEMO_SCAN_GRID_STACK_X_OFFSET : -DEMO_SCAN_GRID_STACK_X_OFFSET;

  return {
    root: {x: columnX, y: rootY},
    child: {
      x: columnX + stackOffsetX * 0.5,
      y: rootY + DEMO_SCAN_GRID_CHILD_Y_OFFSET,
    },
    detail: {
      x: columnX + stackOffsetX,
      y: rootY + DEMO_SCAN_GRID_DETAIL_Y_OFFSET,
    },
  };
}

function getDemoColumnX(columnIndex: number): number {
  const totalWidth = (DEMO_COLUMN_COUNTS.length - 1) * DEMO_COLUMN_SPACING;
  return columnIndex * DEMO_COLUMN_SPACING - totalWidth * 0.5;
}

function getScanGridColumnX(columnIndex: number): number {
  const totalWidth = (DEMO_SCAN_GRID_COLUMN_COUNT - 1) * DEMO_SCAN_GRID_COLUMN_SPACING;
  return columnIndex * DEMO_SCAN_GRID_COLUMN_SPACING - totalWidth * 0.5;
}

function getPaletteColumnIndex(
  rootIndex: number,
  columnIndex: number,
  layoutStrategy: LayoutStrategy,
): number {
  if (layoutStrategy === 'scan-grid') {
    return rootIndex % DEMO_SCAN_GRID_COLUMN_COUNT;
  }

  return columnIndex;
}

function createDemoHierarchyTexts(rootText: string, index: number): DemoHierarchyTexts {
  switch (rootText) {
    case 'BUTTON PAN':
      return {
        root: rootText,
        child: 'CAMERA INPUT',
        detail: 'CONTROL CLOSE READ',
      };
    case 'TEXT LAYER':
      return {
        root: rootText,
        child: 'LUMA TEXT',
        detail: 'LUMA TEXT / GLYPH DETAIL',
      };
    case 'WORLD VIEW':
      return {
        root: rootText,
        child: 'WORLD VIEW / REGION',
        detail: 'WORLD VIEW / LOCAL TILE',
      };
    default: {
      const focusSuffix = DEMO_FOCUS_SUFFIXES[index % DEMO_FOCUS_SUFFIXES.length];
      const detailSuffix = DEMO_DETAIL_SUFFIXES[index % DEMO_DETAIL_SUFFIXES.length];

      return {
        root: rootText,
        child: `${rootText} / ${focusSuffix}`,
        detail: `${rootText} / ${detailSuffix}`,
      };
    }
  }
}

function getRootZoomWindow(rootText: string): ZoomBandPreset {
  if (rootText === 'WORLD VIEW') {
    return DEMO_WORLD_WINDOW;
  }

  return DEMO_ROOT_WINDOW;
}

function parseSingleColumnCsv(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(stripWrappingQuotes)
    .slice(0, DEMO_ROOT_LABEL_COUNT);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

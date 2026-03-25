import demoLabelSetCsv from './demo-label-set.csv?raw';

import type {LabelDefinition, RgbaColor} from '../text/types';

type ZoomWindow = {
  maxZoom: number;
  minZoom: number;
  size: number;
};

type DemoHierarchyTexts = {
  child: string;
  detail: string;
  root: string;
};

const DEMO_COLUMN_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DEMO_ROOT_LABEL_COUNT = DEMO_COLUMN_COUNTS.reduce((sum, count) => sum + count, 0);
const DEMO_COLUMN_SPACING = 2.4;
const DEMO_TOP_Y = 6.1;
const DEMO_ROW_SPACING = 1.34;
const DEMO_CHILD_X_OFFSET = 0.48;
const DEMO_CHILD_Y_OFFSET = -0.18;
const DEMO_DETAIL_X_OFFSET = 0.94;
const DEMO_DETAIL_Y_OFFSET = -0.38;

const DEMO_ROOT_WINDOW: ZoomWindow = {
  minZoom: -0.6,
  maxZoom: 0.15,
  size: 0.58,
};

const DEMO_CHILD_WINDOW: ZoomWindow = {
  minZoom: 0.2,
  maxZoom: 0.45,
  size: 0.42,
};

const DEMO_DETAIL_WINDOW: ZoomWindow = {
  minZoom: 0.95,
  maxZoom: 2.8,
  size: 0.32,
};

const DEMO_WORLD_WINDOW: ZoomWindow = {
  minZoom: -4,
  maxZoom: -0.18,
  size: 0.68,
};

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

export const DEMO_LABELS: LabelDefinition[] = createDemoLabels(DEMO_ROOT_TEXTS);

function createDemoLabels(rootTexts: string[]): LabelDefinition[] {
  const labels: LabelDefinition[] = [];
  let rootIndex = 0;

  for (let columnIndex = 0; columnIndex < DEMO_COLUMN_COUNTS.length; columnIndex += 1) {
    const columnCount = DEMO_COLUMN_COUNTS[columnIndex];
    const palette = DEMO_COLUMN_PALETTES[columnIndex % DEMO_COLUMN_PALETTES.length];
    const columnX = getDemoColumnX(columnIndex);

    for (let rowIndex = 0; rowIndex < columnCount; rowIndex += 1) {
      const rootText = rootTexts[rootIndex] ?? `DEMO ROOT ${String(rootIndex + 1).padStart(2, '0')}`;
      const hierarchyTexts = createDemoHierarchyTexts(rootText, rootIndex);
      const rootWindow = getRootZoomWindow(rootText);
      const rootY = DEMO_TOP_Y - rowIndex * DEMO_ROW_SPACING;
      const childJitter = rootIndex % 2 === 0 ? 0 : 0.04;

      labels.push({
        text: hierarchyTexts.root,
        location: {x: columnX, y: rootY},
        size: rootWindow.size,
        minZoom: rootWindow.minZoom,
        maxZoom: rootWindow.maxZoom,
        color: palette[0],
      });

      labels.push({
        text: hierarchyTexts.child,
        location: {
          x: columnX + DEMO_CHILD_X_OFFSET,
          y: rootY + DEMO_CHILD_Y_OFFSET - childJitter,
        },
        size: DEMO_CHILD_WINDOW.size,
        minZoom: DEMO_CHILD_WINDOW.minZoom,
        maxZoom: DEMO_CHILD_WINDOW.maxZoom,
        color: palette[1],
      });

      labels.push({
        text: hierarchyTexts.detail,
        location: {
          x: columnX + DEMO_DETAIL_X_OFFSET,
          y: rootY + DEMO_DETAIL_Y_OFFSET - childJitter * 1.5,
        },
        size: DEMO_DETAIL_WINDOW.size,
        minZoom: DEMO_DETAIL_WINDOW.minZoom,
        maxZoom: DEMO_DETAIL_WINDOW.maxZoom,
        color: palette[2],
      });

      rootIndex += 1;
    }
  }

  return labels;
}

function getDemoColumnX(columnIndex: number): number {
  const totalWidth = (DEMO_COLUMN_COUNTS.length - 1) * DEMO_COLUMN_SPACING;
  return columnIndex * DEMO_COLUMN_SPACING - totalWidth * 0.5;
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

function getRootZoomWindow(rootText: string): ZoomWindow {
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

import type {LabelLocation} from '../text/types';

const DEMO_COLUMN_SPACING = 1.86;
const DEMO_ROW_SPACING = 1.02;
const DEMO_SCAN_GRID_COLUMN_COUNT = 12;
const DEMO_SCAN_GRID_COLUMN_SPACING = 1.8;
const DEMO_SCAN_GRID_ROW_SPACING = 0.96;
const DEMO_LAYOUT_REFERENCE_PIXELS_PER_WORLD_UNIT = 56;
const DEMO_LAYOUT_ESTIMATED_ADVANCE_PX = 24;
const DEMO_LAYOUT_ESTIMATED_HEIGHT_PX = 94;
const DEMO_LAYOUT_ESTIMATED_PADDING_PX = 18;
const DEMO_LAYOUT_TOP_EXTENT_RATIO = 0.7;

export const LAYOUT_STRATEGIES = ['column-ramp', 'scan-grid', 'flow-columns'] as const;
export type LayoutStrategy = (typeof LAYOUT_STRATEGIES)[number];

export const LAYOUT_STRATEGY_OPTIONS = [
  {mode: 'column-ramp', label: 'Column Ramp'},
  {mode: 'scan-grid', label: 'Scan Grid'},
  {mode: 'flow-columns', label: 'Flow Columns'},
] as const satisfies ReadonlyArray<{mode: LayoutStrategy; label: string}>;

export const DEFAULT_LAYOUT_STRATEGY: LayoutStrategy = 'flow-columns';

export type DemoLayoutNodeKey = 'root' | 'child';

export type DemoLayoutNodeSpec = {
  size: number;
  text: string;
};

export type DemoLayoutEntry = {
  nodes: Record<DemoLayoutNodeKey, DemoLayoutNodeSpec>;
  rootIndex: number;
  sourceColumnIndex: number;
  sourceRowIndex: number;
};

export type DemoHierarchyLocations = Record<DemoLayoutNodeKey, LabelLocation>;

export type DemoLayoutNodeBox = {
  column: number;
  entryIndex: number;
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
  node: DemoLayoutNodeKey;
  row: number;
};

export type DemoLayoutPlacement = {
  bandCount: number;
  boxes: DemoLayoutNodeBox[];
  columnCount: number;
  locations: DemoHierarchyLocations[];
};

type DemoNodeBounds = {
  bottom: number;
  top: number;
  width: number;
};

export function layoutDemoEntries(
  entries: DemoLayoutEntry[],
  layoutStrategy: LayoutStrategy,
): DemoLayoutPlacement {
  switch (layoutStrategy) {
    case 'scan-grid':
      return createFormulaPlacement(entries, 'scan-grid');
    case 'flow-columns':
      return createFlowColumnsPlacement(entries);
    case 'column-ramp':
    default:
      return createFormulaPlacement(entries, 'column-ramp');
  }
}

function createFormulaPlacement(
  entries: DemoLayoutEntry[],
  layoutStrategy: 'column-ramp' | 'scan-grid',
): DemoLayoutPlacement {
  const locations = entries.map((entry) =>
    layoutStrategy === 'scan-grid'
      ? createScanGridLocations(entry.rootIndex, entries.length)
      : createColumnRampLocations(entry.sourceColumnIndex, entry.sourceRowIndex),
  );

  return createPlacement(entries, locations, getSourceColumnCount(entries));
}

function createFlowColumnsPlacement(entries: DemoLayoutEntry[]): DemoLayoutPlacement {
  const sourceColumns = getSortedUnique(entries.map((entry) => entry.sourceColumnIndex));
  const sourceRows = getSortedUnique(entries.map((entry) => entry.sourceRowIndex));
  const columnSlotBySource = new Map(sourceColumns.map((column, index) => [column, index]));
  const rowSlotBySource = new Map(sourceRows.map((row, index) => [row, index]));
  const locations = entries.map((entry) => {
    const columnSlot = columnSlotBySource.get(entry.sourceColumnIndex) ?? 0;
    const rowSlot = rowSlotBySource.get(entry.sourceRowIndex) ?? 0;
    const root = {
      x: getCenteredX(columnSlot, sourceColumns.length, DEMO_COLUMN_SPACING),
      y: getCenteredY(rowSlot, sourceRows.length, DEMO_ROW_SPACING),
    };

    return {
      root,
      child: root,
    };
  });

  return createPlacement(entries, locations, sourceColumns.length, columnSlotBySource, rowSlotBySource);
}

function createPlacement(
  entries: DemoLayoutEntry[],
  locations: DemoHierarchyLocations[],
  bandCount: number,
  columnSlotBySource?: Map<number, number>,
  rowSlotBySource?: Map<number, number>,
): DemoLayoutPlacement {
  const boxes = entries.map((entry, index) => {
    const rootBounds = estimateNodeBounds(entry.nodes.root);

    return createNodeBox(
      locations[index].root,
      rootBounds,
      index,
      'root',
      columnSlotBySource?.get(entry.sourceColumnIndex) ?? entry.sourceColumnIndex,
      rowSlotBySource?.get(entry.sourceRowIndex) ?? entry.sourceRowIndex,
    );
  });

  return {
    bandCount,
    boxes,
    columnCount: bandCount,
    locations,
  };
}

function createColumnRampLocations(columnIndex: number, rowIndex: number): DemoHierarchyLocations {
  const root = {
    x: getCenteredX(columnIndex, 12, DEMO_COLUMN_SPACING),
    y: getCenteredY(rowIndex, 12, DEMO_ROW_SPACING),
  };

  return {
    root,
    child: root,
  };
}

function createScanGridLocations(rootIndex: number, totalEntries: number): DemoHierarchyLocations {
  const columnIndex = rootIndex % DEMO_SCAN_GRID_COLUMN_COUNT;
  const rowIndex = Math.floor(rootIndex / DEMO_SCAN_GRID_COLUMN_COUNT);
  const totalRows = Math.max(1, Math.ceil(totalEntries / DEMO_SCAN_GRID_COLUMN_COUNT));
  const root = {
    x: getCenteredX(columnIndex, DEMO_SCAN_GRID_COLUMN_COUNT, DEMO_SCAN_GRID_COLUMN_SPACING),
    y:
      getCenteredY(rowIndex, totalRows, DEMO_SCAN_GRID_ROW_SPACING) +
      (columnIndex % 2 === 0 ? 0.04 : -0.04),
  };

  return {
    root,
    child: root,
  };
}

function createNodeBox(
  location: LabelLocation,
  bounds: DemoNodeBounds,
  entryIndex: number,
  node: DemoLayoutNodeKey,
  column: number,
  row: number,
): DemoLayoutNodeBox {
  return {
    column,
    entryIndex,
    maxX: location.x + bounds.width * 0.5,
    maxY: location.y + bounds.top,
    minX: location.x - bounds.width * 0.5,
    minY: location.y - bounds.bottom,
    node,
    row,
  };
}

function estimateNodeBounds(node: DemoLayoutNodeSpec): DemoNodeBounds {
  const characterCount = Math.max(1, node.text.length);
  const pixelWidth =
    characterCount * DEMO_LAYOUT_ESTIMATED_ADVANCE_PX + DEMO_LAYOUT_ESTIMATED_PADDING_PX;
  const worldWidth = (pixelWidth * node.size) / DEMO_LAYOUT_REFERENCE_PIXELS_PER_WORLD_UNIT;
  const worldHeight =
    (DEMO_LAYOUT_ESTIMATED_HEIGHT_PX * node.size) / DEMO_LAYOUT_REFERENCE_PIXELS_PER_WORLD_UNIT;

  return {
    bottom: worldHeight * (1 - DEMO_LAYOUT_TOP_EXTENT_RATIO),
    top: worldHeight * DEMO_LAYOUT_TOP_EXTENT_RATIO,
    width: worldWidth,
  };
}

function getCenteredX(index: number, total: number, spacing: number): number {
  return index * spacing - ((total - 1) * spacing) * 0.5;
}

function getCenteredY(index: number, total: number, spacing: number): number {
  return ((total - 1) * spacing) * 0.5 - index * spacing;
}

function getSourceColumnCount(entries: DemoLayoutEntry[]): number {
  return getSortedUnique(entries.map((entry) => entry.sourceColumnIndex)).length;
}

function getSortedUnique(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

export type ParsedLabelKey = {
  column: number;
  layer: number;
  row: number;
  workplaneId: string;
};

export const DEFAULT_LABEL_KEY_WORKPLANE_ID = 'wp-1';

export function buildLabelKey(
  workplaneId: string,
  layer: number,
  row: number,
  column: number,
): string {
  return `${workplaneId}:${layer}:${row}:${column}`;
}

export function buildLabelCellKey(
  workplaneId: string,
  row: number,
  column: number,
): string {
  return `${workplaneId}:${row}:${column}`;
}

export function parseLabelKey(
  labelKey: string | null | undefined,
  fallbackWorkplaneId: string = DEFAULT_LABEL_KEY_WORKPLANE_ID,
): ParsedLabelKey {
  if (!labelKey) {
    return {
      column: 1,
      layer: 1,
      row: 1,
      workplaneId: fallbackWorkplaneId,
    };
  }

  const parts = labelKey.split(':');

  if (parts.length >= 4 && parts[0]?.startsWith('wp-')) {
    const [workplaneIdPart, layerPart = '1', rowPart = '1', columnPart = '1'] = parts;

    return {
      column: normalizePart(columnPart),
      layer: normalizePart(layerPart),
      row: normalizePart(rowPart),
      workplaneId: workplaneIdPart || fallbackWorkplaneId,
    };
  }

  const [columnPart = '1', rowPart = '1', layerPart = '1'] = parts;

  return {
    column: normalizePart(columnPart),
    layer: normalizePart(layerPart),
    row: normalizePart(rowPart),
    workplaneId: fallbackWorkplaneId,
  };
}

export function getCellKeyFromLabelKey(
  labelKey: string | null | undefined,
  fallbackWorkplaneId?: string,
): string {
  const parsed = parseLabelKey(labelKey, fallbackWorkplaneId);
  return buildLabelCellKey(parsed.workplaneId, parsed.row, parsed.column);
}

export function getRootLabelKey(
  labelKey: string | null | undefined,
  fallbackWorkplaneId?: string,
): string {
  const parsed = parseLabelKey(labelKey, fallbackWorkplaneId);
  return buildLabelKey(parsed.workplaneId, 1, parsed.row, parsed.column);
}

function normalizePart(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

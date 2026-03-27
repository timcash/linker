import type {LabelDefinition} from './text/types';

export type LabelNavigationAction =
  | 'pan-up'
  | 'pan-down'
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-camera';

export type LabelNavigationNode = NonNullable<LabelDefinition['navigation']> & {
  label: LabelDefinition;
};

export type LabelNavigationIndex = {
  defaultKey: string;
  nodeByCoordinate: Map<string, LabelNavigationNode>;
  nodeByKey: Map<string, LabelNavigationNode>;
};

export const DEFAULT_CAMERA_LABEL_KEY = '1:1:1';

export function createLabelNavigationIndex(labels: LabelDefinition[]): LabelNavigationIndex | null {
  const nodeByKey = new Map<string, LabelNavigationNode>();
  const nodeByCoordinate = new Map<string, LabelNavigationNode>();

  for (const label of labels) {
    if (!label.navigation) {
      continue;
    }

    const node: LabelNavigationNode = {
      ...label.navigation,
      label,
    };

    nodeByKey.set(node.key, node);
    nodeByCoordinate.set(getCoordinateKey(node.column, node.row, node.layer), node);
  }

  if (nodeByKey.size === 0) {
    return null;
  }

  const defaultKey =
    nodeByKey.has(DEFAULT_CAMERA_LABEL_KEY)
      ? DEFAULT_CAMERA_LABEL_KEY
      : nodeByKey.values().next().value?.key ?? DEFAULT_CAMERA_LABEL_KEY;

  return {
    defaultKey,
    nodeByCoordinate,
    nodeByKey,
  };
}

export function getLabelNavigationNode(
  index: LabelNavigationIndex | null,
  key: string | null | undefined,
): LabelNavigationNode | null {
  if (!index || !key) {
    return null;
  }

  return index.nodeByKey.get(key) ?? null;
}

export function resolveLabelNavigationKey(
  index: LabelNavigationIndex,
  requestedKey: string | null | undefined,
): string {
  if (requestedKey && index.nodeByKey.has(requestedKey)) {
    return requestedKey;
  }

  return index.defaultKey;
}

export function getLabelNavigationTarget(
  index: LabelNavigationIndex,
  currentKey: string,
  action: LabelNavigationAction,
): LabelNavigationNode | null {
  const currentNode = getLabelNavigationNode(index, currentKey) ?? getLabelNavigationNode(index, index.defaultKey);

  if (!currentNode) {
    return null;
  }

  switch (action) {
    case 'pan-left':
      return getNodeByCoordinate(index, currentNode.column - 1, currentNode.row, currentNode.layer) ?? currentNode;
    case 'pan-right':
      return getNodeByCoordinate(index, currentNode.column + 1, currentNode.row, currentNode.layer) ?? currentNode;
    case 'pan-up':
      return getNodeByCoordinate(index, currentNode.column, currentNode.row - 1, currentNode.layer) ?? currentNode;
    case 'pan-down':
      return getNodeByCoordinate(index, currentNode.column, currentNode.row + 1, currentNode.layer) ?? currentNode;
    case 'zoom-in':
      return getNodeByCoordinate(index, currentNode.column, currentNode.row, currentNode.layer + 1) ?? currentNode;
    case 'zoom-out':
      return getNodeByCoordinate(index, currentNode.column, currentNode.row, currentNode.layer - 1) ?? currentNode;
    case 'reset-camera':
      return getLabelNavigationNode(index, index.defaultKey) ?? currentNode;
    default:
      return currentNode;
  }
}

export function hasLabelNavigationTarget(
  index: LabelNavigationIndex,
  currentKey: string,
  action: LabelNavigationAction,
): boolean {
  const currentNode = getLabelNavigationNode(index, currentKey);
  const targetNode = getLabelNavigationTarget(index, currentKey, action);

  return Boolean(currentNode && targetNode && currentNode.key !== targetNode.key);
}

function getNodeByCoordinate(
  index: LabelNavigationIndex,
  column: number,
  row: number,
  layer: number,
): LabelNavigationNode | null {
  return index.nodeByCoordinate.get(getCoordinateKey(column, row, layer)) ?? null;
}

function getCoordinateKey(column: number, row: number, layer: number): string {
  return `${column}:${row}:${layer}`;
}

import type {WorkplaneId} from './plane-stack';
import type {WorkplaneDagEdgeState, WorkplaneDagPosition} from './dag-document';

export const WORLD_COLUMN_STEP = 48;
export const WORLD_ROW_STEP = 34;
export const WORLD_LAYER_STEP = 18;
export const WORKPLANE_HALF_WIDTH = 12;
export const WORKPLANE_HALF_HEIGHT = 12;
export const WORKPLANE_TITLE_OFFSET = 4;

export type DagWorldPoint = {
  x: number;
  y: number;
  z: number;
};

export type DagNodeWorldLayout = {
  origin: DagWorldPoint;
  planeBounds: {
    maxX: number;
    maxY: number;
    minX: number;
    minY: number;
    z: number;
  };
  titleAnchor: DagWorldPoint;
  workplaneId: WorkplaneId;
};

export type DagEdgeWorldLayout = {
  edgeKey: string;
  fromWorkplaneId: WorkplaneId;
  input: DagWorldPoint;
  output: DagWorldPoint;
  toWorkplaneId: WorkplaneId;
};

export function layoutDagNode(
  workplaneId: WorkplaneId,
  position: WorkplaneDagPosition,
): DagNodeWorldLayout {
  const origin = {
    x: normalizeZero(position.column * WORLD_COLUMN_STEP),
    y: normalizeZero(-position.row * WORLD_ROW_STEP),
    z: normalizeZero(-position.layer * WORLD_LAYER_STEP),
  };

  return {
    origin,
    planeBounds: {
      maxX: origin.x + WORKPLANE_HALF_WIDTH,
      maxY: origin.y + WORKPLANE_HALF_HEIGHT,
      minX: origin.x - WORKPLANE_HALF_WIDTH,
      minY: origin.y - WORKPLANE_HALF_HEIGHT,
      z: origin.z,
    },
    titleAnchor: {
      x: origin.x,
      y: origin.y + WORKPLANE_HALF_HEIGHT + WORKPLANE_TITLE_OFFSET,
      z: origin.z,
    },
    workplaneId,
  };
}

export function resolveDagEdgeCurve(
  edge: WorkplaneDagEdgeState,
  nodeLayoutsById: Map<WorkplaneId, DagNodeWorldLayout>,
): DagEdgeWorldLayout | null {
  const fromNode = nodeLayoutsById.get(edge.fromWorkplaneId);
  const toNode = nodeLayoutsById.get(edge.toWorkplaneId);

  if (!fromNode || !toNode) {
    return null;
  }

  return {
    edgeKey: edge.edgeKey,
    fromWorkplaneId: edge.fromWorkplaneId,
    input: {
      x: toNode.planeBounds.minX,
      y: toNode.origin.y,
      z: toNode.origin.z,
    },
    output: {
      x: fromNode.planeBounds.maxX,
      y: fromNode.origin.y,
      z: fromNode.origin.z,
    },
    toWorkplaneId: edge.toWorkplaneId,
  };
}

function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

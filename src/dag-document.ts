import type {WorkplaneId} from './plane-stack';
import type {StageScene} from './scene-model';

export type WorkplaneDagPosition = {
  column: number;
  row: number;
  layer: number;
};

export type WorkplaneDagNodeState = {
  labelTextOverrides: Record<string, string>;
  position: WorkplaneDagPosition;
  scene: StageScene;
  workplaneId: WorkplaneId;
};

export type WorkplaneDagEdgeState = {
  edgeKey: string;
  fromWorkplaneId: WorkplaneId;
  toWorkplaneId: WorkplaneId;
};

export type DagDocumentState = {
  edges: WorkplaneDagEdgeState[];
  nextWorkplaneNumber: number;
  nodesById: Record<WorkplaneId, WorkplaneDagNodeState>;
  rootWorkplaneId: WorkplaneId;
};

export type DagValidationIssueCode =
  | 'column-order'
  | 'cycle'
  | 'dangling-edge-reference'
  | 'integer-position'
  | 'reachability'
  | 'root';

export type DagValidationIssue = {
  code: DagValidationIssueCode;
  edgeKey?: string;
  message: string;
  workplaneId?: WorkplaneId;
};

export type DagValidationResult = {
  issues: DagValidationIssue[];
  topologicalOrder: WorkplaneId[];
  valid: boolean;
};

export function validateDagDocument(document: DagDocumentState): DagValidationResult {
  const issues = [
    ...getDanglingEdgeIssues(document),
    ...getIntegerPositionIssues(document),
    ...getColumnIncreaseIssues(document),
    ...getSingleRootIssues(document),
    ...getReachabilityIssues(document),
    ...getCycleIssues(document),
  ];

  return {
    issues,
    topologicalOrder: getTopologicalOrder(document),
    valid: issues.length === 0,
  };
}

export function assertNoDanglingEdgeReferences(document: DagDocumentState): void {
  throwForIssues(getDanglingEdgeIssues(document));
}

export function assertSingleRoot(document: DagDocumentState): void {
  throwForIssues(getSingleRootIssues(document));
}

export function assertColumnsIncreaseAlongEdges(document: DagDocumentState): void {
  throwForIssues(getColumnIncreaseIssues(document));
}

export function assertIntegerWorkplanePositions(document: DagDocumentState): void {
  throwForIssues(getIntegerPositionIssues(document));
}

export function assertReachableFromRoot(document: DagDocumentState): void {
  throwForIssues(getReachabilityIssues(document));
}

export function assertAcyclicDag(document: DagDocumentState): void {
  throwForIssues(getCycleIssues(document));
}

function getDanglingEdgeIssues(document: DagDocumentState): DagValidationIssue[] {
  return document.edges.flatMap((edge) => {
    const issues: DagValidationIssue[] = [];

    if (!document.nodesById[edge.fromWorkplaneId]) {
      issues.push({
        code: 'dangling-edge-reference',
        edgeKey: edge.edgeKey,
        message: `Edge ${edge.edgeKey} references missing source workplane ${edge.fromWorkplaneId}.`,
        workplaneId: edge.fromWorkplaneId,
      });
    }

    if (!document.nodesById[edge.toWorkplaneId]) {
      issues.push({
        code: 'dangling-edge-reference',
        edgeKey: edge.edgeKey,
        message: `Edge ${edge.edgeKey} references missing target workplane ${edge.toWorkplaneId}.`,
        workplaneId: edge.toWorkplaneId,
      });
    }

    return issues;
  });
}

function getSingleRootIssues(document: DagDocumentState): DagValidationIssue[] {
  const nodeIds = listNodeIds(document);

  if (nodeIds.length === 0) {
    return [{code: 'root', message: 'DAG document must contain at least one workplane.'}];
  }

  if (!document.nodesById[document.rootWorkplaneId]) {
    return [
      {
        code: 'root',
        message: `Declared root workplane ${document.rootWorkplaneId} is missing from the DAG document.`,
        workplaneId: document.rootWorkplaneId,
      },
    ];
  }

  const incomingCount = createIncomingCount(document);
  const zeroIncomingNodeIds = nodeIds.filter((workplaneId) => (incomingCount.get(workplaneId) ?? 0) === 0);

  if (zeroIncomingNodeIds.length !== 1) {
    return [
      {
        code: 'root',
        message: `DAG document must expose exactly one root workplane; found ${zeroIncomingNodeIds.length}.`,
      },
    ];
  }

  const [zeroIncomingNodeId] = zeroIncomingNodeIds;

  if (zeroIncomingNodeId !== document.rootWorkplaneId) {
    return [
      {
        code: 'root',
        message: `Declared root workplane ${document.rootWorkplaneId} does not match the only zero-incoming workplane ${zeroIncomingNodeId}.`,
        workplaneId: document.rootWorkplaneId,
      },
    ];
  }

  return [];
}

function getColumnIncreaseIssues(document: DagDocumentState): DagValidationIssue[] {
  return listValidEdges(document).flatMap((edge) => {
    const fromNode = document.nodesById[edge.fromWorkplaneId];
    const toNode = document.nodesById[edge.toWorkplaneId];

    if (!fromNode || !toNode || fromNode.position.column < toNode.position.column) {
      return [];
    }

    return [
      {
        code: 'column-order',
        edgeKey: edge.edgeKey,
        message: `Edge ${edge.edgeKey} must point into a later column: ${edge.fromWorkplaneId} (${fromNode.position.column}) -> ${edge.toWorkplaneId} (${toNode.position.column}).`,
      },
    ];
  });
}

function getIntegerPositionIssues(document: DagDocumentState): DagValidationIssue[] {
  return listNodeIds(document).flatMap((workplaneId) => {
    const node = document.nodesById[workplaneId];
    const {column, row, layer} = node.position;

    if (Number.isInteger(column) && Number.isInteger(row) && Number.isInteger(layer)) {
      return [];
    }

    return [
      {
        code: 'integer-position',
        message: `Workplane ${workplaneId} must stay on integer DAG rails; received (${column}, ${row}, ${layer}).`,
        workplaneId,
      },
    ];
  });
}

function getReachabilityIssues(document: DagDocumentState): DagValidationIssue[] {
  const rootNode = document.nodesById[document.rootWorkplaneId];

  if (!rootNode) {
    return [];
  }

  const adjacency = createAdjacencyMap(document);
  const reachableNodeIds = new Set<WorkplaneId>([document.rootWorkplaneId]);
  const pendingNodeIds: WorkplaneId[] = [document.rootWorkplaneId];

  while (pendingNodeIds.length > 0) {
    const currentNodeId = pendingNodeIds.shift();

    if (!currentNodeId) {
      continue;
    }

    for (const nextNodeId of adjacency.get(currentNodeId) ?? []) {
      if (reachableNodeIds.has(nextNodeId)) {
        continue;
      }

      reachableNodeIds.add(nextNodeId);
      pendingNodeIds.push(nextNodeId);
    }
  }

  return listNodeIds(document)
    .filter((workplaneId) => !reachableNodeIds.has(workplaneId))
    .map((workplaneId) => ({
      code: 'reachability' as const,
      message: `Workplane ${workplaneId} is not reachable from root ${document.rootWorkplaneId}.`,
      workplaneId,
    }));
}

function getCycleIssues(document: DagDocumentState): DagValidationIssue[] {
  const nodeIds = listNodeIds(document);

  if (nodeIds.length === 0 || getTopologicalOrder(document).length === nodeIds.length) {
    return [];
  }

  return [{code: 'cycle', message: 'DAG document contains a dependency cycle.'}];
}

function getTopologicalOrder(document: DagDocumentState): WorkplaneId[] {
  const nodeIds = listNodeIds(document);
  const incomingCount = createIncomingCount(document);
  const adjacency = createAdjacencyMap(document);
  const zeroIncomingNodeIds = nodeIds
    .filter((workplaneId) => (incomingCount.get(workplaneId) ?? 0) === 0)
    .sort(compareWorkplaneIds);
  const topologicalOrder: WorkplaneId[] = [];

  while (zeroIncomingNodeIds.length > 0) {
    const workplaneId = zeroIncomingNodeIds.shift();

    if (!workplaneId) {
      continue;
    }

    topologicalOrder.push(workplaneId);

    for (const nextNodeId of adjacency.get(workplaneId) ?? []) {
      const nextIncomingCount = (incomingCount.get(nextNodeId) ?? 0) - 1;
      incomingCount.set(nextNodeId, nextIncomingCount);

      if (nextIncomingCount === 0) {
        insertSortedWorkplaneId(zeroIncomingNodeIds, nextNodeId);
      }
    }
  }

  return topologicalOrder.length === nodeIds.length ? topologicalOrder : [];
}

function createIncomingCount(document: DagDocumentState): Map<WorkplaneId, number> {
  const incomingCount = new Map<WorkplaneId, number>(
    listNodeIds(document).map((workplaneId) => [workplaneId, 0]),
  );

  for (const edge of listValidEdges(document)) {
    incomingCount.set(edge.toWorkplaneId, (incomingCount.get(edge.toWorkplaneId) ?? 0) + 1);
  }

  return incomingCount;
}

function createAdjacencyMap(document: DagDocumentState): Map<WorkplaneId, WorkplaneId[]> {
  const adjacency = new Map<WorkplaneId, WorkplaneId[]>(
    listNodeIds(document).map((workplaneId) => [workplaneId, []]),
  );

  for (const edge of listValidEdges(document)) {
    const nextNodeIds = adjacency.get(edge.fromWorkplaneId);

    if (!nextNodeIds) {
      continue;
    }

    nextNodeIds.push(edge.toWorkplaneId);
    nextNodeIds.sort(compareWorkplaneIds);
  }

  return adjacency;
}

function listValidEdges(document: DagDocumentState): WorkplaneDagEdgeState[] {
  return document.edges.filter((edge) => {
    return Boolean(document.nodesById[edge.fromWorkplaneId] && document.nodesById[edge.toWorkplaneId]);
  });
}

function listNodeIds(document: DagDocumentState): WorkplaneId[] {
  return Object.keys(document.nodesById).sort(compareWorkplaneIds) as WorkplaneId[];
}

function insertSortedWorkplaneId(queue: WorkplaneId[], workplaneId: WorkplaneId): void {
  if (queue.includes(workplaneId)) {
    return;
  }

  queue.push(workplaneId);
  queue.sort(compareWorkplaneIds);
}

function compareWorkplaneIds(left: string, right: string): number {
  const leftNumber = Number.parseInt(left.slice(3), 10);
  const rightNumber = Number.parseInt(right.slice(3), 10);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right);
}

function throwForIssues(issues: DagValidationIssue[]): void {
  if (issues.length === 0) {
    return;
  }

  throw new Error(issues.map((issue) => issue.message).join(' '));
}

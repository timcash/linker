import type {DagDocumentState, WorkplaneDagPosition} from '../dag-document';
import type {WorkplaneId} from '../plane-stack';
import {createEmptyStageScene} from '../scene-model';

export type CanonicalDagNodeSpec = {
  dependsOn: WorkplaneId[];
  position: WorkplaneDagPosition;
  role: string;
  workplaneId: WorkplaneId;
};

export const CANONICAL_FIVE_WORKPLANE_NETWORK: CanonicalDagNodeSpec[] = [
  {
    dependsOn: [],
    position: {column: 0, row: 0, layer: 0},
    role: 'Internet Edge Router',
    workplaneId: 'wp-1',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 0, layer: 0},
    role: 'Core Router',
    workplaneId: 'wp-2',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 1, layer: 1},
    role: 'DMZ Network Space',
    workplaneId: 'wp-3',
  },
  {
    dependsOn: ['wp-2', 'wp-3'],
    position: {column: 2, row: 0, layer: 0},
    role: 'Compute Cluster',
    workplaneId: 'wp-4',
  },
  {
    dependsOn: ['wp-2', 'wp-3'],
    position: {column: 2, row: 1, layer: 1},
    role: 'Storage Network Space',
    workplaneId: 'wp-5',
  },
];

export function createCanonicalFiveWorkplaneNetworkDagDocument(): DagDocumentState {
  return {
    edges: CANONICAL_FIVE_WORKPLANE_NETWORK.flatMap((node) => {
      return node.dependsOn.map((fromWorkplaneId) => ({
        edgeKey: `dag:${fromWorkplaneId}->${node.workplaneId}`,
        fromWorkplaneId,
        toWorkplaneId: node.workplaneId,
      }));
    }),
    nextWorkplaneNumber: CANONICAL_FIVE_WORKPLANE_NETWORK.length + 1,
    nodesById: Object.fromEntries(
      CANONICAL_FIVE_WORKPLANE_NETWORK.map((node) => [
        node.workplaneId,
        {
          labelTextOverrides: {},
          position: {...node.position},
          scene: createEmptyStageScene('dag-network', node.workplaneId),
          workplaneId: node.workplaneId,
        },
      ]),
    ) as DagDocumentState['nodesById'],
    rootWorkplaneId: 'wp-1',
  };
}

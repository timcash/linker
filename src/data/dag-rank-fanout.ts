import {buildLabelKey} from '../label-key';
import {
  type PlaneStackDagState,
  type StageMode,
  type StageSystemState,
  type WorkplaneDocumentState,
  type WorkplaneId,
  type WorkplaneViewState,
} from '../plane-stack';
import {createStageScene} from '../scene-model';
import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
} from '../stack-camera';
import {DEFAULT_DEMO_LAYER_COUNT, getDemoLabelCount} from './labels';

const DAG_RANK_FANOUT_LAYOUT_STRATEGY = 'flow-columns';
const DAG_RANK_FANOUT_FOCUSED_ROW = 6;
const DAG_RANK_FANOUT_FOCUSED_COLUMN = 6;
const DAG_RANK_FANOUT_DEFAULT_STAGE_MODE: StageMode = '3d-mode';
const DAG_RANK_FANOUT_DEFAULT_ACTIVE_WORKPLANE_ID: WorkplaneId = 'wp-1';

export type DagRankFanoutNodeSpec = {
  dependsOn: WorkplaneId[];
  position: {
    column: number;
    layer: number;
    row: number;
  };
  role: string;
  workplaneId: WorkplaneId;
};

export const DAG_RANK_FANOUT_NODES: readonly DagRankFanoutNodeSpec[] = [
  {
    dependsOn: [],
    position: {column: 0, row: 0, layer: 0},
    role: 'Root Overview',
    workplaneId: 'wp-1',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 0, layer: 0},
    role: 'Ingress North',
    workplaneId: 'wp-2',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 0, layer: 1},
    role: 'Ingress East',
    workplaneId: 'wp-3',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 1, layer: 0},
    role: 'Ingress South',
    workplaneId: 'wp-4',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 1, layer: 1},
    role: 'Ingress West',
    workplaneId: 'wp-5',
  },
  {
    dependsOn: ['wp-2'],
    position: {column: 2, row: 0, layer: 0},
    role: 'Compute North',
    workplaneId: 'wp-6',
  },
  {
    dependsOn: ['wp-3'],
    position: {column: 2, row: 0, layer: 1},
    role: 'Compute East',
    workplaneId: 'wp-7',
  },
  {
    dependsOn: ['wp-4'],
    position: {column: 2, row: 1, layer: 0},
    role: 'Compute South',
    workplaneId: 'wp-8',
  },
  {
    dependsOn: ['wp-5'],
    position: {column: 2, row: 1, layer: 1},
    role: 'Compute West',
    workplaneId: 'wp-9',
  },
  {
    dependsOn: ['wp-6'],
    position: {column: 3, row: 0, layer: 0},
    role: 'Publish North',
    workplaneId: 'wp-10',
  },
  {
    dependsOn: ['wp-7'],
    position: {column: 3, row: 0, layer: 1},
    role: 'Publish East',
    workplaneId: 'wp-11',
  },
  {
    dependsOn: ['wp-8'],
    position: {column: 3, row: 1, layer: 0},
    role: 'Publish South',
    workplaneId: 'wp-12',
  },
] as const;

export const DAG_RANK_FANOUT_ROOT_WORKPLANE_ID: WorkplaneId = 'wp-1';
export const DAG_RANK_FANOUT_WORKPLANE_ORDER = DAG_RANK_FANOUT_NODES.map(
  (node) => node.workplaneId,
);
export const DAG_RANK_FANOUT_LAYOUT_FINGERPRINT = DAG_RANK_FANOUT_NODES.map(
  (node) =>
    `${node.workplaneId}:${node.position.column}:${node.position.row}:${node.position.layer}`,
).join('|');
export const DAG_RANK_FANOUT_EDGE_COUNT = DAG_RANK_FANOUT_NODES.reduce(
  (total, node) => total + node.dependsOn.length,
  0,
);

export function createDefaultDagRankFanoutState(options?: {
  activeWorkplaneId?: WorkplaneId;
  stageMode?: StageMode;
}): StageSystemState {
  const workplanesById = Object.fromEntries(
    DAG_RANK_FANOUT_NODES.map((node) => {
      const scene = createStageScene({
        demoLayerCount: DEFAULT_DEMO_LAYER_COUNT,
        labelSetKind: 'demo',
        labelTargetCount: getDemoLabelCount(DEFAULT_DEMO_LAYER_COUNT),
        layoutStrategy: DAG_RANK_FANOUT_LAYOUT_STRATEGY,
        workplaneId: node.workplaneId,
      });
      const focusedLabelKey = getDagRankFanoutFocusLabelKey(node.workplaneId);
      const focusedLabel =
        scene.labels.find((label) => label.navigation?.key === focusedLabelKey) ?? null;

      if (focusedLabel) {
        focusedLabel.text = node.role;
      }

      return [
        node.workplaneId,
        {
          labelTextOverrides: focusedLabel ? {[focusedLabelKey]: node.role} : {},
          scene,
          workplaneId: node.workplaneId,
        } satisfies WorkplaneDocumentState,
      ];
    }),
  ) as Record<WorkplaneId, WorkplaneDocumentState>;
  const workplaneViewsById = Object.fromEntries(
    DAG_RANK_FANOUT_WORKPLANE_ORDER.map((workplaneId) => {
      const focusedLabelKey = getDagRankFanoutFocusLabelKey(workplaneId);
      const focusedLabel =
        workplanesById[workplaneId]?.scene.labels.find(
          (label) => label.navigation?.key === focusedLabelKey,
        ) ?? null;

      return [
        workplaneId,
        {
          camera: focusedLabel
            ? {
                centerX: focusedLabel.location.x,
                centerY: focusedLabel.location.y,
                zoom: focusedLabel.zoomLevel,
              }
            : {centerX: 0, centerY: 0, zoom: 0},
          selectedLabelKey: focusedLabelKey,
        } satisfies WorkplaneViewState,
      ];
    }),
  ) as Record<WorkplaneId, WorkplaneViewState>;

  return {
    document: {
      dag: {
        edges: createDagRankFanoutEdges(),
        positionsById: createDagRankFanoutPositionsById(),
        rootWorkplaneId: DAG_RANK_FANOUT_ROOT_WORKPLANE_ID,
      },
      nextWorkplaneNumber: DAG_RANK_FANOUT_WORKPLANE_ORDER.length + 1,
      workplaneBridgeLinks: [],
      workplaneOrder: [...DAG_RANK_FANOUT_WORKPLANE_ORDER],
      workplanesById,
    },
    session: {
      activeWorkplaneId:
        options?.activeWorkplaneId ?? DAG_RANK_FANOUT_DEFAULT_ACTIVE_WORKPLANE_ID,
      stackCamera: cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE),
      stageMode: options?.stageMode ?? DAG_RANK_FANOUT_DEFAULT_STAGE_MODE,
      workplaneViewsById,
    },
  };
}

export function getDagRankFanoutFocusLabelKey(workplaneId: WorkplaneId): string {
  return buildLabelKey(workplaneId, 1, DAG_RANK_FANOUT_FOCUSED_ROW, DAG_RANK_FANOUT_FOCUSED_COLUMN);
}

function createDagRankFanoutEdges(): PlaneStackDagState['edges'] {
  return DAG_RANK_FANOUT_NODES.flatMap((node) =>
    node.dependsOn.map((fromWorkplaneId) => ({
      edgeKey: `dag:${fromWorkplaneId}->${node.workplaneId}`,
      fromWorkplaneId,
      toWorkplaneId: node.workplaneId,
    })),
  );
}

function createDagRankFanoutPositionsById(): PlaneStackDagState['positionsById'] {
  return Object.fromEntries(
    DAG_RANK_FANOUT_NODES.map((node) => [node.workplaneId, {...node.position}]),
  ) as PlaneStackDagState['positionsById'];
}

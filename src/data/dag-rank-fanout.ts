import {buildLabelKey} from '../label-key';
import {
  addLabelAtStageEditorCursor,
  createStageEditorState,
  focusStageEditorLabel,
  linkStageEditorSelection,
  moveStageEditorCursor,
  toggleStageEditorSelection,
} from '../stage-editor';
import {
  type PlaneStackDagState,
  type StageMode,
  type StageSystemState,
  type WorkplaneDocumentState,
  type WorkplaneId,
  type WorkplaneViewState,
} from '../plane-stack';
import {createEmptyStageScene} from '../scene-model';
import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
} from '../stack-camera';
import {DEMO_LABEL_SET_ID} from './demo-meta';

const DAG_RANK_FANOUT_DEFAULT_STAGE_MODE: StageMode = '3d-mode';
const DAG_RANK_FANOUT_DEFAULT_ACTIVE_WORKPLANE_ID: WorkplaneId = 'wp-1';
const DAG_RANK_FANOUT_PRIMARY_LABEL_ROW = 1;
const DAG_RANK_FANOUT_PRIMARY_LABEL_COLUMN = 1;

export type DagRankFanoutNodeSpec = {
  dependsOn: WorkplaneId[];
  localLabelTexts?: readonly string[];
  position: {
    column: number;
    layer: number;
    row: number;
  };
  workplaneId: WorkplaneId;
};

type AuthoredWorkplaneSceneSeed = {
  labelTextOverrides: Record<string, string>;
  primaryLabelKey: string | null;
  scene: WorkplaneDocumentState['scene'];
};

export const DAG_RANK_FANOUT_ROOT_LABEL_TEXT = 'Root Router';

export const DAG_RANK_FANOUT_NODES: readonly DagRankFanoutNodeSpec[] = [
  {
    dependsOn: [],
    localLabelTexts: [DAG_RANK_FANOUT_ROOT_LABEL_TEXT],
    position: {column: 0, row: 0, layer: 0},
    workplaneId: 'wp-1',
  },
  {
    dependsOn: ['wp-1'],
    localLabelTexts: ['Ingress', 'Mirror'],
    position: {column: 1, row: 0, layer: 0},
    workplaneId: 'wp-2',
  },
  {
    dependsOn: ['wp-1'],
    localLabelTexts: ['Policy', 'Mirror'],
    position: {column: 1, row: 0, layer: 1},
    workplaneId: 'wp-3',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 1, layer: 0},
    workplaneId: 'wp-4',
  },
  {
    dependsOn: ['wp-1'],
    position: {column: 1, row: 1, layer: 1},
    workplaneId: 'wp-5',
  },
  {
    dependsOn: ['wp-2'],
    localLabelTexts: ['Policy', 'Audit'],
    position: {column: 2, row: 0, layer: 0},
    workplaneId: 'wp-6',
  },
  {
    dependsOn: ['wp-3'],
    localLabelTexts: ['Rules', 'Relay'],
    position: {column: 2, row: 0, layer: 1},
    workplaneId: 'wp-7',
  },
  {
    dependsOn: ['wp-4'],
    position: {column: 2, row: 1, layer: 0},
    workplaneId: 'wp-8',
  },
  {
    dependsOn: ['wp-5'],
    position: {column: 2, row: 1, layer: 1},
    workplaneId: 'wp-9',
  },
  {
    dependsOn: ['wp-6'],
    localLabelTexts: ['Deploy', 'Alarm'],
    position: {column: 3, row: 0, layer: 0},
    workplaneId: 'wp-10',
  },
  {
    dependsOn: ['wp-7'],
    position: {column: 3, row: 0, layer: 1},
    workplaneId: 'wp-11',
  },
  {
    dependsOn: ['wp-8'],
    position: {column: 3, row: 1, layer: 0},
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
export const DAG_RANK_FANOUT_TOTAL_LOCAL_LINK_COUNT = DAG_RANK_FANOUT_NODES.reduce(
  (total, node) => total + ((node.localLabelTexts?.length ?? 0) >= 2 ? 1 : 0),
  0,
);
export const DAG_RANK_FANOUT_TOTAL_LOCAL_LABEL_COUNT = DAG_RANK_FANOUT_NODES.reduce(
  (total, node) => total + (node.localLabelTexts?.length ?? 0) * 5,
  0,
);

export function createDefaultDagRankFanoutState(options?: {
  activeWorkplaneId?: WorkplaneId;
  stageMode?: StageMode;
}): StageSystemState {
  const authoredSeedsById = new Map<WorkplaneId, AuthoredWorkplaneSceneSeed>(
    DAG_RANK_FANOUT_NODES.map((node) => [
      node.workplaneId,
      createAuthoredWorkplaneSceneSeed(
        node.workplaneId,
        node.localLabelTexts ?? [],
      ),
    ]),
  );
  const workplanesById = Object.fromEntries(
    DAG_RANK_FANOUT_NODES.map((node) => {
      const authoredSeed = authoredSeedsById.get(node.workplaneId);

      return [
        node.workplaneId,
        {
          labelTextOverrides: {...(authoredSeed?.labelTextOverrides ?? {})},
          scene: authoredSeed?.scene ?? createEmptyStageScene(DEMO_LABEL_SET_ID, node.workplaneId),
          workplaneId: node.workplaneId,
        } satisfies WorkplaneDocumentState,
      ];
    }),
  ) as Record<WorkplaneId, WorkplaneDocumentState>;
  const workplaneViewsById = Object.fromEntries(
    DAG_RANK_FANOUT_WORKPLANE_ORDER.map((workplaneId) => {
      const focusedLabelKey = authoredSeedsById.get(workplaneId)?.primaryLabelKey ?? null;
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
  return buildLabelKey(
    workplaneId,
    1,
    DAG_RANK_FANOUT_PRIMARY_LABEL_ROW,
    DAG_RANK_FANOUT_PRIMARY_LABEL_COLUMN,
  );
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

function createAuthoredWorkplaneSceneSeed(
  workplaneId: WorkplaneId,
  labelTexts: readonly string[],
): AuthoredWorkplaneSceneSeed {
  let scene = createEmptyStageScene(DEMO_LABEL_SET_ID, workplaneId);
  let editorState = createStageEditorState(scene);
  const labelTextOverrides: Record<string, string> = {};
  const rootLabelKeys: string[] = [];

  for (const [index, labelText] of labelTexts.entries()) {
    const mutation = addLabelAtStageEditorCursor(scene, editorState);

    if (!mutation.changed) {
      continue;
    }

    scene = mutation.scene;
    editorState = mutation.editorState;

    const rootLabelKey = buildLabelKey(
      workplaneId,
      1,
      DAG_RANK_FANOUT_PRIMARY_LABEL_ROW,
      DAG_RANK_FANOUT_PRIMARY_LABEL_COLUMN + index,
    );
    const rootLabel =
      scene.labels.find((label) => label.navigation?.key === rootLabelKey) ?? null;

    if (rootLabel) {
      rootLabel.text = labelText;
      labelTextOverrides[rootLabelKey] = labelText;
      rootLabelKeys.push(rootLabelKey);
    }

    if (index < labelTexts.length - 1) {
      editorState = moveStageEditorCursor(editorState, scene, 'pan-right');
    }
  }

  if (rootLabelKeys.length >= 2) {
    editorState = focusStageEditorLabel(editorState, scene, rootLabelKeys[1] ?? '');
    editorState = toggleStageEditorSelection(editorState, scene);
    editorState = focusStageEditorLabel(editorState, scene, rootLabelKeys[0] ?? '');
    editorState = toggleStageEditorSelection(editorState, scene);
    const linkMutation = linkStageEditorSelection(scene, editorState);

    if (linkMutation.changed) {
      scene = linkMutation.scene;
    }
  }

  return {
    labelTextOverrides,
    primaryLabelKey: rootLabelKeys[0] ?? null,
    scene,
  };
}

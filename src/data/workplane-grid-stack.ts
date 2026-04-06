import {
  cloneStackCameraState,
  DEFAULT_STACK_CAMERA_STATE,
} from '../stack-camera';
import {
  type StageMode,
  type StageSystemState,
  type WorkplaneBridgeLinkDefinition,
  type WorkplaneDocumentState,
  type WorkplaneId,
  type WorkplaneViewState,
} from '../plane-stack';
import {createStageScene} from '../scene-model';
import {buildLabelKey} from '../label-key';
import {DEFAULT_DEMO_LAYER_COUNT, getDemoLabelCount} from './labels';

const GRID_STACK_LAYOUT_STRATEGY = 'flow-columns';
const GRID_STACK_WORKPLANE_ORDER: WorkplaneId[] = ['wp-1', 'wp-2', 'wp-3', 'wp-4', 'wp-5'];
const GRID_STACK_ACTIVE_WORKPLANE_ID: WorkplaneId = 'wp-3';
const GRID_STACK_FOCUSED_ROW = 6;
const GRID_STACK_FOCUSED_COLUMN = 6;

export function createFiveWorkplaneGridState(options: {
  activeWorkplaneId?: WorkplaneId;
  stageMode: StageMode;
}): StageSystemState {
  const workplanesById = Object.fromEntries(
    GRID_STACK_WORKPLANE_ORDER.map((workplaneId) => {
      const scene = createStageScene({
        demoLayerCount: DEFAULT_DEMO_LAYER_COUNT,
        labelSetKind: 'demo',
        labelTargetCount: getDemoLabelCount(DEFAULT_DEMO_LAYER_COUNT),
        layoutStrategy: GRID_STACK_LAYOUT_STRATEGY,
        workplaneId,
      });

      return [
        workplaneId,
        {
          labelTextOverrides: {},
          scene,
          workplaneId,
        } satisfies WorkplaneDocumentState,
      ];
    }),
  ) as Record<WorkplaneId, WorkplaneDocumentState>;

  const workplaneViewsById = Object.fromEntries(
    GRID_STACK_WORKPLANE_ORDER.map((workplaneId) => {
      const scene = workplanesById[workplaneId]?.scene;
      const selectedLabelKey = buildLabelKey(
        workplaneId,
        1,
        GRID_STACK_FOCUSED_ROW,
        GRID_STACK_FOCUSED_COLUMN,
      );
      const focusedLabel =
        scene?.labels.find((label) => label.navigation?.key === selectedLabelKey) ?? null;

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
          selectedLabelKey,
        } satisfies WorkplaneViewState,
      ];
    }),
  ) as Record<WorkplaneId, WorkplaneViewState>;

  return {
    document: {
      nextWorkplaneNumber: GRID_STACK_WORKPLANE_ORDER.length + 1,
      workplaneBridgeLinks: createGridBridgeLinks(),
      workplaneOrder: [...GRID_STACK_WORKPLANE_ORDER],
      workplanesById,
    },
    session: {
      activeWorkplaneId: options.activeWorkplaneId ?? GRID_STACK_ACTIVE_WORKPLANE_ID,
      stackCamera: cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE),
      stageMode: options.stageMode,
      workplaneViewsById,
    },
  };
}

function createGridBridgeLinks(): WorkplaneBridgeLinkDefinition[] {
  const bridgeSpecs: Array<{
    color: [number, number, number, number];
    input: WorkplaneId;
    inputColumn: number;
    inputRow: number;
    output: WorkplaneId;
    outputColumn: number;
    outputRow: number;
  }> = [
    {output: 'wp-1', outputRow: 6, outputColumn: 6, input: 'wp-2', inputRow: 6, inputColumn: 6, color: [0.82, 0.82, 0.82, 0.52]},
    {output: 'wp-2', outputRow: 6, outputColumn: 6, input: 'wp-3', inputRow: 6, inputColumn: 6, color: [0.78, 0.78, 0.78, 0.5]},
    {output: 'wp-3', outputRow: 6, outputColumn: 6, input: 'wp-4', inputRow: 6, inputColumn: 6, color: [0.74, 0.74, 0.74, 0.48]},
    {output: 'wp-4', outputRow: 6, outputColumn: 6, input: 'wp-5', inputRow: 6, inputColumn: 6, color: [0.7, 0.7, 0.7, 0.46]},
    {output: 'wp-5', outputRow: 6, outputColumn: 6, input: 'wp-1', inputRow: 6, inputColumn: 6, color: [0.86, 0.86, 0.86, 0.48]},
    {output: 'wp-1', outputRow: 3, outputColumn: 3, input: 'wp-3', inputRow: 10, inputColumn: 10, color: [0.68, 0.68, 0.68, 0.42]},
    {output: 'wp-2', outputRow: 10, outputColumn: 3, input: 'wp-4', inputRow: 3, inputColumn: 10, color: [0.64, 0.64, 0.64, 0.4]},
    {output: 'wp-3', outputRow: 2, outputColumn: 11, input: 'wp-5', inputRow: 11, inputColumn: 2, color: [0.72, 0.72, 0.72, 0.44]},
  ];

  return bridgeSpecs.map((spec, index) => ({
    bendDirection: 1,
    color: [...spec.color],
    curveBias: 0.24,
    curveDepth: 0.16,
    curveLift: 0.1,
    inputLabelKey: buildLabelKey(spec.input, 1, spec.inputRow, spec.inputColumn),
    inputWorkplaneId: spec.input,
    linkKey: `bridge:grid:${index + 1}`,
    lineWidth: 2.4,
    outputLabelKey: buildLabelKey(spec.output, 1, spec.outputRow, spec.outputColumn),
    outputWorkplaneId: spec.output,
    zoomLevel: 0,
    zoomRange: 8,
  }));
}

import {
  getActiveWorkplaneDocument,
  type StageSystemState,
  type WorkplaneId,
} from './plane-stack';
import {
  includeScenePointInBounds,
  type SceneBounds3D,
  type ScenePoint3D,
} from './scene-space';
import type {StageScene} from './scene-model';
import type {LinkDefinition} from './line/types';
import type {LabelDefinition, LabelPlaneBasis, RgbaColor} from './text/types';

const STACK_PLANE_BASIS_X: LabelPlaneBasis = {x: 1, y: 0, z: 0};
const STACK_PLANE_BASIS_Y: LabelPlaneBasis = {x: 0, y: -1, z: 0};
const STACK_PLANE_PADDING = 1.8;
const STACK_PLANE_OFFSET_RATIO = 0.36;
const INACTIVE_PLANE_ALPHA_SCALE = 0.68;
const ACTIVE_BACKPLATE_FILL: RgbaColor = [0.08, 0.12, 0.18, 0.82];
const ACTIVE_BACKPLATE_OUTLINE: RgbaColor = [0.66, 0.82, 1, 0.94];
const INACTIVE_BACKPLATE_FILL: RgbaColor = [0.04, 0.06, 0.09, 0.58];
const INACTIVE_BACKPLATE_OUTLINE: RgbaColor = [0.19, 0.24, 0.32, 0.72];

export type StackBackplate = {
  corners: [ScenePoint3D, ScenePoint3D, ScenePoint3D, ScenePoint3D];
  fillColor: RgbaColor;
  isActive: boolean;
  outlineColor: RgbaColor;
  workplaneId: WorkplaneId;
};

export type StackViewState = {
  backplates: StackBackplate[];
  scene: StageScene;
  sceneBounds: SceneBounds3D;
};

export function createStackViewState(state: StageSystemState): StackViewState {
  const activeWorkplane = getActiveWorkplaneDocument(state);
  const sceneBoundsById = new Map<WorkplaneId, ScenePlaneBounds>();
  let maxSceneWidth = 1;
  let maxSceneHeight = 1;

  for (const workplaneId of state.document.workplaneOrder) {
    const workplane = state.document.workplanesById[workplaneId];
    const sceneBounds = expandSceneBounds(measureSceneBounds(workplane.scene), STACK_PLANE_PADDING);
    sceneBoundsById.set(workplaneId, sceneBounds);
    maxSceneWidth = Math.max(maxSceneWidth, sceneBounds.maxX - sceneBounds.minX);
    maxSceneHeight = Math.max(maxSceneHeight, sceneBounds.maxY - sceneBounds.minY);
  }

  const planeOffset = Math.max(maxSceneWidth, maxSceneHeight) * STACK_PLANE_OFFSET_RATIO;
  const backplates: StackBackplate[] = [];
  const labels: LabelDefinition[] = [];
  const links: LinkDefinition[] = [];
  let sceneBounds: SceneBounds3D | null = null;

  for (let stackIndex = state.document.workplaneOrder.length - 1; stackIndex >= 0; stackIndex -= 1) {
    const workplaneId = state.document.workplaneOrder[stackIndex];
    const workplane = state.document.workplanesById[workplaneId];
    const planeBounds = sceneBoundsById.get(workplaneId) ?? {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    };
    const planeZ = -planeOffset * stackIndex;
    const isActive = workplaneId === state.session.activeWorkplaneId;
    const alphaScale = isActive ? 1 : INACTIVE_PLANE_ALPHA_SCALE;
    const backplateCorners = createBackplateCorners(planeBounds, planeZ);

    backplates.push({
      corners: backplateCorners,
      fillColor: isActive ? ACTIVE_BACKPLATE_FILL : INACTIVE_BACKPLATE_FILL,
      isActive,
      outlineColor: isActive ? ACTIVE_BACKPLATE_OUTLINE : INACTIVE_BACKPLATE_OUTLINE,
      workplaneId,
    });
    sceneBounds = includeCornersInSceneBounds(sceneBounds, backplateCorners);

    for (const label of workplane.scene.labels) {
      const stackLocation = projectWorkplanePointToScene(label.location, planeZ);

      labels.push({
        ...label,
        color: label.color ? scaleColorAlpha(label.color, alphaScale) : undefined,
        inputLinkKeys: [...label.inputLinkKeys],
        location: stackLocation,
        navigation: label.navigation ? {...label.navigation} : undefined,
        outputLinkKeys: [...label.outputLinkKeys],
        planeBasisX: {...STACK_PLANE_BASIS_X},
        planeBasisY: {...STACK_PLANE_BASIS_Y},
      });
      sceneBounds = includeScenePointInBounds(sceneBounds, stackLocation);
    }

    for (const link of workplane.scene.links) {
      const inputLocation = projectWorkplanePointToScene(link.inputLocation, planeZ);
      const outputLocation = projectWorkplanePointToScene(link.outputLocation, planeZ);

      links.push({
        ...link,
        color: scaleColorAlpha(link.color, alphaScale),
        inputLocation,
        outputLocation,
      });
      sceneBounds = includeScenePointInBounds(sceneBounds, inputLocation);
      sceneBounds = includeScenePointInBounds(sceneBounds, outputLocation);
    }
  }

  return {
    backplates,
    scene: {
      labelSetPreset: activeWorkplane.scene.labelSetPreset,
      labels,
      links,
    },
    sceneBounds:
      sceneBounds ?? {
        minX: -1,
        maxX: 1,
        minY: -1,
        maxY: 1,
        minZ: -1,
        maxZ: 1,
      },
  };
}

type ScenePlaneBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function projectWorkplanePointToScene(
  point: {x: number; y: number; z?: number},
  planeZ: number,
): ScenePoint3D {
  return {
    x: point.x,
    y: point.y,
    z: planeZ + (point.z ?? 0),
  };
}

function measureSceneBounds(scene: StageScene): ScenePlaneBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const label of scene.labels) {
    minX = Math.min(minX, label.location.x);
    maxX = Math.max(maxX, label.location.x);
    minY = Math.min(minY, label.location.y);
    maxY = Math.max(maxY, label.location.y);
  }

  for (const link of scene.links) {
    minX = Math.min(minX, link.inputLocation.x, link.outputLocation.x);
    maxX = Math.max(maxX, link.inputLocation.x, link.outputLocation.x);
    minY = Math.min(minY, link.inputLocation.y, link.outputLocation.y);
    maxY = Math.max(maxY, link.inputLocation.y, link.outputLocation.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return {
      minX: -1,
      maxX: 1,
      minY: -1,
      maxY: 1,
    };
  }

  return {minX, maxX, minY, maxY};
}

function expandSceneBounds(bounds: ScenePlaneBounds, padding: number): ScenePlaneBounds {
  return {
    minX: bounds.minX - padding,
    maxX: bounds.maxX + padding,
    minY: bounds.minY - padding,
    maxY: bounds.maxY + padding,
  };
}

function createBackplateCorners(
  bounds: ScenePlaneBounds,
  planeZ: number,
): [ScenePoint3D, ScenePoint3D, ScenePoint3D, ScenePoint3D] {
  return [
    {x: bounds.minX, y: bounds.maxY, z: planeZ},
    {x: bounds.maxX, y: bounds.maxY, z: planeZ},
    {x: bounds.maxX, y: bounds.minY, z: planeZ},
    {x: bounds.minX, y: bounds.minY, z: planeZ},
  ];
}

function includeCornersInSceneBounds(
  sceneBounds: SceneBounds3D | null,
  corners: [ScenePoint3D, ScenePoint3D, ScenePoint3D, ScenePoint3D],
): SceneBounds3D {
  return corners.reduce<SceneBounds3D | null>(
    (nextSceneBounds, corner) => includeScenePointInBounds(nextSceneBounds, corner),
    sceneBounds,
  ) ?? {
    minX: -1,
    maxX: 1,
    minY: -1,
    maxY: 1,
    minZ: -1,
    maxZ: 1,
  };
}

function scaleColorAlpha(
  color: RgbaColor,
  alphaScale: number,
): RgbaColor {
  return [color[0], color[1], color[2], Math.min(1, color[3] * alphaScale)];
}

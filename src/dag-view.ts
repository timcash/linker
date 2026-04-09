import type {ViewportSize} from './camera';
import type {DagDocumentState} from './dag-document';
import {
  layoutDagNode,
  resolveDagEdgeCurve,
  type DagEdgeWorldLayout,
  type DagNodeWorldLayout,
} from './dag-layout';
import type {LinkDefinition} from './line/types';
import {
  getActiveWorkplaneDocument,
  type StageSystemState,
  type WorkplaneId,
} from './plane-stack';
import {StackCameraProjector} from './projector';
import type {StageScene} from './scene-model';
import {
  includeScenePointInBounds,
  type SceneBounds3D,
  type ScenePoint3D,
} from './scene-space';
import type {StackBackplate, StackViewState} from './stack-view';
import type {LabelDefinition, LabelPlaneBasis, RgbaColor} from './text/types';

const STACK_PLANE_BASIS_X: LabelPlaneBasis = {x: 1, y: 0, z: 0};
const STACK_PLANE_BASIS_Y: LabelPlaneBasis = {x: 0, y: -1, z: 0};
const STACK_PLANE_PADDING = 1.8;
const INACTIVE_PLANE_ALPHA_SCALE = 0.68;
const ACTIVE_BACKPLATE_FILL: RgbaColor = [0.08, 0.12, 0.18, 0.82];
const ACTIVE_BACKPLATE_OUTLINE: RgbaColor = [0.66, 0.82, 1, 0.94];
const INACTIVE_BACKPLATE_FILL: RgbaColor = [0.04, 0.06, 0.09, 0.58];
const INACTIVE_BACKPLATE_OUTLINE: RgbaColor = [0.19, 0.24, 0.32, 0.72];
const DAG_EDGE_COLOR: RgbaColor = [0.78, 0.82, 0.9, 0.56];

type ScenePlaneBounds = {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
};

type DagProjectedNode = {
  layout: DagNodeWorldLayout;
  translation: ScenePoint3D;
  workplane: StageSystemState['document']['workplanesById'][WorkplaneId];
};

export type WorkplaneLod =
  | 'full-workplane'
  | 'label-points'
  | 'title-only'
  | 'graph-point';

export type DagVisibleNode = {
  layout: DagNodeWorldLayout;
  projectedPlaneSpanPx: number;
};

export type DagLodBuckets = {
  fullWorkplanes: DagNodeWorldLayout[];
  graphPointWorkplanes: DagNodeWorldLayout[];
  labelPointWorkplanes: DagNodeWorldLayout[];
  titleOnlyWorkplanes: DagNodeWorldLayout[];
};

export function resolveWorkplaneLod(projectedPlaneSpanPx: number): WorkplaneLod {
  if (!Number.isFinite(projectedPlaneSpanPx)) {
    return 'graph-point';
  }

  if (projectedPlaneSpanPx >= 180) {
    return 'full-workplane';
  }

  if (projectedPlaneSpanPx >= 72) {
    return 'label-points';
  }

  if (projectedPlaneSpanPx >= 22) {
    return 'title-only';
  }

  return 'graph-point';
}

export function bucketVisibleDagNodes(visibleNodes: DagVisibleNode[]): DagLodBuckets {
  const buckets: DagLodBuckets = {
    fullWorkplanes: [],
    graphPointWorkplanes: [],
    labelPointWorkplanes: [],
    titleOnlyWorkplanes: [],
  };

  for (const node of visibleNodes) {
    switch (resolveWorkplaneLod(node.projectedPlaneSpanPx)) {
      case 'full-workplane':
        buckets.fullWorkplanes.push(node.layout);
        break;
      case 'label-points':
        buckets.labelPointWorkplanes.push(node.layout);
        break;
      case 'title-only':
        buckets.titleOnlyWorkplanes.push(node.layout);
        break;
      case 'graph-point':
        buckets.graphPointWorkplanes.push(node.layout);
        break;
    }
  }

  return buckets;
}

export function createProjectedDagVisibleNodes(
  state: StageSystemState,
  viewport: ViewportSize,
): DagVisibleNode[] {
  const dagDocument = createDagDocumentFromState(state);

  if (!dagDocument) {
    return [];
  }

  const stackViewState = createDagStackViewState(state);
  const projector = new StackCameraProjector();
  projector.setSceneBounds(stackViewState.sceneBounds);
  projector.setOrbitTarget(stackViewState.orbitTarget);
  projector.setStackCamera(state.session.stackCamera);

  return createProjectedDagNodes(state, dagDocument).map((node) => ({
    layout: node.layout,
    projectedPlaneSpanPx: measureProjectedPlaneSpanPx(node.layout, projector, viewport),
  }));
}

export function createDagNodeLayouts(document: DagDocumentState): DagNodeWorldLayout[] {
  return Object.values(document.nodesById)
    .sort((left, right) => {
      return (
        left.position.column - right.position.column ||
        left.position.row - right.position.row ||
        left.position.layer - right.position.layer ||
        left.workplaneId.localeCompare(right.workplaneId, undefined, {numeric: true})
      );
    })
    .map((node) => layoutDagNode(node.workplaneId, node.position));
}

export function createDagNodeLayoutsById(
  document: DagDocumentState,
): Map<WorkplaneId, DagNodeWorldLayout> {
  return new Map(createDagNodeLayouts(document).map((layout) => [layout.workplaneId, layout]));
}

export function createDagEdgeCurves(document: DagDocumentState): DagEdgeWorldLayout[] {
  const nodeLayoutsById = createDagNodeLayoutsById(document);

  return document.edges.flatMap((edge) => {
    const resolvedEdge = resolveDagEdgeCurve(edge, nodeLayoutsById);
    return resolvedEdge ? [resolvedEdge] : [];
  });
}

export function createDagStackViewState(state: StageSystemState): StackViewState {
  const dagDocument = createDagDocumentFromState(state);
  const activeWorkplane = getActiveWorkplaneDocument(state);

  if (!dagDocument) {
    return {
      backplates: [],
      orbitTarget: {x: 0, y: 0, z: 0},
      scene: {
        labelSetPreset: activeWorkplane.scene.labelSetPreset,
        labels: [],
        links: [],
        workplaneId: activeWorkplane.scene.workplaneId,
      },
      sceneBounds: {
        maxX: 1,
        maxY: 1,
        maxZ: 1,
        minX: -1,
        minY: -1,
        minZ: -1,
      },
    };
  }

  const projectedNodes = createProjectedDagNodes(state, dagDocument);
  const nodeLayoutsById = new Map(projectedNodes.map((node) => [node.layout.workplaneId, node.layout]));
  const backplates: StackBackplate[] = [];
  const labels: LabelDefinition[] = [];
  const links: LinkDefinition[] = [];
  let orbitTarget: ScenePoint3D | null = null;
  let sceneBounds: SceneBounds3D | null = null;

  for (const node of projectedNodes) {
    const isActive = node.layout.workplaneId === state.session.activeWorkplaneId;
    const alphaScale = isActive ? 1 : INACTIVE_PLANE_ALPHA_SCALE;
    const backplateCorners = createBackplateCorners(node.layout.planeBounds);

    backplates.push({
      corners: backplateCorners,
      fillColor: isActive ? ACTIVE_BACKPLATE_FILL : INACTIVE_BACKPLATE_FILL,
      isActive,
      outlineColor: isActive ? ACTIVE_BACKPLATE_OUTLINE : INACTIVE_BACKPLATE_OUTLINE,
      workplaneId: node.layout.workplaneId,
    });
    sceneBounds = includeCornersInSceneBounds(sceneBounds, backplateCorners);

    if (isActive) {
      orbitTarget = {
        x: (node.layout.planeBounds.minX + node.layout.planeBounds.maxX) * 0.5,
        y: (node.layout.planeBounds.minY + node.layout.planeBounds.maxY) * 0.5,
        z: node.layout.origin.z,
      };
    }

    for (const label of node.workplane.scene.labels) {
      const worldLocation = projectWorkplanePointToScene(label.location, node.translation);
      const worldLabel: LabelDefinition = {
        ...label,
        color: label.color ? scaleColorAlpha(label.color, alphaScale) : undefined,
        inputLinkKeys: [...label.inputLinkKeys],
        location: worldLocation,
        navigation: label.navigation ? {...label.navigation} : undefined,
        outputLinkKeys: [...label.outputLinkKeys],
        planeBasisX: {...STACK_PLANE_BASIS_X},
        planeBasisY: {...STACK_PLANE_BASIS_Y},
      };

      labels.push(worldLabel);
      sceneBounds = includeScenePointInBounds(sceneBounds, worldLocation);
    }

    for (const link of node.workplane.scene.links) {
      const inputLocation = projectWorkplanePointToScene(link.inputLocation, node.translation);
      const outputLocation = projectWorkplanePointToScene(link.outputLocation, node.translation);

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

  for (const edge of dagDocument.edges) {
    const resolvedEdge = resolveDagEdgeCurve(edge, nodeLayoutsById);

    if (!resolvedEdge) {
      continue;
    }

    links.push(createDagEdgeLinkDefinition(resolvedEdge));
    sceneBounds = includeScenePointInBounds(sceneBounds, resolvedEdge.input);
    sceneBounds = includeScenePointInBounds(sceneBounds, resolvedEdge.output);
  }

  return {
    backplates,
    orbitTarget: orbitTarget ?? {x: 0, y: 0, z: 0},
    scene: {
      labelSetPreset: activeWorkplane.scene.labelSetPreset,
      labels,
      links,
      workplaneId: activeWorkplane.scene.workplaneId,
    },
    sceneBounds:
      sceneBounds ?? {
        maxX: 1,
        maxY: 1,
        maxZ: 1,
        minX: -1,
        minY: -1,
        minZ: -1,
      },
  };
}

function createDagDocumentFromState(state: StageSystemState): DagDocumentState | null {
  const dag = state.document.dag;

  if (!dag) {
    return null;
  }

  return {
    edges: dag.edges.map((edge) => ({...edge})),
    nextWorkplaneNumber: state.document.nextWorkplaneNumber,
    nodesById: Object.fromEntries(
      Object.entries(dag.positionsById).flatMap(([workplaneId, position]) => {
        const typedWorkplaneId = workplaneId as WorkplaneId;
        const workplane = state.document.workplanesById[typedWorkplaneId];

        if (!workplane) {
          return [];
        }

        return [
          [
            typedWorkplaneId,
            {
              labelTextOverrides: {...workplane.labelTextOverrides},
              position: {...position},
              scene: workplane.scene,
              workplaneId: typedWorkplaneId,
            },
          ],
        ];
      }),
    ) as DagDocumentState['nodesById'],
    rootWorkplaneId: dag.rootWorkplaneId,
  };
}

function createProjectedDagNodes(
  state: StageSystemState,
  document: DagDocumentState,
): DagProjectedNode[] {
  const baseLayoutsById = createDagNodeLayoutsById(document);

  return state.document.workplaneOrder.flatMap((workplaneId) => {
    const workplane = state.document.workplanesById[workplaneId];
    const baseLayout = baseLayoutsById.get(workplaneId);

    if (!workplane || !baseLayout) {
      return [];
    }

    const localBounds = expandSceneBounds(measureSceneBounds(workplane.scene), STACK_PLANE_PADDING);
    const localCenterX = (localBounds.minX + localBounds.maxX) * 0.5;
    const localCenterY = (localBounds.minY + localBounds.maxY) * 0.5;
    const localHalfWidth = Math.max(
      localBounds.maxX - localCenterX,
      localCenterX - localBounds.minX,
      (baseLayout.planeBounds.maxX - baseLayout.planeBounds.minX) * 0.5,
    );
    const localHalfHeight = Math.max(
      localBounds.maxY - localCenterY,
      localCenterY - localBounds.minY,
      (baseLayout.planeBounds.maxY - baseLayout.planeBounds.minY) * 0.5,
    );
    const translation = {
      x: baseLayout.origin.x - localCenterX,
      y: baseLayout.origin.y - localCenterY,
      z: baseLayout.origin.z,
    };

    return [
      {
        layout: {
          ...baseLayout,
          planeBounds: {
            maxX: baseLayout.origin.x + localHalfWidth,
            maxY: baseLayout.origin.y + localHalfHeight,
            minX: baseLayout.origin.x - localHalfWidth,
            minY: baseLayout.origin.y - localHalfHeight,
            z: baseLayout.origin.z,
          },
        },
        translation,
        workplane,
      },
    ];
  });
}

function createDagEdgeLinkDefinition(edge: DagEdgeWorldLayout): LinkDefinition {
  return {
    bendDirection: 1,
    color: [...DAG_EDGE_COLOR],
    curveBias: 0.24,
    curveDepth: 0.16,
    curveLift: 0.1,
    inputLabelKey: `dag:${edge.toWorkplaneId}:input`,
    inputLinkPoint: 'left-center',
    inputLocation: {...edge.input},
    linkKey: `bridge:dag:${edge.edgeKey}`,
    lineWidth: 2.4,
    outputLabelKey: `dag:${edge.fromWorkplaneId}:output`,
    outputLinkPoint: 'right-center',
    outputLocation: {...edge.output},
    zoomLevel: 0,
    zoomRange: 8,
  };
}

function projectWorkplanePointToScene(
  point: {x: number; y: number; z?: number},
  translation: ScenePoint3D,
): ScenePoint3D {
  return {
    x: point.x + translation.x,
    y: point.y + translation.y,
    z: (point.z ?? 0) + translation.z,
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
      maxX: 1,
      maxY: 1,
      minX: -1,
      minY: -1,
    };
  }

  return {maxX, maxY, minX, minY};
}

function expandSceneBounds(bounds: ScenePlaneBounds, padding: number): ScenePlaneBounds {
  return {
    maxX: bounds.maxX + padding,
    maxY: bounds.maxY + padding,
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
  };
}

function createBackplateCorners(
  bounds: DagNodeWorldLayout['planeBounds'],
): [ScenePoint3D, ScenePoint3D, ScenePoint3D, ScenePoint3D] {
  return [
    {x: bounds.minX, y: bounds.maxY, z: bounds.z},
    {x: bounds.maxX, y: bounds.maxY, z: bounds.z},
    {x: bounds.maxX, y: bounds.minY, z: bounds.z},
    {x: bounds.minX, y: bounds.minY, z: bounds.z},
  ];
}

function measureProjectedPlaneSpanPx(
  layout: DagNodeWorldLayout,
  projector: StackCameraProjector,
  viewport: ViewportSize,
): number {
  const corners = createBackplateCorners(layout.planeBounds);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const point = projector.projectWorldPoint(corner, viewport);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return 0;
  }

  return Math.max(maxX - minX, maxY - minY);
}

function includeCornersInSceneBounds(
  sceneBounds: SceneBounds3D | null,
  corners: [ScenePoint3D, ScenePoint3D, ScenePoint3D, ScenePoint3D],
): SceneBounds3D {
  return corners.reduce<SceneBounds3D | null>(
    (nextSceneBounds, corner) => includeScenePointInBounds(nextSceneBounds, corner),
    sceneBounds,
  ) ?? {
    maxX: 1,
    maxY: 1,
    maxZ: 1,
    minX: -1,
    minY: -1,
    minZ: -1,
  };
}

function scaleColorAlpha(
  color: RgbaColor,
  alphaScale: number,
): RgbaColor {
  return [color[0], color[1], color[2], Math.min(1, color[3] * alphaScale)];
}

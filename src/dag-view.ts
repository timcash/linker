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
  getSceneBoundsCenter,
  includeScenePointInBounds,
  type SceneBounds3D,
  type ScenePoint3D,
} from './scene-space';
import {DEFAULT_STACK_CAMERA_STATE} from './stack-camera';
import type {StackBackplate, StackViewState} from './stack-view';
import type {LabelDefinition, LabelPlaneBasis, RgbaColor} from './text/types';

const STACK_PLANE_BASIS_X: LabelPlaneBasis = {x: 1, y: 0, z: 0};
const STACK_PLANE_BASIS_Y: LabelPlaneBasis = {x: 0, y: -1, z: 0};
const STACK_PLANE_PADDING = 1.8;
const INACTIVE_PLANE_ALPHA_SCALE = 0.82;
const ACTIVE_BACKPLATE_FILL: RgbaColor = [0.02, 0.02, 0.02, 0.97];
const ACTIVE_BACKPLATE_OUTLINE: RgbaColor = [1, 1, 1, 1];
const INACTIVE_BACKPLATE_FILL: RgbaColor = [0.01, 0.01, 0.01, 0.88];
const INACTIVE_BACKPLATE_OUTLINE: RgbaColor = [0.78, 0.78, 0.78, 0.9];
const DAG_GRAPH_POINT_SYMBOL_ACTIVE_FILL: RgbaColor = [1, 1, 1, 0.34];
const DAG_GRAPH_POINT_SYMBOL_ACTIVE_OUTLINE: RgbaColor = [1, 1, 1, 1];
const DAG_GRAPH_POINT_SYMBOL_INACTIVE_FILL: RgbaColor = [1, 1, 1, 0.18];
const DAG_GRAPH_POINT_SYMBOL_INACTIVE_OUTLINE: RgbaColor = [1, 1, 1, 0.8];
const DAG_EDGE_COLOR: RgbaColor = [1, 1, 1, 0.96];
const DAG_TITLE_ACTIVE_COLOR: RgbaColor = [1, 1, 1, 1];
const DAG_TITLE_INACTIVE_COLOR: RgbaColor = [0.88, 0.88, 0.88, 0.97];
const DAG_POINT_COLOR: RgbaColor = [1, 1, 1, 1];
const DAG_TITLE_LABEL_SIZE = 1.72;
const DAG_OVERVIEW_TITLE_LABEL_SIZE = 3.1;
const DAG_GRAPH_POINT_SYMBOL_HALF_SIZE = 5.2;
const DAG_LABEL_POINT_MARKER_SIZE = 0.86;
export const DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX = 32;
export const DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX = 92;
export const DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX = 150;
const DAG_ALWAYS_VISIBLE_ZOOM_LEVEL = 0;
const DAG_ALWAYS_VISIBLE_ZOOM_RANGE = 40;
const DEFAULT_DAG_VIEWPORT: ViewportSize = {width: 393, height: 852};
const DAG_FULL_LABEL_SIZE_SCALE = 2.3;
const DAG_FULL_MIN_LABEL_SIZE = 0.48;
const DAG_FULL_LINE_WIDTH_SCALE = 1.45;
const DAG_LABEL_POINT_LINE_ALPHA_SCALE = 0.82;
const DAG_LABEL_POINT_LINE_WIDTH_SCALE = 1.08;
const DAG_CAMERA_BASE_AZIMUTH_MIN = -0.9;
const DAG_CAMERA_BASE_AZIMUTH_MAX = -0.58;
const DAG_CAMERA_BASE_AZIMUTH_PREFERRED = -0.72;
const DAG_CAMERA_BASE_AZIMUTH_STEP = 0.06;
const DAG_CAMERA_BASE_ELEVATION_MIN = -0.36;
const DAG_CAMERA_BASE_ELEVATION_MAX = -0.16;
const DAG_CAMERA_BASE_ELEVATION_PREFERRED = -0.24;
const DAG_CAMERA_BASE_ELEVATION_STEP = 0.04;

type ScenePlaneBounds = {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
};

type DagProjectedNode = {
  contentPlaneBounds: DagNodeWorldLayout['planeBounds'];
  layout: DagNodeWorldLayout;
  translation: ScenePoint3D;
  workplane: StageSystemState['document']['workplanesById'][WorkplaneId];
};

type DagSceneScaffold = {
  activeOrbitTarget: ScenePoint3D;
  graphCenter: ScenePoint3D;
  sceneBounds: SceneBounds3D;
};

type DagProjectionContext = {
  focusAlpha: number;
  orbitTarget: ScenePoint3D;
  projectedPlaneSpanById: Map<WorkplaneId, number>;
  scaffold: DagSceneScaffold;
  stackCamera: StageSystemState['session']['stackCamera'];
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

  if (projectedPlaneSpanPx >= DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX) {
    return 'full-workplane';
  }

  if (projectedPlaneSpanPx >= DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX) {
    return 'label-points';
  }

  if (projectedPlaneSpanPx >= DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX) {
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
  options?: {stackCamera?: StageSystemState['session']['stackCamera']},
): DagVisibleNode[] {
  const dagDocument = createDagDocumentFromState(state);

  if (!dagDocument) {
    return [];
  }

  const projectedNodes = createProjectedDagNodes(state, dagDocument);
  const projectionContext = createDagProjectionContext(
    projectedNodes,
    state.session.activeWorkplaneId,
    options?.stackCamera ?? state.session.stackCamera,
    viewport,
  );

  return projectedNodes.map((node) => ({
    layout: node.layout,
    projectedPlaneSpanPx: projectionContext.projectedPlaneSpanById.get(node.layout.workplaneId) ?? 0,
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

export function createDagStackViewState(
  state: StageSystemState,
  options?: {
    stackCamera?: StageSystemState['session']['stackCamera'];
    viewport?: ViewportSize;
  },
): StackViewState {
  const dagDocument = createDagDocumentFromState(state);
  const activeWorkplane = getActiveWorkplaneDocument(state);

  if (!dagDocument) {
    return {
      backplates: [],
      orbitTarget: {x: 0, y: 0, z: 0},
      projectorStackCamera: options?.stackCamera ?? state.session.stackCamera,
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
  const viewport = options?.viewport ?? DEFAULT_DAG_VIEWPORT;
  const projectionContext = createDagProjectionContext(
    projectedNodes,
    state.session.activeWorkplaneId,
    options?.stackCamera ?? state.session.stackCamera,
    viewport,
  );
  const projectedPlaneSpanById = projectionContext.projectedPlaneSpanById;
  const nodeLayoutsById = new Map(projectedNodes.map((node) => [node.layout.workplaneId, node.layout]));
  const graphDistanceById = createDagGraphDistanceById(
    dagDocument,
    state.session.activeWorkplaneId,
  );
  const backplates: StackBackplate[] = [];
  const labels: LabelDefinition[] = [];
  const links: LinkDefinition[] = [];
  let sceneBounds: SceneBounds3D | null = cloneSceneBounds(projectionContext.scaffold.sceneBounds);

  for (const node of projectedNodes) {
    const isActive = node.layout.workplaneId === state.session.activeWorkplaneId;
    const alphaScale = resolveDagNodeAlphaScale(
      isActive,
      graphDistanceById.get(node.layout.workplaneId) ?? Number.POSITIVE_INFINITY,
      projectionContext.focusAlpha,
    );
    const projectedPlaneSpanPx = projectedPlaneSpanById.get(node.layout.workplaneId) ?? 0;
    const lod = resolveWorkplaneLod(projectedPlaneSpanPx);
    const backplateCorners = createBackplateCorners(
      lod === 'full-workplane' ? node.contentPlaneBounds : node.layout.planeBounds,
    );

    if (lod === 'graph-point') {
      backplates.push(createGraphPointSymbolBackplate(node, isActive, alphaScale));
    } else {
      backplates.push({
        corners: backplateCorners,
        fillColor: isActive ? ACTIVE_BACKPLATE_FILL : INACTIVE_BACKPLATE_FILL,
        isActive,
        outlineColor: isActive ? ACTIVE_BACKPLATE_OUTLINE : INACTIVE_BACKPLATE_OUTLINE,
        workplaneId: node.layout.workplaneId,
      });
    }

    switch (lod) {
      case 'full-workplane':
        appendFullWorkplaneNodeScene(
          node,
          isActive,
          alphaScale,
          labels,
          links,
          state.session.workplaneViewsById[node.workplane.workplaneId]?.selectedLabelKey ?? null,
        );
        break;
      case 'label-points':
        appendLabelPointNodeScene(node, isActive, alphaScale, labels, links);
        break;
      case 'title-only':
        appendTitleOnlyNodeScene(node, isActive, alphaScale, labels);
        break;
      case 'graph-point':
        appendGraphPointNodeScene();
        break;
    }
  }

  for (const edge of dagDocument.edges) {
    const resolvedEdge = resolveDagEdgeCurve(edge, nodeLayoutsById);

    if (!resolvedEdge) {
      continue;
    }

    links.push(
      createDagEdgeLinkDefinition(
        resolvedEdge,
        resolveDagEdgeAlphaScale(
          graphDistanceById.get(resolvedEdge.fromWorkplaneId) ?? Number.POSITIVE_INFINITY,
          graphDistanceById.get(resolvedEdge.toWorkplaneId) ?? Number.POSITIVE_INFINITY,
          projectionContext.focusAlpha,
        ),
      ),
    );
    sceneBounds = includeScenePointInBounds(sceneBounds, resolvedEdge.input);
    sceneBounds = includeScenePointInBounds(sceneBounds, resolvedEdge.output);
  }

  return {
    backplates,
    orbitTarget: projectionContext.orbitTarget,
    projectorStackCamera: projectionContext.stackCamera,
    scene: {
      labelSetPreset: activeWorkplane.scene.labelSetPreset,
      labels,
      links,
      workplaneId: activeWorkplane.scene.workplaneId,
    },
    sceneBounds: sceneBounds ?? cloneSceneBounds(projectionContext.scaffold.sceneBounds),
  };
}

function appendFullWorkplaneNodeScene(
  node: DagProjectedNode,
  isActive: boolean,
  alphaScale: number,
  labels: LabelDefinition[],
  links: LinkDefinition[],
  focusedLabelKey: string | null,
): void {
  labels.push(createWorkplaneTitleLabel(node, isActive, alphaScale));

  for (const label of node.workplane.scene.labels) {
    labels.push(createWorldLabel(label, node.translation, alphaScale));
  }

  for (const link of node.workplane.scene.links) {
    links.push(createWorldLink(link, node.translation, alphaScale));
  }

  const focusedLabel = focusedLabelKey
    ? node.workplane.scene.labels.find((label) => label.navigation?.key === focusedLabelKey) ?? null
    : null;

  if (focusedLabel) {
    labels.push(createFocusedWorkplaneSummaryLabel(focusedLabel, node.translation, alphaScale));
  }
}

function appendLabelPointNodeScene(
  node: DagProjectedNode,
  isActive: boolean,
  alphaScale: number,
  labels: LabelDefinition[],
  links: LinkDefinition[],
): void {
  labels.push(createWorkplaneTitleLabel(node, isActive, alphaScale));

  for (const label of node.workplane.scene.labels) {
    labels.push(createWorkplanePointMarkerLabel(label, node.translation, alphaScale));
  }

  for (const link of node.workplane.scene.links) {
    links.push(createWorldLabelPointLink(link, node.translation, alphaScale));
  }
}

function appendTitleOnlyNodeScene(
  node: DagProjectedNode,
  isActive: boolean,
  alphaScale: number,
  labels: LabelDefinition[],
): void {
  labels.push(createWorkplaneOverviewLabel(node, isActive, alphaScale));
}

function appendGraphPointNodeScene(): void {
  // The far graph-point band is geometry-first: one projected square symbol per DAG node.
}

function createWorldLabel(
  label: LabelDefinition,
  translation: ScenePoint3D,
  alphaScale: number,
): LabelDefinition {
  return {
    ...label,
    color: label.color ? scaleColorAlpha(label.color, alphaScale) : undefined,
    inputLinkKeys: [...label.inputLinkKeys],
    location: projectWorkplanePointToScene(label.location, translation),
    navigation: label.navigation ? {...label.navigation} : undefined,
    outputLinkKeys: [...label.outputLinkKeys],
    planeBasisX: {...STACK_PLANE_BASIS_X},
    planeBasisY: {...STACK_PLANE_BASIS_Y},
    size: Math.max(DAG_FULL_MIN_LABEL_SIZE, label.size * DAG_FULL_LABEL_SIZE_SCALE),
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createWorldLink(
  link: LinkDefinition,
  translation: ScenePoint3D,
  alphaScale: number,
): LinkDefinition {
  return {
    ...link,
    color: scaleColorAlpha(link.color, alphaScale),
    inputLocation: projectWorkplanePointToScene(link.inputLocation, translation),
    lineWidth: link.lineWidth * DAG_FULL_LINE_WIDTH_SCALE,
    outputLocation: projectWorkplanePointToScene(link.outputLocation, translation),
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createWorldLabelPointLink(
  link: LinkDefinition,
  translation: ScenePoint3D,
  alphaScale: number,
): LinkDefinition {
  return {
    ...link,
    color: scaleColorAlpha(link.color, alphaScale * DAG_LABEL_POINT_LINE_ALPHA_SCALE),
    inputLocation: projectWorkplanePointToScene(link.inputLocation, translation),
    lineWidth: Math.max(2.2, link.lineWidth * DAG_LABEL_POINT_LINE_WIDTH_SCALE),
    outputLocation: projectWorkplanePointToScene(link.outputLocation, translation),
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createWorkplaneTitleLabel(
  node: DagProjectedNode,
  isActive: boolean,
  alphaScale: number,
): LabelDefinition {
  return {
    color: scaleColorAlpha(
      isActive ? DAG_TITLE_ACTIVE_COLOR : DAG_TITLE_INACTIVE_COLOR,
      alphaScale,
    ),
    inputLinkKeys: [],
    location: {...node.layout.titleAnchor},
    outputLinkKeys: [],
    planeBasisX: {...STACK_PLANE_BASIS_X},
    planeBasisY: {...STACK_PLANE_BASIS_Y},
    size: DAG_TITLE_LABEL_SIZE,
    text: resolveWorkplaneDisplayTitle(node.workplane),
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createWorkplaneOverviewLabel(
  node: DagProjectedNode,
  isActive: boolean,
  alphaScale: number,
): LabelDefinition {
  return {
    color: scaleColorAlpha(
      isActive ? DAG_TITLE_ACTIVE_COLOR : DAG_TITLE_INACTIVE_COLOR,
      alphaScale,
    ),
    inputLinkKeys: [],
    location: {...node.layout.origin},
    outputLinkKeys: [],
    planeBasisX: {...STACK_PLANE_BASIS_X},
    planeBasisY: {...STACK_PLANE_BASIS_Y},
    size: DAG_OVERVIEW_TITLE_LABEL_SIZE,
    text: resolveWorkplaneDisplayTitle(node.workplane),
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createGraphPointSymbolBackplate(
  node: DagProjectedNode,
  isActive: boolean,
  alphaScale: number,
): StackBackplate {
  const symbolBounds = createGraphPointSymbolBounds(node.layout);

  return {
    corners: createBackplateCorners(symbolBounds),
    fillColor: scaleColorAlpha(
      isActive ? DAG_GRAPH_POINT_SYMBOL_ACTIVE_FILL : DAG_GRAPH_POINT_SYMBOL_INACTIVE_FILL,
      alphaScale,
    ),
    isActive,
    outlineColor: scaleColorAlpha(
      isActive
        ? DAG_GRAPH_POINT_SYMBOL_ACTIVE_OUTLINE
        : DAG_GRAPH_POINT_SYMBOL_INACTIVE_OUTLINE,
      alphaScale,
    ),
    workplaneId: node.layout.workplaneId,
  };
}

function createWorkplanePointMarkerLabel(
  label: LabelDefinition,
  translation: ScenePoint3D,
  alphaScale: number,
): LabelDefinition {
  const worldLocation = projectWorkplanePointToScene(label.location, translation);

  return {
    color: scaleColorAlpha(label.color ?? DAG_POINT_COLOR, alphaScale),
    inputLinkKeys: [],
    location: worldLocation,
    outputLinkKeys: [],
    planeBasisX: {...STACK_PLANE_BASIS_X},
    planeBasisY: {...STACK_PLANE_BASIS_Y},
    size: DAG_LABEL_POINT_MARKER_SIZE,
    text: '+',
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createFocusedWorkplaneSummaryLabel(
  label: LabelDefinition,
  translation: ScenePoint3D,
  alphaScale: number,
): LabelDefinition {
  return {
    color: scaleColorAlpha(label.color ?? DAG_TITLE_ACTIVE_COLOR, alphaScale),
    inputLinkKeys: [],
    location: {
      x: label.location.x + translation.x,
      y: label.location.y + translation.y + 2.2,
      z: (label.location.z ?? 0) + translation.z,
    },
    outputLinkKeys: [],
    planeBasisX: {...STACK_PLANE_BASIS_X},
    planeBasisY: {...STACK_PLANE_BASIS_Y},
    size: Math.max(0.78, label.size * 3.2),
    text: label.text,
    zoomLevel: DAG_ALWAYS_VISIBLE_ZOOM_LEVEL,
    zoomRange: DAG_ALWAYS_VISIBLE_ZOOM_RANGE,
  };
}

function createDagProjectionContext(
  projectedNodes: DagProjectedNode[],
  activeWorkplaneId: WorkplaneId,
  stackCamera: StageSystemState['session']['stackCamera'],
  viewport: ViewportSize,
): DagProjectionContext {
  const scaffold = createDagSceneScaffold(projectedNodes, activeWorkplaneId);
  const effectiveStackCamera = resolveDagEffectiveStackCamera(
    projectedNodes,
    scaffold,
    stackCamera,
    viewport,
  );
  const referenceProjector = new StackCameraProjector();
  referenceProjector.setSceneBounds(scaffold.sceneBounds);
  referenceProjector.setOrbitTarget(scaffold.graphCenter);
  referenceProjector.setStackCamera(effectiveStackCamera);

  const activeNode =
    projectedNodes.find((node) => node.layout.workplaneId === activeWorkplaneId) ?? null;
  const activeProjectedPlaneSpanPx = activeNode
    ? measureProjectedPlaneSpanPx(activeNode.layout, referenceProjector, viewport)
    : 0;
  const focusAlpha = smoothstep(
    inverseLerp(12, 140, activeProjectedPlaneSpanPx),
  );
  const orbitTargetBlend = clamp(0.18 + focusAlpha * 0.82, 0, 1);
  const orbitTarget = lerpScenePoint(
    scaffold.graphCenter,
    scaffold.activeOrbitTarget,
    orbitTargetBlend,
  );
  const projector = new StackCameraProjector();
  projector.setSceneBounds(scaffold.sceneBounds);
  projector.setOrbitTarget(orbitTarget);
  projector.setStackCamera(effectiveStackCamera);

  return {
    focusAlpha,
    orbitTarget,
    projectedPlaneSpanById: new Map(
      projectedNodes.map((node) => [
        node.layout.workplaneId,
        measureProjectedPlaneSpanPx(node.layout, projector, viewport),
      ]),
    ),
    scaffold,
    stackCamera: effectiveStackCamera,
  };
}

function createDagSceneScaffold(
  projectedNodes: DagProjectedNode[],
  activeWorkplaneId: WorkplaneId,
): DagSceneScaffold {
  let activeOrbitTarget: ScenePoint3D | null = null;
  let sceneBounds: SceneBounds3D | null = null;

  for (const node of projectedNodes) {
    const backplateCorners = createBackplateCorners(node.layout.planeBounds);
    sceneBounds = includeCornersInSceneBounds(sceneBounds, backplateCorners);

    if (node.layout.workplaneId === activeWorkplaneId) {
      activeOrbitTarget = {
        x: (node.layout.planeBounds.minX + node.layout.planeBounds.maxX) * 0.5,
        y: (node.layout.planeBounds.minY + node.layout.planeBounds.maxY) * 0.5,
        z: node.layout.origin.z,
      };
    }
  }

  const normalizedSceneBounds =
    sceneBounds ?? {
      maxX: 1,
      maxY: 1,
      maxZ: 1,
      minX: -1,
      minY: -1,
      minZ: -1,
    };

  return {
    activeOrbitTarget: activeOrbitTarget ?? getSceneBoundsCenter(normalizedSceneBounds),
    graphCenter: getSceneBoundsCenter(normalizedSceneBounds),
    sceneBounds: normalizedSceneBounds,
  };
}

function cloneSceneBounds(sceneBounds: SceneBounds3D): SceneBounds3D {
  return {
    maxX: sceneBounds.maxX,
    maxY: sceneBounds.maxY,
    maxZ: sceneBounds.maxZ,
    minX: sceneBounds.minX,
    minY: sceneBounds.minY,
    minZ: sceneBounds.minZ,
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
        },
        contentPlaneBounds: {
          maxX: baseLayout.origin.x + localHalfWidth,
          maxY: baseLayout.origin.y + localHalfHeight,
          minX: baseLayout.origin.x - localHalfWidth,
          minY: baseLayout.origin.y - localHalfHeight,
          z: baseLayout.origin.z,
        },
        translation,
        workplane,
      },
    ];
  });
}

function createDagEdgeLinkDefinition(
  edge: DagEdgeWorldLayout,
  alphaScale: number,
): LinkDefinition {
  return {
    bendDirection: 1,
    color: scaleColorAlpha(DAG_EDGE_COLOR, alphaScale),
    curveBias: 0.24,
    curveDepth: 0.16,
    curveLift: 0.1,
    inputLabelKey: `dag:${edge.toWorkplaneId}:input`,
    inputLinkPoint: 'left-center',
    inputLocation: {...edge.input},
    linkKey: `bridge:dag:${edge.edgeKey}`,
    lineWidth: 3,
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

function resolveWorkplaneDisplayTitle(
  workplane: StageSystemState['document']['workplanesById'][WorkplaneId],
): string {
  const rootLabel = workplane.scene.labels.find((label) => label.navigation?.layer === 1) ?? null;
  const rootLabelText = rootLabel?.text.trim() ?? '';
  const normalizedLabelText =
    rootLabelText.length > 0 && rootLabelText !== rootLabel?.navigation?.key
      ? rootLabelText
      : '';

  return normalizedLabelText.length > 0
    ? `${workplane.workplaneId} ${normalizedLabelText}`
    : workplane.workplaneId;
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

function createGraphPointSymbolBounds(
  layout: DagNodeWorldLayout,
): DagNodeWorldLayout['planeBounds'] {
  return {
    maxX: layout.origin.x + DAG_GRAPH_POINT_SYMBOL_HALF_SIZE,
    maxY: layout.origin.y + DAG_GRAPH_POINT_SYMBOL_HALF_SIZE,
    minX: layout.origin.x - DAG_GRAPH_POINT_SYMBOL_HALF_SIZE,
    minY: layout.origin.y - DAG_GRAPH_POINT_SYMBOL_HALF_SIZE,
    z: layout.origin.z,
  };
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

function resolveDagEffectiveStackCamera(
  projectedNodes: DagProjectedNode[],
  scaffold: DagSceneScaffold,
  stackCamera: StageSystemState['session']['stackCamera'],
  viewport: ViewportSize,
): StageSystemState['session']['stackCamera'] {
  const baseOrientation = resolveDagBaseCameraOrientation(
    projectedNodes,
    scaffold,
    viewport,
  );
  const azimuthDelta =
    stackCamera.azimuthRadians - DEFAULT_STACK_CAMERA_STATE.azimuthRadians;
  const elevationDelta =
    stackCamera.elevationRadians - DEFAULT_STACK_CAMERA_STATE.elevationRadians;

  return {
    azimuthRadians: baseOrientation.azimuthRadians + azimuthDelta,
    distanceScale: stackCamera.distanceScale,
    elevationRadians: baseOrientation.elevationRadians + elevationDelta,
  };
}

function resolveDagBaseCameraOrientation(
  projectedNodes: DagProjectedNode[],
  scaffold: DagSceneScaffold,
  viewport: ViewportSize,
): Pick<StageSystemState['session']['stackCamera'], 'azimuthRadians' | 'elevationRadians'> {
  const projector = new StackCameraProjector();
  projector.setSceneBounds(scaffold.sceneBounds);
  projector.setOrbitTarget(scaffold.graphCenter);

  let bestCandidate: {
    azimuthRadians: number;
    elevationRadians: number;
    score: number;
  } | null = null;

  for (
    let azimuthRadians = DAG_CAMERA_BASE_AZIMUTH_MIN;
    azimuthRadians <= DAG_CAMERA_BASE_AZIMUTH_MAX + 0.0001;
    azimuthRadians += DAG_CAMERA_BASE_AZIMUTH_STEP
  ) {
    for (
      let elevationRadians = DAG_CAMERA_BASE_ELEVATION_MIN;
      elevationRadians <= DAG_CAMERA_BASE_ELEVATION_MAX + 0.0001;
      elevationRadians += DAG_CAMERA_BASE_ELEVATION_STEP
    ) {
      projector.setStackCamera({
        azimuthRadians,
        distanceScale: DEFAULT_STACK_CAMERA_STATE.distanceScale,
        elevationRadians,
      });

      const nodeScreenPoints = projectedNodes
        .map((node) => ({
          screenPoint: projector.projectWorldPoint(node.layout.origin, viewport),
          x: node.layout.origin.x,
          y: node.layout.origin.y,
          z: node.layout.origin.z,
        }))
        .sort((left, right) => left.x - right.x || right.y - left.y || right.z - left.z);

      let minDistance = Number.POSITIVE_INFINITY;
      let minDepthSeparation = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let orderPenalty = 0;

      for (let index = 0; index < nodeScreenPoints.length; index += 1) {
        const node = nodeScreenPoints[index];
        minX = Math.min(minX, node.screenPoint.x);
        maxX = Math.max(maxX, node.screenPoint.x);
        minY = Math.min(minY, node.screenPoint.y);
        maxY = Math.max(maxY, node.screenPoint.y);

        if (index > 0 && node.screenPoint.x <= nodeScreenPoints[index - 1].screenPoint.x) {
          orderPenalty += 120;
        }

        for (let compareIndex = index + 1; compareIndex < nodeScreenPoints.length; compareIndex += 1) {
          const compareNode = nodeScreenPoints[compareIndex];
          const deltaX = node.screenPoint.x - compareNode.screenPoint.x;
          const deltaY = node.screenPoint.y - compareNode.screenPoint.y;
          const distance = Math.hypot(deltaX, deltaY);

          minDistance = Math.min(minDistance, distance);
          if (node.z !== compareNode.z) {
            minDepthSeparation = Math.min(minDepthSeparation, distance);
          }
        }
      }

      const width = maxX - minX;
      const height = maxY - minY;
      const orientationPenalty =
        Math.abs(azimuthRadians - DAG_CAMERA_BASE_AZIMUTH_PREFERRED) * 28 +
        Math.abs(elevationRadians - DAG_CAMERA_BASE_ELEVATION_PREFERRED) * 36;
      const score =
        minDistance +
        width * 0.18 +
        height * 0.12 +
        (Number.isFinite(minDepthSeparation) ? minDepthSeparation * 0.35 : 0) -
        orderPenalty -
        orientationPenalty;

      if (!bestCandidate || score > bestCandidate.score) {
        bestCandidate = {
          azimuthRadians,
          elevationRadians,
          score,
        };
      }
    }
  }

  return bestCandidate ?? {
    azimuthRadians: DEFAULT_STACK_CAMERA_STATE.azimuthRadians,
    elevationRadians: DEFAULT_STACK_CAMERA_STATE.elevationRadians,
  };
}

function createDagGraphDistanceById(
  dagDocument: DagDocumentState,
  activeWorkplaneId: WorkplaneId,
): Map<WorkplaneId, number> {
  const adjacencyById = new Map<WorkplaneId, Set<WorkplaneId>>();

  for (const workplaneId of Object.keys(dagDocument.nodesById) as WorkplaneId[]) {
    adjacencyById.set(workplaneId, new Set());
  }

  for (const edge of dagDocument.edges) {
    adjacencyById.get(edge.fromWorkplaneId)?.add(edge.toWorkplaneId);
    adjacencyById.get(edge.toWorkplaneId)?.add(edge.fromWorkplaneId);
  }

  const distanceById = new Map<WorkplaneId, number>([[activeWorkplaneId, 0]]);
  const queue: WorkplaneId[] = [activeWorkplaneId];

  for (let index = 0; index < queue.length; index += 1) {
    const workplaneId = queue[index];
    const nextDistance = (distanceById.get(workplaneId) ?? 0) + 1;

    for (const neighborId of adjacencyById.get(workplaneId) ?? []) {
      if (distanceById.has(neighborId)) {
        continue;
      }

      distanceById.set(neighborId, nextDistance);
      queue.push(neighborId);
    }
  }

  return distanceById;
}

function resolveDagNodeAlphaScale(
  isActive: boolean,
  graphDistance: number,
  focusAlpha: number,
): number {
  if (isActive) {
    return 1;
  }

  const safeDistance = Number.isFinite(graphDistance) ? graphDistance : 4;
  const distanceAlphaBoost =
    safeDistance <= 1 ? 0.14 : safeDistance === 2 ? 0.08 : 0.04;
  const baseAlpha = INACTIVE_PLANE_ALPHA_SCALE - Math.min(0.06, Math.max(0, safeDistance - 1) * 0.03);

  return clamp(
    baseAlpha + distanceAlphaBoost - focusAlpha * Math.min(0.2, 0.05 + safeDistance * 0.04),
    0.44,
    0.98,
  );
}

function resolveDagEdgeAlphaScale(
  fromDistance: number,
  toDistance: number,
  focusAlpha: number,
): number {
  const safeDistance = Math.min(
    Number.isFinite(fromDistance) ? fromDistance : 4,
    Number.isFinite(toDistance) ? toDistance : 4,
  );
  const baseAlpha = safeDistance <= 1 ? 1 : safeDistance === 2 ? 0.94 : 0.86;

  return clamp(baseAlpha - focusAlpha * (safeDistance <= 1 ? 0.04 : 0.1), 0.58, 1);
}

function lerpScenePoint(
  start: ScenePoint3D,
  end: ScenePoint3D,
  alpha: number,
): ScenePoint3D {
  return {
    x: lerp(start.x, end.x, alpha),
    y: lerp(start.y, end.y, alpha),
    z: lerp(start.z, end.z, alpha),
  };
}

function inverseLerp(start: number, end: number, value: number): number {
  if (Math.abs(end - start) <= 0.0001) {
    return 0;
  }

  return clamp((value - start) / (end - start), 0, 1);
}

function smoothstep(value: number): number {
  const clampedValue = clamp(value, 0, 1);
  return clampedValue * clampedValue * (3 - 2 * clampedValue);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function scaleColorAlpha(
  color: RgbaColor,
  alphaScale: number,
): RgbaColor {
  return [color[0], color[1], color[2], Math.min(1, color[3] * alphaScale)];
}

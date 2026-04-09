import assert from 'node:assert/strict';

import {
  bucketVisibleDagNodes,
  createProjectedDagVisibleNodes,
} from '../../src/dag-view';
import {
  clickStageModeButton,
  clickWorkplaneButton,
  getCameraState,
  readAppResult,
  getStageRouteState,
  getStageState,
  openRouteWithBootState,
  waitForStageWorkplane,
  type BrowserTestContext,
} from './shared';
import {createCanonicalNetworkDagStageState} from './fixtures';

const CANONICAL_DAG_LAYOUT_FINGERPRINT =
  'wp-1:0:0:0|wp-2:1:0:0|wp-3:1:1:1|wp-4:2:0:0|wp-5:2:1:1';

export async function runDagViewSmokeFlow(
  context: BrowserTestContext,
): Promise<void> {
  await openRouteWithBootState(context.page, context.url, {
    initialState: createCanonicalNetworkDagStageState(),
    strategyPanelMode: 'label-edit',
  });

  const initialStage = await getStageState(context.page);
  assert.equal(initialStage.stageMode, '2d-mode', 'The DAG smoke flow should boot in 2d mode.');
  assert.equal(initialStage.activeWorkplaneId, 'wp-1', 'The DAG smoke flow should boot on the root workplane.');
  assert.equal(initialStage.planeCount, 5, 'The DAG smoke flow should seed five workplanes.');
  assert.equal(initialStage.documentBridgeLinkCount, 0, 'The DAG smoke flow should keep legacy bridge-link state empty.');
  assert.equal(initialStage.renderBridgeLinkCount, 0, '2d mode should not render DAG edges.');
  assert.equal(initialStage.dagRootWorkplaneId, 'wp-1', 'The DAG smoke flow should export the root workplane id.');
  assert.equal(initialStage.dagNodeCount, 5, 'The DAG smoke flow should export the DAG node count.');
  assert.equal(initialStage.dagEdgeCount, 6, 'The DAG smoke flow should export the DAG edge count.');
  assert.equal(
    initialStage.dagLayoutFingerprint,
    CANONICAL_DAG_LAYOUT_FINGERPRINT,
    'The DAG smoke flow should export a stable layout fingerprint for the canonical network.',
  );
  assert.deepEqual(
    {
      column: initialStage.dagActiveWorkplaneColumn,
      layer: initialStage.dagActiveWorkplaneLayer,
      row: initialStage.dagActiveWorkplaneRow,
    },
    {column: 0, layer: 0, row: 0},
    'The DAG smoke flow should export the active root position while booted in 2d mode.',
  );
  assert.equal(initialStage.dagVisibleWorkplaneCount, 0, '2d mode should not report visible DAG workplanes.');
  assert.equal(initialStage.dagVisibleEdgeCount, 0, '2d mode should not report visible DAG edges.');

  await clickStageModeButton(context.page, '3d-mode');

  const stackStage = await getStageState(context.page);
  const stackRoute = await getStageRouteState(context.page);
  assert.equal(stackStage.stageMode, '3d-mode', 'The DAG smoke flow should enter 3d mode.');
  assert.equal(stackRoute.stageMode, '3d-mode', 'The DAG smoke flow should mirror 3d mode into the route.');
  assert.equal(stackRoute.workplaneId, 'wp-1', 'The DAG smoke flow should keep the root workplane active when entering 3d mode.');
  assert.equal(stackStage.dagVisibleWorkplaneCount, 5, '3d mode should render all five DAG workplanes.');
  assert.equal(stackStage.dagVisibleEdgeCount, 6, '3d mode should render all six DAG edges.');
  assert.equal(stackStage.renderBridgeLinkCount, 6, 'Rendered bridge-link count should match the DAG dependency count.');
  assert.deepEqual(
    resolveCanonicalDagBucketIds({
      activeWorkplaneId: stackStage.activeWorkplaneId,
      stackCameraAzimuth: (await getCameraState(context.page)).stackCameraAzimuth,
      stackCameraDistanceScale: (await getCameraState(context.page)).stackCameraDistanceScale,
      stackCameraElevation: (await getCameraState(context.page)).stackCameraElevation,
      viewport: await resolveViewport(context),
    }),
    {
      graphPointWorkplanes: ['wp-1', 'wp-2', 'wp-3', 'wp-4', 'wp-5'],
      titleOnlyWorkplanes: [],
    },
    'The root DAG overview should reconstruct to the zoomed-out graph-point bucket set from exported browser state.',
  );

  await clickWorkplaneButton(context.page, 'select-next-workplane');
  await waitForStageWorkplane(context.page, {activeWorkplaneId: 'wp-2', planeCount: 5});

  const selectedStage = await getStageState(context.page);
  const selectedRoute = await getStageRouteState(context.page);
  assert.equal(selectedStage.activeWorkplaneId, 'wp-2', 'The DAG smoke flow should keep workplane selection working in 3d mode.');
  assert.equal(selectedRoute.workplaneId, 'wp-2', 'The DAG smoke flow should mirror selected DAG workplanes into the route.');
  assert.deepEqual(
    {
      column: selectedStage.dagActiveWorkplaneColumn,
      layer: selectedStage.dagActiveWorkplaneLayer,
      row: selectedStage.dagActiveWorkplaneRow,
    },
    {column: 1, layer: 0, row: 0},
    'Selecting a workplane in 3d mode should export its DAG integer position.',
  );
  assert.deepEqual(
    resolveCanonicalDagBucketIds({
      activeWorkplaneId: selectedStage.activeWorkplaneId,
      stackCameraAzimuth: (await getCameraState(context.page)).stackCameraAzimuth,
      stackCameraDistanceScale: (await getCameraState(context.page)).stackCameraDistanceScale,
      stackCameraElevation: (await getCameraState(context.page)).stackCameraElevation,
      viewport: await resolveViewport(context),
    }),
    {
      graphPointWorkplanes: [],
      titleOnlyWorkplanes: ['wp-1', 'wp-2', 'wp-3', 'wp-4', 'wp-5'],
    },
    'Selecting the middle DAG workplane should reconstruct a closer title-only bucket set from exported browser state.',
  );
}

function resolveCanonicalDagBucketIds(input: {
  activeWorkplaneId: string;
  stackCameraAzimuth: number;
  stackCameraDistanceScale: number;
  stackCameraElevation: number;
  viewport: {height: number; width: number};
}): {
  graphPointWorkplanes: string[];
  titleOnlyWorkplanes: string[];
} {
  const state = createCanonicalNetworkDagStageState();
  state.session.activeWorkplaneId = input.activeWorkplaneId as typeof state.session.activeWorkplaneId;
  state.session.stageMode = '3d-mode';
  state.session.stackCamera = {
    azimuthRadians: input.stackCameraAzimuth,
    distanceScale: input.stackCameraDistanceScale,
    elevationRadians: input.stackCameraElevation,
  };

  const buckets = bucketVisibleDagNodes(createProjectedDagVisibleNodes(state, input.viewport));

  return {
    graphPointWorkplanes: buckets.graphPointWorkplanes.map((layout) => layout.workplaneId),
    titleOnlyWorkplanes: buckets.titleOnlyWorkplanes.map((layout) => layout.workplaneId),
  };
}

async function resolveViewport(
  context: BrowserTestContext,
): Promise<{height: number; width: number}> {
  const app = await readAppResult(context.page);

  if (app.state !== 'ready' || !('height' in app) || !('width' in app)) {
    throw new Error(`Expected a ready app while resolving DAG viewport. Received ${app.state}.`);
  }

  return {
    height: app.height,
    width: app.width,
  };
}

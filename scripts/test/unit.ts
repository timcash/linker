import assert from 'node:assert/strict';

import {Camera2D, type ScreenPoint, type ViewportSize} from '../../src/camera';
import {
  buildDeferredBridgeHealthSummary,
  buildLockedBridgeStatus,
  shouldFallbackToCloudflareAuthorizeWindow,
} from '../../src/codex/CodexBridgePolicy';
import {
  filterBrowserLogs,
  formatBrowserLogEntry,
  parseLogsCommand,
  resolveBrowserLogSource,
  type BrowserLogEntry,
} from '../../src/logs/log-model';
import {
  resolveCodexBaseOrigin,
} from '../../src/codex/CodexTerminalClient';
import {
  assertAcyclicDag,
  assertColumnsIncreaseAlongEdges,
  assertIntegerWorkplanePositions,
  assertNoDanglingEdgeReferences,
  assertReachableFromRoot,
  assertSingleRoot,
  validateDagDocument,
  type DagDocumentState,
  type WorkplaneDagEdgeState,
  type WorkplaneDagPosition,
} from '../../src/dag-document';
import {layoutDagNode, resolveDagEdgeCurve} from '../../src/dag-layout';
import {
  DAG_RANK_FANOUT_EDGE_COUNT,
  DAG_RANK_FANOUT_LAYOUT_FINGERPRINT,
  DAG_RANK_FANOUT_ROOT_LABEL_TEXT,
  DAG_RANK_FANOUT_TOTAL_LOCAL_LABEL_COUNT,
  DAG_RANK_FANOUT_TOTAL_LOCAL_LINK_COUNT,
  DAG_RANK_FANOUT_WORKPLANE_ORDER,
  createDefaultDagRankFanoutState,
} from '../../src/data/dag-rank-fanout';
import {
  DEFAULT_REMOTE_AUTH_ORIGIN,
  resolveConfiguredAuthOrigin,
} from '../../src/remote-config';
import {
  createDefaultEditorLabState,
} from '../../src/data/editor-lab';
import {
  CANONICAL_FIVE_WORKPLANE_NETWORK,
  createCanonicalFiveWorkplaneNetworkDagDocument,
} from '../../src/data/network-dag';
import {
  layoutDemoEntries,
  type DemoLayoutEntry,
  type DemoLayoutNodeBox,
} from '../../src/data/demo-layout';
import {getDemoLinks} from '../../src/data/links';
import {DEMO_LABELS} from '../../src/data/labels';
import {GRID_LAYER_ZOOM_STEP} from '../../src/layer-grid';
import {
  createLabelNavigationIndex,
  getLabelNavigationNode,
  getLabelNavigationTarget,
  hasLabelNavigationTarget,
} from '../../src/label-navigation';
import {sampleLineCurve} from '../../src/line/curves';
import {buildLabelKey} from '../../src/label-key';
import {
  INITIAL_WORKPLANE_ID,
  MAX_WORKPLANE_COUNT,
  canDeleteActiveWorkplane,
  canSpawnWorkplane,
  createStageSystemState,
  createStageSystemStateWithDagRoot,
  deleteActiveWorkplane,
  focusDagRootWorkplane,
  getActiveWorkplaneDocument,
  getActiveWorkplaneView,
  getDagControlAvailability,
  getPlaneCount,
  insertDagParentWorkplane,
  moveActiveDagWorkplaneByDepth,
  moveActiveDagWorkplaneByLane,
  moveActiveDagWorkplaneByRank,
  replaceWorkplaneLabelTextOverride,
  replaceWorkplaneScene,
  replaceWorkplaneView,
  selectNextWorkplane,
  selectPreviousWorkplane,
  spawnDagChildWorkplane,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneId,
} from '../../src/plane-stack';
import {
  PlaneFocusProjector,
  StackCameraProjector,
  type StageProjector,
} from '../../src/projector';
import {
  cloneStageScene,
  createEmptyStageScene,
  createStageScene,
} from '../../src/scene-model';
import {readStageConfig} from '../../src/stage-config';
import {
  addLabelAtStageEditorCursor,
  createStageEditorState,
  moveStageEditorCursor,
} from '../../src/stage-editor';
import {hydrateStageBootState} from '../../src/stage-session';
import {
  DEFAULT_STACK_CAMERA_STATE,
  getStackCameraForward,
  isStackCameraAtDefault,
  orbitStackCamera,
  scaleStackCameraDistance,
} from '../../src/stack-camera';
import {createStackViewState} from '../../src/stack-view';
import {
  DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX,
  DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX,
  DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX,
  bucketVisibleDagNodes,
  createDagEdgeCurves,
  createDagNodeLayouts,
  createDagStackViewState,
  createProjectedDagVisibleNodes,
  resolveWorkplaneLod,
} from '../../src/dag-view';
import {projectGlyphQuadToScreen} from '../../src/text/projection';
import type {GlyphPlacement, LabelDefinition} from '../../src/text/types';
import {
  MIN_ZOOM_OPACITY,
  createZoomBand,
  getMaxVisibleZoom,
  getMinVisibleZoom,
  getZoomOpacity,
  getZoomScale,
  isZoomVisible,
} from '../../src/text/zoom';
import {
  createCanonicalNetworkDagDocument,
  createCanonicalNetworkDagStageState,
} from './fixtures';
import {
  DEMO_CHILD_LABEL_SIZE,
  DEMO_LABEL_COUNT,
  DEMO_ROOT_LABEL_SIZE,
  DEMO_ROWS_PER_SOURCE_COLUMN,
  DEMO_SOURCE_COLUMN_COUNT,
  FIRST_ROOT_LABEL,
  LAST_CHILD_LABEL,
} from './types';

export function runStaticUnitTests(): void {
  runRouteAndSessionTests();
  runCodexBridgePolicyTests();
  runBrowserLogModelTests();
  runDagDocumentTests();
  runDagLayoutTests();
  runDagViewTests();
  runDagFixtureTests();
  runPlaneStackStateTests();
  runCameraAndProjectionTests();
  runLayoutAndLinkTests();
  runNavigationAndZoomTests();
  runDemoPresetGeometryTests();
}

function runCodexBridgePolicyTests(): void {
  assert.equal(
    buildDeferredBridgeHealthSummary(DEFAULT_REMOTE_AUTH_ORIGIN),
    `Cloudflare Access unlock will verify the Codex bridge at ${DEFAULT_REMOTE_AUTH_ORIGIN} before the terminal connects.`,
    'Deferred health copy should explain the single Cloudflare Access unlock flow and target origin.',
  );
  assert.equal(
    buildLockedBridgeStatus(),
    'Use Cloudflare Access to unlock the Codex terminal.',
    'Locked status copy should point to the Cloudflare-only unlock flow.',
  );
  assert.equal(
    shouldFallbackToCloudflareAuthorizeWindow({
      bridgeOrigin: DEFAULT_REMOTE_AUTH_ORIGIN,
      error: new Error('Failed to fetch'),
      locationOrigin: 'https://your-user.github.io',
    }),
    true,
    'Hosted codex unlock should still launch Cloudflare Access when the first bridge probe fails cross-origin.',
  );
  assert.equal(
    shouldFallbackToCloudflareAuthorizeWindow({
      bridgeOrigin: 'http://127.0.0.1:4173',
      error: new Error('Failed to fetch'),
      locationOrigin: 'http://127.0.0.1:4173',
    }),
    false,
    'Local codex unlock should not hide same-origin bridge failures behind the Cloudflare Access fallback.',
  );
  assert.equal(
    resolveCodexBaseOrigin({
      hostname: 'your-user.github.io',
      locationOrigin: 'https://your-user.github.io',
    }),
    DEFAULT_REMOTE_AUTH_ORIGIN,
    'Hosted GitHub Pages should prefer the public bridge origin.',
  );
  assert.equal(
    resolveCodexBaseOrigin({
      configuredOrigin: 'http://127.0.0.1:4186',
      hostname: 'localhost',
      locationOrigin: 'http://127.0.0.1:5173',
    }),
    'http://127.0.0.1:4186',
    'A configured codex bridge origin should override the default base-origin resolution.',
  );
  assert.equal(
    resolveConfiguredAuthOrigin({
      configuredOrigin: 'https://auth.acme.test',
      hostname: 'localhost',
      locationOrigin: 'http://127.0.0.1:5173',
    }),
    'https://auth.acme.test',
    'Auth-mode origin resolution should honor an explicitly configured remote origin even on localhost.',
  );
  assert.equal(
    resolveConfiguredAuthOrigin({
      hostname: 'github.io',
      locationOrigin: 'https://your-user.github.io',
    }),
    DEFAULT_REMOTE_AUTH_ORIGIN,
    'Hosted auth-origin resolution should still fall back to the generic remote default when no override is set.',
  );
}

function runBrowserLogModelTests(): void {
  const nowMs = Date.UTC(2026, 3, 15, 12, 0, 0);
  const entries: BrowserLogEntry[] = [
    createBrowserLogEntry({
      id: 'entry-1',
      level: 'info',
      message: 'boot route',
      source: '/src/main.ts:12:3',
      timestamp: nowMs - 5 * 60_000,
    }),
    createBrowserLogEntry({
      id: 'entry-2',
      level: 'warn',
      message: 'onboarding warning',
      source: '/src/app.ts:2429:7',
      timestamp: nowMs - 2 * 60_000,
    }),
    createBrowserLogEntry({
      id: 'entry-3',
      level: 'warn',
      message: 'logs smoke follow row',
      source: '/src/logs-page.ts:18:5',
      timestamp: nowMs - 15_000,
    }),
  ];

  assert.deepEqual(
    filterBrowserLogs(entries, {
      level: 'warn',
      query: 'logs smoke',
      sinceMinutes: 1,
      source: 'logs-page',
    }, nowMs).map((entry) => entry.id),
    ['entry-3'],
    'Browser log filtering should apply level, grep, source, and since filters together.',
  );
  assert.equal(
    resolveBrowserLogSource(
      [
        'Error',
        '    at recordBrowserLog (http://127.0.0.1:4173/src/logs/log-store.ts:10:2)',
        '    at handleClick (http://127.0.0.1:4173/src/app.ts?t=123:1996:17)',
      ].join('\n'),
    ),
    '/src/app.ts:1996:17',
    'Browser log source resolution should skip wrapper frames and keep the caller source line.',
  );
  assert.equal(
    resolveBrowserLogSource(
      [
        'Error',
        '    at record (http://127.0.0.1:4173/src/logs/log-store.ts:10:2)',
        '    at pptr:evaluate;runLogsPageSmokeFlow%20(file%3A%2F%2F%2FC%3A%2FUsers%2Ftimca%2Flinker%2Fscripts%2Ftest%2Flogs-page-smoke.ts%3A34%3A68):1:230',
      ].join('\n'),
    ),
    'C:/Users/timca/linker/scripts/test/logs-page-smoke.ts:34:68',
    'Browser log source resolution should decode Puppeteer-evaluated stack frames back to the authored source line.',
  );
  assert.match(
    formatBrowserLogEntry(
      createBrowserLogEntry({
        id: 'entry-4',
        level: 'warn',
        message: 'logs smoke warn row',
        source: 'C:/Users/timca/linker/scripts/test/logs-page-smoke.ts:34:68',
        timestamp: nowMs,
      }),
    ),
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WARN\s{2}logs-page-smoke\.ts:34\n\s{2}logs smoke warn row$/u,
    'Browser log formatting should keep timestamps compact and source labels human-readable in the terminal.',
  );
  assert.deepEqual(
    [
      parseLogsCommand('level warn'),
      parseLogsCommand('since all'),
      parseLogsCommand('show 12'),
      parseLogsCommand('history 5'),
    ],
    [
      {kind: 'level', level: 'warn'},
      {kind: 'since', minutes: null},
      {kind: 'show', count: 12},
      {kind: 'history', count: 5},
    ],
    'The logs terminal command parser should normalize the supported CLI commands.',
  );
}

function runDagDocumentTests(): void {
  const validDocument = createDagTestDocument({
    edges: [
      {edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'},
      {edgeKey: 'edge-2', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-3'},
      {edgeKey: 'edge-3', fromWorkplaneId: 'wp-2', toWorkplaneId: 'wp-4'},
      {edgeKey: 'edge-4', fromWorkplaneId: 'wp-3', toWorkplaneId: 'wp-4'},
    ],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 1, row: 0, layer: 0}},
      {workplaneId: 'wp-3', position: {column: 1, row: 1, layer: 1}},
      {workplaneId: 'wp-4', position: {column: 2, row: 0, layer: 0}},
    ],
    rootWorkplaneId: 'wp-1',
  });

  assert.doesNotThrow(() => {
    assertNoDanglingEdgeReferences(validDocument);
    assertSingleRoot(validDocument);
    assertColumnsIncreaseAlongEdges(validDocument);
    assertIntegerWorkplanePositions(validDocument);
    assertReachableFromRoot(validDocument);
    assertAcyclicDag(validDocument);
  }, 'A valid DAG document should satisfy every core invariant.');

  const validResult = validateDagDocument(validDocument);
  assert.equal(validResult.valid, true, 'Valid DAG documents should report a passing validation result.');
  assert.deepEqual(
    validResult.topologicalOrder,
    ['wp-1', 'wp-2', 'wp-3', 'wp-4'],
    'Valid DAG documents should expose a deterministic topological order.',
  );

  const wrongRootDocument = createDagTestDocument({
    edges: [{edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'}],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 1, row: 0, layer: 0}},
    ],
    rootWorkplaneId: 'wp-2',
  });
  assert.throws(
    () => assertSingleRoot(wrongRootDocument),
    /root workplane/i,
    'The declared root should match the only zero-incoming workplane.',
  );

  const nonIntegerPositionDocument = createDagTestDocument({
    edges: [{edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'}],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 1.5, row: 0, layer: 0}},
    ],
    rootWorkplaneId: 'wp-1',
  });
  assert.throws(
    () => assertIntegerWorkplanePositions(nonIntegerPositionDocument),
    /integer/i,
    'Workplane DAG positions should stay on integer rails.',
  );

  const backwardEdgeDocument = createDagTestDocument({
    edges: [{edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'}],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 0, row: 1, layer: 0}},
    ],
    rootWorkplaneId: 'wp-1',
  });
  assert.throws(
    () => assertColumnsIncreaseAlongEdges(backwardEdgeDocument),
    /column/i,
    'Dependencies should always point into a later column.',
  );

  const danglingEdgeDocument = createDagTestDocument({
    edges: [{edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-3'}],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 1, row: 0, layer: 0}},
    ],
    rootWorkplaneId: 'wp-1',
  });
  assert.throws(
    () => assertNoDanglingEdgeReferences(danglingEdgeDocument),
    /missing/i,
    'Edges should only reference existing workplanes.',
  );

  const unreachableDocument = createDagTestDocument({
    edges: [{edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'}],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 1, row: 0, layer: 0}},
      {workplaneId: 'wp-3', position: {column: 2, row: 0, layer: 0}},
    ],
    rootWorkplaneId: 'wp-1',
  });
  assert.throws(
    () => assertReachableFromRoot(unreachableDocument),
    /reachable/i,
    'Every node should remain reachable from the root workplane.',
  );

  const cyclicDocument = createDagTestDocument({
    edges: [
      {edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'},
      {edgeKey: 'edge-2', fromWorkplaneId: 'wp-2', toWorkplaneId: 'wp-3'},
      {edgeKey: 'edge-3', fromWorkplaneId: 'wp-3', toWorkplaneId: 'wp-2'},
    ],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 1, row: 0, layer: 0}},
      {workplaneId: 'wp-3', position: {column: 1, row: 1, layer: 0}},
    ],
    rootWorkplaneId: 'wp-1',
  });
  assert.throws(
    () => assertAcyclicDag(cyclicDocument),
    /cycle/i,
    'Validation should reject cycles even before render code consumes the graph.',
  );
  assert.equal(
    validateDagDocument(cyclicDocument).issues.some((issue) => issue.code === 'cycle'),
    true,
    'Cycle validation results should surface a dedicated cycle issue.',
  );
}

function runDagLayoutTests(): void {
  const rootLayout = layoutDagNode('wp-1', {column: 0, row: 0, layer: 0});

  assert.deepEqual(
    rootLayout,
    {
      origin: {x: 0, y: 0, z: 0},
      planeBounds: {
        maxX: 12,
        maxY: 12,
        minX: -12,
        minY: -12,
        z: 0,
      },
      titleAnchor: {x: 0, y: 16, z: 0},
      workplaneId: 'wp-1',
    },
    'A root DAG node should map to the canonical world origin and deterministic bounds.',
  );

  const downstreamLayout = layoutDagNode('wp-4', {column: 2, row: 3, layer: 1});

  assert.deepEqual(
    downstreamLayout.origin,
    {x: 96, y: -102, z: -18},
    'Later columns, rows, and layers should move right, down, and deeper in world space.',
  );
  assert.deepEqual(
    downstreamLayout.titleAnchor,
    {x: 96, y: -86, z: -18},
    'Title anchors should sit a fixed distance above the workplane origin.',
  );
  assert.deepEqual(
    downstreamLayout.planeBounds,
    {
      maxX: 108,
      maxY: -90,
      minX: 84,
      minY: -114,
      z: -18,
    },
    'Plane bounds should stay deterministic for every integer DAG position.',
  );
}

function runDagViewTests(): void {
  const document = createDagTestDocument({
    edges: [
      {edgeKey: 'edge-1', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-2'},
      {edgeKey: 'edge-2', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-3'},
      {edgeKey: 'edge-3', fromWorkplaneId: 'wp-1', toWorkplaneId: 'wp-9'},
    ],
    nodes: [
      {workplaneId: 'wp-1', position: {column: 0, row: 0, layer: 0}},
      {workplaneId: 'wp-2', position: {column: 2, row: 0, layer: 0}},
      {workplaneId: 'wp-3', position: {column: 2, row: 1, layer: 1}},
    ],
    rootWorkplaneId: 'wp-1',
  });
  const nodeLayoutsById = new Map(
    Object.values(document.nodesById).map((node) => [
      node.workplaneId,
      layoutDagNode(node.workplaneId, node.position),
    ]),
  );
  const canonicalLodBuckets = bucketVisibleDagNodes(
    createDagNodeLayouts(createCanonicalNetworkDagDocument()).map((layout, index) => ({
      layout,
      projectedPlaneSpanPx: [240, 120, 40, 10, 180][index] ?? 0,
    })),
  );

  assert.deepEqual(
    [
      resolveWorkplaneLod(DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX),
      resolveWorkplaneLod(DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX - 0.001),
      resolveWorkplaneLod(DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX),
      resolveWorkplaneLod(DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX),
      resolveWorkplaneLod(Number.NaN),
      resolveWorkplaneLod(DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX - 0.01),
    ],
    [
      'full-workplane',
      'label-points',
      'label-points',
      'title-only',
      'graph-point',
      'graph-point',
    ],
    'Projected workplane span should classify threshold boundaries and non-finite inputs into stable LOD states.',
  );
  assert.deepEqual(
    {
      fullWorkplanes: canonicalLodBuckets.fullWorkplanes.map((layout) => layout.workplaneId),
      graphPointWorkplanes: canonicalLodBuckets.graphPointWorkplanes.map(
        (layout) => layout.workplaneId,
      ),
      labelPointWorkplanes: canonicalLodBuckets.labelPointWorkplanes.map(
        (layout) => layout.workplaneId,
      ),
      titleOnlyWorkplanes: canonicalLodBuckets.titleOnlyWorkplanes.map(
        (layout) => layout.workplaneId,
      ),
    },
    {
      fullWorkplanes: ['wp-1', 'wp-5'],
      graphPointWorkplanes: ['wp-4'],
      labelPointWorkplanes: ['wp-2'],
      titleOnlyWorkplanes: ['wp-3'],
    },
    'Visible DAG nodes should land in the expected LOD buckets while preserving bucket order.',
  );

  const viewport = {width: 393, height: 852};
  const defaultRootBuckets = bucketVisibleDagNodes(
    createProjectedDagVisibleNodes(
      {
        ...createCanonicalNetworkDagStageState(),
        session: {
          ...createCanonicalNetworkDagStageState().session,
          stageMode: '3d-mode',
        },
      },
      viewport,
    ),
  );
  const zoomedOutBuckets = bucketVisibleDagNodes(
    createProjectedDagVisibleNodes(
      {
        ...createCanonicalNetworkDagStageState(),
        session: {
          ...createCanonicalNetworkDagStageState().session,
          stackCamera: scaleStackCameraDistance(DEFAULT_STACK_CAMERA_STATE, 3),
          stageMode: '3d-mode',
        },
      },
      viewport,
    ),
  );
  const closeBuckets = bucketVisibleDagNodes(
    createProjectedDagVisibleNodes(
      {
        ...createCanonicalNetworkDagStageState(),
        session: {
          ...createCanonicalNetworkDagStageState().session,
          activeWorkplaneId: 'wp-2',
          stageMode: '3d-mode',
        },
      },
      viewport,
    ),
  );
  assert.deepEqual(
    {
      graphPointWorkplanes: defaultRootBuckets.graphPointWorkplanes.map((layout) => layout.workplaneId),
      titleOnlyWorkplanes: defaultRootBuckets.titleOnlyWorkplanes.map((layout) => layout.workplaneId),
    },
    {
      graphPointWorkplanes: [],
      titleOnlyWorkplanes: ['wp-1', 'wp-2', 'wp-3', 'wp-4', 'wp-5'],
    },
    'The canonical DAG root entry view should begin in the readable title-only bucket.',
  );
  assert.deepEqual(
    {
      graphPointWorkplanes: zoomedOutBuckets.graphPointWorkplanes.map((layout) => layout.workplaneId),
      titleOnlyWorkplanes: zoomedOutBuckets.titleOnlyWorkplanes.map((layout) => layout.workplaneId),
    },
    {
      graphPointWorkplanes: ['wp-1', 'wp-2', 'wp-3', 'wp-4', 'wp-5'],
      titleOnlyWorkplanes: [],
    },
    'Zooming the canonical DAG root outward should collapse every visible workplane into the graph-point bucket.',
  );
  const graphPointViewState = createDagStackViewState({
    ...createCanonicalNetworkDagStageState(),
    session: {
      ...createCanonicalNetworkDagStageState().session,
      stackCamera: scaleStackCameraDistance(DEFAULT_STACK_CAMERA_STATE, 3),
      stageMode: '3d-mode',
    },
  });
  const firstGraphPointBackplate = graphPointViewState.backplates[0];
  assert.equal(
    graphPointViewState.backplates.length,
    createCanonicalNetworkDagStageState().document.workplaneOrder.length,
    'The far graph-point band should draw one projected square symbol backplate per DAG node.',
  );
  assert.equal(
    graphPointViewState.scene.labels.length,
    0,
    'The far graph-point band should rely on projected square symbols instead of text labels.',
  );
  assert.ok(firstGraphPointBackplate, 'The far graph-point band should produce a symbol backplate for the root node.');
  if (firstGraphPointBackplate) {
    const symbolWidth = Math.abs(firstGraphPointBackplate.corners[1].x - firstGraphPointBackplate.corners[0].x);
    const symbolHeight = Math.abs(firstGraphPointBackplate.corners[0].y - firstGraphPointBackplate.corners[3].y);
    assert.equal(
      symbolWidth,
      symbolHeight,
      'Graph-point symbol backplates should stay square so the far DAG overview reads as one symbol per node.',
    );
    assert.ok(
      symbolWidth < 24,
      'Graph-point symbol backplates should stay smaller than a full workplane plane footprint.',
    );
  }
  assert.deepEqual(
    {
      graphPointWorkplanes: closeBuckets.graphPointWorkplanes.map((layout) => layout.workplaneId),
      titleOnlyWorkplanes: closeBuckets.titleOnlyWorkplanes.map((layout) => layout.workplaneId),
    },
    {
      graphPointWorkplanes: [],
      titleOnlyWorkplanes: ['wp-1', 'wp-2', 'wp-3', 'wp-4', 'wp-5'],
    },
    'Focusing the middle DAG workplane should move the canonical network into the closer title-only bucket without changing workplane order.',
  );

  assert.deepEqual(
    resolveDagEdgeCurve(document.edges[0], nodeLayoutsById),
    {
      edgeKey: 'edge-1',
      fromWorkplaneId: 'wp-1',
      input: {x: 84, y: 0, z: 0},
      output: {x: 12, y: 0, z: 0},
      toWorkplaneId: 'wp-2',
    },
    'Straight DAG edges should resolve from source right edge to target left edge.',
  );

  const crossRowAndLayerEdge = resolveDagEdgeCurve(document.edges[1], nodeLayoutsById);
  assert.deepEqual(
    crossRowAndLayerEdge,
    {
      edgeKey: 'edge-2',
      fromWorkplaneId: 'wp-1',
      input: {x: 84, y: -34, z: -18},
      output: {x: 12, y: 0, z: 0},
      toWorkplaneId: 'wp-3',
    },
    'Cross-row and cross-layer DAG edges should still resolve left to right.',
  );
  assert.ok(
    (crossRowAndLayerEdge?.output.x ?? 0) < (crossRowAndLayerEdge?.input.x ?? 0),
    'Resolved DAG edge geometry should always keep the source left of the target.',
  );

  assert.equal(
    resolveDagEdgeCurve(document.edges[2], nodeLayoutsById),
    null,
    'Invalid DAG edge references should be skipped safely.',
  );

  const resolvedEdges = createDagEdgeCurves(document);
  assert.deepEqual(
    resolvedEdges.map((edge) => edge.edgeKey),
    ['edge-1', 'edge-2'],
    'Dag view helpers should preserve valid edge order while filtering invalid references.',
  );
}

function runDagFixtureTests(): void {
  const sourceFixture = createCanonicalFiveWorkplaneNetworkDagDocument();
  const helperFixture = createCanonicalNetworkDagDocument();

  assert.equal(
    helperFixture.rootWorkplaneId,
    'wp-1',
    'The canonical network fixture should keep wp-1 as the root workplane.',
  );
  assert.equal(
    Object.keys(helperFixture.nodesById).length,
    5,
    'The canonical network fixture should create exactly five workplanes.',
  );
  assert.equal(
    helperFixture.edges.length,
    6,
    'The canonical network fixture should create the expected six dependencies.',
  );
  assert.equal(
    validateDagDocument(helperFixture).valid,
    true,
    'The canonical network fixture should already satisfy the core DAG invariants.',
  );
  assert.deepEqual(
    helperFixture,
    sourceFixture,
    'The test fixture helper should proxy the reusable canonical network DAG data.',
  );
  assert.deepEqual(
    CANONICAL_FIVE_WORKPLANE_NETWORK.map((node) => ({
      dependsOn: [...node.dependsOn],
      position: {...node.position},
      role: node.role,
      workplaneId: node.workplaneId,
    })),
    [
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
    ],
    'The canonical network fixture should preserve the exact roles, positions, and dependencies from PLAN.md.',
  );
  assert.deepEqual(
    helperFixture.edges.map((edge) => `${edge.fromWorkplaneId}->${edge.toWorkplaneId}`),
    ['wp-1->wp-2', 'wp-1->wp-3', 'wp-2->wp-4', 'wp-3->wp-4', 'wp-2->wp-5', 'wp-3->wp-5'],
    'The canonical network fixture should preserve the expected dependency graph.',
  );
}

function runRouteAndSessionTests(): void {
  const defaultConfig = readStageConfig('');
  assert.equal(defaultConfig.demoPreset, 'dag-rank-fanout', 'Default config should target the authored twelve-workplane DAG preset.');
  assert.equal(defaultConfig.stageMode, '2d-mode', 'Default config should boot in 2d-mode.');
  assert.equal(defaultConfig.requestedStageMode, null, 'Default config should not request a stage-mode override.');
  assert.equal(defaultConfig.requestedWorkplaneId, null, 'Default config should not request a workplane override.');
  assert.equal(defaultConfig.initialCameraLabel, null, 'Default config should not request a focused label override.');

  const explicitConfig = readStageConfig('?session=stk-42&history=7&stageMode=3d-mode&workplane=wp-1&labelSet=benchmark&labelCount=1024');
  assert.equal(explicitConfig.requestedStageMode, '3d-mode', 'Valid stage routes should preserve the requested stage mode.');
  assert.equal(explicitConfig.stageMode, '3d-mode', 'Valid stage routes should parse 3d-mode.');
  assert.equal(explicitConfig.requestedWorkplaneId, 'wp-1', 'Valid routes should preserve the requested workplane.');
  assert.equal(explicitConfig.labelSetKind, 'benchmark', 'Valid routes should preserve the requested dataset.');
  assert.equal(explicitConfig.labelTargetCount, 1024, 'Benchmark routes should preserve the requested label count.');

  const invalidConfig = readStageConfig('?session=%20%20&history=-2&stageMode=sideways&workplane=plane-7&cameraCenterX=99&cameraCenterY=42&cameraZoom=7');
  assert.equal(invalidConfig.requestedStageMode, null, 'Invalid stage routes should not preserve a requested override.');
  assert.equal(invalidConfig.stageMode, '2d-mode', 'Invalid stage routes should fall back to 2d-mode.');
  assert.equal(invalidConfig.requestedWorkplaneId, null, 'Invalid workplane routes should be ignored.');
  assert.equal(invalidConfig.initialCameraLabel, null, 'Numeric camera params should be ignored after moving to label-only routing.');

  const dagConfig = readStageConfig('?demoPreset=dag-empty&labelSet=demo&stageMode=3d-mode&workplane=wp-1');
  assert.equal(dagConfig.demoPreset, 'dag-empty', 'Dag-empty routes should preserve the empty DAG preset.');
  assert.equal(dagConfig.stageMode, '3d-mode', 'Dag-empty routes should preserve the requested stage mode.');

  const dagRankFanoutConfig = readStageConfig('?demoPreset=dag-rank-fanout&labelSet=demo&stageMode=2d-mode&workplane=wp-8');
  assert.equal(
    dagRankFanoutConfig.demoPreset,
    'dag-rank-fanout',
    'Dag-rank-fanout routes should preserve the twelve-workplane DAG preset.',
  );
  assert.equal(
    dagRankFanoutConfig.requestedWorkplaneId,
    'wp-8',
    'Dag-rank-fanout routes should preserve explicit workplane selection.',
  );

  const dagBootState = hydrateStageBootState(dagConfig, null);
  assert.equal(
    dagBootState.initialState.document.dag?.rootWorkplaneId,
    'wp-1',
    'Dag-empty routes should boot with a root DAG workplane.',
  );
  assert.deepEqual(
    dagBootState.initialState.document.dag?.positionsById['wp-1'],
    {column: 0, row: 0, layer: 0},
    'Dag-empty routes should place the root workplane at rank 0 lane 0 depth 0.',
  );
  assert.equal(
    dagBootState.initialState.document.workplanesById['wp-1']?.scene.labels.length ?? -1,
    0,
    'Dag-empty routes should boot with an empty local workplane scene.',
  );

  const missingSessionBootState = hydrateStageBootState(readStageConfig('?session=stk-missing'), null);
  assert.equal(
    getPlaneCount(missingSessionBootState.initialState),
    DAG_RANK_FANOUT_WORKPLANE_ORDER.length,
    'Ignored persisted-session routes should still boot the default DAG preset instead of restoring a missing session.',
  );
  assert.equal(
    missingSessionBootState.initialState.session.activeWorkplaneId,
    'wp-1',
    'Fresh route boot should start on the default DAG root workplane.',
  );
  assert.equal(
    missingSessionBootState.initialState.session.stageMode,
    '3d-mode',
    'Fresh route boot should keep the default preset stage mode.',
  );
  assert.equal(
    isStackCameraAtDefault(missingSessionBootState.initialState.session.stackCamera),
    true,
    'Fresh route boot should keep the default stack-camera orbit.',
  );
  assert.equal(
    missingSessionBootState.initialState.document.dag?.edges.length ?? 0,
    DAG_RANK_FANOUT_EDGE_COUNT,
    'Fresh route boot should keep the full authored DAG dependency count.',
  );
  assert.equal(
    formatDagLayoutFingerprint(
      missingSessionBootState.initialState.document.dag?.positionsById ?? {},
    ),
    DAG_RANK_FANOUT_LAYOUT_FINGERPRINT,
    'Fresh route boot should keep the stable authored DAG layout fingerprint.',
  );

  const scene = createStageScene({
    demoLayerCount: 12,
    labelSetKind: 'demo',
    labelTargetCount: DEMO_LABEL_COUNT,
    layoutStrategy: 'flow-columns',
  });
  let snapshot = createStageSystemState(cloneStageScene(scene), {
    initialCameraLabel: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    stageMode: '3d-mode',
  });
  snapshot = replaceWorkplaneView(snapshot, INITIAL_WORKPLANE_ID, {
    selectedLabelKey: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    camera: {centerX: 22, centerY: 18, zoom: 2},
  });
  snapshot = spawnWorkplaneAfterActive(snapshot);
  snapshot = replaceWorkplaneScene(
    snapshot,
    'wp-2',
    createStageScene({
      demoLayerCount: 12,
      labelSetKind: 'demo',
      labelTargetCount: DEMO_LABEL_COUNT,
      layoutStrategy: 'flow-columns',
      workplaneId: 'wp-2',
    }),
  );
  snapshot = replaceWorkplaneView(snapshot, 'wp-2', {
    selectedLabelKey: buildLabelKey('wp-2', 1, 3, 3),
    camera: {centerX: 44, centerY: 39, zoom: 4},
  });
  snapshot = {
    ...snapshot,
    session: {
      ...snapshot.session,
      activeWorkplaneId: INITIAL_WORKPLANE_ID,
      stackCamera: orbitStackCamera(DEFAULT_STACK_CAMERA_STATE, Math.PI / 8, -Math.PI / 18),
      stageMode: '3d-mode',
    },
  };
  const stageModeOverrideBootState = hydrateStageBootState(
    readStageConfig('?stageMode=2d-mode'),
    snapshot,
  );
  assert.equal(
    stageModeOverrideBootState.initialState.session.stageMode,
    '2d-mode',
    'Route stageMode should override the stored session stage mode.',
  );
  assert.equal(
    isStackCameraAtDefault(stageModeOverrideBootState.initialState.session.stackCamera),
    false,
    'Route stageMode overrides should preserve the injected stack-camera orbit.',
  );

  const existingWorkplaneOverrideBootState = hydrateStageBootState(
    readStageConfig('?workplane=wp-2'),
    snapshot,
  );
  assert.equal(
    existingWorkplaneOverrideBootState.initialState.session.activeWorkplaneId,
    'wp-2',
    'Route workplane overrides should apply when the requested workplane exists.',
  );

  const missingWorkplaneOverrideBootState = hydrateStageBootState(
    readStageConfig('?workplane=wp-7'),
    snapshot,
  );
  assert.equal(
    missingWorkplaneOverrideBootState.initialState.session.activeWorkplaneId,
    INITIAL_WORKPLANE_ID,
    'Route workplane overrides should be ignored when the requested workplane is missing.',
  );
}

function runPlaneStackStateTests(): void {
  const scene = createStageScene({
    demoLayerCount: 12,
    labelSetKind: 'demo',
    labelTargetCount: DEMO_LABEL_COUNT,
    layoutStrategy: 'flow-columns',
  });
  const state = createStageSystemState(scene, {
    activeWorkplaneId: 'wp-7',
    initialCamera: {centerX: 9, centerY: -4, zoom: 3},
    initialCameraLabel: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    stageMode: '3d-mode',
  });

  assert.equal(state.session.stageMode, '3d-mode', 'Initial plane-stack state should retain the requested stage mode.');
  assert.equal(getPlaneCount(state), 1, 'Initial plane-stack state should contain one workplane.');
  assert.deepEqual(
    state.document.workplaneOrder,
    [INITIAL_WORKPLANE_ID],
    'Initial plane-stack state should boot with workplane 1 only.',
  );
  assert.equal(
    state.session.activeWorkplaneId,
    INITIAL_WORKPLANE_ID,
    'Initial plane-stack state should fall back to workplane 1 when the requested workplane is missing.',
  );
  assert.equal(
    getActiveWorkplaneDocument(state).scene.labelSetPreset,
    scene.labelSetPreset,
    'The active workplane should carry the boot scene.',
  );
  assert.equal(
    getActiveWorkplaneView(state).selectedLabelKey,
    buildLabelKey(INITIAL_WORKPLANE_ID, 1, 2, 2),
    'Initial demo workplane view should store the resolved active label per workplane.',
  );
  assert.equal(
    canDeleteActiveWorkplane(state),
    false,
    'Initial plane-stack state should block deleting the only workplane.',
  );

  const storedViewState = replaceWorkplaneView(state, INITIAL_WORKPLANE_ID, {
    selectedLabelKey: buildLabelKey(INITIAL_WORKPLANE_ID, 1, 3, 3),
    camera: {centerX: 12, centerY: 14, zoom: 5},
  });
  const spawnedState = spawnWorkplaneAfterActive(
    replaceWorkplaneLabelTextOverride(
      storedViewState,
      INITIAL_WORKPLANE_ID,
      buildLabelKey(INITIAL_WORKPLANE_ID, 1, 1, 1),
      'Signal',
    ),
  );

  assert.equal(getPlaneCount(spawnedState), 2, 'Spawning should add a second workplane.');
  assert.equal(spawnedState.session.activeWorkplaneId, 'wp-2', 'Spawning should select the new workplane.');
  assert.equal(
    getActiveWorkplaneView(spawnedState).selectedLabelKey,
    null,
    'Spawning should leave the new workplane without a selected label.',
  );
  assert.deepEqual(
    getActiveWorkplaneView(spawnedState).camera,
    {centerX: 12, centerY: 14, zoom: 5},
    'Spawning should preserve the active workplane numeric camera memory.',
  );
  assert.equal(
    Object.keys(getActiveWorkplaneDocument(spawnedState).labelTextOverrides).length,
    0,
    'Spawning should start the new workplane without inherited label text overrides.',
  );
  assert.equal(
    spawnedState.document.workplanesById['wp-2'].scene.labels.length,
    0,
    'Spawning should start the new workplane with an empty scene.',
  );

  const previousSelectedState = selectPreviousWorkplane(spawnedState);
  assert.equal(
    previousSelectedState.session.activeWorkplaneId,
    INITIAL_WORKPLANE_ID,
    'Selecting the previous workplane should return to wp-1.',
  );
  const nextSelectedState = selectNextWorkplane(previousSelectedState);
  assert.equal(
    nextSelectedState.session.activeWorkplaneId,
    'wp-2',
    'Selecting the next workplane should advance back to wp-2.',
  );

  const deletedState = deleteActiveWorkplane(nextSelectedState);
  assert.equal(getPlaneCount(deletedState), 1, 'Deleting the active workplane should reduce the stack size.');
  assert.equal(
    deletedState.session.activeWorkplaneId,
    INITIAL_WORKPLANE_ID,
    'Deleting the trailing workplane should keep the nearest surviving neighbor active.',
  );

  let cappedState = state;
  for (let index = 0; index < MAX_WORKPLANE_COUNT - 1; index += 1) {
    cappedState = spawnWorkplaneAfterActive(cappedState);
  }
  assert.equal(getPlaneCount(cappedState), MAX_WORKPLANE_COUNT, 'The plane stack should stop at the hard cap.');
  assert.equal(canSpawnWorkplane(cappedState), false, 'The hard cap should block further spawns.');
  assert.equal(spawnWorkplaneAfterActive(cappedState), cappedState, 'Spawning at the cap should no-op.');

  const dagRootState = createStageSystemStateWithDagRoot(
    createEmptyStageScene('dag-unit', INITIAL_WORKPLANE_ID),
    {
      stageMode: '2d-mode',
    },
  );
  assert.equal(
    dagRootState.document.dag?.rootWorkplaneId,
    INITIAL_WORKPLANE_ID,
    'A single-root DAG stage state should keep wp-1 as the root workplane.',
  );
  assert.equal(
    getDagControlAvailability(dagRootState)?.canFocusRoot,
    false,
    'The root workplane should not advertise focus-root while it is already active.',
  );
  assert.equal(
    canDeleteActiveWorkplane(dagRootState),
    false,
    'The root DAG workplane should not be deletable.',
  );

  const firstChildState = spawnDagChildWorkplane(dagRootState);
  assert.equal(firstChildState.session.activeWorkplaneId, 'wp-2', 'Spawning a DAG child should select the new child workplane.');
  assert.deepEqual(
    firstChildState.document.dag?.positionsById['wp-2'],
    {column: 1, row: 0, layer: 0},
    'The first DAG child should land in the next rank at the first lane.',
  );
  assert.equal(
    firstChildState.document.dag?.edges.length,
    1,
    'Spawning a DAG child should create one dependency edge from the active parent.',
  );
  assert.equal(
    canDeleteActiveWorkplane(firstChildState),
    true,
    'Leaf DAG workplanes should be deletable once they are no longer the root.',
  );

  const deletedLeafState = deleteActiveWorkplane(firstChildState);
  assert.equal(
    deletedLeafState.session.activeWorkplaneId,
    'wp-1',
    'Deleting a leaf DAG workplane should select the nearest surviving workplane.',
  );
  assert.equal(
    deletedLeafState.document.dag?.edges.length,
    0,
    'Deleting a leaf DAG workplane should remove its dependency edges.',
  );
  assert.equal(
    deletedLeafState.document.dag?.positionsById['wp-2'],
    undefined,
    'Deleting a leaf DAG workplane should remove its rank/lane/depth placement.',
  );
  assert.equal(
    validateDagDocument(createDagDocumentFromStageState(deletedLeafState)).valid,
    true,
    'Deleting a leaf DAG workplane should preserve the DAG invariants.',
  );
  const recycledChildState = spawnDagChildWorkplane(focusDagRootWorkplane(deletedLeafState));
  assert.equal(
    recycledChildState.session.activeWorkplaneId,
    'wp-2',
    'Deleting the highest-numbered DAG leaf should make that workplane id available again.',
  );
  assert.deepEqual(
    recycledChildState.document.dag?.positionsById['wp-2'],
    {column: 1, row: 0, layer: 0},
    'Reusing the freed DAG workplane id should still place the child in the next deterministic slot.',
  );

  const secondChildState = spawnDagChildWorkplane(focusDagRootWorkplane(firstChildState));
  assert.deepEqual(
    secondChildState.document.dag?.positionsById['wp-3'],
    {column: 1, row: 0, layer: 1},
    'A second child from the root should fill the next available depth slot of the same rank slice.',
  );

  const rankMoveState = moveActiveDagWorkplaneByRank(
    selectNextWorkplane(focusDagRootWorkplane(secondChildState)),
    1,
  );
  assert.deepEqual(
    rankMoveState.document.dag?.positionsById['wp-2'],
    {column: 2, row: 0, layer: 0},
    'Rank-forward should move the active DAG workplane one rank to the right when topology allows it.',
  );

  const laneAndDepthMoveState = moveActiveDagWorkplaneByDepth(
    moveActiveDagWorkplaneByLane(rankMoveState, 1),
    1,
  );
  assert.deepEqual(
    laneAndDepthMoveState.document.dag?.positionsById['wp-2'],
    {column: 2, row: 1, layer: 1},
    'Lane-down and depth-in should move the active DAG workplane within the same rank slice.',
  );
  assert.equal(
    getDagControlAvailability(laneAndDepthMoveState)?.canMoveDepthOut,
    true,
    'Depth-out should become available once the active DAG workplane is no longer at depth 0.',
  );
  assert.equal(
    getDagControlAvailability(laneAndDepthMoveState)?.canMoveLaneUp,
    true,
    'Lane-up should become available once the active DAG workplane is no longer in the top lane.',
  );

  const insertedParentState = insertDagParentWorkplane(laneAndDepthMoveState);
  assert.equal(
    insertedParentState.session.activeWorkplaneId,
    'wp-4',
    'Inserting a DAG parent should select the newly inserted parent workplane.',
  );
  assert.deepEqual(
    insertedParentState.document.dag?.positionsById['wp-4'],
    {column: 2, row: 1, layer: 1},
    'Inserted DAG parents should occupy the previous active rank/lane/depth slot.',
  );
  assert.deepEqual(
    insertedParentState.document.dag?.positionsById['wp-2'],
    {column: 3, row: 1, layer: 1},
    'Inserting a DAG parent should push the active workplane and its descendants one rank to the right.',
  );
  assert.deepEqual(
    insertedParentState.document.dag?.edges.map((edge) => `${edge.fromWorkplaneId}->${edge.toWorkplaneId}`),
    ['wp-1->wp-3', 'wp-1->wp-4', 'wp-4->wp-2'],
    'Inserting a DAG parent should replace the primary incoming edge with a valid two-edge chain.',
  );
  assert.equal(
    validateDagDocument(createDagDocumentFromStageState(insertedParentState)).valid,
    true,
    'DAG authoring mutations should preserve the core DAG invariants.',
  );
  assert.equal(
    canDeleteActiveWorkplane(insertedParentState),
    false,
    'Inserted DAG parents should not be deletable while they still have children.',
  );

  const newRootState = insertDagParentWorkplane(dagRootState);
  assert.equal(
    newRootState.document.dag?.rootWorkplaneId,
    'wp-2',
    'Inserting a parent on the root should create a new root workplane.',
  );
  assert.deepEqual(
    newRootState.document.dag?.positionsById['wp-1'],
    {column: 1, row: 0, layer: 0},
    'Creating a new root should shift the previous root one rank to the right.',
  );
  assert.equal(
    validateDagDocument(createDagDocumentFromStageState(newRootState)).valid,
    true,
    'Root-parent insertion should still preserve the DAG invariants.',
  );
}

function runCameraAndProjectionTests(): void {
  const viewport: ViewportSize = {width: 1280, height: 800};
  const camera = new Camera2D();
  const beforePan = camera.getSnapshot();

  camera.panByPixels(112, 56);
  camera.advance(1000);

  const afterPan = camera.getSnapshot();
  assert.notEqual(afterPan.centerX, beforePan.centerX, 'Camera pan should change centerX.');
  assert.notEqual(afterPan.centerY, beforePan.centerY, 'Camera pan should change centerY.');

  const anchorScreenPoint = {x: 400, y: 300};
  const worldBeforeZoom = camera.screenToWorld(anchorScreenPoint, viewport);
  const zoomBefore = camera.zoom;

  camera.zoomAtScreenPoint(-120, anchorScreenPoint, viewport);
  camera.advance(1000);

  const worldAfterZoom = camera.screenToWorld(anchorScreenPoint, viewport);
  assert.notEqual(camera.zoom, zoomBefore, 'Camera zoom should change after wheel zoom input.');
  assert.ok(
    Math.abs(worldAfterZoom.x - worldBeforeZoom.x) < 0.0001,
    'Zooming around a screen point should preserve world X at the anchor.',
  );
  assert.ok(
    Math.abs(worldAfterZoom.y - worldBeforeZoom.y) < 0.0001,
    'Zooming around a screen point should preserve world Y at the anchor.',
  );

  camera.setView(12.5, -8.75, 3.25);
  const projector = new PlaneFocusProjector(camera);
  const worldPoint = {x: 16.25, y: -4.5};

  assertScreenPointClose(
    projector.projectWorldPoint(worldPoint, viewport),
    camera.worldToScreen(worldPoint, viewport),
    'PlaneFocusProjector.projectWorldPoint should match the current camera screen projection.',
  );
  assertScreenPointClose(
    {
      x: projector.projectWorldPointToClip(worldPoint, viewport).x,
      y: projector.projectWorldPointToClip(worldPoint, viewport).y,
    },
    camera.worldToClip(worldPoint, viewport),
    'PlaneFocusProjector clip x/y should match the current camera clip projection on the active workplane.',
  );
  assertWorldBoundsClose(
    projector.getVisibleWorldBounds(viewport),
    camera.getVisibleWorldBounds(viewport),
    'PlaneFocusProjector visible bounds should match the current camera visible bounds.',
  );

  const projectionScene = createStageScene({
    demoLayerCount: 12,
    labelSetKind: 'demo',
    labelTargetCount: DEMO_LABEL_COUNT,
    layoutStrategy: 'flow-columns',
  });
  let stageState = createStageSystemState(cloneStageScene(projectionScene), {stageMode: '3d-mode'});

  for (let planeCount = 1; planeCount < 5; planeCount += 1) {
    stageState = spawnWorkplaneAfterActive(stageState);
    const activeWorkplaneId = stageState.session.activeWorkplaneId;
    stageState = replaceWorkplaneScene(
      stageState,
      activeWorkplaneId,
      createStageScene({
        demoLayerCount: 12,
        labelSetKind: 'demo',
        labelTargetCount: DEMO_LABEL_COUNT,
        layoutStrategy: 'flow-columns',
        workplaneId: activeWorkplaneId,
      }),
    );
  }

  const stackViewState = createStackViewState(stageState);
  const stackProjector = new StackCameraProjector();

  stackProjector.setSceneBounds(stackViewState.sceneBounds);
  stackProjector.setOrbitTarget(stackViewState.orbitTarget, {immediate: true});
  stackProjector.setViewport(viewport);

  const visibleBounds = stackProjector.getVisibleWorldBounds(viewport);
  const sceneCenter = stackViewState.orbitTarget;
  const centerPoint = stackProjector.projectWorldPoint(
    sceneCenter,
    viewport,
  );
  const orbitSamplePoint = {
    x: sceneCenter.x + 1.25,
    y: sceneCenter.y + 0.75,
    z: sceneCenter.z,
  };
  const defaultStackProjection = stackProjector.projectWorldPoint(orbitSamplePoint, viewport);

  assert.equal(
    stackViewState.backplates.length,
    5,
    'Stack view state should create one backplate per workplane.',
  );
  assert.equal(
    stackViewState.backplates.filter((backplate) => backplate.isActive).length,
    1,
    'Stack view state should keep exactly one active workplane backplate.',
  );
  assert.ok(
    stackViewState.scene.labels.length > getActiveWorkplaneDocument(stageState).scene.labels.length,
    'Stack view state should combine labels from all workplanes.',
  );
  assert.ok(
    Math.abs(centerPoint.x - viewport.width / 2) < 0.0001 &&
      Math.abs(centerPoint.y - viewport.height / 2) < 0.0001,
    'StackCameraProjector should center the active workplane orbit target in the viewport.',
  );
  assert.ok(
    visibleBounds.minX <= stackViewState.sceneBounds.minX &&
      visibleBounds.maxX >= stackViewState.sceneBounds.maxX &&
      visibleBounds.minY <= stackViewState.sceneBounds.minY &&
      visibleBounds.maxY >= stackViewState.sceneBounds.maxY,
    'StackCameraProjector visible bounds should contain the stack-view scene bounds.',
  );
  assertSceneVectorClose(
    getStackCameraForward(stackProjector.getStackCamera()),
    getStackCameraForward(DEFAULT_STACK_CAMERA_STATE),
    'StackCameraProjector should boot with the default stack-camera orbit.',
  );
  stackProjector.setOrbitTarget(
    {
      x: stackViewState.orbitTarget.x + 2,
      y: stackViewState.orbitTarget.y - 1,
      z: stackViewState.orbitTarget.z,
    },
  );
  assert.equal(
    stackProjector.isAnimating,
    true,
    'StackCameraProjector should animate orbit-target changes instead of snapping immediately.',
  );
  stackProjector.advance(16.67);
  assert.ok(
    stackProjector.centerX > sceneCenter.x,
    'StackCameraProjector should ease its orbit target toward the next active workplane.',
  );
  stackProjector.setOrbitTarget(stackViewState.orbitTarget, {immediate: true});

  const orbitedStackCamera = orbitStackCamera(
    stackProjector.getStackCamera(),
    Math.PI / 9,
    -Math.PI / 18,
  );
  const defaultStackZoom = stackProjector.zoom;
  stackProjector.setStackCamera(orbitedStackCamera);
  const orbitedCenterPoint = stackProjector.projectWorldPoint(orbitSamplePoint, viewport);
  const orbitedStackZoom = stackProjector.zoom;

  assert.ok(
    Math.abs(orbitedCenterPoint.x - defaultStackProjection.x) > 0.0001 ||
      Math.abs(orbitedCenterPoint.y - defaultStackProjection.y) > 0.0001,
    'Changing the stack-camera orbit should change the projected stack geometry.',
  );
  assert.ok(
    Math.abs(orbitedStackZoom - defaultStackZoom) < 0.05,
    'Changing the stack-camera orbit should not materially change stack-view zoom visibility.',
  );
  assert.equal(
    countVisibleItemsForZoom(stackViewState.scene.labels, defaultStackZoom),
    countVisibleItemsForZoom(stackViewState.scene.labels, orbitedStackZoom),
    'Changing the stack-camera orbit should not change stack-view label visibility.',
  );
  assert.equal(
    countVisibleItemsForZoom(stackViewState.scene.links, defaultStackZoom),
    countVisibleItemsForZoom(stackViewState.scene.links, orbitedStackZoom),
    'Changing the stack-camera orbit should not change stack-view link visibility.',
  );

  const zoomedStackCamera = scaleStackCameraDistance(orbitedStackCamera, 0.8);
  stackProjector.setStackCamera(zoomedStackCamera);
  const zoomedStackZoom = stackProjector.zoom;

  assert.ok(
    stackProjector.getStackCamera().distanceScale < orbitedStackCamera.distanceScale,
    'Stack-camera zoom should move the camera closer by reducing its distance scale.',
  );
  assert.ok(
    zoomedStackZoom > orbitedStackZoom,
    'Reducing stack-camera distance should increase stack-view zoom visibility.',
  );

  const activePlaneLabel = findVisibleLabelForZoom(
    getActiveWorkplaneDocument(stageState).scene.labels,
    projector.zoom,
  );
  assert.ok(activePlaneLabel, 'Projection tests need a visible plane-focus label sample.');

  if (!activePlaneLabel) {
    return;
  }

  const planeFocusQuad = projectGlyphQuadToScreen(
    createProjectedGlyphSample(activePlaneLabel),
    projector,
    viewport,
  );
  assert.ok(planeFocusQuad, 'Plane-focus label glyph geometry should project into screen space.');

  if (!planeFocusQuad) {
    return;
  }

  assert.ok(
    Math.abs(planeFocusQuad.basisX.y) <= 0.0001 && planeFocusQuad.basisX.x > 0,
    'Plane-focus label glyphs should stay aligned to the readable workplane X axis.',
  );
  assert.ok(
    Math.abs(planeFocusQuad.basisY.x) <= 0.0001 && planeFocusQuad.basisY.y > 0,
    'Plane-focus label glyphs should stay aligned to the readable workplane down axis.',
  );

  const stackLabel = findVisibleLabelForZoom(stackViewState.scene.labels, stackProjector.zoom);
  assert.ok(stackLabel, 'Projection tests need a visible stack-view label sample.');
  assert.ok(
    stackLabel?.planeBasisX && stackLabel?.planeBasisY,
    'Stack-view labels should carry workplane text bases.',
  );

  if (!stackLabel || !stackLabel.planeBasisX || !stackLabel.planeBasisY) {
    return;
  }

  const stackQuad = projectGlyphQuadToScreen(
    createProjectedGlyphSample(stackLabel),
    stackProjector,
    viewport,
  );
  assert.ok(stackQuad, 'Stack-view label glyph geometry should project into screen space.');

  if (!stackQuad) {
    return;
  }

  const expectedStackBasisX = projectScreenBasis(
    stackLabel.location,
    stackLabel.planeBasisX,
    stackProjector,
    viewport,
  );
  const expectedStackBasisY = projectScreenBasis(
    stackLabel.location,
    stackLabel.planeBasisY,
    stackProjector,
    viewport,
  );

  assert.ok(
    Math.abs(stackQuad.basisX.y) > 0.001 || Math.abs(stackQuad.basisY.x) > 0.001,
    'Stack-view label glyphs should pick up the stack-camera perspective instead of staying perfectly camera-flat.',
  );
  assert.ok(
    Math.abs(stackQuad.basisY.x) > 0.001 && stackQuad.basisY.y > 0,
    'Stack-view label glyphs should follow the projected workplane down axis instead of flipping upside down.',
  );
  assert.ok(
    screenVectorAlignment(stackQuad.basisX, expectedStackBasisX) > 0.999,
    'Stack-view label X geometry should follow the projected workplane basis.',
  );
  assert.ok(
    screenVectorAlignment(stackQuad.basisY, expectedStackBasisY) > 0.999,
    'Stack-view label Y geometry should follow the projected workplane down basis.',
  );

  const stackLink = stackViewState.scene.links[0];
  assert.ok(stackLink, 'Projection tests need a stack-view link sample.');

  if (!stackLink) {
    return;
  }

  const projectedLinkPoints = sampleLineCurve(stackLink, 'rounded-step-links', 20).map((point) =>
    stackProjector.projectWorldPoint(point, viewport),
  );
  assert.ok(
    projectedLinkPoints.some((point, index) => {
      if (index === 0) {
        return false;
      }

      return isObliqueScreenSegment(projectedLinkPoints[index - 1], point);
    }),
    'Stack-view link geometry should stay projected onto the workplane instead of flattening to camera axes.',
  );
}

function runLayoutAndLinkTests(): void {
  const viewport: ViewportSize = {width: 1280, height: 800};
  const visibleBounds = new Camera2D().getVisibleWorldBounds(viewport);
  const entries = createCanonicalDemoLayoutEntries();
  const placement = layoutDemoEntries(entries, 'flow-columns');
  const rootBoxes = placement.boxes.filter((box) => box.node === 'root');
  const rootBoxByLabel = new Map<string, DemoLayoutNodeBox>();

  entries.forEach((entry, index) => {
    const rootBox = placement.boxes.find((box) => box.entryIndex === index && box.node === 'root');

    if (rootBox) {
      rootBoxByLabel.set(entry.nodes.root.text, rootBox);
    }
  });

  assert.equal(
    placement.locations.length,
    entries.length,
    'The canonical demo scene should place every root entry.',
  );
  assert.equal(
    placement.columnCount,
    DEMO_SOURCE_COLUMN_COUNT,
    'Flow-columns layout should preserve all source columns.',
  );
  assert.equal(
    rootBoxes.length,
    DEMO_SOURCE_COLUMN_COUNT * DEMO_ROWS_PER_SOURCE_COLUMN,
    'Flow-columns layout should create one visible root box per root label.',
  );

  for (let index = 0; index < rootBoxes.length; index += 1) {
    const rootBox = rootBoxes[index];

    assert.ok(
      rootBox.minX >= visibleBounds.minX && rootBox.maxX <= visibleBounds.maxX,
      'Every root label should fit inside the zoom-0 camera width.',
    );
    assert.ok(
      rootBox.minY >= visibleBounds.minY && rootBox.maxY <= visibleBounds.maxY,
      'Every root label should fit inside the zoom-0 camera height.',
    );

    for (let otherIndex = index + 1; otherIndex < rootBoxes.length; otherIndex += 1) {
      assert.equal(
        boxesOverlap(rootBox, rootBoxes[otherIndex]),
        false,
        'The canonical root grid should avoid overlapping root labels.',
      );
    }
  }

  const links = getDemoLinks('flow-columns');
  const horizontalStartBox = getRequiredRootBox(
    rootBoxByLabel,
    buildLabelKey('wp-1', 1, 2, 1),
  );
  const horizontalEndBox = getRequiredRootBox(
    rootBoxByLabel,
    buildLabelKey('wp-1', 1, 2, 2),
  );
  const horizontalLink = links.find((link) => {
    return (
      Math.abs(link.outputLocation.x - horizontalStartBox.maxX) < 0.0001 &&
      Math.abs(link.outputLocation.y - getBoxCenterY(horizontalStartBox)) < 0.0001 &&
      Math.abs(link.inputLocation.x - horizontalEndBox.minX) < 0.0001 &&
      Math.abs(link.inputLocation.y - getBoxCenterY(horizontalEndBox)) < 0.0001
    );
  });

  assert.ok(
    horizontalLink,
    'Horizontal demo links should connect source right-center to target left-center.',
  );
  assert.equal(horizontalLink?.outputLinkPoint, 'right-center', 'Horizontal links should use the source right-center link-point.');
  assert.equal(horizontalLink?.inputLinkPoint, 'left-center', 'Horizontal links should use the target left-center link-point.');

  const verticalStartBox = getRequiredRootBox(
    rootBoxByLabel,
    buildLabelKey('wp-1', 1, 1, 3),
  );
  const verticalEndBox = getRequiredRootBox(
    rootBoxByLabel,
    buildLabelKey('wp-1', 1, 2, 3),
  );
  const verticalLink = links.find((link) => {
    return (
      Math.abs(link.outputLocation.x - getBoxCenterX(verticalStartBox)) < 0.0001 &&
      Math.abs(link.outputLocation.y - verticalStartBox.minY) < 0.0001 &&
      Math.abs(link.inputLocation.x - getBoxCenterX(verticalEndBox)) < 0.0001 &&
      Math.abs(link.inputLocation.y - verticalEndBox.maxY) < 0.0001
    );
  });

  assert.ok(
    verticalLink,
    'Vertical demo links should connect source bottom-center to target top-center.',
  );
  assert.equal(verticalLink?.outputLinkPoint, 'bottom-center', 'Vertical links should use the source bottom-center link-point.');
  assert.equal(verticalLink?.inputLinkPoint, 'top-center', 'Vertical links should use the target top-center link-point.');

  const diagonalLink = links.find((link) => {
    return (
      link.outputLinkPoint === 'right-center' &&
      link.inputLinkPoint === 'left-center' &&
      link.outputLocation.x < link.inputLocation.x &&
      link.outputLocation.y > link.inputLocation.y
    );
  });

  assert.ok(diagonalLink, 'The demo link set should include a diagonal right-to-left link.');

  if (!diagonalLink) {
    return;
  }

  const roundedStepPoints = sampleLineCurve(diagonalLink, 'rounded-step-links', 20);
  assert.equal(
    roundedStepPoints.length > 4,
    true,
    'Rounded-step links should sample extra points for rounded corners.',
  );
  assert.deepEqual(
    {
      x: roundedStepPoints[0]?.x,
      y: roundedStepPoints[0]?.y,
      z: roundedStepPoints[0]?.z ?? 0,
    },
    {
      x: diagonalLink.outputLocation.x,
      y: diagonalLink.outputLocation.y,
      z: diagonalLink.outputLocation.z ?? 0,
    },
    'Rounded-step links should preserve the source endpoint.',
  );
  assert.deepEqual(
    {
      x: roundedStepPoints[roundedStepPoints.length - 1]?.x,
      y: roundedStepPoints[roundedStepPoints.length - 1]?.y,
      z: roundedStepPoints[roundedStepPoints.length - 1]?.z ?? 0,
    },
    {
      x: diagonalLink.inputLocation.x,
      y: diagonalLink.inputLocation.y,
      z: diagonalLink.inputLocation.z ?? 0,
    },
    'Rounded-step links should preserve the target endpoint.',
  );
}

function runNavigationAndZoomTests(): void {
  const navigationIndex = createLabelNavigationIndex(DEMO_LABELS);
  assert.ok(navigationIndex, 'Demo labels should build a navigation index.');

  if (!navigationIndex) {
    return;
  }

  const firstRootNode = getLabelNavigationNode(navigationIndex, FIRST_ROOT_LABEL);
  assert.ok(firstRootNode, 'The first root label should exist in the navigation index.');
  assert.equal(firstRootNode?.column, 1, '1:1:1 should report column 1.');
  assert.equal(firstRootNode?.row, 1, '1:1:1 should report row 1.');
  assert.equal(firstRootNode?.layer, 1, '1:1:1 should report layer 1.');

  assert.equal(
    getLabelNavigationTarget(navigationIndex, FIRST_ROOT_LABEL, 'pan-right')?.key,
    buildLabelKey('wp-1', 1, 1, 2),
    'Right should advance to the next column on the same row and layer.',
  );
  assert.equal(
    getLabelNavigationTarget(
      navigationIndex,
      buildLabelKey('wp-1', 1, 2, 2),
      'pan-up',
    )?.key,
    buildLabelKey('wp-1', 1, 1, 2),
    'Up should move to the visually higher row.',
  );
  assert.equal(
    getLabelNavigationTarget(
      navigationIndex,
      buildLabelKey('wp-1', 1, 2, 2),
      'zoom-in',
    )?.key,
    buildLabelKey('wp-1', 2, 2, 2),
    'Zoom In should move to the next layer in the same cell.',
  );
  assert.equal(
    hasLabelNavigationTarget(navigationIndex, FIRST_ROOT_LABEL, 'pan-left'),
    false,
    'The first root label should not advertise a left move.',
  );
  assert.equal(
    hasLabelNavigationTarget(navigationIndex, FIRST_ROOT_LABEL, 'zoom-in'),
    true,
    'The first root label should advertise a zoom-in move.',
  );
  assert.equal(
    getLabelNavigationTarget(navigationIndex, LAST_CHILD_LABEL, 'pan-right')?.key,
    LAST_CHILD_LABEL,
    'Missing right neighbors should no-op.',
  );

  const detailBand = createZoomBand(3.5, 4.5);
  assert.equal(detailBand.zoomLevel, 4, 'Zoom bands should store the focal zoom midpoint.');
  assert.equal(detailBand.zoomRange, 0.5, 'Zoom bands should store half of the visible zoom span.');
  assert.equal(getMinVisibleZoom(detailBand.zoomLevel, detailBand.zoomRange), 3.5, 'Zoom bands should expose the lower visible bound.');
  assert.equal(getMaxVisibleZoom(detailBand.zoomLevel, detailBand.zoomRange), 4.5, 'Zoom bands should expose the upper visible bound.');
  assert.equal(isZoomVisible(3.49, detailBand.zoomLevel, detailBand.zoomRange), false, 'Zoom bands should hide labels before the reveal threshold.');
  assert.equal(isZoomVisible(3.5, detailBand.zoomLevel, detailBand.zoomRange), true, 'Zoom bands should reveal labels at the threshold.');
  assert.equal(isZoomVisible(4.51, detailBand.zoomLevel, detailBand.zoomRange), false, 'Zoom bands should hide labels after the upper threshold.');
  assert.ok(
    Math.abs(getZoomScale(3.5, detailBand.zoomLevel, detailBand.zoomRange) - 2 ** -0.5) <= 0.0001,
    'Zoom-band scaling should follow the relative zoom delta at the reveal edge.',
  );
  assert.equal(getZoomScale(4, detailBand.zoomLevel, detailBand.zoomRange), 1, 'Zoom-band scaling should reach full size at the focal zoom.');
  assert.equal(getZoomOpacity(3.5, detailBand.zoomLevel, detailBand.zoomRange), 1, 'Zoom-band opacity should stay readable at the reveal threshold.');
  assert.ok(
    getZoomOpacity(3.75, detailBand.zoomLevel, detailBand.zoomRange) >= MIN_ZOOM_OPACITY &&
      getZoomOpacity(3.75, detailBand.zoomLevel, detailBand.zoomRange) <= 1,
    'Zoom-band opacity should remain in a valid visible range while the label scales in.',
  );
}

function runDemoPresetGeometryTests(): void {
  const classicScene = createStageScene({
    demoLayerCount: 12,
    labelSetKind: 'demo',
    labelTargetCount: DEMO_LABEL_COUNT,
    layoutStrategy: 'flow-columns',
  });
  const defaultDagState = createDefaultDagRankFanoutState();
  const editorLabState = createDefaultEditorLabState();

  assertSceneUsesAlignedGrid(classicScene, 'Classic demo scene');
  assert.equal(
    validateDagDocument(createDagDocumentFromStageState(defaultDagState)).valid,
    true,
    'The default twelve-workplane DAG preset should remain a valid DAG document.',
  );
  assertBridgeLinksResolveInStackView(
    editorLabState,
    'Editor lab should resolve authored workplane bridge links in stack view.',
  );

  for (const workplaneId of editorLabState.document.workplaneOrder) {
    assertSceneUsesAlignedGrid(
      editorLabState.document.workplanesById[workplaneId].scene,
      `Editor lab ${workplaneId}`,
    );
  }

  assert.equal(
    defaultDagState.document.workplanesById['wp-1'].scene.labels.find(
      (label) => label.navigation?.key === buildLabelKey('wp-1', 1, 1, 1),
    )?.text,
    DAG_RANK_FANOUT_ROOT_LABEL_TEXT,
    'The default twelve-workplane DAG preset should reuse the onboarding-authored root label.',
  );
  assert.equal(
    defaultDagState.document.workplanesById['wp-2'].scene.links.length,
    1,
    'The default twelve-workplane DAG preset should reuse the onboarding-authored local links.',
  );
  assert.equal(
    defaultDagState.document.workplanesById['wp-4'].scene.labels.length,
    0,
    'Unseeded onboarding workplanes should stay empty in the default twelve-workplane DAG preset.',
  );
  assert.equal(
    defaultDagState.document.workplaneOrder.reduce((total, workplaneId) => {
      return total + defaultDagState.document.workplanesById[workplaneId].scene.labels.length;
    }, 0),
    DAG_RANK_FANOUT_TOTAL_LOCAL_LABEL_COUNT,
    'The default twelve-workplane DAG preset should keep the same total local label count as the onboarding result.',
  );
  assert.equal(
    defaultDagState.document.workplaneOrder.reduce((total, workplaneId) => {
      return total + defaultDagState.document.workplanesById[workplaneId].scene.links.length;
    }, 0),
    DAG_RANK_FANOUT_TOTAL_LOCAL_LINK_COUNT,
    'The default twelve-workplane DAG preset should keep the same total local link count as the onboarding result.',
  );

  const editorLabScene = getActiveWorkplaneDocument(editorLabState).scene;
  const editorLabStartState = createStageEditorState(
    editorLabScene,
    buildLabelKey('wp-3', 1, 6, 12),
  );
  const editorLabGhostState = moveStageEditorCursor(
    editorLabStartState,
    editorLabScene,
    'pan-right',
  );
  const editorLabMutation = addLabelAtStageEditorCursor(
    editorLabScene,
    editorLabGhostState,
  );

  assert.equal(
    editorLabGhostState.cursor.kind,
    'ghost',
    'Editor lab geometry tests should navigate to a ghost slot before adding a label.',
  );
  assert.equal(
    editorLabMutation.changed,
    true,
    'Adding a label from a ghost slot should mutate the scene.',
  );
  assertSceneUsesAlignedGrid(
    editorLabMutation.scene,
    'Editor-created editor-lab scene',
  );
}

function assertSceneUsesAlignedGrid(
  scene: ReturnType<typeof createStageScene>,
  name: string,
): void {
  const labelsByCellKey = new Map<string, LabelDefinition[]>();
  const rootLabels: LabelDefinition[] = [];

  for (const label of scene.labels) {
    if (!label.navigation) {
      continue;
    }

    const cellKey = `${label.navigation.column}:${label.navigation.row}`;
    const cellLabels = labelsByCellKey.get(cellKey);

    if (cellLabels) {
      cellLabels.push(label);
    } else {
      labelsByCellKey.set(cellKey, [label]);
    }

    if (label.navigation.layer === 1) {
      rootLabels.push(label);
    }
  }

  assert.ok(rootLabels.length > 0, `${name} should include root labels.`);

  for (const [cellKey, cellLabels] of labelsByCellKey.entries()) {
    const sortedLabels = [...cellLabels].sort(
      (left, right) =>
        (left.navigation?.layer ?? 0) - (right.navigation?.layer ?? 0),
    );
    const rootLabel = sortedLabels[0];

    assert.equal(
      rootLabel?.navigation?.layer,
      1,
      `${name} ${cellKey} should start at layer 1.`,
    );

    for (let index = 0; index < sortedLabels.length; index += 1) {
      const currentLabel = sortedLabels[index];
      const previousLabel = sortedLabels[index - 1] ?? null;

      assert.ok(
        Math.abs((currentLabel?.location.x ?? 0) - (rootLabel?.location.x ?? 0)) <= 0.0001 &&
          Math.abs((currentLabel?.location.y ?? 0) - (rootLabel?.location.y ?? 0)) <= 0.0001,
        `${name} ${cellKey} should keep every layer on the same grid location.`,
      );

      if (previousLabel) {
        assert.ok(
          Math.abs(currentLabel.zoomLevel - previousLabel.zoomLevel - GRID_LAYER_ZOOM_STEP) <= 0.0001,
          `${name} ${cellKey} should use a consistent 3x zoom step between layers.`,
        );
      }
    }
  }

  assertGridAxisConsistency(rootLabels, 'column', name);
  assertGridAxisConsistency(rootLabels, 'row', name);
}

function assertGridAxisConsistency(
  rootLabels: LabelDefinition[],
  axis: 'column' | 'row',
  name: string,
): void {
  const perStepSamples: number[] = [];

  if (axis === 'column') {
    const labelsByRow = new Map<number, LabelDefinition[]>();

    for (const label of rootLabels) {
      const row = label.navigation?.row ?? 0;
      const rowLabels = labelsByRow.get(row);

      if (rowLabels) {
        rowLabels.push(label);
      } else {
        labelsByRow.set(row, [label]);
      }
    }

    for (const rowLabels of labelsByRow.values()) {
      rowLabels.sort(
        (left, right) =>
          (left.navigation?.column ?? 0) - (right.navigation?.column ?? 0),
      );

      for (let index = 1; index < rowLabels.length; index += 1) {
        const previousLabel = rowLabels[index - 1];
        const nextLabel = rowLabels[index];
        const columnDelta =
          (nextLabel.navigation?.column ?? 0) -
          (previousLabel.navigation?.column ?? 0);

        if (columnDelta > 0) {
          perStepSamples.push(
            (nextLabel.location.x - previousLabel.location.x) / columnDelta,
          );
        }
      }
    }
  } else {
    const labelsByColumn = new Map<number, LabelDefinition[]>();

    for (const label of rootLabels) {
      const column = label.navigation?.column ?? 0;
      const columnLabels = labelsByColumn.get(column);

      if (columnLabels) {
        columnLabels.push(label);
      } else {
        labelsByColumn.set(column, [label]);
      }
    }

    for (const columnLabels of labelsByColumn.values()) {
      columnLabels.sort(
        (left, right) =>
          (left.navigation?.row ?? 0) - (right.navigation?.row ?? 0),
      );

      for (let index = 1; index < columnLabels.length; index += 1) {
        const previousLabel = columnLabels[index - 1];
        const nextLabel = columnLabels[index];
        const rowDelta =
          (nextLabel.navigation?.row ?? 0) -
          (previousLabel.navigation?.row ?? 0);

        if (rowDelta > 0) {
          perStepSamples.push(
            (nextLabel.location.y - previousLabel.location.y) / rowDelta,
          );
        }
      }
    }
  }

  assert.ok(
    perStepSamples.length > 0,
    `${name} should provide enough root labels to measure ${axis} spacing.`,
  );

  const expectedStep = perStepSamples[0] ?? 0;

  for (const sample of perStepSamples) {
    assert.ok(
      Math.abs(sample - expectedStep) <= 0.0001,
      `${name} should keep a constant ${axis} step across the grid.`,
    );
  }

  if (axis === 'column') {
    assert.ok(expectedStep > 0, `${name} should increase x as columns increase.`);
  } else {
    assert.ok(expectedStep < 0, `${name} should decrease y as rows increase.`);
  }
}

function assertBridgeLinksResolveInStackView(
  state: StageSystemState,
  message: string,
): void {
  const stackViewState = createStackViewState({
    ...state,
    session: {
      ...state.session,
      stageMode: '3d-mode',
    },
  });

  assert.equal(
    countRenderedBridgeLinks(stackViewState.scene.links),
    state.document.workplaneBridgeLinks.length,
    message,
  );
}

function countRenderedBridgeLinks(
  links: ReturnType<typeof createStackViewState>['scene']['links'],
): number {
  return links.filter((link) => link.linkKey.startsWith('bridge:')).length;
}

function formatDagLayoutFingerprint(
  positionsById: Record<string, {column: number; layer: number; row: number}>,
): string {
  return Object.entries(positionsById)
    .sort(([leftWorkplaneId], [rightWorkplaneId]) =>
      leftWorkplaneId.localeCompare(rightWorkplaneId, undefined, {numeric: true}),
    )
    .map(
      ([workplaneId, position]) =>
        `${workplaneId}:${position.column}:${position.row}:${position.layer}`,
    )
    .join('|');
}

function createCanonicalDemoLayoutEntries(): DemoLayoutEntry[] {
  const entries: DemoLayoutEntry[] = [];

  for (let rowIndex = 0; rowIndex < DEMO_ROWS_PER_SOURCE_COLUMN; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < DEMO_SOURCE_COLUMN_COUNT; columnIndex += 1) {
      const column = columnIndex + 1;
      const row = rowIndex + 1;
      const rootText = buildLabelKey('wp-1', 1, row, column);
      entries.push({
        nodes: {
          root: {text: rootText, size: DEMO_ROOT_LABEL_SIZE},
          child: {text: buildLabelKey('wp-1', 2, row, column), size: DEMO_CHILD_LABEL_SIZE},
        },
        sourceColumnIndex: columnIndex,
        sourceRowIndex: rowIndex,
      });
    }
  }

  return entries;
}

function boxesOverlap(left: DemoLayoutNodeBox, right: DemoLayoutNodeBox): boolean {
  const epsilon = 0.0001;

  return (
    left.minX < right.maxX - epsilon &&
    left.maxX > right.minX + epsilon &&
    left.minY < right.maxY - epsilon &&
    left.maxY > right.minY + epsilon
  );
}

function getRequiredRootBox(
  rootBoxByLabel: Map<string, DemoLayoutNodeBox>,
  label: string,
): DemoLayoutNodeBox {
  const box = rootBoxByLabel.get(label);

  assert.ok(box, `Expected a root box for ${label}.`);
  return box;
}

function getBoxCenterX(box: DemoLayoutNodeBox): number {
  return (box.minX + box.maxX) * 0.5;
}

function getBoxCenterY(box: DemoLayoutNodeBox): number {
  return (box.minY + box.maxY) * 0.5;
}

function findVisibleLabelForZoom(
  labels: LabelDefinition[],
  zoom: number,
): LabelDefinition | null {
  return labels.find((label) => isZoomVisible(zoom, label.zoomLevel, label.zoomRange)) ?? null;
}

function countVisibleItemsForZoom(
  items: Array<{zoomLevel: number; zoomRange: number}>,
  zoom: number,
): number {
  return items.reduce((count, item) => {
    return count + (isZoomVisible(zoom, item.zoomLevel, item.zoomRange) ? 1 : 0);
  }, 0);
}

function createProjectedGlyphSample(label: LabelDefinition): GlyphPlacement {
  return {
    labelId: 0,
    labelKey: label.navigation?.key ?? label.text,
    anchorX: label.location.x,
    anchorY: label.location.y,
    anchorZ: label.location.z ?? 0,
    color: label.color ?? [0.92, 0.96, 1, 1],
    height: label.size,
    labelText: label.text,
    offsetX: -label.size * 0.4,
    offsetY: -label.size,
    planeBasisX: label.planeBasisX ? {...label.planeBasisX} : undefined,
    planeBasisY: label.planeBasisY ? {...label.planeBasisY} : undefined,
    u0: 0,
    u1: 1,
    v0: 0,
    v1: 1,
    width: label.size * 0.8,
    zoomLevel: label.zoomLevel,
    zoomRange: label.zoomRange,
  };
}

function projectScreenBasis(
  anchor: LabelDefinition['location'],
  basis: NonNullable<LabelDefinition['planeBasisX']>,
  projector: StageProjector,
  viewport: ViewportSize,
): ScreenPoint {
  const anchorPoint = projector.projectWorldPoint(anchor, viewport);
  const targetPoint = projector.projectWorldPoint(
    {
      x: anchor.x + basis.x,
      y: anchor.y + basis.y,
      z: (anchor.z ?? 0) + (basis.z ?? 0),
    },
    viewport,
  );

  return {
    x: targetPoint.x - anchorPoint.x,
    y: targetPoint.y - anchorPoint.y,
  };
}

function screenVectorAlignment(left: ScreenPoint, right: ScreenPoint): number {
  const normalizedLeft = normalizeScreenVector(left);
  const normalizedRight = normalizeScreenVector(right);

  return normalizedLeft.x * normalizedRight.x + normalizedLeft.y * normalizedRight.y;
}

function normalizeScreenVector(vector: ScreenPoint): ScreenPoint {
  const length = Math.hypot(vector.x, vector.y);

  if (length <= 0.0001) {
    return {x: 0, y: 0};
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function isObliqueScreenSegment(start: ScreenPoint, end: ScreenPoint): boolean {
  const deltaX = Math.abs(end.x - start.x);
  const deltaY = Math.abs(end.y - start.y);

  return deltaX > 0.01 && deltaY > 0.01;
}

function assertScreenPointClose(
  actual: ScreenPoint,
  expected: ScreenPoint,
  message: string,
): void {
  assert.ok(
    Math.abs(actual.x - expected.x) <= 0.0001 &&
      Math.abs(actual.y - expected.y) <= 0.0001,
    `${message} actual=(${actual.x}, ${actual.y}) expected=(${expected.x}, ${expected.y})`,
  );
}

function assertWorldBoundsClose(
  actual: ViewportBoundsLike,
  expected: ViewportBoundsLike,
  message: string,
): void {
  assert.ok(
    Math.abs(actual.minX - expected.minX) <= 0.0001 &&
      Math.abs(actual.maxX - expected.maxX) <= 0.0001 &&
      Math.abs(actual.minY - expected.minY) <= 0.0001 &&
      Math.abs(actual.maxY - expected.maxY) <= 0.0001,
    `${message} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
}

function assertSceneVectorClose(
  actual: {x: number; y: number; z: number},
  expected: {x: number; y: number; z: number},
  message: string,
): void {
  assert.ok(
    Math.abs(actual.x - expected.x) <= 0.0001 &&
      Math.abs(actual.y - expected.y) <= 0.0001 &&
      Math.abs(actual.z - expected.z) <= 0.0001,
    `${message} actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
  );
}

type ViewportBoundsLike = {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
};

function createDagTestDocument(options: {
  edges: WorkplaneDagEdgeState[];
  nodes: Array<{
    position: WorkplaneDagPosition;
    workplaneId: WorkplaneId;
  }>;
  rootWorkplaneId: WorkplaneId;
}): DagDocumentState {
  return {
    edges: options.edges.map((edge) => ({...edge})),
    nextWorkplaneNumber: options.nodes.length + 1,
    nodesById: Object.fromEntries(
      options.nodes.map(({position, workplaneId}) => [
        workplaneId,
        {
          labelTextOverrides: {},
          position: {...position},
          scene: createEmptyStageScene('dag-test', workplaneId),
          workplaneId,
        },
      ]),
    ) as DagDocumentState['nodesById'],
    rootWorkplaneId: options.rootWorkplaneId,
  };
}

function createDagDocumentFromStageState(
  state: StageSystemState,
): DagDocumentState {
  const dag = state.document.dag;

  if (!dag) {
    throw new Error('Expected a DAG stage state.');
  }

  return {
    edges: dag.edges.map((edge) => ({...edge})),
    nextWorkplaneNumber: state.document.nextWorkplaneNumber,
    nodesById: Object.fromEntries(
      Object.keys(dag.positionsById).map((workplaneId) => {
        const typedWorkplaneId = workplaneId as WorkplaneId;
        const workplane = state.document.workplanesById[typedWorkplaneId];

        return [
          typedWorkplaneId,
          {
            labelTextOverrides: {...workplane.labelTextOverrides},
            position: {...dag.positionsById[typedWorkplaneId]},
            scene: workplane.scene,
            workplaneId: typedWorkplaneId,
          },
        ];
      }),
    ) as DagDocumentState['nodesById'],
    rootWorkplaneId: dag.rootWorkplaneId,
  };
}

function createBrowserLogEntry(
  entry: Partial<BrowserLogEntry> & Pick<BrowserLogEntry, 'id' | 'level' | 'message' | 'source' | 'timestamp'>,
): BrowserLogEntry {
  return {
    route: 'app',
    sessionId: 'session-test',
    ...entry,
  };
}

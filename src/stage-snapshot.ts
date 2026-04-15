import type {CameraSnapshot} from './camera';
import type {GridStats} from './grid';
import type {LabelFocusedCameraAvailability} from './label-focused-camera';
import type {LineLayerStats, LineStrategy} from './line/types';
import type {FrameTelemetrySnapshot} from './perf';
import {
  type StageMode,
  type WorkplaneId,
} from './plane-stack';
import type {StageScene} from './scene-model';
import type {StackCameraState} from './stack-camera';
import type {LabelSetKind} from './stage-config';
import type {LabelNavigationNode} from './label-navigation';
import type {TextLayerStats, TextStrategy} from './text/types';
import type {StageEditorCursor} from './stage-editor';
import {
  LAYOUT_STRATEGY_OPTIONS,
  type LayoutStrategy,
} from './data/labels';
import {LINE_STRATEGY_OPTIONS} from './line/types';
import {TEXT_STRATEGY_OPTIONS} from './text/types';

export type StageSnapshot = {
  bodyDataset: Record<string, string>;
  statsRows: Array<{label: string; value: string}>;
  statsSignature: string;
};

export type OnboardingSnapshotState = {
  panelVisible: boolean;
  state: 'complete' | 'dismissed' | 'inactive' | 'running';
  stepCount: number;
  stepId: string;
  stepIndex: number;
};

export type DagSnapshotState = {
  activePosition: {column: number; layer: number; row: number} | null;
  canFocusRoot: boolean;
  canInsertParent: boolean;
  canMoveDepthIn: boolean;
  canMoveDepthOut: boolean;
  canMoveLaneDown: boolean;
  canMoveLaneUp: boolean;
  canMoveRankBackward: boolean;
  canMoveRankForward: boolean;
  canSpawnChild: boolean;
  edgeCount: number;
  fullWorkplaneCount: number;
  graphPointWorkplaneCount: number;
  labelPointWorkplaneCount: number;
  layoutFingerprint: string;
  nodeCount: number;
  rootWorkplaneId: string;
  titleOnlyWorkplaneCount: number;
  visibleEdgeCount: number;
  visibleWorkplaneCount: number;
};

const layoutFingerprintCache = new WeakMap<StageScene['labels'], string>();

export function createStageSnapshot(input: {
  activeLabelNode: LabelNavigationNode | null;
  activeWorkplaneIndex: number;
  activeWorkplaneId: WorkplaneId;
  cameraAnimating: boolean;
  cameraAvailability: LabelFocusedCameraAvailability;
  cameraSnapshot: CameraSnapshot;
  dag: DagSnapshotState | null;
  documentBridgeLinkCount: number;
  documentLabelCount: number;
  documentLinkCount: number;
  editorCursor: StageEditorCursor | null;
  editorSelectedLabelCount: number;
  editorSelectedLabelKeys: string[];
  gpuTimingEnabled: boolean;
  gridStats: GridStats | null | undefined;
  labelSetKind: LabelSetKind;
  labelTargetCount: number;
  layoutStrategy: LayoutStrategy;
  lineStats: LineLayerStats | null | undefined;
  lineStrategy: LineStrategy;
  onboarding: OnboardingSnapshotState;
  planeCount: number;
  perf: FrameTelemetrySnapshot | null | undefined;
  renderBridgeLinkCount: number;
  scene: StageScene;
  stackCamera: StackCameraState;
  stageMode: StageMode;
  strategyPanelMode: string;
  textStats: TextLayerStats | null | undefined;
  textStrategy: TextStrategy;
  workplaneCanDelete: boolean;
}): StageSnapshot {
  const {
    activeLabelNode,
    activeWorkplaneIndex,
    activeWorkplaneId,
    cameraAnimating,
    cameraAvailability,
    cameraSnapshot,
    dag,
    documentBridgeLinkCount,
    documentLabelCount,
    documentLinkCount,
    editorCursor,
    editorSelectedLabelCount,
    editorSelectedLabelKeys,
    gpuTimingEnabled,
    gridStats,
    labelSetKind,
    labelTargetCount,
    layoutStrategy,
    lineStats,
    lineStrategy,
    onboarding,
    planeCount,
    perf,
    renderBridgeLinkCount,
    scene,
    stackCamera,
    stageMode,
    strategyPanelMode,
    textStats,
    textStrategy,
    workplaneCanDelete,
  } = input;
  const lineCount = gridStats ? gridStats.verticalLines + gridStats.horizontalLines : 0;
  const minorSpacing = gridStats ? formatSpacing(gridStats.minorSpacing) : 'n/a';
  const majorSpacing = gridStats ? formatSpacing(gridStats.majorSpacing) : 'n/a';
  const labelCount = textStats ? textStats.labelCount : 0;
  const glyphCount = textStats ? textStats.glyphCount : 0;
  const activeLineStrategy = lineStats ? lineStats.lineStrategy : lineStrategy;
  const activeTextStrategy = textStats ? textStats.textStrategy : textStrategy;
  const activeLayoutStrategy = labelSetKind === 'demo' ? layoutStrategy : 'benchmark-static';
  const layoutStrategyLabel =
    labelSetKind === 'demo'
      ? getLayoutStrategyLabel(layoutStrategy)
      : 'Benchmark Static';
  const lineStrategyLabel = getLineStrategyLabel(activeLineStrategy);
  const textStrategyLabel = getTextStrategyLabel(activeTextStrategy);
  const lineLinkCount = lineStats ? lineStats.lineLinkCount : scene.links.length;
  const visibleLinkCount = lineStats ? lineStats.lineVisibleLinkCount : 0;
  const submittedLineVertexCount = lineStats ? lineStats.submittedVertexCount : 0;
  const bytesUploadedPerFrame = textStats ? textStats.bytesUploadedPerFrame : 0;
  const submittedGlyphCount = textStats ? textStats.submittedGlyphCount : 0;
  const submittedVertexCount = textStats ? textStats.submittedVertexCount : 0;
  const submittedTotalVertexCount = submittedVertexCount + submittedLineVertexCount;
  const visibleChunkCount = textStats ? textStats.visibleChunkCount : 0;
  const visibleLabelCount = textStats ? textStats.visibleLabelCount : 0;
  const visibleGlyphCount = textStats ? textStats.visibleGlyphCount : 0;
  const visibleLabels = textStats
    ? formatVisibleLabelSample(textStats.visibleLabels, textStats.visibleLabelCount)
    : '';
  const statsRows = createStatusRows({
    cameraSnapshot,
    gpuTimingEnabled,
    glyphCount,
    planeCount,
    perf,
    renderBridgeLinkCount,
    stageMode,
    submittedTotalVertexCount,
    visibleGlyphCount,
  });

  return {
    bodyDataset: {
      activeWorkplaneIndex: String(activeWorkplaneIndex),
      activeWorkplaneId,
      cameraCanMoveDown: String(cameraAvailability.canMoveDown),
      cameraCanMoveLeft: String(cameraAvailability.canMoveLeft),
      cameraCanMoveRight: String(cameraAvailability.canMoveRight),
      cameraCanMoveUp: String(cameraAvailability.canMoveUp),
      cameraCanReset: String(cameraAvailability.canReset),
      cameraCanZoomIn: String(cameraAvailability.canZoomIn),
      cameraCanZoomOut: String(cameraAvailability.canZoomOut),
      cameraAnimating: String(cameraAnimating),
      cameraCenterX: cameraSnapshot.centerX.toFixed(4),
      cameraCenterY: cameraSnapshot.centerY.toFixed(4),
      cameraColumn: activeLabelNode ? String(activeLabelNode.column) : '',
      cameraLabel: activeLabelNode?.key ?? '',
      cameraLayer: activeLabelNode ? String(activeLabelNode.layer) : '',
      cameraRow: activeLabelNode ? String(activeLabelNode.row) : '',
      cameraScale: cameraSnapshot.pixelsPerWorldUnit.toFixed(4),
      cameraZoom: cameraSnapshot.zoom.toFixed(4),
      dagActiveWorkplaneColumn: dag?.activePosition ? String(dag.activePosition.column) : '',
      dagActiveWorkplaneLayer: dag?.activePosition ? String(dag.activePosition.layer) : '',
      dagActiveWorkplaneRow: dag?.activePosition ? String(dag.activePosition.row) : '',
      dagCanFocusRoot: String(dag?.canFocusRoot ?? false),
      dagCanInsertParent: String(dag?.canInsertParent ?? false),
      dagCanMoveDepthIn: String(dag?.canMoveDepthIn ?? false),
      dagCanMoveDepthOut: String(dag?.canMoveDepthOut ?? false),
      dagCanMoveLaneDown: String(dag?.canMoveLaneDown ?? false),
      dagCanMoveLaneUp: String(dag?.canMoveLaneUp ?? false),
      dagCanMoveRankBackward: String(dag?.canMoveRankBackward ?? false),
      dagCanMoveRankForward: String(dag?.canMoveRankForward ?? false),
      dagCanSpawnChild: String(dag?.canSpawnChild ?? false),
      dagEdgeCount: String(dag?.edgeCount ?? 0),
      dagFullWorkplaneCount: String(dag?.fullWorkplaneCount ?? 0),
      dagGraphPointWorkplaneCount: String(dag?.graphPointWorkplaneCount ?? 0),
      dagLabelPointWorkplaneCount: String(dag?.labelPointWorkplaneCount ?? 0),
      dagLayoutFingerprint: dag?.layoutFingerprint ?? '',
      dagNodeCount: String(dag?.nodeCount ?? 0),
      dagRootWorkplaneId: dag?.rootWorkplaneId ?? '',
      dagTitleOnlyWorkplaneCount: String(dag?.titleOnlyWorkplaneCount ?? 0),
      dagVisibleEdgeCount: String(dag?.visibleEdgeCount ?? 0),
      dagVisibleWorkplaneCount: String(dag?.visibleWorkplaneCount ?? 0),
      documentBridgeLinkCount: String(documentBridgeLinkCount),
      documentLabelCount: String(documentLabelCount),
      documentLinkCount: String(documentLinkCount),
      editorCursorColumn: editorCursor ? String(editorCursor.column) : '',
      editorCursorKey: editorCursor?.key ?? '',
      editorCursorKind: editorCursor?.kind ?? '',
      editorCursorLayer: editorCursor ? String(editorCursor.layer) : '',
      editorCursorRow: editorCursor ? String(editorCursor.row) : '',
      editorSelectedLabelCount: String(editorSelectedLabelCount),
      editorSelectedLabelKeys: editorSelectedLabelKeys.join('|'),
      gridLineCount: String(lineCount),
      gridMajorSpacing: majorSpacing,
      gridMinorSpacing: minorSpacing,
      labelSetCount: String(scene.labels.length),
      labelSetKind,
      labelSetPreset: scene.labelSetPreset,
      labelTargetCount: String(labelTargetCount),
      layoutFingerprint: getLayoutFingerprint(scene.labels),
      layoutStrategy: activeLayoutStrategy,
      layoutStrategyLabel,
      lineCurveFingerprint: lineStats?.curveFingerprint ?? '0:0:0:0:0:0:0',
      lineDimmedLinkCount: String(lineStats?.lineDimmedLinkCount ?? 0),
      lineHighlightedInputLinkCount: String(lineStats?.lineHighlightedInputLinkCount ?? 0),
      lineHighlightedOutputLinkCount: String(lineStats?.lineHighlightedOutputLinkCount ?? 0),
      lineLinkCount: String(lineLinkCount),
      lineStrategy: activeLineStrategy,
      lineStrategyLabel,
      lineSubmittedVertexCount: String(submittedLineVertexCount),
      lineVisibleLinkCount: String(visibleLinkCount),
      onboardingPanelVisible: String(onboarding.panelVisible),
      onboardingState: onboarding.state,
      onboardingStepCount: String(onboarding.stepCount),
      onboardingStepId: onboarding.stepId,
      onboardingStepIndex: String(onboarding.stepIndex),
      perfCpuDrawAvgMs: perf ? perf.cpuDrawAvgMs.toFixed(3) : '0.000',
      perfCpuDrawLastMs: perf ? perf.cpuDrawLastMs.toFixed(3) : '0.000',
      perfCpuFrameAvgMs: perf ? perf.cpuFrameAvgMs.toFixed(3) : '0.000',
      perfCpuFrameLastMs: perf ? perf.cpuFrameLastMs.toFixed(3) : '0.000',
      perfCpuFrameMaxMs: perf ? perf.cpuFrameMaxMs.toFixed(3) : '0.000',
      perfCpuFrameSamples: String(perf?.cpuFrameSamples ?? 0),
      perfFrameGapAvgMs: perf ? perf.frameGapAvgMs.toFixed(3) : '0.000',
      perfFrameGapLastMs: perf ? perf.frameGapLastMs.toFixed(3) : '0.000',
      perfFrameGapMaxMs: perf ? perf.frameGapMaxMs.toFixed(3) : '0.000',
      perfFrameGapSamples: String(perf?.frameGapSamples ?? 0),
      perfCpuGridAvgMs: perf ? perf.cpuGridAvgMs.toFixed(3) : '0.000',
      perfCpuGridLastMs: perf ? perf.cpuGridLastMs.toFixed(3) : '0.000',
      perfCpuLineAvgMs: perf ? perf.cpuLineAvgMs.toFixed(3) : '0.000',
      perfCpuLineLastMs: perf ? perf.cpuLineLastMs.toFixed(3) : '0.000',
      perfCpuTextAvgMs: perf ? perf.cpuTextAvgMs.toFixed(3) : '0.000',
      perfCpuTextLastMs: perf ? perf.cpuTextLastMs.toFixed(3) : '0.000',
      perfBuffersActive: String(perf?.buffersActive ?? 0),
      perfBufferMemoryBytes: String(perf?.bufferMemoryBytes ?? 0),
      perfGpuError: perf?.gpuError ?? '',
      perfGpuFrameAvgMs:
        !gpuTimingEnabled
          ? 'disabled'
          : perf?.gpuFrameAvgMs === null || perf?.gpuFrameAvgMs === undefined
          ? 'unsupported'
          : perf.gpuFrameAvgMs.toFixed(3),
      perfGpuFrameLastMs:
        !gpuTimingEnabled
          ? 'disabled'
          : perf?.gpuFrameLastMs === null || perf?.gpuFrameLastMs === undefined
          ? 'unsupported'
          : perf.gpuFrameLastMs.toFixed(3),
      perfGpuFrameSamples: String(perf?.gpuFrameSamples ?? 0),
      perfGpuMemoryBytes: String(perf?.gpuMemoryBytes ?? 0),
      perfGpuSupported: String(perf?.gpuSupported ?? false),
      perfGpuTextAvgMs:
        !gpuTimingEnabled
          ? 'disabled'
          : perf?.gpuTextAvgMs === null || perf?.gpuTextAvgMs === undefined
          ? 'unsupported'
          : perf.gpuTextAvgMs.toFixed(3),
      perfGpuTextLastMs:
        !gpuTimingEnabled
          ? 'disabled'
          : perf?.gpuTextLastMs === null || perf?.gpuTextLastMs === undefined
          ? 'unsupported'
          : perf.gpuTextLastMs.toFixed(3),
      planeCount: String(planeCount),
      perfResourcesActive: String(perf?.resourcesActive ?? 0),
      perfTexturesActive: String(perf?.texturesActive ?? 0),
      perfTextureMemoryBytes: String(perf?.textureMemoryBytes ?? 0),
      renderBridgeLinkCount: String(renderBridgeLinkCount),
      stageMode,
      stackCameraAzimuth: stackCamera.azimuthRadians.toFixed(4),
      stackCameraDistanceScale: stackCamera.distanceScale.toFixed(4),
      stackCameraElevation: stackCamera.elevationRadians.toFixed(4),
      strategyPanelMode,
      textBytesUploadedPerFrame: String(bytesUploadedPerFrame),
      textGlyphCount: String(glyphCount),
      textLabelCount: String(labelCount),
      textStrategy: activeTextStrategy,
      textStrategyLabel,
      textSubmittedGlyphCount: String(submittedGlyphCount),
      textSubmittedVertexCount: String(submittedVertexCount),
      textVisibleChunkCount: String(visibleChunkCount),
      textVisibleGlyphCount: String(visibleGlyphCount),
      textVisibleLabelCount: String(visibleLabelCount),
      textVisibleLabels: visibleLabels,
      workplaneCanDelete: String(workplaneCanDelete),
    },
    statsRows,
    statsSignature: statsRows.map(({label, value}) => `${label}:${value}`).join('|'),
  };
}

export function writeStageSnapshot(snapshot: StageSnapshot): void {
  for (const [key, value] of Object.entries(snapshot.bodyDataset)) {
    if (document.body.dataset[key] !== value) {
      document.body.dataset[key] = value;
    }
  }
}

function formatMemorySummary(perf: FrameTelemetrySnapshot): string {
  return [
    `mem ${formatBytes(perf.gpuMemoryBytes)} gpu`,
    `${formatBytes(perf.bufferMemoryBytes)} buf`,
    `${formatBytes(perf.textureMemoryBytes)} tex`,
    `${perf.resourcesActive} res`,
  ].join(' / ');
}

function createStatusRows(input: {
  cameraSnapshot: CameraSnapshot;
  glyphCount: number;
  gpuTimingEnabled: boolean;
  planeCount: number;
  perf: FrameTelemetrySnapshot | null | undefined;
  renderBridgeLinkCount: number;
  stageMode: StageMode;
  submittedTotalVertexCount: number;
  visibleGlyphCount: number;
}): Array<{label: string; value: string}> {
  const {
    cameraSnapshot,
    glyphCount,
    gpuTimingEnabled,
    planeCount,
    perf,
    renderBridgeLinkCount,
    stageMode,
    submittedTotalVertexCount,
    visibleGlyphCount,
  } = input;

  return [
    {
      label: 'View',
      value:
        stageMode === '3d-mode'
          ? `${planeCount} planes / ${renderBridgeLinkCount} bridges`
          : `${cameraSnapshot.centerX.toFixed(2)}, ${cameraSnapshot.centerY.toFixed(2)} / zoom ${cameraSnapshot.zoom.toFixed(2)}`,
    },
    {
      label: 'Glyphs',
      value: `${visibleGlyphCount} / ${glyphCount} / ${submittedTotalVertexCount} vertices`,
    },
    {
      label: 'CPU',
      value: perf ? formatCpuSummary(perf) : '0.00 ms frame / 0.00 ms text',
    },
    {
      label: 'GPU',
      value: `${perf ? formatGpuSummary(perf, gpuTimingEnabled) : 'pending'} / ${
        perf ? formatMemorySummary(perf) : '0 B gpu / 0 B buf / 0 B tex / 0 res'
      }`,
    },
  ];
}

function formatCpuSummary(perf: FrameTelemetrySnapshot): string {
  return `${formatMs(perf.cpuFrameAvgMs)} frame / ${formatMs(perf.cpuTextAvgMs)} text`;
}

function formatGpuSummary(perf: FrameTelemetrySnapshot, gpuTimingEnabled: boolean): string {
  if (!gpuTimingEnabled) {
    return 'disabled';
  }

  if (perf.gpuError) {
    return `error ${perf.gpuError}`;
  }

  if (!perf.gpuSupported) {
    return 'unsupported';
  }

  if (perf.gpuFrameSamples === 0 || perf.gpuFrameAvgMs === null) {
    return 'pending';
  }

  if (perf.gpuTextAvgMs === null) {
    return `${formatMs(perf.gpuFrameAvgMs)} frame`;
  }

  return `${formatMs(perf.gpuFrameAvgMs)} frame / ${formatMs(perf.gpuTextAvgMs)} text`;
}

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${Math.round(value)} B`;
}

function formatSpacing(value: number): string {
  if (value >= 1) {
    return value.toFixed(2);
  }

  return value.toPrecision(2);
}

function formatVisibleLabelSample(visibleLabels: string[], visibleLabelCount: number): string {
  if (visibleLabels.length === 0) {
    return '';
  }

  const suffix =
    visibleLabelCount > visibleLabels.length
      ? `|...(+${visibleLabelCount - visibleLabels.length} more)`
      : '';

  return `${visibleLabels.join('|')}${suffix}`;
}

function getLayoutFingerprint(labels: StageScene['labels']): string {
  const cachedFingerprint = layoutFingerprintCache.get(labels);

  if (cachedFingerprint !== undefined) {
    return cachedFingerprint;
  }

  let weightedX = 0;
  let weightedY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  labels.forEach((label, index) => {
    const weight = index + 1;
    weightedX += label.location.x * weight;
    weightedY += label.location.y * weight;
    minX = Math.min(minX, label.location.x);
    maxX = Math.max(maxX, label.location.x);
    minY = Math.min(minY, label.location.y);
    maxY = Math.max(maxY, label.location.y);
  });

  const fingerprint = [
    labels.length,
    weightedX.toFixed(3),
    weightedY.toFixed(3),
    minX.toFixed(3),
    maxX.toFixed(3),
    minY.toFixed(3),
    maxY.toFixed(3),
  ].join(':');

  layoutFingerprintCache.set(labels, fingerprint);

  return fingerprint;
}

function getTextStrategyLabel(textStrategy: TextStrategy): string {
  return (
    TEXT_STRATEGY_OPTIONS.find((option) => option.mode === textStrategy)?.label ?? textStrategy
  );
}

function getLineStrategyLabel(lineStrategy: LineStrategy): string {
  return (
    LINE_STRATEGY_OPTIONS.find((option) => option.mode === lineStrategy)?.label ?? lineStrategy
  );
}

function getLayoutStrategyLabel(layoutStrategy: LayoutStrategy): string {
  return (
    LAYOUT_STRATEGY_OPTIONS.find((option) => option.mode === layoutStrategy)?.label ?? layoutStrategy
  );
}

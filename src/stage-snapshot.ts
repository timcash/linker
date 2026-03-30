import type {CameraSnapshot} from './camera';
import type {GridStats} from './grid';
import type {LabelFocusedCameraAvailability} from './label-focused-camera';
import type {LineLayerStats, LineStrategy} from './line/types';
import type {FrameTelemetrySnapshot} from './perf';
import type {StageScene} from './scene-model';
import type {LabelSetKind} from './stage-config';
import type {LabelNavigationNode} from './label-navigation';
import type {TextLayerStats, TextStrategy} from './text/types';
import {
  LAYOUT_STRATEGY_OPTIONS,
  type LayoutStrategy,
} from './data/labels';
import {LINE_STRATEGY_OPTIONS} from './line/types';
import {TEXT_STRATEGY_OPTIONS} from './text/types';

export type StageSnapshot = {
  bodyDataset: Record<string, string>;
  statsText: string;
};

export function createStageSnapshot(input: {
  activeLabelNode: LabelNavigationNode | null;
  cameraAnimating: boolean;
  cameraAvailability: LabelFocusedCameraAvailability;
  cameraSnapshot: CameraSnapshot;
  gpuTimingEnabled: boolean;
  gridStats: GridStats | null | undefined;
  labelSetKind: LabelSetKind;
  labelTargetCount: number;
  layoutStrategy: LayoutStrategy;
  lineStats: LineLayerStats | null | undefined;
  lineStrategy: LineStrategy;
  perf: FrameTelemetrySnapshot | null | undefined;
  scene: StageScene;
  strategyPanelMode: string;
  textStats: TextLayerStats | null | undefined;
  textStrategy: TextStrategy;
}): StageSnapshot {
  const {
    activeLabelNode,
    cameraAnimating,
    cameraAvailability,
    cameraSnapshot,
    gpuTimingEnabled,
    gridStats,
    labelSetKind,
    labelTargetCount,
    layoutStrategy,
    lineStats,
    lineStrategy,
    perf,
    scene,
    strategyPanelMode,
    textStats,
    textStrategy,
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

  return {
    bodyDataset: {
      cameraCanMoveDown: String(cameraAvailability.canMoveDown),
      cameraCanMoveLeft: String(cameraAvailability.canMoveLeft),
      cameraCanMoveRight: String(cameraAvailability.canMoveRight),
      cameraCanMoveUp: String(cameraAvailability.canMoveUp),
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
      perfCpuDrawAvgMs: perf ? perf.cpuDrawAvgMs.toFixed(3) : '0.000',
      perfCpuFrameAvgMs: perf ? perf.cpuFrameAvgMs.toFixed(3) : '0.000',
      perfCpuFrameMaxMs: perf ? perf.cpuFrameMaxMs.toFixed(3) : '0.000',
      perfCpuFrameSamples: String(perf?.cpuFrameSamples ?? 0),
      perfCpuGridAvgMs: perf ? perf.cpuGridAvgMs.toFixed(3) : '0.000',
      perfCpuTextAvgMs: perf ? perf.cpuTextAvgMs.toFixed(3) : '0.000',
      perfBuffersActive: String(perf?.buffersActive ?? 0),
      perfBufferMemoryBytes: String(perf?.bufferMemoryBytes ?? 0),
      perfGpuError: perf?.gpuError ?? '',
      perfGpuFrameAvgMs:
        !gpuTimingEnabled
          ? 'disabled'
          : perf?.gpuFrameAvgMs === null || perf?.gpuFrameAvgMs === undefined
          ? 'unsupported'
          : perf.gpuFrameAvgMs.toFixed(3),
      perfGpuFrameSamples: String(perf?.gpuFrameSamples ?? 0),
      perfGpuMemoryBytes: String(perf?.gpuMemoryBytes ?? 0),
      perfGpuSupported: String(perf?.gpuSupported ?? false),
      perfGpuTextAvgMs:
        !gpuTimingEnabled
          ? 'disabled'
          : perf?.gpuTextAvgMs === null || perf?.gpuTextAvgMs === undefined
          ? 'unsupported'
          : perf.gpuTextAvgMs.toFixed(3),
      perfResourcesActive: String(perf?.resourcesActive ?? 0),
      perfTexturesActive: String(perf?.texturesActive ?? 0),
      perfTextureMemoryBytes: String(perf?.textureMemoryBytes ?? 0),
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
    },
    statsText: [
      activeLabelNode ? `label ${activeLabelNode.key}` : null,
      `center ${cameraSnapshot.centerX.toFixed(2)}, ${cameraSnapshot.centerY.toFixed(2)}`,
      `zoom ${cameraSnapshot.zoom.toFixed(2)}`,
      textStats
        ? `glyphs ${visibleGlyphCount} visible / ${glyphCount} total`
        : 'glyphs 0 visible / 0 total',
      `vertices ${submittedTotalVertexCount}`,
      perf ? formatMemorySummary(perf) : null,
      perf ? formatPerfSummary(perf, gpuTimingEnabled) : 'cpu 0.00 ms / gpu pending',
    ].filter(Boolean).join('  |  '),
  };
}

export function writeStageSnapshot(snapshot: StageSnapshot): void {
  for (const [key, value] of Object.entries(snapshot.bodyDataset)) {
    document.body.dataset[key] = value;
  }
}

function formatPerfSummary(perf: FrameTelemetrySnapshot, gpuTimingEnabled: boolean): string {
  const cpuFrame = formatMs(perf.cpuFrameAvgMs);
  const cpuText = formatMs(perf.cpuTextAvgMs);
  const gpuSummary =
    !gpuTimingEnabled
      ? 'gpu disabled'
      : perf.gpuError
      ? `gpu error ${perf.gpuError}`
      : !perf.gpuSupported
      ? 'gpu unsupported'
      : perf.gpuFrameSamples === 0 || perf.gpuFrameAvgMs === null
      ? 'gpu pending'
      : perf.gpuTextAvgMs === null
      ? `gpu ${formatMs(perf.gpuFrameAvgMs)} frame`
      : `gpu ${formatMs(perf.gpuFrameAvgMs)} frame / ${formatMs(perf.gpuTextAvgMs)} text`;

  return `cpu ${cpuFrame} frame / ${cpuText} text / ${gpuSummary}`;
}

function formatMemorySummary(perf: FrameTelemetrySnapshot): string {
  return [
    `mem ${formatBytes(perf.gpuMemoryBytes)} gpu`,
    `${formatBytes(perf.bufferMemoryBytes)} buf`,
    `${formatBytes(perf.textureMemoryBytes)} tex`,
    `${perf.resourcesActive} res`,
  ].join(' / ');
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

  return [
    labels.length,
    weightedX.toFixed(3),
    weightedY.toFixed(3),
    minX.toFixed(3),
    maxX.toFixed(3),
    minY.toFixed(3),
    maxY.toFixed(3),
  ].join(':');
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

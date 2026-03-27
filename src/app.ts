import {luma, type Device} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {webgpuAdapter} from '@luma.gl/webgpu';

import {Camera2D, type CameraSnapshot, type ViewportSize} from './camera';
import {getDemoLinks} from './data/links';
import {DEMO_LABEL_SET_ID} from './data/demo-meta';
import {
  DEFAULT_LAYOUT_STRATEGY,
  DEMO_LABELS,
  LAYOUT_STRATEGIES,
  LAYOUT_STRATEGY_OPTIONS,
  getDemoLabels,
  type LayoutStrategy,
} from './data/labels';
import {
  DEFAULT_BENCHMARK_LABEL_COUNT,
  STATIC_BENCHMARK_LABEL_SET_ID,
  getStaticBenchmarkLabels,
} from './data/static-benchmark';
import {GridLayer} from './grid';
import {LineLayer} from './line/layer';
import {
  DEFAULT_LINE_STRATEGY,
  LINE_STRATEGIES,
  LINE_STRATEGY_OPTIONS,
  type LinkDefinition,
  type LineStrategy,
} from './line/types';
import {FrameTelemetry, type FrameTelemetrySnapshot} from './perf';
import {TextLayer} from './text/layer';
import {
  DEFAULT_TEXT_STRATEGY,
  TEXT_STRATEGIES,
  TEXT_STRATEGY_OPTIONS,
  type LabelDefinition,
  type TextStrategy,
} from './text/types';

const STAGE_SHADER = /* wgsl */ `
struct VertexInputs {
  @location(0) position: vec2<f32>,
  @location(1) uv: vec2<f32>
}

struct FragmentInputs {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) position: vec2<f32>
}

@vertex
fn vertexMain(inputs: VertexInputs) -> FragmentInputs {
  var outputs: FragmentInputs;
  outputs.clipPosition = vec4<f32>(inputs.position, 0.0, 1.0);
  outputs.uv = inputs.uv;
  outputs.position = inputs.position;
  return outputs;
}

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4<f32> {
  let vignette = smoothstep(1.45, 0.18, length(inputs.position));

  let base = vec3<f32>(0.015, 0.026, 0.06);
  let wash = vec3<f32>(0.012, 0.055, 0.11) * (1.0 - inputs.uv.y * 0.9);

  return vec4<f32>((base + wash) * vignette, 1.0);
}
`;

const QUAD_POSITIONS = new Float32Array([
  -1, -1,
   1, -1,
  -1,  1,
   1,  1,
]);

const QUAD_UVS = new Float32Array([
  0, 0,
  1, 0,
  0, 1,
  1, 1,
]);

const DEFAULT_BENCHMARK_TRACE_STEP_COUNT = 8;
const BENCHMARK_CAMERA_TRACE: ControlAction[] = [
  'zoom-out',
  'zoom-out',
  'pan-right',
  'pan-up',
  'zoom-in',
  'zoom-in',
  'pan-left',
  'pan-down',
];

type AppState = 'loading' | 'ready' | 'unsupported' | 'error';
type StrategyPanelMode = 'text' | 'line' | 'layout';

type ControlAction =
  | 'pan-up'
  | 'pan-down'
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-camera';

type LabelSetKind = 'demo' | 'benchmark';

type StageConfig = {
  benchmarkTraceStepCount: number;
  benchmarkEnabled: boolean;
  gpuTimingEnabled: boolean;
  initialCamera: CameraView;
  labelSetKind: LabelSetKind;
  labelSetPreset: string;
  layoutStrategy: LayoutStrategy;
  labelTargetCount: number;
  labels: LabelDefinition[];
  lineStrategy: LineStrategy;
  links: LinkDefinition[];
  textStrategy: TextStrategy;
};

type CameraView = Pick<CameraSnapshot, 'centerX' | 'centerY' | 'zoom'>;

type StageBenchmarkSummary = {
  bytesUploadedPerFrame: number;
  cpuDrawAvgMs: number;
  cpuFrameAvgMs: number;
  cpuFrameSamples: number;
  cpuTextAvgMs: number;
  glyphCount: number;
  gpuFrameAvgMs: number | null;
  gpuFrameSamples: number;
  gpuTextAvgMs: number | null;
  gpuSupported: boolean;
  labelCount: number;
  textStrategy: TextStrategy;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
};

type StageChromeElements = {
  cameraPanel: HTMLElement;
  canvas: HTMLCanvasElement;
  launchBanner: HTMLDivElement;
  renderPanel: HTMLElement;
  stage: HTMLDivElement;
  statusPanel: HTMLElement;
  stats: HTMLParagraphElement;
  strategyModePanel: HTMLElement;
};

export type AppHandle = {
  destroy: () => void;
};

export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const stageChrome = createStageChrome(root);
  const config = readStageConfig(window.location.search);
  const stageController = new LumaStageController(stageChrome, config);

  await stageController.start();

  return {
    destroy: () => stageController.destroy(),
  };
}

class LumaStageController {
  private device: Device | null = null;
  private frameId = 0;
  private backgroundModel: Model | null = null;
  private benchmarkStarted = false;
  private benchmarkSummary: StageBenchmarkSummary | null = null;
  private frameTelemetry: FrameTelemetry | null = null;
  private gridLayer: GridLayer | null = null;
  private lineLayer: LineLayer | null = null;
  private textLayer: TextLayer | null = null;
  private readonly camera = new Camera2D();
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly layoutStrategyButtons: HTMLButtonElement[] = [];
  private readonly lineStrategyButtons: HTMLButtonElement[] = [];
  private readonly strategyModeButtons: HTMLButtonElement[] = [];
  private readonly textStrategyButtons: HTMLButtonElement[] = [];
  private destroyed = false;
  private layoutStrategy: LayoutStrategy;
  private lineStrategy: LineStrategy;
  private strategyPanelMode: StrategyPanelMode = 'text';
  private textStrategy: TextStrategy;

  constructor(
    private readonly chrome: StageChromeElements,
    private readonly config: StageConfig,
  ) {
    this.layoutStrategy = config.layoutStrategy;
    this.lineStrategy = config.lineStrategy;
    this.textStrategy = config.textStrategy;
    this.camera.setView(
      config.initialCamera.centerX,
      config.initialCamera.centerY,
      config.initialCamera.zoom,
    );
  }

  async start(): Promise<void> {
    this.setState('loading');
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';

    if (!('gpu' in navigator) || !navigator.gpu) {
      this.showUnsupported(
        'WebGPU is unavailable in this browser. Use a current Chromium-based browser with WebGPU enabled.',
      );
      return;
    }

    try {
      this.device = await luma.createDevice({
        id: 'linker-luma-stage',
        type: 'webgpu',
        adapters: [webgpuAdapter],
        createCanvasContext: {
          canvas: this.chrome.canvas,
          alphaMode: 'opaque',
          autoResize: true,
          useDevicePixels: true,
        },
      });

      if (this.destroyed) {
        this.device.destroy();
        return;
      }

      this.frameTelemetry = new FrameTelemetry(this.device, {
        enableGpuTimestamps: this.config.gpuTimingEnabled,
      });
      this.backgroundModel = new Model(this.device, {
        id: 'luma-stage-background',
        source: STAGE_SHADER,
        geometry: new Geometry({
          topology: 'triangle-strip',
          vertexCount: 4,
          attributes: {
            position: {
              size: 2,
              value: QUAD_POSITIONS,
            },
            uv: {
              size: 2,
              value: QUAD_UVS,
            },
          },
        }),
        vertexCount: 4,
        parameters: {
          depthWriteEnabled: false,
        },
      });

      this.gridLayer = new GridLayer(this.device);
      this.lineLayer = new LineLayer(this.device, this.config.links, this.lineStrategy);
      this.textLayer = new TextLayer(this.device, this.config.labels, this.textStrategy);
      await this.textLayer.ready;
      this.installInteractionHandlers();
      this.updateTextStrategyButtons();
      this.updateLineStrategyButtons();
      this.updateLayoutStrategyButtons();
      this.updateStrategyModeButtons();
      this.updateStrategyPanel();
      this.chrome.launchBanner.hidden = true;
      this.chrome.canvas.hidden = false;
      this.setState('ready');
      syncCameraQueryParams(this.camera.getSnapshot());
      this.updateStatus();
      this.render();

      if (this.config.benchmarkEnabled) {
        void this.runBenchmark();
      }
    } catch (error) {
      if (isWebGPUUnavailableError(error)) {
        this.showUnsupported(error.message);
        return;
      }

      this.showError(error);
    }
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    this.removeInteractionHandlers();
    this.backgroundModel?.destroy();
    this.gridLayer?.destroy();
    this.lineLayer?.destroy();
    this.textLayer?.destroy();
    this.frameTelemetry?.destroy();
    this.device?.destroy();
    this.chrome.stage.remove();
  }

  private render = (): void => {
    if (
      this.destroyed ||
      !this.device ||
      !this.backgroundModel ||
      !this.gridLayer ||
      !this.lineLayer ||
      !this.textLayer
    ) {
      return;
    }

    try {
      const frameStartedAt = performance.now();
      const viewport = this.getViewportSize();

      const gridStartedAt = performance.now();
      this.gridLayer.update(this.camera, viewport);
      const gridCpuMs = performance.now() - gridStartedAt;

      this.lineLayer.update(this.camera, viewport);

      const textStartedAt = performance.now();
      this.textLayer.update(this.camera, viewport);
      const textCpuMs = performance.now() - textStartedAt;

      const drawStartedAt = performance.now();
      const framebuffer = this.device
        .getDefaultCanvasContext()
        .getCurrentFramebuffer({depthStencilFormat: false});
      const frameTimingProps = this.frameTelemetry?.getRenderPassTimingProps() ?? {};
      const splitTextGpuPass = frameTimingProps.timestampQuerySet !== undefined;

      const renderPass = this.device.beginRenderPass({
        id: 'luma-stage-pass',
        framebuffer,
        clearColor: [0.01, 0.02, 0.04, 1],
        ...frameTimingProps,
      });

      this.backgroundModel.draw(renderPass);
      this.gridLayer.draw(renderPass);
      this.lineLayer.draw(renderPass);

      if (!splitTextGpuPass) {
        this.textLayer.draw(renderPass);
      }

      renderPass.end();

      if (splitTextGpuPass) {
        const textRenderPass = this.device.beginRenderPass({
          id: 'luma-stage-text-pass',
          framebuffer,
          clearColor: false,
          ...this.frameTelemetry?.getTextRenderPassTimingProps(),
        });

        this.textLayer.draw(textRenderPass);
        textRenderPass.end();
      }

      this.frameTelemetry?.resolveGpuPass();
      this.device.submit();
      this.frameTelemetry?.submitGpuPass();
      const drawCpuMs = performance.now() - drawStartedAt;

      this.frameTelemetry?.recordCpuGrid(gridCpuMs);
      this.frameTelemetry?.recordCpuText(textCpuMs);
      this.frameTelemetry?.recordCpuDraw(drawCpuMs);
      this.frameTelemetry?.recordCpuFrame(performance.now() - frameStartedAt);
      this.updateStatus();

      this.frameId = window.requestAnimationFrame(this.render);
    } catch (error) {
      this.showError(error);
    }
  };

  private applyControlAction(action: string): void {
    const viewport = this.getViewportSize();
    const panX = viewport.width * 0.16;
    const panY = viewport.height * 0.16;
    let cameraChanged = true;

    switch (action) {
      case 'pan-up':
        this.camera.panByPixels(0, panY);
        break;
      case 'pan-down':
        this.camera.panByPixels(0, -panY);
        break;
      case 'pan-left':
        this.camera.panByPixels(panX, 0);
        break;
      case 'pan-right':
        this.camera.panByPixels(-panX, 0);
        break;
      case 'zoom-in':
        this.camera.zoomAtScreenPoint(-160, getViewportCenter(viewport), viewport);
        break;
      case 'zoom-out':
        this.camera.zoomAtScreenPoint(160, getViewportCenter(viewport), viewport);
        break;
      case 'reset-camera':
        this.camera.reset();
        break;
      default:
        cameraChanged = false;
        break;
    }

    if (cameraChanged) {
      syncCameraQueryParams(this.camera.getSnapshot());
    }
  }

  private getViewportSize(): ViewportSize {
    const rect = this.chrome.canvas.getBoundingClientRect();

    return {
      width: rect.width || window.innerWidth,
      height: rect.height || window.innerHeight,
    };
  }

  private handleActionButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.control;

    if (action) {
      this.applyControlAction(action);
    }
  };

  private handleStrategyButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const textStrategy = button.dataset.textStrategy;

    if (isTextStrategy(textStrategy)) {
      this.setTextStrategy(textStrategy);
    }
  };

  private handleLineStrategyButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const lineStrategy = button.dataset.lineStrategy;

    if (isLineStrategy(lineStrategy)) {
      this.setLineStrategy(lineStrategy);
    }
  };

  private handleLayoutStrategyButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const layoutStrategy = button.dataset.layoutStrategy;

    if (isLayoutStrategy(layoutStrategy)) {
      this.setLayoutStrategy(layoutStrategy);
    }
  };

  private handleStrategyModeButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const mode = button.dataset.strategyPanelMode;

    if (mode === 'text' || mode === 'line' || mode === 'layout') {
      this.setStrategyPanelMode(mode);
    }
  };

  private setTextStrategy(mode: TextStrategy): void {
    if (!this.textLayer || mode === this.textStrategy || document.body.dataset.benchmarkState === 'running') {
      return;
    }

    this.textStrategy = mode;
    this.textLayer.setMode(mode);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    syncTextStrategyQueryParam(mode);
    this.updateTextStrategyButtons();
    this.updateStatus();
  }

  private setLineStrategy(mode: LineStrategy): void {
    if (
      !this.lineLayer ||
      this.config.labelSetKind !== 'demo' ||
      mode === this.lineStrategy ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    this.lineStrategy = mode;
    this.lineLayer.setMode(mode);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    syncLineStrategyQueryParam(mode);
    this.updateLineStrategyButtons();
    this.updateStatus();
  }

  private setLayoutStrategy(mode: LayoutStrategy): void {
    if (
      !this.textLayer ||
      !this.lineLayer ||
      this.config.labelSetKind !== 'demo' ||
      mode === this.layoutStrategy ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    this.layoutStrategy = mode;
    this.config.labels = getDemoLabels(mode);
    this.config.links = getDemoLinks(mode);
    this.lineLayer.setLinks(this.config.links);
    this.textLayer.setLayoutLabels(this.config.labels);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    syncLayoutStrategyQueryParam(mode);
    this.updateLayoutStrategyButtons();
    this.updateStatus();
  }

  private setStrategyPanelMode(mode: StrategyPanelMode): void {
    if ((mode === 'layout' || mode === 'line') && this.config.labelSetKind !== 'demo') {
      return;
    }

    if (mode === this.strategyPanelMode) {
      return;
    }

    this.strategyPanelMode = mode;
    this.updateStrategyModeButtons();
    this.updateStrategyPanel();
    this.updateStatus();
  }

  private updateTextStrategyButtons(): void {
    const buttons = this.chrome.renderPanel.querySelectorAll<HTMLButtonElement>('[data-text-strategy]');

    for (const button of buttons) {
      const isActive = button.dataset.textStrategy === this.textStrategy;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private updateLineStrategyButtons(): void {
    const buttons = this.chrome.renderPanel.querySelectorAll<HTMLButtonElement>('[data-line-strategy]');

    for (const button of buttons) {
      const isActive = button.dataset.lineStrategy === this.lineStrategy;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private updateLayoutStrategyButtons(): void {
    const buttons = this.chrome.renderPanel.querySelectorAll<HTMLButtonElement>('[data-layout-strategy]');

    for (const button of buttons) {
      const isActive = button.dataset.layoutStrategy === this.layoutStrategy;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private updateStrategyModeButtons(): void {
    const buttons =
      this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-strategy-panel-mode]');

    for (const button of buttons) {
      const mode = button.dataset.strategyPanelMode;
      const requiresDemoLabelSet = mode === 'layout' || mode === 'line';
      const isDisabled = requiresDemoLabelSet && this.config.labelSetKind !== 'demo';
      const isActive = mode === this.strategyPanelMode;

      button.disabled = isDisabled;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private updateStrategyPanel(): void {
    const textStrategyPanel = this.chrome.renderPanel.querySelector<HTMLElement>(
      '[data-testid="text-strategy-panel"]',
    );
    const lineStrategyPanel = this.chrome.renderPanel.querySelector<HTMLElement>(
      '[data-testid="line-strategy-panel"]',
    );
    const layoutStrategyPanel = this.chrome.renderPanel.querySelector<HTMLElement>(
      '[data-testid="layout-strategy-panel"]',
    );
    const panelLabel = this.chrome.renderPanel.querySelector<HTMLElement>(
      '[data-testid="strategy-panel-label"]',
    );

    if (panelLabel) {
      panelLabel.textContent =
        this.strategyPanelMode === 'layout'
          ? 'Layout Strategy'
          : this.strategyPanelMode === 'line'
          ? 'Line Strategy'
          : 'Text Strategy';
    }

    if (textStrategyPanel) {
      textStrategyPanel.hidden = this.strategyPanelMode !== 'text';
    }

    if (lineStrategyPanel) {
      lineStrategyPanel.hidden =
        this.strategyPanelMode !== 'line' || this.config.labelSetKind !== 'demo';
    }

    if (layoutStrategyPanel) {
      layoutStrategyPanel.hidden =
        this.strategyPanelMode !== 'layout' || this.config.labelSetKind !== 'demo';
    }
  }

  private installInteractionHandlers(): void {
    this.actionButtons.push(
      ...this.chrome.cameraPanel.querySelectorAll<HTMLButtonElement>('[data-control]'),
    );
    this.textStrategyButtons.push(
      ...this.chrome.renderPanel.querySelectorAll<HTMLButtonElement>('[data-text-strategy]'),
    );
    this.lineStrategyButtons.push(
      ...this.chrome.renderPanel.querySelectorAll<HTMLButtonElement>('[data-line-strategy]'),
    );
    this.layoutStrategyButtons.push(
      ...this.chrome.renderPanel.querySelectorAll<HTMLButtonElement>('[data-layout-strategy]'),
    );
    this.strategyModeButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-strategy-panel-mode]'),
    );

    for (const button of this.actionButtons) {
      button.addEventListener('click', this.handleActionButtonClick);
    }

    for (const button of this.textStrategyButtons) {
      button.addEventListener('click', this.handleStrategyButtonClick);
    }

    for (const button of this.lineStrategyButtons) {
      button.addEventListener('click', this.handleLineStrategyButtonClick);
    }

    for (const button of this.layoutStrategyButtons) {
      button.addEventListener('click', this.handleLayoutStrategyButtonClick);
    }

    for (const button of this.strategyModeButtons) {
      button.addEventListener('click', this.handleStrategyModeButtonClick);
    }
  }

  private removeInteractionHandlers(): void {
    for (const button of this.actionButtons) {
      button.removeEventListener('click', this.handleActionButtonClick);
    }

    for (const button of this.textStrategyButtons) {
      button.removeEventListener('click', this.handleStrategyButtonClick);
    }

    for (const button of this.lineStrategyButtons) {
      button.removeEventListener('click', this.handleLineStrategyButtonClick);
    }

    for (const button of this.layoutStrategyButtons) {
      button.removeEventListener('click', this.handleLayoutStrategyButtonClick);
    }

    for (const button of this.strategyModeButtons) {
      button.removeEventListener('click', this.handleStrategyModeButtonClick);
    }

    this.actionButtons.length = 0;
    this.textStrategyButtons.length = 0;
    this.lineStrategyButtons.length = 0;
    this.layoutStrategyButtons.length = 0;
    this.strategyModeButtons.length = 0;
  }

  private async runBenchmark(): Promise<void> {
    if (!this.frameTelemetry || !this.textLayer || this.benchmarkStarted) {
      return;
    }

    this.benchmarkStarted = true;
    document.body.dataset.benchmarkState = 'running';
    document.body.dataset.benchmarkError = '';
    console.info(
      `Starting benchmark strategy=${this.textStrategy} labelSet=${this.config.labelSetKind} labels=${this.config.labels.length}`,
    );

    try {
      await this.waitForAnimationFrames(4);
      await this.frameTelemetry.flushGpuSamples();
      this.frameTelemetry.reset();
      this.applyControlAction('reset-camera');
      await this.waitForAnimationFrames(2);

      const cameraTrace = buildBenchmarkCameraTrace(this.config.benchmarkTraceStepCount);

      for (const action of cameraTrace) {
        this.applyControlAction(action);
        await this.waitForAnimationFrames(1);
      }

      await this.waitForAnimationFrames(2);
      await this.frameTelemetry.flushGpuSamples();

      const perf = this.frameTelemetry.getSnapshot();
      const textStats = this.textLayer.getStats();

      this.benchmarkSummary = {
        bytesUploadedPerFrame: textStats.bytesUploadedPerFrame,
        cpuDrawAvgMs: perf.cpuDrawAvgMs,
        cpuFrameAvgMs: perf.cpuFrameAvgMs,
        cpuFrameSamples: perf.cpuFrameSamples,
        cpuTextAvgMs: perf.cpuTextAvgMs,
        glyphCount: textStats.glyphCount,
        gpuFrameAvgMs: perf.gpuFrameAvgMs,
        gpuFrameSamples: perf.gpuFrameSamples,
        gpuTextAvgMs: perf.gpuTextAvgMs,
        gpuSupported: perf.gpuSupported,
        labelCount: textStats.labelCount,
        textStrategy: this.textStrategy,
        submittedGlyphCount: textStats.submittedGlyphCount,
        submittedVertexCount: textStats.submittedVertexCount,
        visibleChunkCount: textStats.visibleChunkCount,
        visibleGlyphCount: textStats.visibleGlyphCount,
        visibleLabelCount: textStats.visibleLabelCount,
      };

      document.body.dataset.benchmarkError = '';
      document.body.dataset.benchmarkState = 'complete';
      this.updateStatus();
      console.info(`Benchmark complete ${JSON.stringify(this.benchmarkSummary)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      document.body.dataset.benchmarkError = message;
      document.body.dataset.benchmarkState = 'error';
      console.error(`Benchmark failed: ${message}`);
    }
  }

  private setBenchmarkDatasets(): void {
    document.body.dataset.benchmarkLabelCount = String(this.config.labels.length);
    document.body.dataset.benchmarkLabelSetKind = this.config.labelSetKind;
    document.body.dataset.benchmarkLabelSetPreset = this.config.labelSetPreset;
    document.body.dataset.benchmarkLabelTargetCount = String(this.config.labelTargetCount);
    document.body.dataset.benchmarkTextStrategy = this.textStrategy;
    document.body.dataset.benchmarkGpuTimingEnabled = String(this.config.gpuTimingEnabled);

    if (!this.benchmarkSummary) {
      document.body.dataset.benchmarkBytesUploadedPerFrame = '0';
      document.body.dataset.benchmarkCpuDrawAvgMs = '0.000';
      document.body.dataset.benchmarkCpuFrameAvgMs = '0.000';
      document.body.dataset.benchmarkCpuFrameSamples = '0';
      document.body.dataset.benchmarkCpuTextAvgMs = '0.000';
      document.body.dataset.benchmarkGlyphCount = '0';
      document.body.dataset.benchmarkGpuFrameAvgMs = this.config.gpuTimingEnabled ? 'pending' : 'disabled';
      document.body.dataset.benchmarkGpuTextAvgMs = this.config.gpuTimingEnabled ? 'pending' : 'disabled';
      document.body.dataset.benchmarkGpuFrameSamples = '0';
      document.body.dataset.benchmarkGpuSupported = 'false';
      document.body.dataset.benchmarkSubmittedGlyphCount = '0';
      document.body.dataset.benchmarkSubmittedVertexCount = '0';
      document.body.dataset.benchmarkVisibleChunkCount = '0';
      document.body.dataset.benchmarkVisibleGlyphCount = '0';
      document.body.dataset.benchmarkVisibleLabelCount = '0';
      return;
    }

    document.body.dataset.benchmarkBytesUploadedPerFrame =
      String(this.benchmarkSummary.bytesUploadedPerFrame);
    document.body.dataset.benchmarkCpuDrawAvgMs = this.benchmarkSummary.cpuDrawAvgMs.toFixed(3);
    document.body.dataset.benchmarkCpuFrameAvgMs = this.benchmarkSummary.cpuFrameAvgMs.toFixed(3);
    document.body.dataset.benchmarkCpuFrameSamples = String(this.benchmarkSummary.cpuFrameSamples);
    document.body.dataset.benchmarkCpuTextAvgMs = this.benchmarkSummary.cpuTextAvgMs.toFixed(3);
    document.body.dataset.benchmarkGlyphCount = String(this.benchmarkSummary.glyphCount);
    document.body.dataset.benchmarkGpuFrameAvgMs =
      !this.config.gpuTimingEnabled
        ? 'disabled'
        : this.benchmarkSummary.gpuFrameAvgMs === null
        ? 'unsupported'
        : this.benchmarkSummary.gpuFrameAvgMs.toFixed(3);
    document.body.dataset.benchmarkGpuTextAvgMs =
      !this.config.gpuTimingEnabled
        ? 'disabled'
        : this.benchmarkSummary.gpuTextAvgMs === null
        ? 'unsupported'
        : this.benchmarkSummary.gpuTextAvgMs.toFixed(3);
    document.body.dataset.benchmarkGpuFrameSamples = String(this.benchmarkSummary.gpuFrameSamples);
    document.body.dataset.benchmarkGpuSupported = String(this.benchmarkSummary.gpuSupported);
    document.body.dataset.benchmarkSubmittedGlyphCount = String(this.benchmarkSummary.submittedGlyphCount);
    document.body.dataset.benchmarkSubmittedVertexCount = String(this.benchmarkSummary.submittedVertexCount);
    document.body.dataset.benchmarkVisibleChunkCount = String(this.benchmarkSummary.visibleChunkCount);
    document.body.dataset.benchmarkVisibleGlyphCount = String(this.benchmarkSummary.visibleGlyphCount);
    document.body.dataset.benchmarkVisibleLabelCount = String(this.benchmarkSummary.visibleLabelCount);
  }

  private setState(state: AppState): void {
    document.body.dataset.appState = state;
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown startup error';

    this.setState('error');
    this.chrome.canvas.hidden = true;
    this.chrome.launchBanner.hidden = false;
    this.chrome.launchBanner.innerHTML = `
      <strong>Startup Failed</strong>
      <p>${escapeHtml(message)}</p>
    `;
  }

  private showUnsupported(message: string): void {
    this.setState('unsupported');
    this.chrome.canvas.hidden = true;
    this.chrome.launchBanner.hidden = false;
    this.chrome.launchBanner.innerHTML = `
      <strong>WebGPU Required</strong>
      <p>${escapeHtml(message)}</p>
    `;
  }

  private updateStatus(): void {
    const snapshot = this.camera.getSnapshot();
    const gridStats = this.gridLayer?.getStats();
    const lineStats = this.lineLayer?.getStats();
    const perf = this.frameTelemetry?.getSnapshot();
    const textStats = this.textLayer?.getStats();
    const lineCount = gridStats ? gridStats.verticalLines + gridStats.horizontalLines : 0;
    const minorSpacing = gridStats ? formatSpacing(gridStats.minorSpacing) : 'n/a';
    const majorSpacing = gridStats ? formatSpacing(gridStats.majorSpacing) : 'n/a';
    const labelCount = textStats ? textStats.labelCount : 0;
    const glyphCount = textStats ? textStats.glyphCount : 0;
    const activeLineStrategy = lineStats ? lineStats.lineStrategy : this.lineStrategy;
    const activeTextStrategy = textStats ? textStats.textStrategy : this.textStrategy;
    const activeLayoutStrategy =
      this.config.labelSetKind === 'demo' ? this.layoutStrategy : 'benchmark-static';
    const layoutStrategyLabel =
      this.config.labelSetKind === 'demo'
        ? getLayoutStrategyLabel(this.layoutStrategy)
        : 'Benchmark Static';
    const lineStrategyLabel = getLineStrategyLabel(activeLineStrategy);
    const textStrategyLabel = getTextStrategyLabel(activeTextStrategy);
    const lineLinkCount = lineStats ? lineStats.lineLinkCount : this.config.links.length;
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

    document.body.dataset.cameraCenterX = snapshot.centerX.toFixed(4);
    document.body.dataset.cameraCenterY = snapshot.centerY.toFixed(4);
    document.body.dataset.cameraZoom = snapshot.zoom.toFixed(4);
    document.body.dataset.cameraScale = snapshot.pixelsPerWorldUnit.toFixed(4);
    document.body.dataset.labelSetKind = this.config.labelSetKind;
    document.body.dataset.labelSetPreset = this.config.labelSetPreset;
    document.body.dataset.labelSetCount = String(this.config.labels.length);
    document.body.dataset.labelTargetCount = String(this.config.labelTargetCount);
    document.body.dataset.gridLineCount = String(lineCount);
    document.body.dataset.gridMinorSpacing = minorSpacing;
    document.body.dataset.gridMajorSpacing = majorSpacing;
    document.body.dataset.layoutFingerprint = getLayoutFingerprint(this.config.labels);
    document.body.dataset.layoutStrategy = activeLayoutStrategy;
    document.body.dataset.layoutStrategyLabel = layoutStrategyLabel;
    document.body.dataset.strategyPanelMode = this.strategyPanelMode;
    document.body.dataset.lineStrategy = activeLineStrategy;
    document.body.dataset.lineStrategyLabel = lineStrategyLabel;
    document.body.dataset.lineLinkCount = String(lineLinkCount);
    document.body.dataset.lineVisibleLinkCount = String(visibleLinkCount);
    document.body.dataset.lineSubmittedVertexCount = String(submittedLineVertexCount);
    document.body.dataset.lineCurveFingerprint = lineStats?.curveFingerprint ?? '0:0:0:0:0:0:0';
    document.body.dataset.textStrategy = activeTextStrategy;
    document.body.dataset.textStrategyLabel = textStrategyLabel;
    document.body.dataset.textBytesUploadedPerFrame = String(bytesUploadedPerFrame);
    document.body.dataset.textLabelCount = String(labelCount);
    document.body.dataset.textGlyphCount = String(glyphCount);
    document.body.dataset.textSubmittedGlyphCount = String(submittedGlyphCount);
    document.body.dataset.textSubmittedVertexCount = String(submittedVertexCount);
    document.body.dataset.textVisibleChunkCount = String(visibleChunkCount);
    document.body.dataset.textVisibleLabelCount = String(visibleLabelCount);
    document.body.dataset.textVisibleLabels = visibleLabels;
    document.body.dataset.textVisibleGlyphCount = String(visibleGlyphCount);
    document.body.dataset.perfCpuDrawAvgMs = perf ? perf.cpuDrawAvgMs.toFixed(3) : '0.000';
    document.body.dataset.perfCpuFrameAvgMs = perf ? perf.cpuFrameAvgMs.toFixed(3) : '0.000';
    document.body.dataset.perfCpuFrameMaxMs = perf ? perf.cpuFrameMaxMs.toFixed(3) : '0.000';
    document.body.dataset.perfCpuFrameSamples = String(perf?.cpuFrameSamples ?? 0);
    document.body.dataset.perfCpuGridAvgMs = perf ? perf.cpuGridAvgMs.toFixed(3) : '0.000';
    document.body.dataset.perfCpuTextAvgMs = perf ? perf.cpuTextAvgMs.toFixed(3) : '0.000';
    document.body.dataset.perfGpuError = perf?.gpuError ?? '';
    document.body.dataset.perfGpuFrameAvgMs =
      !this.config.gpuTimingEnabled
        ? 'disabled'
        : perf?.gpuFrameAvgMs === null || perf?.gpuFrameAvgMs === undefined
        ? 'unsupported'
        : perf.gpuFrameAvgMs.toFixed(3);
    document.body.dataset.perfGpuTextAvgMs =
      !this.config.gpuTimingEnabled
        ? 'disabled'
        : perf?.gpuTextAvgMs === null || perf?.gpuTextAvgMs === undefined
        ? 'unsupported'
        : perf.gpuTextAvgMs.toFixed(3);
    document.body.dataset.perfGpuFrameSamples = String(perf?.gpuFrameSamples ?? 0);
    document.body.dataset.perfGpuSupported = String(perf?.gpuSupported ?? false);

    this.setBenchmarkDatasets();

    this.chrome.stats.textContent = [
      `center ${snapshot.centerX.toFixed(2)}, ${snapshot.centerY.toFixed(2)}`,
      `zoom ${snapshot.zoom.toFixed(2)}`,
      textStats
        ? `glyphs ${visibleGlyphCount} visible / ${glyphCount} total`
        : 'glyphs 0 visible / 0 total',
      `vertices ${submittedTotalVertexCount}`,
      perf ? formatPerfSummary(perf, this.config.gpuTimingEnabled) : 'cpu 0.00 ms / gpu pending',
    ].filter(Boolean).join('  |  ');
  }

  private async waitForAnimationFrames(count: number): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      if (this.destroyed) {
        return;
      }

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
  }
}

function buildBenchmarkCameraTrace(stepCount: number): ControlAction[] {
  const safeCount = Math.max(1, stepCount);
  const actions: ControlAction[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    actions.push(BENCHMARK_CAMERA_TRACE[index % BENCHMARK_CAMERA_TRACE.length]);
  }

  return actions;
}

function createStageChrome(root: HTMLElement): StageChromeElements {
  const stage = document.createElement('div');
  stage.className = 'luma-stage';

  const canvas = document.createElement('canvas');
  canvas.className = 'stage-canvas';
  canvas.dataset.testid = 'gpu-canvas';
  canvas.setAttribute('aria-label', 'luma.gl WebGPU canvas');
  canvas.hidden = true;

  const statusPanel = document.createElement('aside');
  statusPanel.className = 'status-panel';
  statusPanel.dataset.testid = 'status-panel';
  statusPanel.innerHTML = `
    <div class="status-eyebrow">Linker / Luma</div>
    <h1>Network Mapping Lab</h1>
  `;

  const stats = document.createElement('p');
  stats.className = 'status-stats';
  stats.textContent =
    'center 0.00, 0.00  |  zoom 0.00  |  glyphs 0 visible / 0 total  |  vertices 0  |  cpu 0.00 ms frame / 0.00 ms text / gpu pending';
  statusPanel.append(stats);

  const textStrategyButtonsMarkup = TEXT_STRATEGY_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-text-strategy="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  const lineStrategyButtonsMarkup = LINE_STRATEGY_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-line-strategy="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  const layoutStrategyButtonsMarkup = LAYOUT_STRATEGY_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-layout-strategy="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  const strategyModeButtonsMarkup = `
    <button type="button" class="control-button" data-strategy-panel-mode="text" aria-pressed="false">Text Strategy</button>
    <button type="button" class="control-button" data-strategy-panel-mode="line" aria-pressed="false">Line Strategy</button>
    <button type="button" class="control-button" data-strategy-panel-mode="layout" aria-pressed="false">Layout Strategy</button>
  `;

  const launchBanner = document.createElement('div');
  launchBanner.className = 'launch-banner';
  launchBanner.dataset.testid = 'app-message';
  launchBanner.innerHTML = `
    <strong>Preparing WebGPU</strong>
    <p>Initializing a luma-stage and fullscreen WebGPU canvas.</p>
  `;

  const strategyModePanel = document.createElement('aside');
  strategyModePanel.className = 'strategy-mode-panel';
  strategyModePanel.dataset.testid = 'strategy-mode-panel';
  strategyModePanel.innerHTML = `
    <div class="panel-label">Strategy View</div>
    <div class="control-row" data-testid="strategy-panel-mode">
      ${strategyModeButtonsMarkup}
    </div>
  `;

  const renderPanel = document.createElement('aside');
  renderPanel.className = 'render-panel';
  renderPanel.dataset.testid = 'render-panel';
  renderPanel.setAttribute('aria-label', 'Render panel');
  renderPanel.innerHTML = `
    <div class="panel-label" data-testid="strategy-panel-label">Text Strategy</div>
    <div class="control-row" data-testid="text-strategy-panel">
      ${textStrategyButtonsMarkup}
    </div>
    <div class="control-row" data-testid="line-strategy-panel" hidden>
      ${lineStrategyButtonsMarkup}
    </div>
    <div class="control-row" data-testid="layout-strategy-panel" hidden>
      ${layoutStrategyButtonsMarkup}
    </div>
  `;

  const cameraPanel = document.createElement('aside');
  cameraPanel.className = 'camera-panel';
  cameraPanel.dataset.testid = 'camera-panel';
  cameraPanel.setAttribute('aria-label', 'Camera panel');
  cameraPanel.innerHTML = `
    <div class="panel-label">Camera</div>
    <div class="camera-grid" aria-label="Camera controls">
      <button type="button" class="control-button" data-control="zoom-in">Zoom In</button>
      <button type="button" class="control-button" data-control="zoom-out">Zoom Out</button>
      <button type="button" class="control-button" data-control="reset-camera">Reset</button>
      <button type="button" class="control-button" data-control="pan-up">Up</button>
      <button type="button" class="control-button" data-control="pan-left">Left</button>
      <button type="button" class="control-button" data-control="pan-down">Down</button>
      <button type="button" class="control-button" data-control="pan-right">Right</button>
    </div>
  `;

  stage.append(canvas, statusPanel, strategyModePanel, renderPanel, cameraPanel, launchBanner);
  root.replaceChildren(stage);

  return {
    cameraPanel,
    canvas,
    launchBanner,
    renderPanel,
    stage,
    statusPanel,
    stats,
    strategyModePanel,
  };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function formatMs(value: number): string {
  return `${value.toFixed(2)} ms`;
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

function getLayoutFingerprint(labels: LabelDefinition[]): string {
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

function getViewportCenter(viewport: ViewportSize): {x: number; y: number} {
  return {
    x: viewport.width / 2,
    y: viewport.height / 2,
  };
}

function isWebGPUUnavailableError(error: unknown): error is Error {
  if (!(error instanceof Error)) {
    return false;
  }

  return /webgpu|gpu adapter|gpu device|navigator\.gpu/i.test(error.message);
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

function parseBoundedInteger(
  input: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = input ? Number.parseInt(input, 10) : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function isTextStrategy(value: string | null | undefined): value is TextStrategy {
  return TEXT_STRATEGIES.includes(value as TextStrategy);
}

function isLineStrategy(value: string | null | undefined): value is LineStrategy {
  return LINE_STRATEGIES.includes(value as LineStrategy);
}

function isLayoutStrategy(value: string | null | undefined): value is LayoutStrategy {
  return LAYOUT_STRATEGIES.includes(value as LayoutStrategy);
}

function parseTextStrategy(value: string | null): TextStrategy {
  return isTextStrategy(value) ? value : DEFAULT_TEXT_STRATEGY;
}

function parseLineStrategy(value: string | null): LineStrategy {
  return isLineStrategy(value) ? value : DEFAULT_LINE_STRATEGY;
}

function parseLayoutStrategy(value: string | null): LayoutStrategy {
  return isLayoutStrategy(value) ? value : DEFAULT_LAYOUT_STRATEGY;
}

function syncTextStrategyQueryParam(textStrategy: TextStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (textStrategy === DEFAULT_TEXT_STRATEGY) {
      searchParams.delete('textStrategy');
    } else {
      searchParams.set('textStrategy', textStrategy);
    }
  });
}

function syncLineStrategyQueryParam(lineStrategy: LineStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (lineStrategy === DEFAULT_LINE_STRATEGY) {
      searchParams.delete('lineStrategy');
    } else {
      searchParams.set('lineStrategy', lineStrategy);
    }
  });
}

function syncLayoutStrategyQueryParam(layoutStrategy: LayoutStrategy): void {
  updateRouteSearchParams((searchParams) => {
    if (layoutStrategy === DEFAULT_LAYOUT_STRATEGY) {
      searchParams.delete('layoutStrategy');
    } else {
      searchParams.set('layoutStrategy', layoutStrategy);
    }
  });
}

function syncCameraQueryParams(camera: CameraView): void {
  updateRouteSearchParams((searchParams) => {
    syncCameraNumberQueryParam(searchParams, 'cameraCenterX', camera.centerX);
    syncCameraNumberQueryParam(searchParams, 'cameraCenterY', camera.centerY);
    syncCameraNumberQueryParam(searchParams, 'cameraZoom', camera.zoom);
  });
}

function syncCameraNumberQueryParam(
  searchParams: URLSearchParams,
  key: 'cameraCenterX' | 'cameraCenterY' | 'cameraZoom',
  value: number,
): void {
  const normalizedValue = normalizeCameraQueryNumber(value);

  if (normalizedValue === null) {
    searchParams.delete(key);
    return;
  }

  searchParams.set(key, normalizedValue);
}

function normalizeCameraQueryNumber(value: number): string | null {
  if (Math.abs(value) < 0.00005) {
    return null;
  }

  return value.toFixed(4).replace(/\.?0+$/u, '');
}

function updateRouteSearchParams(mutate: (searchParams: URLSearchParams) => void): void {
  const url = new URL(window.location.href);
  const previousSearch = url.search;
  mutate(url.searchParams);

  if (url.search === previousSearch) {
    return;
  }

  window.history.replaceState({}, '', url.toString());
}

function parseFiniteNumber(input: string | null, fallback: number): number {
  const parsed = input ? Number(input) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStageConfig(search: string): StageConfig {
  const params = new URLSearchParams(search);
  const labelSetKind: LabelSetKind = params.get('labelSet') === 'benchmark' ? 'benchmark' : 'demo';
  const layoutStrategy = parseLayoutStrategy(params.get('layoutStrategy'));
  const lineStrategy = parseLineStrategy(params.get('lineStrategy'));
  const labelTargetCount =
    labelSetKind === 'benchmark'
      ? parseBoundedInteger(params.get('labelCount'), DEFAULT_BENCHMARK_LABEL_COUNT, 64, 16384)
      : DEMO_LABELS.length;
  const labels =
    labelSetKind === 'benchmark' ? getStaticBenchmarkLabels(labelTargetCount) : getDemoLabels(layoutStrategy);

  return {
    benchmarkTraceStepCount: parseBoundedInteger(
      params.get('benchmarkFrames'),
      DEFAULT_BENCHMARK_TRACE_STEP_COUNT,
      8,
      120,
    ),
    benchmarkEnabled: params.get('benchmark') === '1',
    gpuTimingEnabled: params.get('gpuTiming') !== '0',
    initialCamera: {
      centerX: parseFiniteNumber(params.get('cameraCenterX'), 0),
      centerY: parseFiniteNumber(params.get('cameraCenterY'), 0),
      zoom: parseFiniteNumber(params.get('cameraZoom'), 0),
    },
    labelSetKind,
    labelSetPreset: labelSetKind === 'benchmark' ? STATIC_BENCHMARK_LABEL_SET_ID : DEMO_LABEL_SET_ID,
    layoutStrategy,
    labelTargetCount,
    labels,
    lineStrategy,
    links: labelSetKind === 'benchmark' ? [] : getDemoLinks(layoutStrategy),
    textStrategy: parseTextStrategy(params.get('textStrategy')),
  };
}

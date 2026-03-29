import {luma, type Device} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {webgpuAdapter} from '@luma.gl/webgpu';

import {
  buildBenchmarkCameraTrace,
  createStageBenchmarkDatasets,
  createStageBenchmarkSummary,
  writeStageBenchmarkDatasets,
  type StageBenchmarkSummary,
} from './benchmark-model';
import {Camera2D, type ViewportSize} from './camera';
import {
  LAYOUT_STRATEGIES,
  type LayoutStrategy,
} from './data/labels';
import {GridLayer} from './grid';
import {
  createLabelFocusedCameraState,
  getActiveLabelFocusedCameraNode,
  getLabelFocusedCameraAvailability,
  getLabelFocusedCameraTarget,
  relayoutLabelFocusedCameraState,
  withActiveLabelFocusedCameraKey,
  type LabelFocusedCameraAction,
  type LabelFocusedCameraState,
} from './label-focused-camera';
import {LineLayer} from './line/layer';
import {
  LINE_STRATEGIES,
  type LineStrategy,
} from './line/types';
import {FrameTelemetry} from './perf';
import {
  createDemoStageScene,
  createStageScene,
  type StageScene,
} from './scene-model';
import {
  readStageConfig,
  syncStageDemoCameraQueryParams,
  syncStageLayoutStrategyQueryParam,
  syncStageLineStrategyQueryParam,
  syncStageNumericCameraQueryParams,
  syncStageTextStrategyQueryParam,
  type StageConfig,
} from './stage-config';
import {
  syncStageCameraPanel,
  syncStageStrategyPanels,
  type StrategyPanelMode,
} from './stage-panels';
import {createStageChrome, type StageChromeElements} from './stage-chrome';
import {syncStageSelectionBox} from './stage-selection-box';
import {createStageSnapshot, writeStageSnapshot} from './stage-snapshot';
import {TextLayer} from './text/layer';
import {
  TEXT_STRATEGIES,
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
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
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

const DEMO_DEEP_ZOOM_STEP = 1;

type AppState = 'loading' | 'ready' | 'unsupported' | 'error';

type ControlAction = LabelFocusedCameraAction;

export type AppHandle = {
  destroy: () => void;
};

export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const stageChrome = createStageChrome(root);
  const config = readStageConfig(window.location.search);
  const scene = createStageScene(config);
  const stageController = new LumaStageController(stageChrome, config, scene);

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
  private labelFocusedCamera: LabelFocusedCameraState | null = null;
  private lineLayer: LineLayer | null = null;
  private scene: StageScene;
  private textLayer: TextLayer | null = null;
  private readonly camera = new Camera2D();
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly layoutStrategyButtons: HTMLButtonElement[] = [];
  private readonly lineStrategyButtons: HTMLButtonElement[] = [];
  private readonly strategyModeButtons: HTMLButtonElement[] = [];
  private readonly textStrategyButtons: HTMLButtonElement[] = [];
  private destroyed = false;
  private layoutStrategy: LayoutStrategy;
  private lastFrameAt = 0;
  private lineStrategy: LineStrategy;
  private strategyPanelMode: StrategyPanelMode = 'text';
  private textStrategy: TextStrategy;

  constructor(
    private readonly chrome: StageChromeElements,
    private readonly config: StageConfig,
    scene: StageScene,
  ) {
    this.scene = scene;
    this.layoutStrategy = config.layoutStrategy;
    this.lineStrategy = config.lineStrategy;
    this.textStrategy = config.textStrategy;

    if (config.labelSetKind === 'demo') {
      this.labelFocusedCamera = createLabelFocusedCameraState(
        this.scene.labels,
        config.initialCameraLabel,
      );
      this.syncActiveDemoCameraView({immediate: true});
    } else {
      this.camera.setView(
        config.initialCamera.centerX,
        config.initialCamera.centerY,
        config.initialCamera.zoom,
      );
    }
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
      this.lineLayer = new LineLayer(this.device, this.scene.links, this.lineStrategy);
      this.textLayer = new TextLayer(this.device, this.scene.labels, this.textStrategy);
      await this.textLayer.ready;
      this.installInteractionHandlers();
      this.updateStrategyPanels();
      this.updateCameraPanel();
      this.chrome.launchBanner.hidden = true;
      this.chrome.canvas.hidden = false;
      this.setState('ready');
      this.syncCurrentCameraQueryParams();
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
      const deltaMs = this.lastFrameAt === 0 ? 16.67 : frameStartedAt - this.lastFrameAt;
      this.lastFrameAt = frameStartedAt;
      this.camera.advance(deltaMs);
      const viewport = this.getViewportSize();

      const gridStartedAt = performance.now();
      this.gridLayer.update(this.camera, viewport);
      const gridCpuMs = performance.now() - gridStartedAt;

      this.lineLayer.update(this.camera, viewport);

      const textStartedAt = performance.now();
      this.textLayer.update(this.camera, viewport);
      const textCpuMs = performance.now() - textStartedAt;
      syncStageSelectionBox({
        activeLabelNode: getActiveLabelFocusedCameraNode(this.labelFocusedCamera),
        camera: this.camera,
        selectionBox: this.chrome.selectionBox,
        textLayer: this.textLayer,
        viewport,
      });

      const drawStartedAt = performance.now();
      const framebuffer = this.device
        .getDefaultCanvasContext()
        .getCurrentFramebuffer({depthStencilFormat: false});
      const frameTimingProps = this.frameTelemetry?.getRenderPassTimingProps() ?? {};
      const splitTextGpuPass = frameTimingProps.timestampQuerySet !== undefined;

      const renderPass = this.device.beginRenderPass({
        id: 'luma-stage-pass',
        framebuffer,
        clearColor: [0, 0, 0, 1],
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
    if (!isControlAction(action)) {
      return;
    }

    const cameraChanged = this.isDemoLabelCameraEnabled()
      ? this.applyDemoControlAction(action)
      : this.applyNumericControlAction(action);

    if (cameraChanged) {
      this.syncCurrentCameraQueryParams();
    }

    this.updateCameraPanel();
  }

  private applyDemoControlAction(action: ControlAction): boolean {
    const activeNode = getActiveLabelFocusedCameraNode(this.labelFocusedCamera);

    if (!activeNode) {
      return false;
    }

    const targetZoom = this.camera.getTargetSnapshot().zoom;

    switch (action) {
      case 'pan-up':
      case 'pan-down':
      case 'pan-left':
      case 'pan-right': {
        const targetNode = getLabelFocusedCameraTarget(this.labelFocusedCamera, action);

        if (!targetNode || targetNode.key === this.labelFocusedCamera?.activeLabelKey) {
          return false;
        }

        return this.setActiveDemoLabelKey(targetNode.key, {zoom: targetZoom});
      }
      case 'zoom-in': {
        const deeperNode = getLabelFocusedCameraTarget(this.labelFocusedCamera, action);

        if (deeperNode && deeperNode.key !== this.labelFocusedCamera?.activeLabelKey) {
          return this.setActiveDemoLabelKey(deeperNode.key);
        }

        return this.syncActiveDemoCameraView({zoom: targetZoom + DEMO_DEEP_ZOOM_STEP});
      }
      case 'zoom-out': {
        if (targetZoom > activeNode.label.zoomLevel + 0.0001) {
          return this.syncActiveDemoCameraView({
            zoom: Math.max(activeNode.label.zoomLevel, targetZoom - DEMO_DEEP_ZOOM_STEP),
          });
        }

        const shallowerNode = getLabelFocusedCameraTarget(this.labelFocusedCamera, action);

        if (!shallowerNode || shallowerNode.key === this.labelFocusedCamera?.activeLabelKey) {
          return false;
        }

        return this.setActiveDemoLabelKey(shallowerNode.key);
      }
      case 'reset-camera': {
        const defaultKey = this.labelFocusedCamera?.navigationIndex.defaultKey;

        if (!defaultKey) {
          return false;
        }

        return this.setActiveDemoLabelKey(defaultKey);
      }
      default:
        return false;
    }
  }

  private applyNumericControlAction(action: ControlAction): boolean {
    const viewport = this.getViewportSize();
    const panX = viewport.width * 0.16;
    const panY = viewport.height * 0.16;
    const before = this.camera.getTargetSnapshot();

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
    }

    const after = this.camera.getTargetSnapshot();

    return (
      before.centerX !== after.centerX ||
      before.centerY !== after.centerY ||
      before.zoom !== after.zoom
    );
  }

  private relayoutDemoCamera(
    requestedLabelKey: string | null,
    syncQuery: boolean,
  ): void {
    this.labelFocusedCamera = relayoutLabelFocusedCameraState(
      this.labelFocusedCamera,
      this.scene.labels,
      requestedLabelKey,
    );
    this.syncActiveDemoCameraView({immediate: true});
    this.updateCameraPanel();

    if (syncQuery) {
      this.syncCurrentCameraQueryParams();
    }
  }

  private setActiveDemoLabelKey(
    labelKey: string,
    options?: {zoom?: number},
  ): boolean {
    const nextState = withActiveLabelFocusedCameraKey(this.labelFocusedCamera, labelKey);

    if (!nextState) {
      return false;
    }

    this.labelFocusedCamera = nextState;
    return this.syncActiveDemoCameraView({zoom: options?.zoom});
  }

  private syncActiveDemoCameraView(options?: {immediate?: boolean; zoom?: number}): boolean {
    const node = getActiveLabelFocusedCameraNode(this.labelFocusedCamera);

    if (!node) {
      return false;
    }

    const zoom = options?.zoom ?? node.label.zoomLevel;
    const before = options?.immediate
      ? this.camera.getSnapshot()
      : this.camera.getTargetSnapshot();

    if (options?.immediate) {
      this.camera.setView(node.label.location.x, node.label.location.y, zoom);
    } else {
      this.camera.setTargetView(node.label.location.x, node.label.location.y, zoom);
    }

    const after = options?.immediate
      ? this.camera.getSnapshot()
      : this.camera.getTargetSnapshot();

    return (
      before.centerX !== after.centerX ||
      before.centerY !== after.centerY ||
      before.zoom !== after.zoom
    );
  }

  private isDemoLabelCameraEnabled(): boolean {
    return this.config.labelSetKind === 'demo' && this.labelFocusedCamera !== null;
  }

  private syncCurrentCameraQueryParams(): void {
    if (this.isDemoLabelCameraEnabled() && this.labelFocusedCamera) {
      syncStageDemoCameraQueryParams(
        this.labelFocusedCamera.activeLabelKey,
        this.labelFocusedCamera.navigationIndex.defaultKey,
      );
      return;
    }

    syncStageNumericCameraQueryParams(this.camera.getTargetSnapshot());
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
    syncStageTextStrategyQueryParam(mode);
    this.updateStrategyPanels();
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
    syncStageLineStrategyQueryParam(mode);
    this.updateStrategyPanels();
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
    this.scene = createDemoStageScene(mode, this.config.demoLayerCount);
    this.lineLayer.setLinks(this.scene.links);
    this.textLayer.setLayoutLabels(this.scene.labels);
    this.relayoutDemoCamera(this.labelFocusedCamera?.activeLabelKey ?? null, true);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    syncStageLayoutStrategyQueryParam(mode);
    this.updateStrategyPanels();
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
    this.updateStrategyPanels();
    this.updateStatus();
  }

  private updateStrategyPanels(): void {
    syncStageStrategyPanels({
      labelSetKind: this.config.labelSetKind,
      layoutStrategy: this.layoutStrategy,
      lineStrategy: this.lineStrategy,
      renderPanel: this.chrome.renderPanel,
      strategyModePanel: this.chrome.strategyModePanel,
      strategyPanelMode: this.strategyPanelMode,
      textStrategy: this.textStrategy,
    });
  }

  private updateCameraPanel(): void {
    syncStageCameraPanel({
      buttons: this.actionButtons,
      cameraAvailability: this.getEffectiveCameraAvailability(),
      cameraEnabled: this.isDemoLabelCameraEnabled(),
    });
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
      `Starting benchmark strategy=${this.textStrategy} labelSet=${this.config.labelSetKind} labels=${this.scene.labels.length}`,
    );

    try {
      await this.waitForAnimationFrames(4);
      await this.frameTelemetry.flushGpuSamples();
      this.frameTelemetry.reset();
      this.applyControlAction('reset-camera');
      await this.waitForCameraToSettle();

      const cameraTrace = buildBenchmarkCameraTrace(this.config.benchmarkTraceStepCount);

      for (const action of cameraTrace) {
        this.applyControlAction(action);
        await this.waitForCameraToSettle();
      }

      await this.waitForAnimationFrames(2);
      await this.frameTelemetry.flushGpuSamples();

      const perf = this.frameTelemetry.getSnapshot();
      const textStats = this.textLayer.getStats();

      this.benchmarkSummary = createStageBenchmarkSummary({
        perf,
        textStats,
        textStrategy: this.textStrategy,
      });

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
    const snapshot = createStageSnapshot({
      activeLabelNode: getActiveLabelFocusedCameraNode(this.labelFocusedCamera),
      cameraAnimating: this.camera.isAnimating,
      cameraAvailability: this.getEffectiveCameraAvailability(),
      cameraSnapshot: this.camera.getSnapshot(),
      gpuTimingEnabled: this.config.gpuTimingEnabled,
      gridStats: this.gridLayer?.getStats(),
      labelSetKind: this.config.labelSetKind,
      labelTargetCount: this.config.labelTargetCount,
      layoutStrategy: this.layoutStrategy,
      lineStats: this.lineLayer?.getStats(),
      lineStrategy: this.lineStrategy,
      perf: this.frameTelemetry?.getSnapshot(),
      scene: this.scene,
      strategyPanelMode: this.strategyPanelMode,
      textStats: this.textLayer?.getStats(),
      textStrategy: this.textStrategy,
    });

    writeStageSnapshot(snapshot);
    writeStageBenchmarkDatasets(
      createStageBenchmarkDatasets({
        gpuTimingEnabled: this.config.gpuTimingEnabled,
        labelSetKind: this.config.labelSetKind,
        labelTargetCount: this.config.labelTargetCount,
        scene: this.scene,
        summary: this.benchmarkSummary,
        textStrategy: this.textStrategy,
      }),
    );
    this.chrome.stats.textContent = snapshot.statsText;
  }

  private getEffectiveCameraAvailability() {
    const availability = getLabelFocusedCameraAvailability(this.labelFocusedCamera);

    if (!this.isDemoLabelCameraEnabled()) {
      return availability;
    }

    const activeNode = getActiveLabelFocusedCameraNode(this.labelFocusedCamera);
    const targetZoom = this.camera.getTargetSnapshot().zoom;

    return {
      ...availability,
      canReset:
        availability.canReset ||
        (activeNode ? Math.abs(targetZoom - activeNode.label.zoomLevel) > 0.0001 : false),
      canZoomIn: activeNode !== null,
      canZoomOut:
        availability.canZoomOut ||
        (activeNode ? targetZoom > activeNode.label.zoomLevel + 0.0001 : false),
    };
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

  private async waitForCameraToSettle(maxFrames = 120): Promise<void> {
    for (let frame = 0; frame < maxFrames; frame += 1) {
      if (this.destroyed || !this.camera.isAnimating) {
        return;
      }

      await this.waitForAnimationFrames(1);
    }
  }
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function isTextStrategy(value: string | null | undefined): value is TextStrategy {
  return value !== null && value !== undefined && TEXT_STRATEGIES.some((strategy) => strategy === value);
}

function isLineStrategy(value: string | null | undefined): value is LineStrategy {
  return LINE_STRATEGIES.includes(value as LineStrategy);
}

function isLayoutStrategy(value: string | null | undefined): value is LayoutStrategy {
  return LAYOUT_STRATEGIES.includes(value as LayoutStrategy);
}

function isControlAction(value: string | null | undefined): value is ControlAction {
  return (
    value === 'pan-up' ||
    value === 'pan-down' ||
    value === 'pan-left' ||
    value === 'pan-right' ||
    value === 'zoom-in' ||
    value === 'zoom-out' ||
    value === 'reset-camera'
  );
}

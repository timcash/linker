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
  canDeleteActiveWorkplane,
  deleteActiveWorkplane,
  getActiveWorkplaneDocument,
  getActiveWorkplaneView,
  getPlaneCount,
  getWorkplaneIndex,
  replaceWorkplaneLabelTextOverride,
  replaceStackCamera,
  replaceWorkplaneScene,
  replaceWorkplaneView,
  selectNextWorkplane,
  selectPreviousWorkplane,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneCameraView,
} from './plane-stack';
import {
  areStageHistoryViewsEqual,
  createStageHistoryViewState,
  type StageHistoryState,
  type StageHistorySnapshot,
} from './stage-history';
import {
  StageHistoryController,
  type StageHistoryPersistenceChange,
} from './stage-history-controller';
import {
  createDemoStageScene,
  type StageScene,
} from './scene-model';
import {
  PlaneFocusProjector,
  StackCameraProjector,
  type StageProjector,
} from './projector';
import {StackBackplateLayer} from './stack-backplate';
import {
  readStageConfig,
  syncStageHistoryQueryParam,
  syncStageSessionQueryParam,
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
import {
  hydrateStageBootState,
  DEFAULT_STRATEGY_PANEL_MODE,
} from './stage-session';
import {
  createSessionToken,
  flushStageSessionIncrementalUpdates,
  loadStageSessionSnapshot,
  saveStageSessionMetadata,
  saveStageSessionSnapshot,
  writeLastStageSessionToken,
  type PersistedIncrementalStageHistorySession,
  type PersistedStageSessionConfig,
  type PersistedStageSessionIncrementalFlush,
  type PersistedStageSessionRecord,
  type PersistedStageSessionUi,
  type SessionToken,
} from './stage-session-store';
import {
  createStackViewState,
  type StackBackplate,
  type StackViewState,
} from './stack-view';
import {
  DEFAULT_STACK_CAMERA_STATE,
  STACK_CAMERA_DISTANCE_SCALE_MAX,
  STACK_CAMERA_DISTANCE_SCALE_MIN,
  STACK_CAMERA_ELEVATION_MAX_RADIANS,
  STACK_CAMERA_ELEVATION_MIN_RADIANS,
  cloneStackCameraState,
  isStackCameraAtDefault,
  orbitStackCamera,
  scaleStackCameraDistance,
  type StackCameraState,
} from './stack-camera';
import {getCharacterSetFromLabels} from './text/charset';
import {TextLayer} from './text/layer';
import {
  TEXT_STRATEGIES,
  type TextStrategy,
} from './text/types';

declare global {
  interface Window {
    __LINKER_TEST_HOOKS__?: {
      flushPerformanceTelemetry: () => Promise<void>;
      resetPerformanceTelemetry: () => Promise<void>;
    };
  }
}

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
const SESSION_SAVE_DEBOUNCE_MS = 750;
const STACK_CAMERA_HISTORY_SETTLE_MS = 250;
const STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS = Math.PI / 18;
const STACK_CAMERA_CONTROL_ELEVATION_STEP_RADIANS = Math.PI / 24;
const STACK_CAMERA_DRAG_RADIANS_PER_PIXEL = 0.0055;
const STACK_CAMERA_ZOOM_IN_FACTOR = 0.9;
const STACK_CAMERA_ZOOM_OUT_FACTOR = 1 / STACK_CAMERA_ZOOM_IN_FACTOR;
const STACK_CAMERA_WHEEL_ZOOM_EXPONENT = 0.0015;
const MAX_RENDER_FRAME_DELTA_MS = 33.34;

type AppState = 'loading' | 'ready' | 'unsupported' | 'error';

type ControlAction = LabelFocusedCameraAction;
type HistoryAction = 'history-back' | 'history-forward';
type StageModeAction = 'toggle-stage-mode';
type WorkplaneAction =
  | 'delete-active-workplane'
  | 'select-next-workplane'
  | 'select-previous-workplane'
  | 'spawn-workplane';

type StageBootPayload = {
  config: StageConfig;
  history: StageHistoryState;
  initialState: StageSystemState;
  sessionToken: SessionToken;
  strategyPanelMode: StrategyPanelMode;
};

type StackCameraDragState = {
  clientX: number;
  clientY: number;
  pointerId: number;
};

export type AppHandle = {
  destroy: () => void;
};

export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const stageChrome = createStageChrome(root);
  const bootPayload = await createStageBootPayload(readStageConfig(window.location.search));
  const stageController = new LumaStageController(
    stageChrome,
    bootPayload.config,
    bootPayload.history,
    bootPayload.initialState,
    bootPayload.sessionToken,
    bootPayload.strategyPanelMode,
  );

  await stageController.start();
  window.__LINKER_TEST_HOOKS__ = {
    flushPerformanceTelemetry: () => stageController.flushPerformanceTelemetryForTest(),
    resetPerformanceTelemetry: () => stageController.resetPerformanceTelemetryForTest(),
  };

  return {
    destroy: () => {
      delete window.__LINKER_TEST_HOOKS__;
      stageController.destroy();
    },
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
  private historyReplayPending = false;
  private historySnapshot: StageHistorySnapshot = {
    canGoBack: false,
    canGoForward: false,
    cursorStep: 0,
    headStep: 0,
  };
  private labelFocusedCamera: LabelFocusedCameraState | null = null;
  private lineLayer: LineLayer | null = null;
  private state: StageSystemState;
  private renderScene: StageScene;
  private scene: StageScene;
  private stackCameraDrag: StackCameraDragState | null = null;
  private stackBackplateLayer: StackBackplateLayer | null = null;
  private stackBackplates: StackBackplate[] = [];
  private textLayer: TextLayer | null = null;
  private readonly camera = new Camera2D();
  private readonly planeFocusProjector = new PlaneFocusProjector(this.camera);
  private readonly stackProjector = new StackCameraProjector();
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly layoutStrategyButtons: HTMLButtonElement[] = [];
  private readonly lineStrategyButtons: HTMLButtonElement[] = [];
  private readonly strategyModeButtons: HTMLButtonElement[] = [];
  private readonly textStrategyButtons: HTMLButtonElement[] = [];
  private destroyed = false;
  private labelInputPending = false;
  private labelInputSyncedKey: string | null = null;
  private labelInputSyncedText = '';
  private layoutStrategy: LayoutStrategy;
  private lastFrameAt = 0;
  private lineStrategy: LineStrategy;
  private pendingHistoryPersistenceAppends: PersistedStageSessionIncrementalFlush['appends'] = [];
  private pendingHistoryPersistenceSnapshot: Pick<StageHistorySnapshot, 'cursorStep' | 'headStep'> | null = null;
  private strategyPanelMode: StrategyPanelMode;
  private readonly initialHistory: StageHistoryState;
  private readonly sessionToken: SessionToken;
  private readonly stageHistory: StageHistoryController;
  private sessionSaveTimeoutId: number | null = null;
  private sessionSaveQueue = Promise.resolve();
  private stackCameraHistoryTimeoutId: number | null = null;
  private suppressHistoryRecording = false;
  private textStrategy: TextStrategy;
  private workplaneSyncGeneration = 0;
  private workplaneSyncPending = false;

  constructor(
    private readonly chrome: StageChromeElements,
    private readonly config: StageConfig,
    initialHistory: StageHistoryState,
    initialState: StageSystemState,
    sessionToken: SessionToken,
    strategyPanelMode: StrategyPanelMode,
  ) {
    this.initialHistory = initialHistory;
    this.state = initialState;
    this.stageHistory = new StageHistoryController(
      initialHistory,
      this.handleHistorySnapshot,
      this.handleHistoryPersistenceChange,
    );
    this.scene = getActiveWorkplaneDocument(initialState).scene;
    const stackViewState =
      initialState.session.stageMode === '3d-mode' ? createStackViewState(initialState) : null;
    this.renderScene =
      initialState.session.stageMode === '3d-mode' && stackViewState ? stackViewState.scene : this.scene;
    this.stackBackplates = stackViewState?.backplates ?? [];
    if (stackViewState) {
      this.stackProjector.setSceneBounds(stackViewState.sceneBounds);
      this.stackProjector.setOrbitTarget(stackViewState.orbitTarget);
    }
    this.stackProjector.setStackCamera(initialState.session.stackCamera);
    this.layoutStrategy = config.layoutStrategy;
    this.lineStrategy = config.lineStrategy;
    this.sessionToken = sessionToken;
    this.strategyPanelMode = strategyPanelMode;
    this.textStrategy = config.textStrategy;
    const initialView = getActiveWorkplaneView(initialState);

    if (config.labelSetKind === 'demo') {
      this.labelFocusedCamera = createLabelFocusedCameraState(
        this.scene.labels,
        initialView.selectedLabelKey,
      );
    }

    this.camera.setView(
      initialView.camera.centerX,
      initialView.camera.centerY,
      initialView.camera.zoom,
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
      this.stackBackplateLayer = new StackBackplateLayer(this.device);
      this.lineLayer = new LineLayer(this.device, this.renderScene.links, this.lineStrategy);
      this.textLayer = new TextLayer(this.device, this.renderScene.labels, this.textStrategy);
      await this.textLayer.ready;
      this.installInteractionHandlers();
      this.updateStrategyPanels();
      this.updateCameraPanel();
      this.syncLabelInputPanel({forceValue: true});
      this.chrome.launchBanner.hidden = true;
      this.chrome.canvas.hidden = false;
      this.setState('ready');
      this.syncCurrentRouteQueryParams();
      this.updateStatus();
      this.persistInitialStageSessionSnapshot();
      this.requestRender();

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
    if (this.sessionSaveTimeoutId !== null) {
      window.clearTimeout(this.sessionSaveTimeoutId);
      this.sessionSaveTimeoutId = null;
    }
    if (this.stackCameraHistoryTimeoutId !== null) {
      window.clearTimeout(this.stackCameraHistoryTimeoutId);
      this.stackCameraHistoryTimeoutId = null;
    }
    cancelAnimationFrame(this.frameId);
    this.removeInteractionHandlers();
    this.stageHistory.destroy();
    this.backgroundModel?.destroy();
    this.gridLayer?.destroy();
    this.lineLayer?.destroy();
    this.stackBackplateLayer?.destroy();
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
      this.frameId = 0;
      const frameStartedAt = performance.now();
      this.frameTelemetry?.startCpuFrame();
      if (this.lastFrameAt !== 0) {
        this.frameTelemetry?.recordFrameGap(frameStartedAt - this.lastFrameAt);
      }
      const deltaMs = this.lastFrameAt === 0
        ? 16.67
        : Math.min(frameStartedAt - this.lastFrameAt, MAX_RENDER_FRAME_DELTA_MS);
      this.lastFrameAt = frameStartedAt;
      this.camera.advance(deltaMs);
      const viewport = this.getViewportSize();
      const stageProjector = this.getActiveProjector(viewport);
      const activeLabelNode = this.workplaneSyncPending || this.state.session.stageMode === '3d-mode'
        ? null
        : getActiveLabelFocusedCameraNode(this.labelFocusedCamera);

      if (this.state.session.stageMode === '2d-mode') {
        this.frameTelemetry?.startCpuGrid();
        this.gridLayer.update(this.planeFocusProjector, viewport);
        this.frameTelemetry?.endCpuGrid();
      }

      if (this.state.session.stageMode === '3d-mode') {
        this.stackBackplateLayer?.update(stageProjector, viewport, this.stackBackplates);
      }

      this.frameTelemetry?.startCpuLine();
      this.lineLayer.update(stageProjector, viewport, activeLabelNode?.label ?? null);
      this.frameTelemetry?.endCpuLine();

      this.frameTelemetry?.startCpuText();
      this.textLayer.update(stageProjector, viewport, activeLabelNode?.key ?? null);
      this.frameTelemetry?.endCpuText();
      if (this.state.session.stageMode === '2d-mode') {
        syncStageSelectionBox({
          activeLabelNode,
          projector: this.planeFocusProjector,
          selectionBox: this.chrome.selectionBox,
          textLayer: this.textLayer,
          viewport,
        });
      } else {
        this.chrome.selectionBox.hidden = true;
      }

      this.frameTelemetry?.startCpuDraw();
      const canvasContext = this.device.getDefaultCanvasContext();
      const backgroundFramebuffer = canvasContext.getCurrentFramebuffer({depthStencilFormat: false});
      const frameTimingProps = this.frameTelemetry?.getRenderPassTimingProps() ?? {};
      const splitTextGpuPass = frameTimingProps.timestampQuerySet !== undefined;

      const backgroundPass = this.device.beginRenderPass({
        id: 'luma-stage-background-pass',
        framebuffer: backgroundFramebuffer,
        clearColor: [0, 0, 0, 1],
      });

      this.backgroundModel.draw(backgroundPass);
      if (this.state.session.stageMode === '2d-mode') {
        this.gridLayer.draw(backgroundPass);
      }
      backgroundPass.end();

      const sceneFramebuffer = canvasContext.getCurrentFramebuffer({depthStencilFormat: 'depth24plus'});
      const renderPass = this.device.beginRenderPass({
        id: 'luma-stage-pass',
        framebuffer: sceneFramebuffer,
        clearColor: false,
        clearDepth: 1,
        ...frameTimingProps,
      });

      if (this.state.session.stageMode === '3d-mode') {
        this.stackBackplateLayer?.draw(renderPass);
      }
      this.lineLayer.draw(renderPass);

      if (!splitTextGpuPass) {
        this.textLayer.draw(renderPass);
      }

      renderPass.end();

      if (splitTextGpuPass) {
        const textRenderPass = this.device.beginRenderPass({
          id: 'luma-stage-text-pass',
          framebuffer: sceneFramebuffer,
          clearColor: false,
          clearDepth: false,
          ...this.frameTelemetry?.getTextRenderPassTimingProps(),
        });

        this.textLayer.draw(textRenderPass);
        textRenderPass.end();
      }

      this.frameTelemetry?.resolveGpuPass();
      this.device.submit();
      this.frameTelemetry?.submitGpuPass();
      this.frameTelemetry?.endCpuDraw();
      this.frameTelemetry?.endCpuFrame();
      this.updateStatus();
      if (this.camera.isAnimating) {
        this.requestRender();
      } else {
        this.lastFrameAt = 0;
      }
    } catch (error) {
      this.showError(error);
    }
  };

  private applyControlAction(action: string): void {
    if (
      !isControlAction(action) ||
      this.workplaneSyncPending ||
      this.labelInputPending
    ) {
      return;
    }

    if (this.state.session.stageMode === '3d-mode') {
      this.applyStackCameraControlAction(action);
      return;
    }

    const previousState = this.captureActiveWorkplaneRuntimeState(this.state);
    const previousView = createStageHistoryViewState(previousState);

    this.state = previousState;
    if (this.isDemoLabelCameraEnabled()) {
      this.applyDemoControlAction(action);
    } else {
      this.applyNumericControlAction(action);
    }
    const nextState = this.captureActiveWorkplaneRuntimeState(this.state);
    const nextView = createStageHistoryViewState(nextState);

    if (!areStageHistoryViewsEqual(previousView, nextView)) {
      this.state = nextState;
      this.recordStageHistoryView('Adjust plane-focus view', nextState);
      this.requestRender();
    }

    this.updateCameraPanel();
    this.syncLabelInputPanel();
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

  private applyStackCameraControlAction(action: ControlAction): boolean {
    const stackCamera = this.state.session.stackCamera;
    let nextStackCamera: StackCameraState | null = null;

    switch (action) {
      case 'pan-left':
        nextStackCamera = orbitStackCamera(
          stackCamera,
          STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS,
          0,
        );
        break;
      case 'pan-right':
        nextStackCamera = orbitStackCamera(
          stackCamera,
          -STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS,
          0,
        );
        break;
      case 'pan-up':
        nextStackCamera = orbitStackCamera(
          stackCamera,
          0,
          -STACK_CAMERA_CONTROL_ELEVATION_STEP_RADIANS,
        );
        break;
      case 'pan-down':
        nextStackCamera = orbitStackCamera(
          stackCamera,
          0,
          STACK_CAMERA_CONTROL_ELEVATION_STEP_RADIANS,
        );
        break;
      case 'zoom-in':
        nextStackCamera = scaleStackCameraDistance(
          stackCamera,
          STACK_CAMERA_ZOOM_IN_FACTOR,
        );
        break;
      case 'zoom-out':
        nextStackCamera = scaleStackCameraDistance(
          stackCamera,
          STACK_CAMERA_ZOOM_OUT_FACTOR,
        );
        break;
      case 'reset-camera':
        nextStackCamera = cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE);
        break;
    }

    const changed = this.applyStackCameraState(nextStackCamera, {persist: true});

    if (changed) {
      this.scheduleStackCameraHistoryView('Adjust stack camera');
    }

    return changed;
  }

  private applyStackCameraOrbitDelta(
    deltaAzimuthRadians: number,
    deltaElevationRadians: number,
    options?: {syncUi?: boolean},
  ): boolean {
    return this.applyStackCameraState(
      orbitStackCamera(
        this.state.session.stackCamera,
        deltaAzimuthRadians,
        deltaElevationRadians,
      ),
      options,
    );
  }

  private applyStackCameraZoomFactor(
    factor: number,
    options?: {persist?: boolean; syncUi?: boolean},
  ): boolean {
    return this.applyStackCameraState(
      scaleStackCameraDistance(this.state.session.stackCamera, factor),
      options,
    );
  }

  private applyStackCameraState(
    nextStackCamera: StackCameraState | null,
    options?: {persist?: boolean; syncUi?: boolean},
  ): boolean {
    if (!nextStackCamera) {
      return false;
    }

    const currentStackCamera = this.state.session.stackCamera;

    if (
      currentStackCamera.azimuthRadians === nextStackCamera.azimuthRadians &&
      currentStackCamera.elevationRadians === nextStackCamera.elevationRadians &&
      currentStackCamera.distanceScale === nextStackCamera.distanceScale
    ) {
      return false;
    }

    this.state = replaceStackCamera(this.state, nextStackCamera);
    this.stackProjector.setStackCamera(this.state.session.stackCamera);

    if (options?.syncUi !== false) {
      this.updateCameraPanel();
      this.updateStatus();
    }
    this.requestRender();

    return true;
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
    this.state = this.captureActiveWorkplaneRuntimeState(this.state);
    this.updateCameraPanel();
    this.syncLabelInputPanel({forceValue: true});
    void syncQuery;
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

  private syncCurrentRouteQueryParams(): void {
    syncStageSessionQueryParam(this.sessionToken);
    syncStageHistoryQueryParam(this.getRouteHistoryStep());
  }

  private getRouteHistoryStep(
    snapshot: StageHistorySnapshot = this.historySnapshot,
  ): number | null {
    if (!this.config.historyTrackingEnabled) {
      return null;
    }

    return snapshot.cursorStep === 0 && snapshot.headStep === 0
      ? null
      : snapshot.cursorStep;
  }

  private persistInitialStageSessionSnapshot(): void {
    if (this.destroyed || !this.config.historyTrackingEnabled) {
      return;
    }

    void this.queueStageSessionSave(
      () =>
        saveStageSessionSnapshot({
          version: 3,
          sessionToken: this.sessionToken,
          savedAt: new Date().toISOString(),
          config: this.getPersistedSessionConfig(),
          history: this.initialHistory,
          ui: this.getPersistedSessionUi(),
        } satisfies PersistedIncrementalStageHistorySession),
      'Failed to save the initial stage session snapshot.',
    );
  }

  private scheduleSessionMetadataSave(): void {
    if (this.destroyed || !this.config.historyTrackingEnabled) {
      return;
    }

    this.pendingHistoryPersistenceSnapshot = {
      cursorStep: this.historySnapshot.cursorStep,
      headStep: this.historySnapshot.headStep,
    };
    this.scheduleHistoryPersistenceFlush();
  }

  private scheduleHistoryPersistenceFlush(): void {
    if (this.destroyed || !this.config.historyTrackingEnabled) {
      return;
    }

    if (this.sessionSaveTimeoutId !== null) {
      window.clearTimeout(this.sessionSaveTimeoutId);
    }

    this.sessionSaveTimeoutId = window.setTimeout(() => {
      this.sessionSaveTimeoutId = null;
      void this.flushPendingHistoryPersistence();
    }, SESSION_SAVE_DEBOUNCE_MS);
  }

  private async flushPendingHistoryPersistence(): Promise<void> {
    const snapshot = this.pendingHistoryPersistenceSnapshot;
    const appends = this.pendingHistoryPersistenceAppends;

    if (!snapshot && appends.length === 0) {
      return;
    }

    this.pendingHistoryPersistenceSnapshot = null;
    this.pendingHistoryPersistenceAppends = [];

    if (appends.length > 0 && snapshot) {
      await this.queueStageSessionSave(
        () =>
          flushStageSessionIncrementalUpdates({
            appends,
            config: this.getPersistedSessionConfig(),
            sessionToken: this.sessionToken,
            snapshot,
            ui: this.getPersistedSessionUi(),
          }),
        'Failed to flush incremental stage history persistence.',
      );
      return;
    }

    if (snapshot) {
      await this.queueStageSessionSave(
        () =>
          saveStageSessionMetadata({
            config: this.getPersistedSessionConfig(),
            sessionToken: this.sessionToken,
            snapshot,
            ui: this.getPersistedSessionUi(),
          }),
        'Failed to save the stage session metadata.',
      );
    }
  }

  private queueStageSessionSave(
    task: () => Promise<void>,
    failureMessage: string,
  ): Promise<void> {
    writeLastStageSessionToken(this.sessionToken);
    this.sessionSaveQueue = this.sessionSaveQueue.then(async () => {
      try {
        await task();
      } catch (error) {
        console.error(failureMessage, error);
      }
    });
    return this.sessionSaveQueue;
  }

  private getPersistedSessionConfig(): PersistedStageSessionConfig {
    return {
      demoLayerCount: this.config.demoLayerCount,
      labelSetKind: this.config.labelSetKind,
    };
  }

  private getPersistedSessionUi(): PersistedStageSessionUi {
    return {
      layoutStrategy: this.layoutStrategy,
      lineStrategy: this.lineStrategy,
      strategyPanelMode: this.strategyPanelMode,
      textStrategy: this.textStrategy,
    };
  }

  private applyWorkplaneAction(action: WorkplaneAction): void {
    if (this.workplaneSyncPending || this.labelInputPending) {
      return;
    }

    const currentState = this.captureActiveWorkplaneRuntimeState(this.state);
    this.state = currentState;
    const nextState = reduceWorkplaneAction(currentState, action);

    if (nextState === currentState) {
      return;
    }

    this.applyStageSystemState(nextState, {
      forceLabelInput: true,
      syncQuery: true,
    });
    this.recordStageHistoryCheckpoint(getWorkplaneHistorySummary(action), nextState);
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

  private handleWindowKeyDown = (event: KeyboardEvent): void => {
    if (
      event.defaultPrevented ||
      this.destroyed ||
      document.body.dataset.benchmarkState === 'running' ||
      this.labelInputPending ||
      this.workplaneSyncPending ||
      isEditableKeyboardTarget(event.target) ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    const stageModeAction = getKeyboardStageModeAction(event);

    if (stageModeAction) {
      event.preventDefault();
      this.applyStageModeAction(stageModeAction);
      return;
    }

    const workplaneAction = getKeyboardWorkplaneAction(event);

    if (workplaneAction) {
      event.preventDefault();
      this.applyWorkplaneAction(workplaneAction);
      return;
    }

    const historyAction = getKeyboardHistoryAction(event);

    if (historyAction) {
      event.preventDefault();
      this.applyHistoryAction(historyAction);
      return;
    }

    const action = getKeyboardControlAction(event);

    if (!action) {
      return;
    }

    event.preventDefault();
    this.applyControlAction(action);
  };

  private handleCanvasPointerDown = (event: PointerEvent): void => {
    if (
      event.defaultPrevented ||
      this.destroyed ||
      this.state.session.stageMode !== '3d-mode' ||
      this.labelInputPending ||
      this.workplaneSyncPending ||
      document.body.dataset.benchmarkState === 'running' ||
      event.button !== 0
    ) {
      return;
    }

    this.stackCameraDrag = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
    this.clearPendingStackCameraHistoryView();
    this.chrome.canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  private handleWindowPointerMove = (event: PointerEvent): void => {
    const drag = this.stackCameraDrag;

    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      this.state.session.stageMode !== '3d-mode' ||
      this.labelInputPending ||
      this.workplaneSyncPending
    ) {
      return;
    }

    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;

    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    this.stackCameraDrag = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
    this.applyStackCameraOrbitDelta(
      -deltaX * STACK_CAMERA_DRAG_RADIANS_PER_PIXEL,
      deltaY * STACK_CAMERA_DRAG_RADIANS_PER_PIXEL,
      {syncUi: false},
    );
    event.preventDefault();
  };

  private handleWindowPointerUp = (event: PointerEvent): void => {
    if (!this.stackCameraDrag || this.stackCameraDrag.pointerId !== event.pointerId) {
      return;
    }

    this.stackCameraDrag = null;
    this.chrome.canvas.releasePointerCapture?.(event.pointerId);
    this.updateCameraPanel();
    this.updateStatus();
    this.recordStageHistoryView('Orbit stack camera');
  };

  private handleCanvasWheel = (event: WheelEvent): void => {
    if (
      event.defaultPrevented ||
      this.destroyed ||
      this.state.session.stageMode !== '3d-mode' ||
      this.labelInputPending ||
      this.workplaneSyncPending ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    const zoomFactor = 2 ** (event.deltaY * STACK_CAMERA_WHEEL_ZOOM_EXPONENT);

    if (this.applyStackCameraZoomFactor(zoomFactor, {persist: true})) {
      this.scheduleStackCameraHistoryView('Zoom stack camera');
      event.preventDefault();
    }
  };

  private handleWindowResize = (): void => {
    if (this.destroyed) {
      return;
    }

    this.requestRender();
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

    if (isStrategyPanelMode(mode)) {
      this.setStrategyPanelMode(mode);
    }
  };

  private handleLabelInputFormSubmit = (event: SubmitEvent): void => {
    event.preventDefault();

    if (
      this.labelInputPending ||
      this.state.session.stageMode === '3d-mode' ||
      this.workplaneSyncPending ||
      this.config.labelSetKind !== 'demo' ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    const activeNode = getActiveLabelFocusedCameraNode(this.labelFocusedCamera);

    if (!activeNode) {
      return;
    }

    const nextText = this.chrome.labelInputField.value;

    if (nextText === activeNode.label.text) {
      this.syncLabelInputPanel({forceValue: true});
      return;
    }

    void this.updateFocusedLabelText(activeNode.key, nextText);
  };

  private setTextStrategy(mode: TextStrategy): void {
    if (
      !this.textLayer ||
      mode === this.textStrategy ||
      this.workplaneSyncPending ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    this.textStrategy = mode;
    this.textLayer.setMode(mode);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    this.updateStrategyPanels();
    this.syncLabelInputPanel();
    this.updateStatus();
    this.scheduleSessionMetadataSave();
    this.requestRender();
  }

  private setLineStrategy(mode: LineStrategy): void {
    if (
      !this.lineLayer ||
      this.config.labelSetKind !== 'demo' ||
      mode === this.lineStrategy ||
      this.workplaneSyncPending ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    this.lineStrategy = mode;
    this.lineLayer.setMode(mode);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    this.updateStrategyPanels();
    this.syncLabelInputPanel();
    this.updateStatus();
    this.scheduleSessionMetadataSave();
    this.requestRender();
  }

  private setLayoutStrategy(mode: LayoutStrategy): void {
    if (
      !this.textLayer ||
      !this.lineLayer ||
      this.config.labelSetKind !== 'demo' ||
      mode === this.layoutStrategy ||
      this.workplaneSyncPending ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    this.layoutStrategy = mode;
    this.setActiveScene(
      this.applyLabelTextOverrides(createDemoStageScene(mode, this.config.demoLayerCount)),
    );
    this.lineLayer.setLinks(this.renderScene.links);
    this.textLayer.setLayoutLabels(this.renderScene.labels);
    this.relayoutDemoCamera(this.labelFocusedCamera?.activeLabelKey ?? null, true);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    this.updateStrategyPanels();
    this.syncLabelInputPanel({forceValue: true});
    this.updateStatus();
    this.recordStageHistoryCheckpoint('Change layout strategy');
    this.requestRender();
  }

  private setStrategyPanelMode(mode: StrategyPanelMode): void {
    if ((mode === 'layout' || mode === 'line' || mode === 'label-edit') && this.config.labelSetKind !== 'demo') {
      return;
    }

    if (mode === this.strategyPanelMode) {
      return;
    }

    this.strategyPanelMode = mode;
    this.updateStrategyPanels();
    this.syncLabelInputPanel();
    this.updateStatus();
    this.scheduleSessionMetadataSave();
    this.requestRender();
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
    this.syncLabelInputPanel();
  }

  private updateCameraPanel(): void {
    syncStageCameraPanel({
      buttons: this.actionButtons,
      cameraAvailability: this.getEffectiveCameraAvailability(),
      cameraEnabled: this.isDemoLabelCameraEnabled(),
    });
  }

  private handleHistorySnapshot = (snapshot: StageHistorySnapshot): void => {
    const previousSnapshot = this.historySnapshot;

    this.historySnapshot = snapshot;
    this.syncHistorySnapshot();

    if (!this.config.historyTrackingEnabled) {
      return;
    }

    if (
      (previousSnapshot.cursorStep === snapshot.cursorStep &&
        previousSnapshot.headStep === snapshot.headStep)
    ) {
      return;
    }

    syncStageHistoryQueryParam(this.getRouteHistoryStep(snapshot));
  };

  private handleHistoryPersistenceChange = (
    change: StageHistoryPersistenceChange,
  ): void => {
    if (this.destroyed || !this.config.historyTrackingEnabled) {
      return;
    }

    this.pendingHistoryPersistenceSnapshot = {
      cursorStep: change.snapshot.cursorStep,
      headStep: change.snapshot.headStep,
    };

    if (change.type === 'append-entry') {
      this.pendingHistoryPersistenceAppends.push({
        entry: change.entry,
        previousHeadStep: change.previousHeadStep,
        step: change.step,
      });
      this.scheduleHistoryPersistenceFlush();
      return;
    }

    this.scheduleHistoryPersistenceFlush();
  };

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

    this.chrome.labelInputForm.addEventListener('submit', this.handleLabelInputFormSubmit);
    this.chrome.canvas.addEventListener('pointerdown', this.handleCanvasPointerDown);
    this.chrome.canvas.addEventListener('wheel', this.handleCanvasWheel, {passive: false});
    window.addEventListener('keydown', this.handleWindowKeyDown);
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerUp);
    window.addEventListener('resize', this.handleWindowResize);
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

    this.chrome.labelInputForm.removeEventListener('submit', this.handleLabelInputFormSubmit);
    this.chrome.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.chrome.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    window.removeEventListener('keydown', this.handleWindowKeyDown);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    window.removeEventListener('resize', this.handleWindowResize);

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
    this.syncLabelInputPanel();
    this.requestRender();
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
      this.syncLabelInputPanel();
      this.updateStatus();
      this.requestRender();
      console.info(`Benchmark complete ${JSON.stringify(this.benchmarkSummary)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      document.body.dataset.benchmarkError = message;
      document.body.dataset.benchmarkState = 'error';
      this.syncLabelInputPanel();
      this.requestRender();
      console.error(`Benchmark failed: ${message}`);
    }
  }

  private getEditableLabelHint(): string {
    if (this.state.session.stageMode === '3d-mode') {
      return 'Stack view disables label editing. Return to 2d-mode to edit the active workplane.';
    }

    if (this.config.labelSetKind !== 'demo') {
      return 'Label editing is only available for the demo label set.';
    }

    const activeNode = getActiveLabelFocusedCameraNode(this.labelFocusedCamera);

    if (!activeNode) {
      return 'No focused demo label is available.';
    }

    return `Focused label ${activeNode.key}`;
  }

  private findSceneLabelByKey(labelKey: string): StageScene['labels'][number] | null {
    return this.scene.labels.find((label) => label.navigation?.key === labelKey) ?? null;
  }

  private applyLabelTextOverrides(scene: StageScene): StageScene {
    const labelTextOverrides = getActiveWorkplaneDocument(this.state).labelTextOverrides;

    for (const label of scene.labels) {
      const labelKey = label.navigation?.key;

      if (!labelKey) {
        continue;
      }

      const overrideText = labelTextOverrides[labelKey];

      if (overrideText !== undefined) {
        label.text = overrideText;
      }
    }

    return scene;
  }

  private setActiveScene(scene: StageScene): void {
    this.scene = scene;
    this.state = replaceWorkplaneScene(
      this.state,
      this.state.session.activeWorkplaneId,
      scene,
    );
    this.syncRenderSceneFromState();
  }

  private syncLabelInputPanel(options?: {forceValue?: boolean}): void {
    const activeNode = getActiveLabelFocusedCameraNode(this.labelFocusedCamera);
    const input = this.chrome.labelInputField;
    const submitButton = this.chrome.labelInputSubmitButton;
    const shouldDisableInput =
      this.labelInputPending ||
      this.state.session.stageMode === '3d-mode' ||
      this.workplaneSyncPending ||
      this.config.labelSetKind !== 'demo' ||
      activeNode === null ||
      document.body.dataset.benchmarkState === 'running';
    const shouldSyncValue =
      Boolean(options?.forceValue) ||
      activeNode?.key !== this.labelInputSyncedKey ||
      (!shouldDisableInput &&
        document.activeElement !== input &&
        activeNode !== null &&
        activeNode.label.text !== this.labelInputSyncedText);

    this.chrome.labelInputHint.textContent = this.getEditableLabelHint();
    input.disabled = shouldDisableInput;
    submitButton.disabled = shouldDisableInput;

    if (!activeNode) {
      this.labelInputSyncedKey = null;
      this.labelInputSyncedText = '';

      if (shouldSyncValue || options?.forceValue) {
        input.value = '';
      }

      return;
    }

    if (shouldSyncValue) {
      input.value = activeNode.label.text;
    }

    this.labelInputSyncedKey = activeNode.key;
    this.labelInputSyncedText = activeNode.label.text;
  }

  private async updateFocusedLabelText(labelKey: string, nextText: string): Promise<void> {
    if (!this.device || !this.textLayer || this.state.session.stageMode === '3d-mode') {
      return;
    }

    const label = this.findSceneLabelByKey(labelKey);

    if (!label || label.text === nextText) {
      this.syncLabelInputPanel({forceValue: true});
      return;
    }

    const previousText = label.text;
    const previousLayer = this.textLayer;
    let nextLayer: TextLayer | null = null;

    this.labelInputPending = true;
    label.text = nextText;
    this.syncLabelInputPanel();

    try {
      nextLayer = new TextLayer(this.device, this.scene.labels, this.textStrategy);
      await nextLayer.ready;

      if (this.destroyed) {
        nextLayer.destroy();
        return;
      }

      this.textLayer = nextLayer;
      previousLayer.destroy();
      this.setActiveScene(this.scene);
      if (label.navigation?.key) {
        this.state = replaceWorkplaneLabelTextOverride(
          this.state,
          this.state.session.activeWorkplaneId,
          label.navigation.key,
          nextText === label.navigation.key ? null : nextText,
        );
      }
      this.benchmarkSummary = null;
      document.body.dataset.benchmarkError = '';
      document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
      this.syncLabelInputPanel({forceValue: true});
      this.updateStatus();
      this.recordStageHistoryCheckpoint('Edit label text');
      this.requestRender();
    } catch (error) {
      label.text = previousText;
      nextLayer?.destroy();
      console.error('Failed to rebuild the text layer after editing a label.', error);
      this.syncLabelInputPanel({forceValue: true});
      this.updateStatus();
      this.requestRender();
    } finally {
      this.labelInputPending = false;
      this.syncLabelInputPanel({forceValue: true});
    }
  }

  private captureActiveWorkplaneRuntimeState(state: StageSystemState): StageSystemState {
    return replaceWorkplaneView(state, state.session.activeWorkplaneId, {
      selectedLabelKey: this.labelFocusedCamera?.activeLabelKey ?? null,
      camera: toWorkplaneCameraView(this.camera.getTargetSnapshot()),
    });
  }

  private applyStageModeAction(action: StageModeAction): void {
    if (this.workplaneSyncPending || this.labelInputPending) {
      return;
    }

    const currentState = this.captureActiveWorkplaneRuntimeState(this.state);
    this.state = currentState;
    const nextState = reduceStageModeAction(currentState, action);

    if (nextState === currentState) {
      return;
    }

    this.applyStageSystemState(nextState, {
      forceLabelInput: true,
      syncQuery: true,
    });
    this.recordStageHistoryCheckpoint('Toggle stage mode', nextState);
  }

  private applyHistoryAction(action: HistoryAction): void {
    if (
      !this.config.historyTrackingEnabled ||
      this.workplaneSyncPending ||
      this.labelInputPending ||
      this.historyReplayPending
    ) {
      return;
    }
    this.clearPendingStackCameraHistoryView();
    this.historyReplayPending = true;
    void this.stageHistory
      .moveCursor(action === 'history-back' ? -1 : 1)
      .then((replayState) => {
        if (!replayState) {
          return;
        }

        this.suppressHistoryRecording = true;

        try {
          this.applyStageSystemState(replayState, {
            forceLabelInput: true,
            syncQuery: true,
          });
        } finally {
          this.suppressHistoryRecording = false;
        }
      })
      .catch((error) => {
        console.error('Failed to replay stage history.', error);
      })
      .finally(() => {
        this.historyReplayPending = false;
      });
  }

  private applyStageSystemState(
    nextState: StageSystemState,
    options?: {forceLabelInput?: boolean; syncQuery?: boolean},
  ): void {
    const nextStackViewState =
      nextState.session.stageMode === '3d-mode' ? createStackViewState(nextState) : undefined;
    const nextRenderScene = this.getRenderSceneForState(nextState, nextStackViewState);

    if (this.requiresTextLayerRebuildForScene(nextRenderScene)) {
      void this.applyStageSystemStateWithTextLayerRebuild(nextState, nextStackViewState, options);
      return;
    }

    this.state = nextState;
    this.applyActiveWorkplaneRuntime(options, nextStackViewState);
  }

  private getRenderSceneForState(
    state: StageSystemState,
    stackViewState?: StackViewState,
  ): StageScene {
    if (state.session.stageMode === '2d-mode') {
      return getActiveWorkplaneDocument(state).scene;
    }

    return (stackViewState ?? createStackViewState(state)).scene;
  }

  private syncRenderSceneFromState(stackViewState?: StackViewState): void {
    this.scene = getActiveWorkplaneDocument(this.state).scene;
    const nextStackViewState =
      this.state.session.stageMode === '3d-mode'
        ? (stackViewState ?? createStackViewState(this.state))
        : null;

    this.stackBackplates = nextStackViewState?.backplates ?? [];
    if (nextStackViewState) {
      this.stackProjector.setSceneBounds(nextStackViewState.sceneBounds);
      this.stackProjector.setOrbitTarget(nextStackViewState.orbitTarget);
    }
    this.stackProjector.setStackCamera(this.state.session.stackCamera);
    this.renderScene =
      this.state.session.stageMode === '3d-mode' && nextStackViewState ? nextStackViewState.scene : this.scene;
  }

  private applyActiveWorkplaneRuntime(options?: {
    forceLabelInput?: boolean;
    syncQuery?: boolean;
  }, stackViewState?: StackViewState): void {
    const view = getActiveWorkplaneView(this.state);

    this.syncRenderSceneFromState(stackViewState);
    this.labelFocusedCamera =
      this.config.labelSetKind === 'demo'
        ? createLabelFocusedCameraState(this.scene.labels, view.selectedLabelKey)
        : null;
    this.camera.setView(view.camera.centerX, view.camera.centerY, view.camera.zoom);
    this.lineLayer?.setLinks(this.renderScene.links);
    this.textLayer?.setLayoutLabels(this.renderScene.labels);

    if (options?.syncQuery) {
      this.syncCurrentRouteQueryParams();
    }

    this.updateCameraPanel();
    this.syncLabelInputPanel({forceValue: options?.forceLabelInput ?? true});
    this.updateStatus();
    this.requestRender();
  }

  private async applyStageSystemStateWithTextLayerRebuild(
    nextState: StageSystemState,
    nextStackViewState: StackViewState | undefined,
    options?: {forceLabelInput?: boolean; syncQuery?: boolean},
  ): Promise<void> {
    if (!this.device || !this.textLayer) {
      this.state = nextState;
      this.applyActiveWorkplaneRuntime(options, nextStackViewState);
      return;
    }

    const generation = ++this.workplaneSyncGeneration;
    const nextRenderScene = this.getRenderSceneForState(nextState, nextStackViewState);
    const nextTextLayer = new TextLayer(this.device, nextRenderScene.labels, this.textStrategy);

    this.workplaneSyncPending = true;
    this.chrome.selectionBox.hidden = true;
    this.updateCameraPanel();
    this.syncLabelInputPanel({forceValue: true});

    try {
      await nextTextLayer.ready;

      if (this.destroyed || generation !== this.workplaneSyncGeneration) {
        nextTextLayer.destroy();
        return;
      }

      const view = getActiveWorkplaneView(nextState);
      const previousTextLayer = this.textLayer;

      this.state = nextState;
      this.syncRenderSceneFromState(nextStackViewState);
      this.labelFocusedCamera =
        this.config.labelSetKind === 'demo'
          ? createLabelFocusedCameraState(this.scene.labels, view.selectedLabelKey)
          : null;
      this.camera.setView(view.camera.centerX, view.camera.centerY, view.camera.zoom);
      this.lineLayer?.setLinks(this.renderScene.links);
      this.textLayer = nextTextLayer;
      previousTextLayer?.destroy();

      if (options?.syncQuery) {
        this.syncCurrentRouteQueryParams();
      }

      this.updateCameraPanel();
      this.syncLabelInputPanel({forceValue: options?.forceLabelInput ?? true});
      this.updateStatus();
      this.requestRender();
    } catch (error) {
      nextTextLayer.destroy();
      console.error('Failed to rebuild the text layer while applying stage runtime.', error);
    } finally {
      if (generation === this.workplaneSyncGeneration) {
        this.workplaneSyncPending = false;
        this.updateCameraPanel();
        this.syncLabelInputPanel({forceValue: true});
      }
    }
  }

  private requiresTextLayerRebuildForScene(scene: StageScene): boolean {
    if (!this.textLayer) {
      return false;
    }

    const currentCharacterSet = new Set(getCharacterSetFromLabels(this.renderScene.labels));

    return getCharacterSetFromLabels(scene.labels).some(
      (character) => !currentCharacterSet.has(character),
    );
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
    const isStackView = this.state.session.stageMode === '3d-mode';
    const snapshot = createStageSnapshot({
      activeLabelNode: getActiveLabelFocusedCameraNode(this.labelFocusedCamera),
      activeWorkplaneIndex:
        getWorkplaneIndex(this.state, this.state.session.activeWorkplaneId) + 1,
      activeWorkplaneId: this.state.session.activeWorkplaneId,
      cameraAnimating: this.camera.isAnimating,
      cameraAvailability: this.getEffectiveCameraAvailability(),
      cameraSnapshot: this.camera.getSnapshot(),
      gpuTimingEnabled: this.config.gpuTimingEnabled,
      gridStats: isStackView ? null : this.gridLayer?.getStats(),
      historyTrackingEnabled: this.config.historyTrackingEnabled,
      labelSetKind: this.config.labelSetKind,
      labelTargetCount: this.config.labelTargetCount,
      layoutStrategy: this.layoutStrategy,
      lineStats: this.lineLayer?.getStats(),
      lineStrategy: this.lineStrategy,
      planeCount: getPlaneCount(this.state),
      perf: this.frameTelemetry?.getSnapshot(),
      scene: this.renderScene,
      stackCamera: this.state.session.stackCamera,
      stageMode: this.state.session.stageMode,
      strategyPanelMode: this.strategyPanelMode,
      textStats: this.textLayer?.getStats(),
      textStrategy: this.textStrategy,
      workplaneCanDelete: canDeleteActiveWorkplane(this.state),
    });

    writeStageSnapshot(snapshot);
    writeStageBenchmarkDatasets(
      createStageBenchmarkDatasets({
        gpuTimingEnabled: this.config.gpuTimingEnabled,
        labelSetKind: this.config.labelSetKind,
        labelTargetCount: this.config.labelTargetCount,
        scene: this.renderScene,
        summary: this.benchmarkSummary,
        textStrategy: this.textStrategy,
      }),
    );
    if (this.chrome.stats.textContent !== snapshot.statsText) {
      this.chrome.stats.textContent = snapshot.statsText;
    }
  }

  private clearPendingStackCameraHistoryView(): void {
    if (this.stackCameraHistoryTimeoutId === null) {
      return;
    }

    window.clearTimeout(this.stackCameraHistoryTimeoutId);
    this.stackCameraHistoryTimeoutId = null;
  }

  private scheduleStackCameraHistoryView(summary: string): void {
    if (!this.isHistoryRecordingEnabled()) {
      return;
    }

    this.clearPendingStackCameraHistoryView();
    this.stackCameraHistoryTimeoutId = window.setTimeout(() => {
      this.stackCameraHistoryTimeoutId = null;
      this.recordStageHistoryView(summary);
    }, STACK_CAMERA_HISTORY_SETTLE_MS);
  }

  private recordStageHistoryCheckpoint(
    summary: string,
    state?: StageSystemState,
  ): void {
    if (!this.isHistoryRecordingEnabled()) {
      return;
    }

    this.clearPendingStackCameraHistoryView();
    this.stageHistory.recordCheckpoint(summary, state ?? this.captureHistoryState());
  }

  private recordStageHistoryView(summary: string, state?: StageSystemState): void {
    if (!this.isHistoryRecordingEnabled()) {
      return;
    }

    this.stageHistory.recordView(summary, state ?? this.captureHistoryState());
  }

  private captureHistoryState(): StageSystemState {
    this.state = this.captureActiveWorkplaneRuntimeState(this.state);
    return this.state;
  }

  private isHistoryRecordingEnabled(): boolean {
    return (
      this.config.historyTrackingEnabled &&
      !this.destroyed &&
      !this.suppressHistoryRecording &&
      !this.benchmarkStarted &&
      document.body.dataset.benchmarkState !== 'running'
    );
  }

  private syncHistorySnapshot(): void {
    const snapshot = this.config.historyTrackingEnabled
      ? this.historySnapshot
      : {
          canGoBack: false,
          canGoForward: false,
          cursorStep: 0,
          headStep: 0,
        };

    document.body.dataset.historyCanGoBack = String(snapshot.canGoBack);
    document.body.dataset.historyCanGoForward = String(snapshot.canGoForward);
    document.body.dataset.historyCursorStep = String(snapshot.cursorStep);
    document.body.dataset.historyHeadStep = String(snapshot.headStep);
  }

  async flushPerformanceTelemetryForTest(): Promise<void> {
    await this.frameTelemetry?.flushGpuSamples();
    this.updateStatus();
  }

  async resetPerformanceTelemetryForTest(): Promise<void> {
    if (!this.frameTelemetry) {
      return;
    }

    await this.frameTelemetry.flushGpuSamples();
    this.frameTelemetry.reset();
    this.lastFrameAt = 0;
    this.updateStatus();
  }

  private getEffectiveCameraAvailability() {
    if (this.state.session.stageMode === '3d-mode') {
      const stackCamera = this.state.session.stackCamera;

      return {
        canMoveDown: stackCamera.elevationRadians < STACK_CAMERA_ELEVATION_MAX_RADIANS - 0.0001,
        canMoveLeft: true,
        canMoveRight: true,
        canMoveUp: stackCamera.elevationRadians > STACK_CAMERA_ELEVATION_MIN_RADIANS + 0.0001,
        canReset: !isStackCameraAtDefault(stackCamera),
        canZoomIn: stackCamera.distanceScale > STACK_CAMERA_DISTANCE_SCALE_MIN + 0.0001,
        canZoomOut: stackCamera.distanceScale < STACK_CAMERA_DISTANCE_SCALE_MAX - 0.0001,
      };
    }

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

      this.requestRender();
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

  private getActiveProjector(viewport: ViewportSize): StageProjector {
    if (this.state.session.stageMode === '3d-mode') {
      this.stackProjector.setViewport(viewport);
      return this.stackProjector;
    }

    return this.planeFocusProjector;
  }

  private requestRender(): void {
    if (this.destroyed || this.frameId !== 0) {
      return;
    }

    this.frameId = window.requestAnimationFrame(this.render);
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

function isStrategyPanelMode(value: string | null | undefined): value is StrategyPanelMode {
  return value === 'text' || value === 'line' || value === 'layout' || value === 'label-edit';
}

function getKeyboardHistoryAction(event: KeyboardEvent): HistoryAction | null {
  if (event.code === 'Comma') {
    return 'history-back';
  }

  if (event.code === 'Period') {
    return 'history-forward';
  }

  return null;
}

function getKeyboardStageModeAction(event: KeyboardEvent): StageModeAction | null {
  return event.code === 'Slash' ? 'toggle-stage-mode' : null;
}

function getKeyboardWorkplaneAction(event: KeyboardEvent): WorkplaneAction | null {
  if (event.key === '[') {
    return 'select-previous-workplane';
  }

  if (event.key === ']') {
    return 'select-next-workplane';
  }

  if (event.key === 'Delete') {
    return 'delete-active-workplane';
  }

  if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
    return 'spawn-workplane';
  }

  return null;
}

function getKeyboardControlAction(event: KeyboardEvent): ControlAction | null {
  switch (event.key) {
    case 'ArrowLeft':
      return 'pan-left';
    case 'ArrowRight':
      return 'pan-right';
    case 'ArrowUp':
      return event.shiftKey ? 'zoom-in' : 'pan-up';
    case 'ArrowDown':
      return event.shiftKey ? 'zoom-out' : 'pan-down';
    default:
      return null;
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
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

function reduceStageModeAction(
  state: StageSystemState,
  action: StageModeAction,
): StageSystemState {
  switch (action) {
    case 'toggle-stage-mode':
      return {
        ...state,
        session: {
          ...state.session,
          stageMode: state.session.stageMode === '2d-mode' ? '3d-mode' : '2d-mode',
        },
      };
    default:
      return state;
  }
}

function reduceWorkplaneAction(
  state: StageSystemState,
  action: WorkplaneAction,
): StageSystemState {
  switch (action) {
    case 'delete-active-workplane':
      return deleteActiveWorkplane(state);
    case 'select-next-workplane':
      return selectNextWorkplane(state);
    case 'select-previous-workplane':
      return selectPreviousWorkplane(state);
    case 'spawn-workplane':
      return spawnWorkplaneAfterActive(state);
    default:
      return state;
  }
}

function getWorkplaneHistorySummary(action: WorkplaneAction): string {
  switch (action) {
    case 'delete-active-workplane':
      return 'Delete workplane';
    case 'select-next-workplane':
      return 'Select next workplane';
    case 'select-previous-workplane':
      return 'Select previous workplane';
    case 'spawn-workplane':
      return 'Spawn workplane';
    default:
      return 'Change workplane';
  }
}

function toWorkplaneCameraView(
  camera: Pick<ReturnType<Camera2D['getTargetSnapshot']>, 'centerX' | 'centerY' | 'zoom'>,
): WorkplaneCameraView {
  return {
    centerX: camera.centerX,
    centerY: camera.centerY,
    zoom: camera.zoom,
  };
}

async function createStageBootPayload(config: StageConfig): Promise<StageBootPayload> {
  const sessionToken = config.requestedSessionToken ?? createSessionToken();
  let persistedSnapshot: PersistedStageSessionRecord | null = null;

  if (config.requestedSessionToken) {
    try {
      persistedSnapshot = await loadStageSessionSnapshot(config.requestedSessionToken);
    } catch (error) {
      console.warn('Failed to load the requested stage session snapshot.', error);
    }
  }

  const hydratedBootState = hydrateStageBootState(config, persistedSnapshot);

  return {
    config: hydratedBootState.config,
    history: hydratedBootState.history,
    initialState: hydratedBootState.initialState,
    sessionToken,
    strategyPanelMode: hydratedBootState.strategyPanelMode ?? DEFAULT_STRATEGY_PANEL_MODE,
  };
}

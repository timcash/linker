import {type Device, type DeviceProps} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {WebGPUDevice} from '@luma.gl/webgpu';

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
import {
  bucketVisibleDagNodes,
  createProjectedDagVisibleNodes,
} from './dag-view';
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
import type {LabelNavigationNode} from './label-navigation';
import {LineLayer} from './line/layer';
import {
  LINE_STRATEGIES,
  type LineStrategy,
} from './line/types';
import {FrameTelemetry} from './perf';
import {
  cloneStageSystemState,
  canDeleteActiveWorkplane,
  canSpawnWorkplane,
  deleteActiveWorkplane,
  focusDagRootWorkplane,
  getActiveWorkplaneDocument,
  getDagControlAvailability,
  getActiveWorkplaneView,
  getPlaneCount,
  getWorkplaneIndex,
  insertDagParentWorkplane,
  moveActiveDagWorkplaneByDepth,
  moveActiveDagWorkplaneByLane,
  moveActiveDagWorkplaneByRank,
  replaceWorkplaneLabelTextOverride,
  replaceStackCamera,
  replaceWorkplaneScene,
  replaceWorkplaneView,
  selectNextWorkplane,
  selectPreviousWorkplane,
  spawnDagChildWorkplane,
  spawnWorkplaneAfterActive,
  type StageSystemState,
  type WorkplaneCameraView,
  type WorkplaneId,
} from './plane-stack';
import {
  createDemoStageScene,
  type StageScene,
} from './scene-model';
import {GRID_LAYER_ZOOM_STEP} from './layer-grid';
import {parseLabelKey} from './label-key';
import {
  PlaneFocusProjector,
  StackCameraProjector,
  type StageProjector,
} from './projector';
import {StackBackplateLayer} from './stack-backplate';
import {
  readStageConfig,
  STAGE_ONBOARDING_COMPLETION_STORAGE_KEY,
  syncStageRouteQueryParams,
  type StageConfig,
} from './stage-config';
import {
  type ControlPadPage,
  syncStageCameraPanel,
  syncStageStrategyPanels,
  type StrategyPanelMode,
} from './stage-panels';
import {createStageChrome, type StageChromeElements} from './stage-chrome';
import {
  syncStageEditorGhostLayer,
  syncStageEditorSelectionBox,
  syncStageEditorSelectionLayer,
} from './stage-editor-overlay';
import {
  addLabelAtStageEditorCursor,
  canLinkStageEditorSelection,
  canRemoveStageEditorLinks,
  clearStageEditorSelection,
  createStageEditorState,
  focusStageEditorLabel,
  getStageEditorFocusedLabel,
  getStageEditorFocusedLabelKey,
  getStageEditorCursorLocation,
  getStageEditorGhosts,
  getStageEditorSelectionRanks,
  linkStageEditorSelection,
  moveStageEditorCursor,
  relayoutStageEditorState,
  removeLabelAtStageEditorCursor,
  removeStageEditorLinks,
  toggleStageEditorSelection,
  type StageEditorCursor,
  type StageEditorDirection,
  type StageEditorState,
} from './stage-editor';
import {
  createStageSnapshot,
  type DagSnapshotState,
  type OnboardingSnapshotState,
  writeStageSnapshot,
} from './stage-snapshot';
import {
  hydrateStageBootState,
  DEFAULT_STRATEGY_PANEL_MODE,
} from './stage-session';
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
  StackCameraAnimator,
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
    __LINKER_TEST_BOOT_STATE__?: TestBootState;
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

const DEMO_DEEP_ZOOM_STEP = GRID_LAYER_ZOOM_STEP;
const STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS = Math.PI / 18;
const STACK_CAMERA_CONTROL_ELEVATION_STEP_RADIANS = Math.PI / 24;
const STACK_CAMERA_DRAG_RADIANS_PER_PIXEL = 0.0055;
const STACK_CAMERA_ZOOM_IN_FACTOR = 0.9;
const STACK_CAMERA_ZOOM_OUT_FACTOR = 1 / STACK_CAMERA_ZOOM_IN_FACTOR;
const STACK_CAMERA_WHEEL_ZOOM_EXPONENT = 0.0015;
const MAX_RENDER_FRAME_DELTA_MS = 33.34;

type AppState = 'loading' | 'ready' | 'unsupported' | 'error';

type ControlAction = LabelFocusedCameraAction;
type EditorAction =
  | 'add-label'
  | 'clear-selection'
  | 'link-selection'
  | 'remove-label'
  | 'remove-links';
type EditorShortcutAction = 'toggle-selection-or-create';
type StageModeAction = 'set-2d-mode' | 'set-3d-mode' | 'toggle-stage-mode';
type StrategyHotkeyAction = 'cycle-line-strategy' | 'cycle-text-strategy';
type DagAction =
  | 'focus-root'
  | 'insert-parent-workplane'
  | 'move-depth-in'
  | 'move-depth-out'
  | 'move-lane-down'
  | 'move-lane-up'
  | 'move-rank-backward'
  | 'move-rank-forward'
  | 'spawn-child-workplane';
type WorkplaneAction =
  | 'delete-active-workplane'
  | 'select-next-workplane'
  | 'select-previous-workplane'
  | 'spawn-workplane';

type StageBootPayload = {
  config: StageConfig;
  initialState: StageSystemState;
  strategyPanelMode: StrategyPanelMode;
};

type TestBootState = {
  initialState: StageSystemState;
  strategyPanelMode?: StrategyPanelMode;
};

type StackCameraDragState = {
  clientX: number;
  clientY: number;
  pointerId: number;
};

type BootPhase =
  | 'awaiting-webgpu'
  | 'creating-device'
  | 'device-created'
  | 'creating-layers'
  | 'awaiting-texture-ready'
  | 'binding-ui'
  | 'ready'
  | 'unsupported'
  | 'error';

type OnboardingPhase = 'complete' | 'dismissed' | 'inactive' | 'running';
type OnboardingStepState = {
  body: string;
  detail: string;
  stepCount: number;
  stepId: string;
  stepIndex: number;
  targetSelectors: string[];
  title: string;
};

export type AppHandle = {
  destroy: () => void;
};

const ONBOARDING_CLICK_SETTLE_MS = 220;
const ONBOARDING_FRAME_SETTLE_MS = 420;
const ONBOARDING_TYPING_DELAY_MS = 72;
const ONBOARDING_TYPING_SETTLE_MS = 180;

export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const stageChrome = createStageChrome(root);
  const bootPayload = createStageBootPayload(readStageConfig(window.location.search));
  const stageController = new LumaStageController(
    stageChrome,
    bootPayload.config,
    bootPayload.initialState,
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
  private editorState: StageEditorState | null = null;
  private editorWorkplaneId: string | null = null;
  private frameTelemetry: FrameTelemetry | null = null;
  private gridLayer: GridLayer | null = null;
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
  private readonly stackCameraAnimator = new StackCameraAnimator();
  private readonly stackProjector = new StackCameraProjector();
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly editorActionButtons: HTMLButtonElement[] = [];
  private readonly editorShortcutButtons: HTMLButtonElement[] = [];
  private readonly layoutStrategyButtons: HTMLButtonElement[] = [];
  private readonly lineStrategyButtons: HTMLButtonElement[] = [];
  private readonly controlPadMenuButtons: HTMLButtonElement[] = [];
  private readonly controlPadTargetButtons: HTMLButtonElement[] = [];
  private readonly dagActionButtons: HTMLButtonElement[] = [];
  private readonly onboardingActionButtons: HTMLButtonElement[] = [];
  private readonly stageModeActionButtons: HTMLButtonElement[] = [];
  private readonly textStrategyButtons: HTMLButtonElement[] = [];
  private readonly workplaneActionButtons: HTMLButtonElement[] = [];
  private controlPadPage: ControlPadPage = 'menu';
  private destroyed = false;
  private labelInputPending = false;
  private labelInputSyncedKey: string | null = null;
  private labelInputSyncedText = '';
  private layoutStrategy: LayoutStrategy;
  private lastFrameAt = 0;
  private lineStrategy: LineStrategy;
  private onboardingPhase: OnboardingPhase;
  private onboardingRunId = 0;
  private onboardingStepState: OnboardingStepState = {
    body: '',
    detail: '',
    stepCount: 0,
    stepId: '',
    stepIndex: 0,
    targetSelectors: [],
    title: 'Linker walkthrough',
  };
  private strategyPanelMode: StrategyPanelMode;
  private textLayerCharacterSet = new Set<string>();
  private textStrategy: TextStrategy;
  private workplaneSyncGeneration = 0;
  private workplaneSyncPending = false;

  constructor(
    private readonly chrome: StageChromeElements,
    private readonly config: StageConfig,
    initialState: StageSystemState,
    strategyPanelMode: StrategyPanelMode,
  ) {
    this.state = initialState;
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
    this.stackCameraAnimator.setView(initialState.session.stackCamera);
    this.stackProjector.setStackCamera(this.stackCameraAnimator.getSnapshot());
    this.layoutStrategy = config.layoutStrategy;
    this.lineStrategy = config.lineStrategy;
    this.onboardingPhase = config.onboardingEnabled ? 'running' : 'inactive';
    this.strategyPanelMode =
      strategyPanelMode === 'label-edit' ? strategyPanelMode : DEFAULT_STRATEGY_PANEL_MODE;
    this.textStrategy = config.textStrategy;
    const initialView = getActiveWorkplaneView(initialState);

    if (config.labelSetKind === 'demo') {
      this.editorState = createStageEditorState(
        this.scene,
        initialView.selectedLabelKey,
      );
      this.editorWorkplaneId = initialState.session.activeWorkplaneId;
    }

    if (config.labelSetKind === 'demo') {
      this.labelFocusedCamera = createOptionalLabelFocusedCameraState(
        this.scene.labels,
        getStageEditorFocusedLabelKey(this.editorState, this.scene) ??
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
    this.setBootPhase('awaiting-webgpu');
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';

    if (!('gpu' in navigator) || !navigator.gpu) {
      this.showUnsupported(
        'WebGPU is unavailable in this browser. Use a current Chromium-based browser with WebGPU enabled.',
      );
      return;
    }

    try {
      this.setBootPhase('creating-device');
      this.device = await createWebGpuDevice({
        id: 'linker-luma-stage',
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

      this.setBootPhase('device-created');
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
      this.setBootPhase('creating-layers');
      const initialTextCharacterSet = this.getTextCharacterSetForScene(this.renderScene);
      this.textLayer = new TextLayer(this.device, this.renderScene.labels, this.textStrategy, {
        characterSet: initialTextCharacterSet,
      });
      this.textLayerCharacterSet = new Set(initialTextCharacterSet);
      this.setBootPhase('awaiting-texture-ready');
      await this.textLayer.ready;
      this.setBootPhase('binding-ui');
      this.installInteractionHandlers();
      this.updateStrategyPanels();
      this.updateCameraPanel();
      this.syncEditorPanel();
      this.syncLabelInputPanel({forceValue: true});
      this.syncHistorySnapshot();
      this.syncOnboardingPanel();
      this.chrome.launchBanner.hidden = true;
      this.chrome.canvas.hidden = false;
      this.syncCanvasDrawingBufferSize();
      this.setState('ready');
      this.setBootPhase('ready');
      this.syncCurrentRouteQueryParams();
      this.updateStatus();
      this.requestRender();
      requestAnimationFrame(() => {
        if (this.destroyed) {
          return;
        }

        this.syncCanvasDrawingBufferSize();
        this.requestRender();
      });

      if (this.config.benchmarkEnabled) {
        void this.runBenchmark();
      }

      if (this.config.onboardingEnabled) {
        void this.startOnboardingWalkthrough();
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
      const planeCameraAnimating = this.camera.advance(deltaMs);
      const stackCameraAnimating = this.stackCameraAnimator.advance(deltaMs);
      const viewport = this.getViewportSize();
      if (this.state.session.stageMode === '3d-mode') {
        this.syncRenderSceneFromState(undefined, {
          stackCamera: this.stackCameraAnimator.getSnapshot(),
          viewport,
        });
      }
      const stageProjector = this.getActiveProjector(viewport);
      const activeLabelNode = this.workplaneSyncPending || this.state.session.stageMode === '3d-mode'
        ? null
        : this.getFocusedEditorLabelNode();

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
        const cursor = this.getEditorCursor();

        syncStageEditorSelectionBox({
          bounds: this.getEditorCursorScreenBounds(),
          cursorKind: cursor?.kind ?? null,
          key: cursor?.key ?? null,
          selectionBox: this.chrome.selectionBox,
        });
        syncStageEditorGhostLayer({
          ghostLayer: this.chrome.editorGhostLayer,
          ghosts: this.getGhostOverlayItems(),
        });
        syncStageEditorSelectionLayer({
          selectionLayer: this.chrome.editorSelectionLayer,
          selections: this.getSelectionRankOverlayItems(),
        });
      } else {
        this.chrome.selectionBox.hidden = true;
        this.chrome.editorGhostLayer.replaceChildren();
        this.chrome.editorSelectionLayer.replaceChildren();
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
      if (planeCameraAnimating || stackCameraAnimating || this.camera.isAnimating || this.stackCameraAnimator.isAnimating) {
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

    this.state = this.captureActiveWorkplaneRuntimeState(this.state);
    const changed = this.isDemoLabelCameraEnabled()
      ? this.applyDemoControlAction(action)
      : this.applyNumericControlAction(action);

    if (changed) {
      this.state = this.captureActiveWorkplaneRuntimeState(this.state);
      this.syncCurrentRouteQueryParams();
      this.requestRender();
    }

    this.updateCameraPanel();
    this.syncEditorPanel();
    this.syncLabelInputPanel();
  }

  private applyDemoControlAction(action: ControlAction): boolean {
    const focusedLabel = this.getFocusedEditorLabel();
    const targetZoom = this.camera.getTargetSnapshot().zoom;

    switch (action) {
      case 'pan-up':
      case 'pan-down':
      case 'pan-left':
      case 'pan-right':
        return this.moveEditorCursor(action);
      case 'zoom-in': {
        if (focusedLabel) {
          const deeperNode = getLabelFocusedCameraTarget(this.labelFocusedCamera, action);

          if (deeperNode && deeperNode.key !== this.labelFocusedCamera?.activeLabelKey) {
            return this.setActiveDemoLabelKey(deeperNode.key);
          }

          return this.syncActiveDemoCameraView({
            zoom: targetZoom + DEMO_DEEP_ZOOM_STEP,
          });
        }

        return this.applyNumericControlAction(action);
      }
      case 'zoom-out': {
        const activeNode = this.getFocusedEditorLabelNode();

        if (focusedLabel && activeNode) {
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

        return this.applyNumericControlAction(action);
      }
      case 'reset-camera': {
        const defaultKey = this.labelFocusedCamera?.navigationIndex.defaultKey;

        if (defaultKey) {
          return this.setActiveDemoLabelKey(defaultKey);
        }

        this.camera.reset();
        return true;
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

    return this.applyStackCameraState(nextStackCamera, {persist: true});
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
    options?: {immediate?: boolean; persist?: boolean; syncUi?: boolean},
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
    if (options?.immediate) {
      this.stackCameraAnimator.setView(this.state.session.stackCamera);
    } else {
      this.stackCameraAnimator.setTargetView(this.state.session.stackCamera);
    }
    this.stackProjector.setStackCamera(this.stackCameraAnimator.getSnapshot());

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
    if (this.editorState) {
      this.editorState = relayoutStageEditorState(
        this.editorState,
        this.scene,
        requestedLabelKey,
      );
    } else {
      this.editorState = createStageEditorState(this.scene, requestedLabelKey);
    }
    this.syncLabelFocusedCameraFromEditor();
    this.syncActiveDemoCameraView({immediate: true});
    this.state = this.captureActiveWorkplaneRuntimeState(this.state);
    if (syncQuery) {
      this.syncCurrentRouteQueryParams();
    }
    this.updateCameraPanel();
    this.syncEditorPanel();
    this.syncLabelInputPanel({forceValue: true});
  }

  private setActiveDemoLabelKey(
    labelKey: string,
    options?: {zoom?: number},
  ): boolean {
    const nextState = withActiveLabelFocusedCameraKey(this.labelFocusedCamera, labelKey);

    if (!nextState) {
      return false;
    }

    if (this.editorState) {
      this.editorState = focusStageEditorLabel(this.editorState, this.scene, labelKey);
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

  private getEditorCursor(): StageEditorCursor | null {
    return this.editorState?.cursor ?? null;
  }

  private getFocusedEditorLabel(): StageScene['labels'][number] | null {
    return getStageEditorFocusedLabel(this.editorState, this.scene);
  }

  private getFocusedEditorLabelKey(): string | null {
    return getStageEditorFocusedLabelKey(this.editorState, this.scene);
  }

  private getFocusedEditorLabelNode(): LabelNavigationNode | null {
    const label = this.getFocusedEditorLabel();

    return label?.navigation
      ? {
          ...label.navigation,
          label,
        }
      : null;
  }

  private focusEditorCursorLabel(labelKey: string): boolean {
    if (!this.editorState) {
      return false;
    }

    const nextEditorState = focusStageEditorLabel(
      this.editorState,
      this.scene,
      labelKey,
    );

    if (nextEditorState.cursor.key === this.editorState.cursor.key) {
      return false;
    }

    this.editorState = nextEditorState;
    this.syncLabelFocusedCameraFromEditor();
    return true;
  }

  private moveEditorCursor(direction: StageEditorDirection): boolean {
    if (!this.editorState) {
      return false;
    }

    const nextEditorState = moveStageEditorCursor(
      this.editorState,
      this.scene,
      direction,
    );

    if (
      nextEditorState.cursor.key === this.editorState.cursor.key &&
      nextEditorState.cursor.kind === this.editorState.cursor.kind
    ) {
      return false;
    }

    this.editorState = nextEditorState;
    this.syncLabelFocusedCameraFromEditor();
    const location = getStageEditorCursorLocation(this.scene, nextEditorState.cursor);
    const targetZoom = this.camera.getTargetSnapshot().zoom;

    this.camera.setTargetView(location.x, location.y, targetZoom);
    return true;
  }

  private syncLabelFocusedCameraFromEditor(): void {
    if (this.config.labelSetKind !== 'demo') {
      this.labelFocusedCamera = null;
      return;
    }

    const focusedLabelKey = this.getFocusedEditorLabelKey();

    if (!this.labelFocusedCamera) {
      this.labelFocusedCamera = createOptionalLabelFocusedCameraState(
        this.scene.labels,
        focusedLabelKey,
      );
      return;
    }

    this.labelFocusedCamera = relayoutOptionalLabelFocusedCameraState(
      this.labelFocusedCamera,
      this.scene.labels,
      focusedLabelKey ?? undefined,
    );
  }

  private syncCurrentRouteQueryParams(): void {
    syncStageRouteQueryParams({
      cameraLabel: this.getFocusedEditorLabelKey(),
      demoPreset: this.config.demoPreset,
      demoLayerCount: this.config.demoLayerCount,
      labelSetKind: this.config.labelSetKind,
      labelTargetCount: this.config.labelTargetCount,
      layoutStrategy: this.layoutStrategy,
      lineStrategy: this.lineStrategy,
      stageMode: this.state.session.stageMode,
      textStrategy: this.textStrategy,
      workplaneId: this.state.session.activeWorkplaneId,
    });
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
  }

  private applyDagAction(action: DagAction): void {
    if (this.workplaneSyncPending || this.labelInputPending) {
      return;
    }

    const currentState = this.captureActiveWorkplaneRuntimeState(this.state);
    this.state = currentState;
    const nextState = reduceDagAction(currentState, action);

    if (nextState === currentState) {
      return;
    }

    this.applyStageSystemState(nextState, {
      forceLabelInput: true,
      syncQuery: true,
    });
  }

  private applyEditorAction(action: EditorAction): void {
    if (
      this.workplaneSyncPending ||
      this.labelInputPending ||
      this.state.session.stageMode === '3d-mode' ||
      this.config.labelSetKind !== 'demo' ||
      document.body.dataset.benchmarkState === 'running' ||
      !this.editorState
    ) {
      return;
    }

    switch (action) {
      case 'add-label': {
        const result = addLabelAtStageEditorCursor(this.scene, this.editorState);
        this.applyEditorMutationResult(result);
        return;
      }
      case 'remove-label': {
        const result = removeLabelAtStageEditorCursor(this.scene, this.editorState);
        this.applyEditorMutationResult(result);
        return;
      }
      case 'link-selection': {
        const result = linkStageEditorSelection(this.scene, this.editorState);
        this.applyEditorMutationResult(result);
        return;
      }
      case 'remove-links': {
        const result = removeStageEditorLinks(this.scene, this.editorState);
        this.applyEditorMutationResult(result);
        return;
      }
      case 'clear-selection': {
        this.editorState = clearStageEditorSelection(this.editorState);
        this.syncLabelFocusedCameraFromEditor();
        this.updateCameraPanel();
        this.syncEditorPanel();
        this.syncLabelInputPanel({forceValue: true});
        this.updateStatus();
        this.requestRender();
        return;
      }
      default:
        return;
    }
  }

  private applyEditorShortcutAction(action: EditorShortcutAction): void {
    switch (action) {
      case 'toggle-selection-or-create':
        this.applyEditorKeyboardShortcut('toggle-selection-or-create');
        return;
      default:
        return;
    }
  }

  private applyEditorKeyboardShortcut(
    action:
      | 'clear-selection'
      | 'link-selection'
      | 'remove-label'
      | 'remove-links'
      | 'toggle-selection-or-create',
  ): void {
    if (
      this.workplaneSyncPending ||
      this.labelInputPending ||
      this.state.session.stageMode === '3d-mode' ||
      this.config.labelSetKind !== 'demo' ||
      document.body.dataset.benchmarkState === 'running' ||
      !this.editorState
    ) {
      return;
    }

    switch (action) {
      case 'toggle-selection-or-create':
        if (this.editorState.cursor.kind === 'ghost') {
          this.applyEditorAction('add-label');
          return;
        }

        this.editorState = toggleStageEditorSelection(this.editorState, this.scene);
        this.syncLabelFocusedCameraFromEditor();
        this.syncEditorPanel();
        this.syncLabelInputPanel({forceValue: true});
        this.updateStatus();
        this.requestRender();
        return;
      case 'clear-selection':
        this.applyEditorAction('clear-selection');
        return;
      case 'link-selection':
        this.applyEditorAction('link-selection');
        return;
      case 'remove-label':
        this.applyEditorAction('remove-label');
        return;
      case 'remove-links':
        this.applyEditorAction('remove-links');
        return;
      default:
        return;
    }
  }

  private applyEditorMutationResult(result: {
    changed: boolean;
    editorState: StageEditorState;
    scene: StageScene;
  }): void {
    this.editorState = result.editorState;
    this.syncLabelFocusedCameraFromEditor();

    if (!result.changed) {
      this.updateCameraPanel();
      this.syncEditorPanel();
      this.syncLabelInputPanel({forceValue: true});
      this.updateStatus();
      this.requestRender();
      return;
    }

    this.applyEditedScene(result.scene);
  }

  private applyEditedScene(nextScene: StageScene): void {
    const nextState = cloneStageSystemState(this.state);
    const activeWorkplaneId = nextState.session.activeWorkplaneId;
    const nextView = nextState.session.workplaneViewsById[activeWorkplaneId];
    const focusedLabelKey = this.getFocusedEditorLabelKey();

    nextState.document.workplanesById[activeWorkplaneId].scene = nextScene;
    nextState.session.workplaneViewsById[activeWorkplaneId] = {
      ...nextView,
      camera: toWorkplaneCameraView(this.camera.getTargetSnapshot()),
      selectedLabelKey: focusedLabelKey,
    };

    this.applyStageSystemState(nextState, {
      forceLabelInput: true,
      syncQuery: true,
    });
  }

  private syncCanvasDrawingBufferSize(): void {
    if (!this.device) {
      return;
    }

    const canvasContext = this.device.getDefaultCanvasContext();
    const rect = this.chrome.canvas.getBoundingClientRect();
    const devicePixelRatio = canvasContext.getDevicePixelRatio();
    const width = Math.max(1, Math.round((rect.width || window.innerWidth) * devicePixelRatio));
    const height = Math.max(1, Math.round((rect.height || window.innerHeight) * devicePixelRatio));

    canvasContext.resize({width, height});
  }

  private getViewportSize(): ViewportSize {
    const rect = this.chrome.canvas.getBoundingClientRect();

    return {
      width: rect.width || window.innerWidth,
      height: rect.height || window.innerHeight,
    };
  }

  private focusSceneLabelAtScreenPoint(
    clientX: number,
    clientY: number,
  ): boolean {
    if (
      this.state.session.stageMode !== '2d-mode' ||
      this.config.labelSetKind !== 'demo' ||
      !this.textLayer
    ) {
      return false;
    }

    const canvasBounds = this.chrome.canvas.getBoundingClientRect();
    const pointX = clientX - canvasBounds.left;
    const pointY = clientY - canvasBounds.top;
    const viewport = this.getViewportSize();
    let bestLabel: StageScene['labels'][number] | null = null;
    let bestArea = Number.POSITIVE_INFINITY;

    for (const label of this.scene.labels) {
      const bounds = this.textLayer.getLabelScreenBounds(
        label,
        this.planeFocusProjector,
        viewport,
      );

      if (
        !bounds ||
        pointX < bounds.left ||
        pointX > bounds.left + bounds.width ||
        pointY < bounds.top ||
        pointY > bounds.top + bounds.height
      ) {
        continue;
      }

      const area = bounds.width * bounds.height;

      if (area < bestArea) {
        bestArea = area;
        bestLabel = label;
      }
    }

    if (!bestLabel?.navigation || !this.focusEditorCursorLabel(bestLabel.navigation.key)) {
      return false;
    }

    this.camera.setTargetView(
      bestLabel.location.x,
      bestLabel.location.y,
      this.camera.getTargetSnapshot().zoom,
    );
    return true;
  }

  private getEditorCursorScreenBounds(): {
    height: number;
    left: number;
    top: number;
    width: number;
  } | null {
    if (!this.editorState || this.state.session.stageMode !== '2d-mode') {
      return null;
    }

    const viewport = this.getViewportSize();
    const focusedLabel = this.getFocusedEditorLabel();

    if (focusedLabel && this.textLayer) {
      return this.textLayer.getLabelScreenBounds(
        focusedLabel,
        this.planeFocusProjector,
        viewport,
      );
    }

    const location = getStageEditorCursorLocation(
      this.scene,
      this.editorState.cursor,
    );
    const center = this.planeFocusProjector.projectWorldPoint(location, viewport);
    const unitSize = this.camera.pixelsPerWorldUnit;
    const width = Math.max(72, unitSize * 2.1);
    const height = Math.max(30, unitSize * 0.88);

    return {
      height,
      left: center.x - width * 0.5,
      top: center.y - height * 0.5,
      width,
    };
  }

  private getGhostOverlayItems(): Array<{
    bounds: {height: number; left: number; top: number; width: number};
    direction: string;
    key: string;
  }> {
    if (!this.editorState || this.state.session.stageMode !== '2d-mode') {
      return [];
    }

    const viewport = this.getViewportSize();
    const unitSize = this.camera.pixelsPerWorldUnit;

    return getStageEditorGhosts(this.scene, this.editorState).map((ghost) => {
      const location = getStageEditorCursorLocation(this.scene, ghost);
      const center = this.planeFocusProjector.projectWorldPoint(location, viewport);
      const width = Math.max(64, unitSize * 1.8);
      const height = Math.max(28, unitSize * 0.76);

      return {
        bounds: {
          height,
          left: center.x - width * 0.5,
          top: center.y - height * 0.5,
          width,
        },
        direction: ghost.direction,
        key: ghost.key,
      };
    });
  }

  private getSelectionRankOverlayItems(): Array<{
    bounds: {height: number; left: number; top: number; width: number};
    key: string;
    rank: number;
  }> {
    if (
      !this.editorState ||
      !this.textLayer ||
      this.state.session.stageMode !== '2d-mode'
    ) {
      return [];
    }

    const viewport = this.getViewportSize();
    const selectionRanks = getStageEditorSelectionRanks(this.editorState);
    const items: Array<{
      bounds: {height: number; left: number; top: number; width: number};
      key: string;
      rank: number;
    }> = [];

    for (const [labelKey, rank] of selectionRanks.entries()) {
      const label = this.scene.labels.find(
        (candidateLabel) => candidateLabel.navigation?.key === labelKey,
      );

      if (!label) {
        continue;
      }

      const bounds = this.textLayer.getLabelScreenBounds(
        label,
        this.planeFocusProjector,
        viewport,
      );

      if (!bounds) {
        continue;
      }

      items.push({
        bounds,
        key: labelKey,
        rank,
      });
    }

    return items;
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

  private handleEditorActionButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.editorAction;

    if (isEditorAction(action)) {
      this.applyEditorAction(action);
    }
  };

  private handleGhostLayerClick = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof HTMLElement) || !this.editorState) {
      return;
    }

    const button = target.closest<HTMLButtonElement>('[data-ghost-key]');
    const ghostKey = button?.dataset.ghostKey;

    if (!ghostKey) {
      return;
    }

    this.editorState = {
      ...this.editorState,
      cursor: {
        ...this.editorState.cursor,
        ...toCursorFromLabelKey(ghostKey),
        kind: 'ghost',
      },
    };
    this.syncLabelFocusedCameraFromEditor();
    this.applyEditorAction('add-label');
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

    const dagAction = getKeyboardDagAction(event);

    if (dagAction) {
      event.preventDefault();
      this.applyDagAction(dagAction);
      return;
    }

    const strategyHotkeyAction = getKeyboardStrategyHotkeyAction(event);

    if (strategyHotkeyAction) {
      event.preventDefault();
      this.applyStrategyHotkeyAction(strategyHotkeyAction);
      return;
    }

    const editorShortcut = getKeyboardEditorShortcut(event);

    if (editorShortcut) {
      event.preventDefault();
      this.applyEditorKeyboardShortcut(editorShortcut);
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
      this.labelInputPending ||
      this.workplaneSyncPending ||
      document.body.dataset.benchmarkState === 'running' ||
      event.button !== 0
    ) {
      return;
    }

    if (this.state.session.stageMode === '2d-mode') {
      if (this.focusSceneLabelAtScreenPoint(event.clientX, event.clientY)) {
        this.state = this.captureActiveWorkplaneRuntimeState(this.state);
        this.syncCurrentRouteQueryParams();
        this.updateCameraPanel();
        this.syncEditorPanel();
        this.syncLabelInputPanel({forceValue: true});
        this.updateStatus();
        this.requestRender();
        event.preventDefault();
      }

      return;
    }

    this.stackCameraDrag = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
    };
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
      event.preventDefault();
    }
  };

  private handleWindowResize = (): void => {
    if (this.destroyed) {
      return;
    }

    this.syncCanvasDrawingBufferSize();
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

  private handleStageModeActionButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.stageModeAction;

    if (isStageModeAction(action)) {
      this.applyStageModeAction(action);
    }
  };

  private handleWorkplaneActionButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.workplaneAction;

    if (isWorkplaneAction(action)) {
      this.applyWorkplaneAction(action);
    }
  };

  private handleDagActionButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.dagAction;

    if (isDagAction(action)) {
      this.applyDagAction(action);
    }
  };

  private handleEditorShortcutButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const action = button.dataset.editorShortcut;

    if (isEditorShortcutAction(action)) {
      this.applyEditorShortcutAction(action);
    }
  };

  private handleControlPadMenuButtonClick = (): void => {
    if (this.controlPadPage === 'menu') {
      return;
    }

    this.controlPadPage = 'menu';
    this.updateStrategyPanels();
    this.updateCameraPanel();
  };

  private handleControlPadTargetButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const target = button.dataset.controlPadTarget as ControlPadPage | undefined;

    if (!target || target === 'menu') {
      return;
    }

    if (target === 'dag' && !this.state.document.dag) {
      return;
    }

    this.controlPadPage = target;
    this.updateStrategyPanels();
    this.updateCameraPanel();
  };

  private handleOnboardingActionButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    switch (button.dataset.onboardAction) {
      case 'dismiss':
        this.dismissOnboardingPanel();
        return;
      case 'replay':
        this.replayOnboardingWalkthrough();
        return;
      case 'skip':
        this.skipOnboardingWalkthrough();
        return;
      default:
        return;
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

    const focusedLabelKey = this.getFocusedEditorLabelKey();
    const focusedLabel = this.getFocusedEditorLabel();

    if (!focusedLabelKey || !focusedLabel) {
      return;
    }

    const nextText = this.chrome.labelInputField.value;

    if (nextText === focusedLabel.text) {
      this.syncLabelInputPanel({forceValue: true});
      return;
    }

    void this.updateFocusedLabelText(focusedLabelKey, nextText);
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
    this.syncCurrentRouteQueryParams();
    this.updateStatus();
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
    this.syncCurrentRouteQueryParams();
    this.updateStatus();
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
    this.syncCurrentRouteQueryParams();
    this.updateStatus();
    this.requestRender();
  }

  private updateStrategyPanels(): void {
    const dagControlAvailability = getDagControlAvailability(this.state);

    document.body.dataset.controlPadPage = this.controlPadPage;
    syncStageStrategyPanels({
      activeWorkplaneIndex:
        getWorkplaneIndex(this.state, this.state.session.activeWorkplaneId) + 1,
      canDeleteWorkplane: canDeleteActiveWorkplane(this.state),
      dagAvailable: Boolean(this.state.document.dag),
      dagControlAvailability,
      canSpawnWorkplane: canSpawnWorkplane(this.state),
      controlPadPage: this.controlPadPage,
      labelSetKind: this.config.labelSetKind,
      lineStrategy: this.lineStrategy,
      planeCount: getPlaneCount(this.state),
      renderPanel: this.chrome.renderPanel,
      stageMode: this.state.session.stageMode,
      strategyModePanel: this.chrome.strategyModePanel,
      strategyPanelMode: this.strategyPanelMode,
      textStrategy: this.textStrategy,
    });
    this.syncEditorPanel();
    this.syncLabelInputPanel();
  }

  private applyStrategyHotkeyAction(action: StrategyHotkeyAction): void {
    switch (action) {
      case 'cycle-line-strategy':
        this.setLineStrategy(getNextStrategyValue(LINE_STRATEGIES, this.lineStrategy));
        break;
      case 'cycle-text-strategy':
        this.setTextStrategy(getNextStrategyValue(TEXT_STRATEGIES, this.textStrategy));
        break;
    }
  }

  private updateCameraPanel(): void {
    syncStageCameraPanel({
      buttons: this.actionButtons,
      cameraAvailability: this.getEffectiveCameraAvailability(),
      cameraEnabled: this.isDemoLabelCameraEnabled(),
    });
  }

  private syncEditorPanel(): void {
    const editorState = this.editorState;
    const focusedLabel = this.getFocusedEditorLabel();
    const editorReady =
      !this.labelInputPending &&
      !this.workplaneSyncPending &&
      this.state.session.stageMode === '2d-mode' &&
      this.config.labelSetKind === 'demo' &&
      document.body.dataset.benchmarkState !== 'running' &&
      editorState !== null;
    const selectedCount = editorState?.selectedLabelKeys.length ?? 0;
    const cursorKey = editorState?.cursor.key ?? '';
    const cursorKind = editorState?.cursor.kind ?? 'ghost';
    const summary =
      this.state.session.stageMode === '3d-mode'
        ? '3D locked'
        : !editorState
        ? 'Unavailable'
        : selectedCount === 0
        ? `${cursorKind === 'ghost' ? 'Ghost' : 'Focus'} ${cursorKey}`
        : `${selectedCount} selected`;

    this.chrome.editorSelectionSummary.textContent = summary;

    for (const button of this.editorActionButtons) {
      const action = button.dataset.editorAction;

      button.disabled =
        !editorReady ||
        !isEditorActionEnabled(action, {
          canAddLabel: editorState?.cursor.kind === 'ghost',
          canClearSelection: selectedCount > 0,
          canLinkSelection: editorState ? canLinkStageEditorSelection(editorState) : false,
          canRemoveLabel: focusedLabel !== null,
          canRemoveLinks:
            editorState !== null && canRemoveStageEditorLinks(this.scene, editorState),
        });
    }

    for (const button of this.editorShortcutButtons) {
      const action = button.dataset.editorShortcut;

      button.disabled = !isEditorShortcutActionEnabled(action, {
        canToggleSelectionOrCreate: editorReady,
      });
    }
  }

  private syncOnboardingPanel(): void {
    const showPanel =
      this.onboardingPhase === 'running' ||
      this.onboardingPhase === 'complete';

    this.chrome.statusPanel.dataset.panelMode = showPanel ? 'onboarding' : 'status';
    this.chrome.onboardPanel.hidden = !showPanel;
    this.chrome.stats.hidden = showPanel;

    if (!showPanel) {
      this.clearOnboardingHighlights();
      return;
    }

    const stepIndex =
      this.onboardingStepState.stepCount <= 0
        ? 0
        : Math.max(1, this.onboardingStepState.stepIndex);

    this.chrome.onboardProgress.textContent =
      this.onboardingStepState.stepCount <= 0
        ? 'Intro ready'
        : `Step ${stepIndex} of ${this.onboardingStepState.stepCount}`;
    this.chrome.onboardTitle.textContent = this.onboardingStepState.title;
    this.chrome.onboardBody.textContent = this.onboardingStepState.body;
    this.chrome.onboardDetail.textContent = this.onboardingStepState.detail;

    const isRunning = this.onboardingPhase === 'running';

    this.chrome.onboardSkipButton.hidden = !isRunning;
    this.chrome.onboardSkipButton.disabled = !isRunning;
    this.chrome.onboardReplayButton.hidden = isRunning;
    this.chrome.onboardReplayButton.disabled = isRunning;
    this.chrome.onboardDismissButton.hidden = this.onboardingPhase !== 'complete';
    this.chrome.onboardDismissButton.disabled = this.onboardingPhase !== 'complete';
  }

  private setOnboardingStepState(input: OnboardingStepState): void {
    this.onboardingStepState = {
      ...input,
      targetSelectors: [...input.targetSelectors],
    };
    this.applyOnboardingHighlights(input.targetSelectors);
    this.syncOnboardingPanel();
  }

  private applyOnboardingHighlights(selectors: string[]): void {
    this.clearOnboardingHighlights();

    for (const selector of selectors) {
      const element = document.querySelector<HTMLElement>(selector);

      if (element) {
        element.dataset.onboardHighlight = 'true';
      }
    }
  }

  private clearOnboardingHighlights(): void {
    for (const element of document.querySelectorAll<HTMLElement>(
      '[data-onboard-highlight="true"], [data-onboard-press="true"]',
    )) {
      delete element.dataset.onboardHighlight;
      delete element.dataset.onboardPress;
    }
  }

  private dismissOnboardingPanel(): void {
    if (this.onboardingPhase !== 'complete') {
      return;
    }

    this.onboardingPhase = 'dismissed';
    this.clearOnboardingHighlights();
    this.syncOnboardingPanel();
    this.updateStatus();
  }

  private skipOnboardingWalkthrough(): void {
    if (this.onboardingPhase !== 'running') {
      return;
    }

    this.onboardingRunId += 1;
    this.onboardingPhase = 'dismissed';
    this.persistOnboardingCompletion();
    this.clearOnboardingHighlights();
    this.syncOnboardingPanel();
    this.updateStatus();
  }

  private replayOnboardingWalkthrough(): void {
    const url = new URL(window.location.href);

    url.search = '';
    url.searchParams.set('onboarding', '1');
    window.location.assign(url.toString());
  }

  private persistOnboardingCompletion(): void {
    try {
      window.localStorage.setItem(STAGE_ONBOARDING_COMPLETION_STORAGE_KEY, '1');
    } catch {
      // Ignore storage failures in private or restricted browser contexts.
    }
  }

  private isOnboardingRunActive(runId: number): boolean {
    return (
      !this.destroyed &&
      this.onboardingPhase === 'running' &&
      this.onboardingRunId === runId
    );
  }

  private ensureOnboardingRunActive(runId: number): void {
    if (!this.isOnboardingRunActive(runId)) {
      throw new Error('Onboarding walkthrough cancelled.');
    }
  }

  private async startOnboardingWalkthrough(): Promise<void> {
    const runId = ++this.onboardingRunId;
    const totalSteps = 25;

    this.onboardingPhase = 'running';
    this.setOnboardingStepState({
      body: 'Linker is starting from one empty root workplane and will author the whole DAG live with the same menu, buttons, and typing flow the user gets.',
      detail: 'The top panel will guide the sequence. You can press Skip any time and take over manually.',
      stepCount: totalSteps,
      stepId: 'intro',
      stepIndex: 0,
      targetSelectors: [],
      title: 'Building a 12-workplane DAG from zero',
    });
    this.updateStatus();

    try {
      await this.waitForOnboardingIdle(runId, {waitForCamera: false});
      await this.runOnboardingWalkthrough(runId, totalSteps);

      if (!this.isOnboardingRunActive(runId)) {
        return;
      }

      this.persistOnboardingCompletion();
      this.onboardingPhase = 'complete';
      this.setOnboardingStepState({
        body: 'The guided run finished on the live 3D overview with a twelve-workplane DAG, richer local labels, and the menu reopened for manual exploration.',
        detail: 'Tap Replay to watch the sequence again, or Stats to restore the live telemetry strip.',
        stepCount: totalSteps,
        stepId: 'complete',
        stepIndex: totalSteps,
        targetSelectors: [],
        title: 'Walkthrough complete',
      });
      this.updateStatus();
    } catch (error) {
      if (!this.isOnboardingRunActive(runId)) {
        return;
      }

      console.error('Onboarding walkthrough failed.', error);
      this.onboardingPhase = 'complete';
      this.setOnboardingStepState({
        body: 'The automated walkthrough paused early, but the editor is still live and ready for manual use.',
        detail: 'Replay will restart the intro from an empty dataset. Stats returns the usual status strip.',
        stepCount: totalSteps,
        stepId: 'error',
        stepIndex: Math.max(this.onboardingStepState.stepIndex, 1),
        targetSelectors: [],
        title: 'Walkthrough paused',
      });
      this.updateStatus();
    } finally {
      this.clearOnboardingHighlights();
      this.syncOnboardingPanel();
    }
  }

  private async runOnboardingWalkthrough(
    runId: number,
    totalSteps: number,
  ): Promise<void> {
    let stepIndex = 0;
    const step = async (input: {
      body: string;
      detail: string;
      stepId: string;
      targetSelectors: string[];
      title: string;
    }): Promise<void> => {
      this.ensureOnboardingRunActive(runId);
      stepIndex += 1;
      this.setOnboardingStepState({
        ...input,
        stepCount: totalSteps,
        stepIndex,
      });
      this.updateStatus();
      await this.waitOnboardingDelay(runId, ONBOARDING_FRAME_SETTLE_MS);
    };

    await this.showOnboardingControlPadPage('menu', runId);
    await step({
      body: 'The bottom control pad now opens as a menu, so new users can jump straight into the right button set instead of cycling blindly.',
      detail: 'Linker uses four pad names here: Map, Stage, DAG, and CRUD.',
      stepId: 'menu-intro',
      targetSelectors: [
        'button[data-control-pad-target="navigate"]',
        'button[data-control-pad-target="stage"]',
        'button[data-control-pad-target="dag"]',
        'button[data-control-pad-target="edit"]',
      ],
      title: 'Open the menu and choose a pad',
    });
    await this.clickOnboardingButton('button[data-control-pad-target="edit"]', runId);

    await step({
      body: 'We begin by converting the first ghost slot into a real label stack on the root workplane.',
      detail: 'The pulsing Select/Create button is the fastest way to grow local content in 2D.',
      stepId: 'root-create',
      targetSelectors: ['button[data-editor-shortcut="toggle-selection-or-create"]'],
      title: 'Create the first label stack',
    });
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);

    await step({
      body: 'Now the input box is live, so Linker can type the first local label directly into the focused stack.',
      detail: 'Typing and Save both happen in the same CRUD pad without leaving the workplane.',
      stepId: 'root-name',
      targetSelectors: ['[data-testid="label-input-field"]', '[data-testid="label-input-submit"]'],
      title: 'Name the root label',
    });
    await this.typeOnboardingFocusedLabel(runId, 'Root Router');

    await this.showOnboardingControlPadPage('navigate', runId);
    await step({
      body: 'The Map pad moves the 2D cursor across labels and empty cells.',
      detail: 'Here the same Right button that pans a camera in stack view advances the local editor cursor.',
      stepId: 'cursor-right',
      targetSelectors: ['button[data-control="pan-right"]'],
      title: 'Move to the next grid cell',
    });
    await this.clickOnboardingButton('button[data-control="pan-right"]', runId);

    await this.showOnboardingControlPadPage('edit', runId);
    await step({
      body: 'The next ghost slot becomes a second stack, which gives the root plane something to link and remove.',
      detail: 'A focused label can be renamed immediately after creation in the same input field.',
      stepId: 'firewall-create',
      targetSelectors: ['button[data-editor-shortcut="toggle-selection-or-create"]'],
      title: 'Create another local label',
    });
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);

    await step({
      body: 'This second label becomes a temporary firewall node so the walkthrough can demonstrate local link CRUD.',
      detail: 'Watch the input field type directly into the focused stack again.',
      stepId: 'firewall-name',
      targetSelectors: ['[data-testid="label-input-field"]', '[data-testid="label-input-submit"]'],
      title: 'Type into the input box',
    });
    await this.typeOnboardingFocusedLabel(runId, 'Firewall');

    await step({
      body: 'Select/Create also toggles ranked selection on existing labels, not just empty cells.',
      detail: 'The current Firewall label becomes selection rank one.',
      stepId: 'firewall-select',
      targetSelectors: ['button[data-editor-shortcut="toggle-selection-or-create"]'],
      title: 'Select the focused label',
    });
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);

    await this.showOnboardingControlPadPage('navigate', runId);
    await step({
      body: 'We move back to the root stack so the second selection can complete a local link pair.',
      detail: 'The same 2D navigation controls are still driving the editor cursor under the hood.',
      stepId: 'cursor-left',
      targetSelectors: ['button[data-control="pan-left"]'],
      title: 'Return to the root stack',
    });
    await this.clickOnboardingButton('button[data-control="pan-left"]', runId);

    await this.showOnboardingControlPadPage('edit', runId);
    await step({
      body: 'Selecting the root label second builds the ranked pair that link creation uses.',
      detail: 'Linker keeps the selection order live so the link button can act on it immediately.',
      stepId: 'root-select',
      targetSelectors: ['button[data-editor-shortcut="toggle-selection-or-create"]'],
      title: 'Add the root to the ranked selection',
    });
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);

    await step({
      body: 'The Link button creates a local workplane connection between the selected labels.',
      detail: 'Local links stay inside one workplane and never affect the global DAG edges.',
      stepId: 'local-link',
      targetSelectors: ['button[data-editor-action="link-selection"]'],
      title: 'Create a local link',
    });
    await this.clickOnboardingButton('button[data-editor-action="link-selection"]', runId);

    await step({
      body: 'Unlink immediately removes that local connection without deleting either label stack.',
      detail: 'This keeps label CRUD and link CRUD separate inside the same workplane.',
      stepId: 'local-unlink',
      targetSelectors: ['button[data-editor-action="remove-links"]'],
      title: 'Remove the local link',
    });
    await this.clickOnboardingButton('button[data-editor-action="remove-links"]', runId);

    await step({
      body: 'Clear drops the ranked selection, then the extra Firewall stack can be removed cleanly.',
      detail: 'The Remove action deletes every authored layer in the focused stack and returns the cell to a ghost slot.',
      stepId: 'local-remove',
      targetSelectors: [
        'button[data-editor-action="clear-selection"]',
        'button[data-editor-action="remove-label"]',
      ],
      title: 'Clear selection and prune the extra label',
    });
    await this.clickOnboardingButton('button[data-editor-action="clear-selection"]', runId);
    await this.showOnboardingControlPadPage('navigate', runId);
    await this.clickOnboardingButton('button[data-control="pan-right"]', runId);
    await this.showOnboardingControlPadPage('edit', runId);
    await this.clickOnboardingButton('button[data-editor-action="remove-label"]', runId);

    await step({
      body: 'Child, Parent, and Delete also support temporary graph surgery before the main fanout begins.',
      detail: 'A short extra chain is created off the root, then removed again, so the final twelve-node build still lands on the clean canonical ids.',
      stepId: 'dag-crud',
      targetSelectors: [
        'button[data-dag-action="spawn-child-workplane"]',
        'button[data-dag-action="insert-parent-workplane"]',
        'button[data-workplane-action="delete-active-workplane"]',
      ],
      title: 'Demonstrate DAG add and remove',
    });
    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await this.clickOnboardingButton('button[data-dag-action="spawn-child-workplane"]', runId);
    await this.clickOnboardingButton('button[data-dag-action="insert-parent-workplane"]', runId);
    await this.navigateToWorkplaneByButtons('wp-2', runId);
    await this.showOnboardingControlPadPage('stage', runId);
    await this.clickOnboardingButton('button[data-workplane-action="delete-active-workplane"]', runId);
    await this.clickOnboardingButton('button[data-workplane-action="delete-active-workplane"]', runId);

    await step({
      body: 'Now the root fans out into four rank-one child workplanes using the DAG control pad only.',
      detail: 'Each Child press creates the next downstream node and makes it active.',
      stepId: 'rank-one',
      targetSelectors: ['button[data-dag-action="spawn-child-workplane"]'],
      title: 'Build the first fanout rank',
    });
    for (let index = 0; index < 4; index += 1) {
      await this.focusRootWithOnboarding(runId);
      await this.showOnboardingControlPadPage('dag', runId);
      await this.clickOnboardingButton('button[data-dag-action="spawn-child-workplane"]', runId, {
        settleMs: ONBOARDING_CLICK_SETTLE_MS,
      });
    }

    await step({
      body: 'Next and Child together build the second rank so each first-rank node fans out one level deeper.',
      detail: 'This is the first time the walkthrough uses stage-page workplane navigation to author across the graph.',
      stepId: 'rank-two',
      targetSelectors: [
        'button[data-workplane-action="select-next-workplane"]',
        'button[data-dag-action="spawn-child-workplane"]',
      ],
      title: 'Build the second fanout rank',
    });
    for (const parentWorkplaneId of ['wp-2', 'wp-3', 'wp-4', 'wp-5'] as const) {
      await this.navigateToWorkplaneByButtons(parentWorkplaneId, runId);
      await this.showOnboardingControlPadPage('dag', runId);
      await this.clickOnboardingButton('button[data-dag-action="spawn-child-workplane"]', runId, {
        settleMs: ONBOARDING_CLICK_SETTLE_MS,
      });
    }

    await step({
      body: 'Three of those second-rank leaves expand once more to finish the target 1-4-4-3 DAG.',
      detail: 'At this point the walkthrough has authored a full twelve-workplane graph from the empty root.',
      stepId: 'rank-three',
      targetSelectors: ['button[data-dag-action="spawn-child-workplane"]'],
      title: 'Finish the twelve-workplane DAG',
    });
    for (const parentWorkplaneId of ['wp-6', 'wp-7', 'wp-8'] as const) {
      await this.navigateToWorkplaneByButtons(parentWorkplaneId, runId);
      await this.showOnboardingControlPadPage('dag', runId);
      await this.clickOnboardingButton('button[data-dag-action="spawn-child-workplane"]', runId, {
        settleMs: ONBOARDING_CLICK_SETTLE_MS,
      });
    }

    await step({
      body: 'Before the camera tour, Linker adds real local labels and links onto several workplanes so the deeper zoom bands reveal meaningful content.',
      detail: 'This keeps the walkthrough zero-data at boot while still showing text and local lines later in 3D.',
      stepId: 'label-seed',
      targetSelectors: ['button[data-editor-shortcut="toggle-selection-or-create"]'],
      title: 'Populate several workplanes',
    });
    await this.navigateToWorkplaneByButtons('wp-2', runId);
    await this.authorOnboardingLinkedPair(runId, ['Ingress', 'Mirror']);
    await this.navigateToWorkplaneByButtons('wp-6', runId);
    await this.authorOnboardingLinkedPair(runId, ['Policy', 'Audit']);
    await this.navigateToWorkplaneByButtons('wp-10', runId);
    await this.authorOnboardingLinkedPair(runId, ['Deploy', 'Alarm']);

    await step({
      body: 'A leaf can slide along the DAG rails in rank, lane, and depth without changing its local 2D label coordinates.',
      detail: 'The walkthrough nudges the active leaf out and back so the final overview still ends on the canonical shape.',
      stepId: 'dag-rails',
      targetSelectors: [
        'button[data-dag-action="move-rank-forward"]',
        'button[data-dag-action="move-lane-down"]',
        'button[data-dag-action="move-depth-in"]',
      ],
      title: 'Move a workplane across the DAG rails',
    });
    await this.showOnboardingControlPadPage('dag', runId);
    await this.clickOnboardingButton('button[data-dag-action="move-rank-forward"]', runId);
    await this.clickOnboardingButton('button[data-dag-action="move-rank-backward"]', runId);
    await this.clickOnboardingButton('button[data-dag-action="move-lane-down"]', runId);
    await this.clickOnboardingButton('button[data-dag-action="move-lane-up"]', runId);
    await this.clickOnboardingButton('button[data-dag-action="move-depth-in"]', runId);
    await this.clickOnboardingButton('button[data-dag-action="move-depth-out"]', runId);

    await step({
      body: 'Now the walkthrough leaves 2D and lifts the finished graph into the global stack view.',
      detail: 'The Stage pad keeps 2D, 3D, and workplane switching in one place.',
      stepId: 'stage-3d',
      targetSelectors: ['button[data-stage-mode-action="set-3d-mode"]'],
      title: 'Enter 3D mode',
    });
    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('stage', runId);
    await this.clickOnboardingButton('button[data-stage-mode-action="set-3d-mode"]', runId, {
      waitForCamera: true,
    });

    await this.zoomOnboardingDagToGraphOverview(runId);
    await step({
      body: 'At the far zoom, every workplane collapses to one graph point so the whole dependency shape fits in view.',
      detail: 'This is the widest LOD band: graph markers plus DAG links only.',
      stepId: 'graph-overview',
      targetSelectors: ['button[data-control="zoom-out"]'],
      title: 'See the far DAG overview',
    });

    await this.navigateToWorkplaneByButtons('wp-6', runId);
    await this.zoomOnboardingDagToTitleOnly(runId);
    await step({
      body: 'One zoom band closer, the graph still fits in view but each workplane now reads as a title card.',
      detail: 'This title-only LOD is the bridge between the abstract DAG and the local plane content.',
      stepId: 'title-only',
      targetSelectors: ['button[data-control="zoom-in"]'],
      title: 'Reveal workplane titles',
    });

    await this.zoomOnboardingDagToLabelPoint(runId);
    await step({
      body: 'Closer again, local label markers appear across the visible DAG so you can see which planes actually contain authored content.',
      detail: 'This label-point LOD keeps the scene light while previewing where the real work lives.',
      stepId: 'label-point',
      targetSelectors: ['button[data-control="zoom-in"]'],
      title: 'Reveal label points',
    });

    await this.zoomOnboardingDagToFullWorkplane(runId);
    await step({
      body: 'At the deepest detail level, Linker hands the selected node off to the 2D plane-focus view so local labels and links become fully readable.',
      detail: 'This is the graph-to-workplane transition: the DAG gets you there, then the workplane editor takes over.',
      stepId: 'full-workplane',
      targetSelectors: ['button[data-stage-mode-action="set-2d-mode"]'],
      title: 'Open the focused workplane',
    });

    await step({
      body: 'The Stage pad can lift that same workplane back into 3D, and Next plus Prev still move around the DAG after the return.',
      detail: 'This keeps the jump between plane-focus and stack view feeling like one continuous map.',
      stepId: 'stage-next-prev',
      targetSelectors: [
        'button[data-stage-mode-action="set-3d-mode"]',
        'button[data-workplane-action="select-next-workplane"]',
        'button[data-workplane-action="select-previous-workplane"]',
      ],
      title: 'Return to 3D and switch workplanes',
    });
    await this.showOnboardingControlPadPage('stage', runId);
    await this.clickOnboardingButton('button[data-stage-mode-action="set-3d-mode"]', runId, {
      waitForCamera: true,
    });
    await this.clickOnboardingButton('button[data-workplane-action="select-next-workplane"]', runId);
    await this.clickOnboardingButton('button[data-workplane-action="select-previous-workplane"]', runId);

    await step({
      body: 'The CRUD pad still controls 3D rendering style, and then Menu returns the user to the four main pads at the end of the tour.',
      detail: 'After the style pass, Root and Reset bring the guided intro back to the clean title-only overview.',
      stepId: 'styles-finish',
      targetSelectors: [
        'button[data-line-strategy="arc-links"]',
        'button[data-text-strategy="sdf-soft"]',
        'button[data-control-pad-action="open-menu"]',
      ],
      title: 'Change styles and reopen the menu',
    });
    await this.showOnboardingControlPadPage('edit', runId);
    await this.clickOnboardingButton('button[data-line-strategy="arc-links"]', runId);
    await this.clickOnboardingButton('button[data-line-strategy="rounded-step-links"]', runId);
    await this.clickOnboardingButton('button[data-text-strategy="sdf-soft"]', runId);
    await this.clickOnboardingButton('button[data-text-strategy="sdf-instanced"]', runId);
    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('navigate', runId);
    await this.clickOnboardingButton('button[data-control="reset-camera"]', runId, {waitForCamera: true});
    await this.zoomOnboardingDagToTitleOnly(runId);
    await this.showOnboardingControlPadPage('menu', runId);
    await this.waitForOnboardingIdle(runId, {waitForCamera: false});
  }

  private async focusRootWithOnboarding(runId: number): Promise<void> {
    if (this.state.session.activeWorkplaneId === this.state.document.dag?.rootWorkplaneId) {
      return;
    }

    await this.showOnboardingControlPadPage('stage', runId);
    await this.clickOnboardingButton('button[data-dag-action="focus-root"]', runId);
  }

  private async navigateToWorkplaneByButtons(
    targetWorkplaneId: WorkplaneId,
    runId: number,
  ): Promise<void> {
    this.ensureOnboardingRunActive(runId);
    const currentIndex = getWorkplaneIndex(this.state, this.state.session.activeWorkplaneId);
    const targetIndex = getWorkplaneIndex(this.state, targetWorkplaneId);

    if (targetIndex < 0 || targetIndex === currentIndex) {
      return;
    }

    await this.showOnboardingControlPadPage('stage', runId);
    const action =
      targetIndex > currentIndex
        ? 'select-next-workplane'
        : 'select-previous-workplane';

    for (let step = 0; step < Math.abs(targetIndex - currentIndex); step += 1) {
      await this.clickOnboardingButton(
        `button[data-workplane-action="${action}"]`,
        runId,
      );
    }
  }

  private async showOnboardingControlPadPage(
    targetPage: ControlPadPage,
    runId: number,
  ): Promise<void> {
    this.ensureOnboardingRunActive(runId);

    if (this.controlPadPage === targetPage) {
      return;
    }

    if (targetPage === 'menu') {
      await this.clickOnboardingButton(
        'button[data-control-pad-action="open-menu"]',
        runId,
        {
          highlight: false,
          settleMs: 120,
          waitForCamera: false,
        },
      );
      return;
    }

    if (this.controlPadPage !== 'menu') {
      await this.clickOnboardingButton(
        'button[data-control-pad-action="open-menu"]',
        runId,
        {
          highlight: false,
          settleMs: 120,
          waitForCamera: false,
        },
      );
    }

    await this.clickOnboardingButton(
      `button[data-control-pad-target="${targetPage}"]`,
      runId,
      {
        highlight: false,
        settleMs: 120,
        waitForCamera: false,
      },
    );
  }

  private async authorOnboardingLinkedPair(
    runId: number,
    labels: readonly [string, string],
  ): Promise<void> {
    await this.showOnboardingControlPadPage('edit', runId);
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);
    await this.typeOnboardingFocusedLabel(runId, labels[0]);
    await this.showOnboardingControlPadPage('navigate', runId);
    await this.clickOnboardingButton('button[data-control="pan-right"]', runId);
    await this.showOnboardingControlPadPage('edit', runId);
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);
    await this.typeOnboardingFocusedLabel(runId, labels[1]);
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);
    await this.showOnboardingControlPadPage('navigate', runId);
    await this.clickOnboardingButton('button[data-control="pan-left"]', runId);
    await this.showOnboardingControlPadPage('edit', runId);
    await this.clickOnboardingButton('button[data-editor-shortcut="toggle-selection-or-create"]', runId);
    await this.clickOnboardingButton('button[data-editor-action="link-selection"]', runId);
    await this.clickOnboardingButton('button[data-editor-action="clear-selection"]', runId);
  }

  private async zoomOnboardingDagToGraphOverview(runId: number): Promise<void> {
    await this.showOnboardingControlPadPage('navigate', runId);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const dagSnapshot = this.getDagSnapshotState(true);
      const planeCount = getPlaneCount(this.state);

      if (
        dagSnapshot &&
        dagSnapshot.graphPointWorkplaneCount === planeCount &&
        dagSnapshot.titleOnlyWorkplaneCount === 0 &&
        dagSnapshot.labelPointWorkplaneCount === 0 &&
        dagSnapshot.fullWorkplaneCount === 0
      ) {
        return;
      }

      await this.clickOnboardingButton('button[data-control="zoom-out"]', runId, {
        waitForCamera: true,
      });
    }

    throw new Error('Timed out while waiting for the onboarding DAG graph overview.');
  }

  private async zoomOnboardingDagToTitleOnly(runId: number): Promise<void> {
    await this.showOnboardingControlPadPage('navigate', runId);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const dagSnapshot = this.getDagSnapshotState(true);
      const planeCount = getPlaneCount(this.state);

      if (
        dagSnapshot &&
        dagSnapshot.graphPointWorkplaneCount < planeCount &&
        dagSnapshot.titleOnlyWorkplaneCount > 0 &&
        dagSnapshot.labelPointWorkplaneCount === 0 &&
        dagSnapshot.fullWorkplaneCount === 0
      ) {
        return;
      }

      const action =
        dagSnapshot && dagSnapshot.graphPointWorkplaneCount === planeCount
          ? 'zoom-in'
          : 'zoom-out';

      await this.clickOnboardingButton(`button[data-control="${action}"]`, runId, {
        waitForCamera: true,
      });
    }

    throw new Error('Timed out while waiting for the onboarding DAG title-only view.');
  }

  private async zoomOnboardingDagToLabelPoint(runId: number): Promise<void> {
    await this.showOnboardingControlPadPage('navigate', runId);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const dagSnapshot = this.getDagSnapshotState(true);

      if (
        dagSnapshot &&
        dagSnapshot.labelPointWorkplaneCount > 0 &&
        dagSnapshot.fullWorkplaneCount === 0
      ) {
        return;
      }

      const action =
        dagSnapshot && dagSnapshot.fullWorkplaneCount > 0
          ? 'zoom-out'
          : 'zoom-in';

      await this.clickOnboardingButton(`button[data-control="${action}"]`, runId, {
        waitForCamera: true,
      });
    }

    throw new Error('Timed out while waiting for the onboarding DAG label-point view.');
  }

  private async zoomOnboardingDagToFullWorkplane(runId: number): Promise<void> {
    await this.showOnboardingControlPadPage('stage', runId);
    await this.clickOnboardingButton('button[data-stage-mode-action="set-2d-mode"]', runId, {
      waitForCamera: true,
    });

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const lineVisibleLinkCount = this.lineLayer?.getStats().lineVisibleLinkCount ?? 0;
      const visibleGlyphCount = this.textLayer?.getStats().visibleGlyphCount ?? 0;

      if (
        this.state.session.stageMode === '2d-mode' &&
        lineVisibleLinkCount > 0 &&
        visibleGlyphCount > 0
      ) {
        return;
      }

      await this.waitOnboardingDelay(runId, 80);
    }

    throw new Error('Timed out while waiting for the onboarding full workplane detail view.');
  }

  private async clickOnboardingButton(
    selector: string,
    runId: number,
    options?: {
      highlight?: boolean;
      settleMs?: number;
      waitForCamera?: boolean;
    },
  ): Promise<void> {
    this.ensureOnboardingRunActive(runId);
    const button = document.querySelector<HTMLButtonElement>(selector);

    if (!(button instanceof HTMLButtonElement) || button.disabled) {
      throw new Error(`Expected an enabled onboarding button for selector ${selector}.`);
    }

    if (options?.highlight !== false) {
      button.dataset.onboardHighlight = 'true';
    }

    button.focus({preventScroll: true});
    button.dataset.onboardPress = 'true';
    await this.waitOnboardingDelay(runId, options?.settleMs ?? 110);
    button.click();
    delete button.dataset.onboardPress;
    await this.waitForOnboardingIdle(runId, {
      waitForCamera: options?.waitForCamera ?? true,
    });
  }

  private async typeOnboardingFocusedLabel(
    runId: number,
    value: string,
  ): Promise<void> {
    this.ensureOnboardingRunActive(runId);
    const input = this.chrome.labelInputField;

    if (input.disabled) {
      throw new Error('Expected the label input field to be enabled during onboarding.');
    }

    input.focus({preventScroll: true});
    input.dataset.onboardHighlight = 'true';
    input.value = '';
    input.dispatchEvent(new InputEvent('input', {bubbles: true, composed: true}));

    for (const character of value) {
      this.ensureOnboardingRunActive(runId);
      input.value += character;
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          composed: true,
          data: character,
          inputType: 'insertText',
        }),
      );
      await this.waitOnboardingDelay(runId, ONBOARDING_TYPING_DELAY_MS);
    }

    await this.waitOnboardingDelay(runId, ONBOARDING_TYPING_SETTLE_MS);
    await this.clickOnboardingButton('[data-testid="label-input-submit"]', runId);
  }

  private async waitForOnboardingIdle(
    runId: number,
    options?: {waitForCamera?: boolean},
  ): Promise<void> {
    const waitForCamera = options?.waitForCamera ?? true;

    for (let attempt = 0; attempt < 180; attempt += 1) {
      this.ensureOnboardingRunActive(runId);

      const cameraAnimating =
        this.camera.isAnimating || this.stackCameraAnimator.isAnimating;

      if (
        !this.labelInputPending &&
        !this.workplaneSyncPending &&
        (!waitForCamera || !cameraAnimating)
      ) {
        return;
      }

      await this.waitForAnimationFrames(1);
    }

    throw new Error('Timed out waiting for onboarding state to settle.');
  }

  private async waitOnboardingDelay(
    runId: number,
    durationMs: number,
  ): Promise<void> {
    this.ensureOnboardingRunActive(runId);
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), durationMs);
    });
    this.ensureOnboardingRunActive(runId);
    await this.waitForAnimationFrames(1);
  }

  private installInteractionHandlers(): void {
    this.actionButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-control]'),
    );
    this.editorActionButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-editor-action]'),
    );
    this.editorShortcutButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-editor-shortcut]'),
    );
    this.controlPadMenuButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-control-pad-action="open-menu"]'),
    );
    this.controlPadTargetButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-control-pad-target]'),
    );
    this.dagActionButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-dag-action]'),
    );
    this.onboardingActionButtons.push(
      this.chrome.onboardSkipButton,
      this.chrome.onboardReplayButton,
      this.chrome.onboardDismissButton,
    );
    this.stageModeActionButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-stage-mode-action]'),
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
    this.workplaneActionButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-workplane-action]'),
    );

    for (const button of this.actionButtons) {
      button.addEventListener('click', this.handleActionButtonClick);
    }

    for (const button of this.editorActionButtons) {
      button.addEventListener('click', this.handleEditorActionButtonClick);
    }

    for (const button of this.editorShortcutButtons) {
      button.addEventListener('click', this.handleEditorShortcutButtonClick);
    }

    for (const button of this.controlPadMenuButtons) {
      button.addEventListener('click', this.handleControlPadMenuButtonClick);
    }

    for (const button of this.controlPadTargetButtons) {
      button.addEventListener('click', this.handleControlPadTargetButtonClick);
    }

    for (const button of this.dagActionButtons) {
      button.addEventListener('click', this.handleDagActionButtonClick);
    }

    for (const button of this.onboardingActionButtons) {
      button.addEventListener('click', this.handleOnboardingActionButtonClick);
    }

    for (const button of this.stageModeActionButtons) {
      button.addEventListener('click', this.handleStageModeActionButtonClick);
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

    for (const button of this.workplaneActionButtons) {
      button.addEventListener('click', this.handleWorkplaneActionButtonClick);
    }

    this.chrome.labelInputForm.addEventListener('submit', this.handleLabelInputFormSubmit);
    this.chrome.editorGhostLayer.addEventListener('click', this.handleGhostLayerClick);
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

    for (const button of this.editorActionButtons) {
      button.removeEventListener('click', this.handleEditorActionButtonClick);
    }

    for (const button of this.editorShortcutButtons) {
      button.removeEventListener('click', this.handleEditorShortcutButtonClick);
    }

    for (const button of this.controlPadMenuButtons) {
      button.removeEventListener('click', this.handleControlPadMenuButtonClick);
    }

    for (const button of this.controlPadTargetButtons) {
      button.removeEventListener('click', this.handleControlPadTargetButtonClick);
    }

    for (const button of this.dagActionButtons) {
      button.removeEventListener('click', this.handleDagActionButtonClick);
    }

    for (const button of this.onboardingActionButtons) {
      button.removeEventListener('click', this.handleOnboardingActionButtonClick);
    }

    for (const button of this.stageModeActionButtons) {
      button.removeEventListener('click', this.handleStageModeActionButtonClick);
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

    for (const button of this.workplaneActionButtons) {
      button.removeEventListener('click', this.handleWorkplaneActionButtonClick);
    }

    this.chrome.labelInputForm.removeEventListener('submit', this.handleLabelInputFormSubmit);
    this.chrome.editorGhostLayer.removeEventListener('click', this.handleGhostLayerClick);
    this.chrome.canvas.removeEventListener('pointerdown', this.handleCanvasPointerDown);
    this.chrome.canvas.removeEventListener('wheel', this.handleCanvasWheel);
    window.removeEventListener('keydown', this.handleWindowKeyDown);
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerUp);
    window.removeEventListener('resize', this.handleWindowResize);

    this.actionButtons.length = 0;
    this.editorActionButtons.length = 0;
    this.editorShortcutButtons.length = 0;
    this.controlPadMenuButtons.length = 0;
    this.controlPadTargetButtons.length = 0;
    this.dagActionButtons.length = 0;
    this.onboardingActionButtons.length = 0;
    this.stageModeActionButtons.length = 0;
    this.textStrategyButtons.length = 0;
    this.lineStrategyButtons.length = 0;
    this.layoutStrategyButtons.length = 0;
    this.workplaneActionButtons.length = 0;
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
      return '3D locked';
    }

    if (this.config.labelSetKind !== 'demo') {
      return 'Demo only';
    }

    const focusedLabel = this.getFocusedEditorLabel();
    const editorCursor = this.getEditorCursor();

    if (!editorCursor) {
      return 'No focus';
    }

    if (!focusedLabel) {
      return `Ghost ${editorCursor.key}`;
    }

    return `Label ${focusedLabel.navigation?.key ?? editorCursor.key}`;
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
    const focusedLabel = this.getFocusedEditorLabel();
    const focusedLabelKey = focusedLabel?.navigation?.key ?? null;
    const input = this.chrome.labelInputField;
    const submitButton = this.chrome.labelInputSubmitButton;
    const shouldDisableInput =
      this.labelInputPending ||
      this.state.session.stageMode === '3d-mode' ||
      this.workplaneSyncPending ||
      this.config.labelSetKind !== 'demo' ||
      focusedLabel === null ||
      document.body.dataset.benchmarkState === 'running';
    const shouldSyncValue =
      Boolean(options?.forceValue) ||
      focusedLabelKey !== this.labelInputSyncedKey ||
      (!shouldDisableInput &&
        document.activeElement !== input &&
        focusedLabel !== null &&
        focusedLabel.text !== this.labelInputSyncedText);

    this.chrome.labelInputHint.textContent = this.getEditableLabelHint();
    input.disabled = shouldDisableInput;
    submitButton.disabled = shouldDisableInput;

    if (!focusedLabel) {
      this.labelInputSyncedKey = null;
      this.labelInputSyncedText = '';

      if (shouldSyncValue || options?.forceValue) {
        input.value = '';
      }

      return;
    }

    if (shouldSyncValue) {
      input.value = focusedLabel.text;
    }

    this.labelInputSyncedKey = focusedLabelKey;
    this.labelInputSyncedText = focusedLabel.text;
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
      const nextTextCharacterSet = this.getTextCharacterSetForScene(this.scene);
      nextLayer = new TextLayer(this.device, this.scene.labels, this.textStrategy, {
        characterSet: nextTextCharacterSet,
      });
      await nextLayer.ready;

      if (this.destroyed) {
        nextLayer.destroy();
        return;
      }

      this.textLayer = nextLayer;
      this.textLayerCharacterSet = new Set(nextTextCharacterSet);
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
      selectedLabelKey: this.getFocusedEditorLabelKey(),
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
  }

  private applyStageSystemState(
    nextState: StageSystemState,
    options?: {forceLabelInput?: boolean; syncQuery?: boolean},
  ): void {
    const nextStackViewState =
      nextState.session.stageMode === '3d-mode'
        ? createStackViewState(nextState, {
            stackCamera: nextState.session.stackCamera,
            viewport: this.getViewportSize(),
          })
        : undefined;
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

  private syncRenderSceneFromState(
    stackViewState?: StackViewState,
    options?: {
      stackCamera?: StackCameraState;
      viewport?: ViewportSize;
    },
  ): void {
    const previousRenderScene = this.renderScene;
    this.scene = getActiveWorkplaneDocument(this.state).scene;
    const nextStackViewState =
      this.state.session.stageMode === '3d-mode'
        ? (stackViewState ?? createStackViewState(this.state, {
            stackCamera: options?.stackCamera ?? this.stackCameraAnimator.getSnapshot(),
            viewport: options?.viewport,
          }))
        : null;

    this.stackBackplates = nextStackViewState?.backplates ?? [];
    if (nextStackViewState) {
      this.stackProjector.setSceneBounds(nextStackViewState.sceneBounds);
      this.stackProjector.setOrbitTarget(nextStackViewState.orbitTarget);
    }
    this.stackProjector.setStackCamera(
      nextStackViewState?.projectorStackCamera ??
        options?.stackCamera ??
        this.stackCameraAnimator.getSnapshot(),
    );
    this.renderScene =
      this.state.session.stageMode === '3d-mode' && nextStackViewState ? nextStackViewState.scene : this.scene;
    if (
      previousRenderScene !== this.renderScene &&
      (previousRenderScene?.labels !== this.renderScene.labels ||
        previousRenderScene?.links !== this.renderScene.links)
    ) {
      this.lineLayer?.setLinks(this.renderScene.links);
      if (this.device && this.textLayer && this.requiresTextLayerRebuildForScene(this.renderScene)) {
        const nextTextCharacterSet = this.getTextCharacterSetForScene(this.renderScene);
        const nextTextLayer = new TextLayer(this.device, this.renderScene.labels, this.textStrategy, {
          characterSet: nextTextCharacterSet,
        });
        const previousTextLayer = this.textLayer;

        this.textLayer = nextTextLayer;
        this.textLayerCharacterSet = new Set(nextTextCharacterSet);
        previousTextLayer.destroy();
      } else {
        this.textLayer?.setLayoutLabels(this.renderScene.labels);
      }
    }
  }

  private applyActiveWorkplaneRuntime(options?: {
    forceLabelInput?: boolean;
    syncQuery?: boolean;
  }, stackViewState?: StackViewState): void {
    const view = getActiveWorkplaneView(this.state);
    const activeWorkplaneId = this.state.session.activeWorkplaneId;

    if (this.state.session.stageMode === '3d-mode') {
      this.stackCameraAnimator.setView(this.state.session.stackCamera);
    }
    this.syncRenderSceneFromState(stackViewState, {
      stackCamera: this.stackCameraAnimator.getSnapshot(),
      viewport: this.getViewportSize(),
    });
    if (this.config.labelSetKind === 'demo') {
      this.editorState =
        this.editorWorkplaneId !== activeWorkplaneId || !this.editorState
          ? createStageEditorState(this.scene, view.selectedLabelKey)
          : relayoutStageEditorState(this.editorState, this.scene, view.selectedLabelKey);
      this.editorWorkplaneId = activeWorkplaneId;
      this.syncLabelFocusedCameraFromEditor();
    } else {
      this.editorState = null;
      this.editorWorkplaneId = null;
      this.labelFocusedCamera = null;
    }
    this.camera.setView(view.camera.centerX, view.camera.centerY, view.camera.zoom);
    this.lineLayer?.setLinks(this.renderScene.links);
    this.textLayer?.setLayoutLabels(this.renderScene.labels);

    if (options?.syncQuery) {
      this.syncCurrentRouteQueryParams();
    }

    this.updateStrategyPanels();
    this.updateCameraPanel();
    this.syncEditorPanel();
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
    const nextTextCharacterSet = this.getTextCharacterSetForScene(nextRenderScene, nextState);
    const nextTextLayer = new TextLayer(this.device, nextRenderScene.labels, this.textStrategy, {
      characterSet: nextTextCharacterSet,
    });

    this.workplaneSyncPending = true;
    this.chrome.selectionBox.hidden = true;
    this.chrome.editorGhostLayer.replaceChildren();
    this.chrome.editorSelectionLayer.replaceChildren();
    this.updateStrategyPanels();
    this.updateCameraPanel();
    this.syncEditorPanel();
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
      if (this.state.session.stageMode === '3d-mode') {
        this.stackCameraAnimator.setView(this.state.session.stackCamera);
      }
      this.syncRenderSceneFromState(nextStackViewState, {
        stackCamera: this.stackCameraAnimator.getSnapshot(),
        viewport: this.getViewportSize(),
      });
      if (this.config.labelSetKind === 'demo') {
        this.editorState =
          this.editorWorkplaneId !== nextState.session.activeWorkplaneId || !this.editorState
            ? createStageEditorState(this.scene, view.selectedLabelKey)
            : relayoutStageEditorState(this.editorState, this.scene, view.selectedLabelKey);
        this.editorWorkplaneId = nextState.session.activeWorkplaneId;
        this.syncLabelFocusedCameraFromEditor();
      } else {
        this.editorState = null;
        this.editorWorkplaneId = null;
        this.labelFocusedCamera = null;
      }
      this.camera.setView(view.camera.centerX, view.camera.centerY, view.camera.zoom);
      this.lineLayer?.setLinks(this.renderScene.links);
      this.textLayer = nextTextLayer;
      this.textLayerCharacterSet = new Set(nextTextCharacterSet);
      previousTextLayer?.destroy();

      if (options?.syncQuery) {
        this.syncCurrentRouteQueryParams();
      }

      this.updateStrategyPanels();
      this.updateCameraPanel();
      this.syncEditorPanel();
      this.syncLabelInputPanel({forceValue: options?.forceLabelInput ?? true});
      this.updateStatus();
      this.requestRender();
    } catch (error) {
      nextTextLayer.destroy();
      console.error('Failed to rebuild the text layer while applying stage runtime.', error);
    } finally {
      if (generation === this.workplaneSyncGeneration) {
        this.workplaneSyncPending = false;
        this.updateStrategyPanels();
        this.updateCameraPanel();
        this.syncEditorPanel();
        this.syncLabelInputPanel({forceValue: true});
      }
    }
  }

  private requiresTextLayerRebuildForScene(scene: StageScene): boolean {
    if (!this.textLayer) {
      return false;
    }

    return this.getTextCharacterSetForScene(scene).some(
      (character) => !this.textLayerCharacterSet.has(character),
    );
  }

  private getTextCharacterSetForScene(
    scene: StageScene,
    state: StageSystemState = this.state,
  ): string[] {
    const characters = new Set(getCharacterSetFromLabels(scene.labels));

    if (state.session.stageMode !== '3d-mode' || !state.document.dag) {
      return [...characters];
    }

    for (const workplaneId of state.document.workplaneOrder) {
      appendCharacters(characters, workplaneId);

      for (const label of state.document.workplanesById[workplaneId]?.scene.labels ?? []) {
        appendCharacters(characters, label.text);
      }
    }

    characters.add('+');

    return [...characters];
  }

  private setState(state: AppState): void {
    document.body.dataset.appState = state;
  }

  private setBootPhase(phase: BootPhase): void {
    document.body.dataset.bootPhase = phase;
  }

  private showError(error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown startup error';

    this.setState('error');
    this.setBootPhase('error');
    this.chrome.canvas.hidden = true;
    this.chrome.launchBanner.hidden = false;
    this.chrome.launchBanner.innerHTML = `
      <strong>Startup Failed</strong>
      <p>${escapeHtml(message)}</p>
    `;
  }

  private showUnsupported(message: string): void {
    this.setState('unsupported');
    this.setBootPhase('unsupported');
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
      activeLabelNode: this.getFocusedEditorLabelNode(),
      activeWorkplaneIndex:
        getWorkplaneIndex(this.state, this.state.session.activeWorkplaneId) + 1,
      activeWorkplaneId: this.state.session.activeWorkplaneId,
      cameraAnimating: this.camera.isAnimating || this.stackCameraAnimator.isAnimating,
      cameraAvailability: this.getEffectiveCameraAvailability(),
      cameraSnapshot: this.camera.getSnapshot(),
      dag: this.getDagSnapshotState(isStackView),
      documentBridgeLinkCount: this.state.document.workplaneBridgeLinks.length,
      documentLabelCount: this.state.document.workplaneOrder.reduce(
        (total, workplaneId) =>
          total + this.state.document.workplanesById[workplaneId].scene.labels.length,
        0,
      ),
      documentLinkCount: this.state.document.workplaneOrder.reduce(
        (total, workplaneId) =>
          total + this.state.document.workplanesById[workplaneId].scene.links.length,
        0,
      ) + this.state.document.workplaneBridgeLinks.length,
      editorCursor: this.getEditorCursor(),
      editorSelectedLabelCount: this.editorState?.selectedLabelKeys.length ?? 0,
      editorSelectedLabelKeys: this.editorState?.selectedLabelKeys ?? [],
      gpuTimingEnabled: this.config.gpuTimingEnabled,
      gridStats: isStackView ? null : this.gridLayer?.getStats(),
      labelSetKind: this.config.labelSetKind,
      labelTargetCount: this.config.labelTargetCount,
      layoutStrategy: this.layoutStrategy,
      lineStats: this.lineLayer?.getStats(),
      lineStrategy: this.lineStrategy,
      onboarding: this.getOnboardingSnapshotState(),
      planeCount: getPlaneCount(this.state),
      perf: this.frameTelemetry?.getSnapshot(),
      renderBridgeLinkCount: countRenderedBridgeLinks(this.renderScene),
      scene: this.renderScene,
      stackCamera: this.stackCameraAnimator.getSnapshot(),
      stageMode: this.state.session.stageMode,
      strategyPanelMode: this.strategyPanelMode,
      textStats: this.textLayer?.getStats(),
      textStrategy: this.textStrategy,
      workplaneCanDelete: canDeleteActiveWorkplane(this.state),
    });

    writeStageSnapshot(snapshot);
    this.syncOnboardingPanel();
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
    if (this.chrome.stats.dataset.signature !== snapshot.statsSignature) {
      renderStatusRows(this.chrome.stats, snapshot.statsRows);
      this.chrome.stats.dataset.signature = snapshot.statsSignature;
    }
  }

  private getDagSnapshotState(
    isStackView: boolean,
  ): DagSnapshotState | null {
    const dag = this.state.document.dag;

    if (!dag) {
      return null;
    }

    const dagControlAvailability = getDagControlAvailability(this.state);
    const dagLodBuckets = isStackView
      ? bucketVisibleDagNodes(
          createProjectedDagVisibleNodes(this.state, this.getViewportSize(), {
            stackCamera: this.stackCameraAnimator.getSnapshot(),
          }),
        )
      : null;

    return {
      activePosition: dag.positionsById[this.state.session.activeWorkplaneId] ?? null,
      canFocusRoot: dagControlAvailability?.canFocusRoot ?? false,
      canInsertParent: dagControlAvailability?.canInsertParent ?? false,
      canMoveDepthIn: dagControlAvailability?.canMoveDepthIn ?? false,
      canMoveDepthOut: dagControlAvailability?.canMoveDepthOut ?? false,
      canMoveLaneDown: dagControlAvailability?.canMoveLaneDown ?? false,
      canMoveLaneUp: dagControlAvailability?.canMoveLaneUp ?? false,
      canMoveRankBackward: dagControlAvailability?.canMoveRankBackward ?? false,
      canMoveRankForward: dagControlAvailability?.canMoveRankForward ?? false,
      canSpawnChild: dagControlAvailability?.canSpawnChild ?? false,
      edgeCount: dag.edges.length,
      fullWorkplaneCount: dagLodBuckets?.fullWorkplanes.length ?? 0,
      graphPointWorkplaneCount: dagLodBuckets?.graphPointWorkplanes.length ?? 0,
      labelPointWorkplaneCount: dagLodBuckets?.labelPointWorkplanes.length ?? 0,
      layoutFingerprint: getDagLayoutFingerprint(dag.positionsById),
      nodeCount: Object.keys(dag.positionsById).length,
      rootWorkplaneId: dag.rootWorkplaneId,
      titleOnlyWorkplaneCount: dagLodBuckets?.titleOnlyWorkplanes.length ?? 0,
      visibleEdgeCount: isStackView ? countRenderedBridgeLinks(this.renderScene) : 0,
      visibleWorkplaneCount: isStackView ? this.stackBackplates.length : 0,
    };
  }

  private getOnboardingSnapshotState(): OnboardingSnapshotState {
    return {
      panelVisible:
        this.onboardingPhase === 'running' ||
        this.onboardingPhase === 'complete',
      state: this.onboardingPhase,
      stepCount: this.onboardingStepState.stepCount,
      stepId: this.onboardingStepState.stepId,
      stepIndex: this.onboardingStepState.stepIndex,
    };
  }

  private syncHistorySnapshot(): void {
    document.body.dataset.historyCanGoBack = 'false';
    document.body.dataset.historyCanGoForward = 'false';
    document.body.dataset.historyCursorStep = '0';
    document.body.dataset.historyHeadStep = '0';
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

    const editorCursor = this.getEditorCursor();
    const focusedLabel = this.getFocusedEditorLabel();

    if (this.config.labelSetKind === 'demo' && editorCursor) {
      const snapshot = this.camera.getTargetSnapshot();

      return {
        canMoveDown: true,
        canMoveLeft: true,
        canMoveRight: true,
        canMoveUp: true,
        canReset:
          Math.abs(snapshot.centerX) > 0.0001 ||
          Math.abs(snapshot.centerY) > 0.0001 ||
          Math.abs(snapshot.zoom) > 0.0001 ||
          editorCursor.kind === 'ghost',
        canZoomIn: true,
        canZoomOut: focusedLabel
          ? snapshot.zoom > focusedLabel.zoomLevel + 0.0001 ||
            Boolean(getLabelFocusedCameraTarget(this.labelFocusedCamera, 'zoom-out'))
          : true,
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

async function createWebGpuDevice(props: DeviceProps): Promise<Device> {
  const gpuNavigator = navigator as Navigator & {
    gpu?: {
      requestAdapter: (options?: {powerPreference?: string}) => Promise<{
        features: Iterable<unknown>;
        info?: unknown;
        limits: Record<string, unknown>;
        requestAdapterInfo?: () => Promise<unknown>;
        requestDevice: (options: {
          requiredFeatures: unknown[];
          requiredLimits: Record<string, number>;
        }) => Promise<unknown>;
      } | null>;
    };
  };

  if (!gpuNavigator.gpu) {
    throw new Error('WebGPU not available. Recent Chrome browsers should work.');
  }

  const adapter = await gpuNavigator.gpu.requestAdapter({
  });

  if (!adapter) {
    throw new Error('Failed to request WebGPU adapter');
  }

  const adapterInfo =
    adapter.info ||
    (await adapter.requestAdapterInfo?.());
  const requiredFeatures: unknown[] = [];
  const requiredLimits: Record<string, number> = {};

  if (props._requestMaxLimits ?? true) {
    requiredFeatures.push(...Array.from(adapter.features));

    for (const key of Object.keys(adapter.limits)) {
      if (key === 'minSubgroupSize' || key === 'maxSubgroupSize') {
        continue;
      }

      const value = adapter.limits[key];

      if (typeof value === 'number') {
        requiredLimits[key] = value;
      }
    }
  }

  const gpuDevice = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits,
  });

  return new WebGPUDevice(props, gpuDevice as never, adapter as never, adapterInfo as never);
}

function renderStatusRows(
  container: HTMLElement,
  rows: Array<{label: string; value: string}>,
): void {
  const fragment = document.createDocumentFragment();

  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'status-live-row';

    const label = document.createElement('span');
    label.className = 'status-live-label';
    label.textContent = row.label;

    const value = document.createElement('span');
    value.className = 'status-live-value';
    value.textContent = row.value;

    item.append(label, value);
    fragment.append(item);
  }

  container.replaceChildren(fragment);
}

function isStageModeAction(value: string | null | undefined): value is StageModeAction {
  return value === 'set-2d-mode' || value === 'set-3d-mode' || value === 'toggle-stage-mode';
}

function isWorkplaneAction(value: string | null | undefined): value is WorkplaneAction {
  return (
    value === 'delete-active-workplane' ||
    value === 'select-next-workplane' ||
    value === 'select-previous-workplane' ||
    value === 'spawn-workplane'
  );
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

  if (event.code === 'Minus') {
    return 'delete-active-workplane';
  }

  if (event.key === '+' || (event.key === '=' && event.shiftKey)) {
    return 'spawn-workplane';
  }

  return null;
}

function getKeyboardDagAction(event: KeyboardEvent): DagAction | null {
  if (event.shiftKey) {
    return null;
  }

  switch (event.code) {
    case 'KeyC':
      return 'spawn-child-workplane';
    case 'KeyF':
      return 'focus-root';
    case 'KeyH':
      return 'move-rank-backward';
    case 'KeyI':
      return 'move-depth-in';
    case 'KeyJ':
      return 'move-lane-down';
    case 'KeyK':
      return 'move-lane-up';
    case 'KeyL':
      return 'move-rank-forward';
    case 'KeyP':
      return 'insert-parent-workplane';
    case 'KeyU':
      return 'move-depth-out';
    default:
      return null;
  }
}

function getKeyboardStrategyHotkeyAction(event: KeyboardEvent): StrategyHotkeyAction | null {
  if (event.shiftKey && event.code === 'KeyL') {
    return 'cycle-line-strategy';
  }

  if (event.shiftKey && event.code === 'KeyT') {
    return 'cycle-text-strategy';
  }

  return null;
}

function getKeyboardEditorShortcut(
  event: KeyboardEvent,
):
  | 'clear-selection'
  | 'link-selection'
  | 'remove-label'
  | 'remove-links'
  | 'toggle-selection-or-create'
  | null {
  if (event.key === 'Enter') {
    return event.shiftKey ? 'link-selection' : 'toggle-selection-or-create';
  }

  if (event.key === 'Escape') {
    return 'clear-selection';
  }

  if (event.key === 'Delete') {
    return event.shiftKey ? 'remove-links' : 'remove-label';
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

function getNextStrategyValue<TValue extends string>(
  strategies: readonly TValue[],
  currentValue: TValue,
): TValue {
  const fallbackValue = strategies[0] ?? currentValue;
  const currentIndex = strategies.indexOf(currentValue);
  const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % strategies.length;
  return strategies[nextIndex] ?? fallbackValue;
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

function isEditorAction(value: string | null | undefined): value is EditorAction {
  return (
    value === 'add-label' ||
    value === 'clear-selection' ||
    value === 'link-selection' ||
    value === 'remove-label' ||
    value === 'remove-links'
  );
}

function isEditorShortcutAction(value: string | null | undefined): value is EditorShortcutAction {
  return value === 'toggle-selection-or-create';
}

function isDagAction(value: string | null | undefined): value is DagAction {
  return (
    value === 'focus-root' ||
    value === 'insert-parent-workplane' ||
    value === 'move-depth-in' ||
    value === 'move-depth-out' ||
    value === 'move-lane-down' ||
    value === 'move-lane-up' ||
    value === 'move-rank-backward' ||
    value === 'move-rank-forward' ||
    value === 'spawn-child-workplane'
  );
}

function isEditorActionEnabled(
  action: string | null | undefined,
  options: {
    canAddLabel: boolean;
    canClearSelection: boolean;
    canLinkSelection: boolean;
    canRemoveLabel: boolean;
    canRemoveLinks: boolean;
  },
): boolean {
  switch (action) {
    case 'add-label':
      return options.canAddLabel;
    case 'clear-selection':
      return options.canClearSelection;
    case 'link-selection':
      return options.canLinkSelection;
    case 'remove-label':
      return options.canRemoveLabel;
    case 'remove-links':
      return options.canRemoveLinks;
    default:
      return false;
  }
}

function isEditorShortcutActionEnabled(
  action: string | null | undefined,
  options: {
    canToggleSelectionOrCreate: boolean;
  },
): boolean {
  switch (action) {
    case 'toggle-selection-or-create':
      return options.canToggleSelectionOrCreate;
    default:
      return false;
  }
}

function toCursorFromLabelKey(
  labelKey: string,
) : Pick<StageEditorCursor, 'column' | 'key' | 'layer' | 'row' | 'workplaneId'> {
  const parsed = parseLabelKey(labelKey);

  return {
    column: parsed.column,
    key: labelKey,
    layer: parsed.layer,
    row: parsed.row,
    workplaneId: parsed.workplaneId,
  };
}

function reduceStageModeAction(
  state: StageSystemState,
  action: StageModeAction,
): StageSystemState {
  switch (action) {
    case 'set-2d-mode':
      if (state.session.stageMode === '2d-mode') {
        return state;
      }

      return {
        ...state,
        session: {
          ...state.session,
          stageMode: '2d-mode',
        },
      };
    case 'set-3d-mode':
      if (state.session.stageMode === '3d-mode') {
        return state;
      }

      return {
        ...state,
        session: {
          ...state.session,
          stageMode: '3d-mode',
        },
      };
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
  if (state.document.dag && action === 'spawn-workplane') {
    return state;
  }

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

function reduceDagAction(
  state: StageSystemState,
  action: DagAction,
): StageSystemState {
  switch (action) {
    case 'focus-root':
      return focusDagRootWorkplane(state);
    case 'insert-parent-workplane':
      return insertDagParentWorkplane(state);
    case 'move-depth-in':
      return moveActiveDagWorkplaneByDepth(state, 1);
    case 'move-depth-out':
      return moveActiveDagWorkplaneByDepth(state, -1);
    case 'move-lane-down':
      return moveActiveDagWorkplaneByLane(state, 1);
    case 'move-lane-up':
      return moveActiveDagWorkplaneByLane(state, -1);
    case 'move-rank-backward':
      return moveActiveDagWorkplaneByRank(state, -1);
    case 'move-rank-forward':
      return moveActiveDagWorkplaneByRank(state, 1);
    case 'spawn-child-workplane':
      return spawnDagChildWorkplane(state);
    default:
      return state;
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

function createOptionalLabelFocusedCameraState(
  labels: StageScene['labels'],
  requestedLabelKey: string | null | undefined,
): LabelFocusedCameraState | null {
  return labels.length > 0
    ? createLabelFocusedCameraState(labels, requestedLabelKey)
    : null;
}

function relayoutOptionalLabelFocusedCameraState(
  previousState: LabelFocusedCameraState | null,
  labels: StageScene['labels'],
  requestedLabelKey?: string | null,
): LabelFocusedCameraState | null {
  return labels.length > 0
    ? relayoutLabelFocusedCameraState(previousState, labels, requestedLabelKey)
    : null;
}

function createStageBootPayload(config: StageConfig): StageBootPayload {
  const testBootState = window.__LINKER_TEST_BOOT_STATE__ ?? null;
  delete window.__LINKER_TEST_BOOT_STATE__;
  const hydratedBootState = hydrateStageBootState(
    config,
    testBootState?.initialState ?? null,
  );

  return {
    config: hydratedBootState.config,
    initialState: hydratedBootState.initialState,
    strategyPanelMode: testBootState?.strategyPanelMode
      ?? hydratedBootState.strategyPanelMode
      ?? DEFAULT_STRATEGY_PANEL_MODE,
  };
}

function countRenderedBridgeLinks(scene: StageScene): number {
  return scene.links.filter((link) => link.linkKey.startsWith('bridge:')).length;
}

function getDagLayoutFingerprint(
  positionsById: Record<string, {column: number; row: number; layer: number}>,
): string {
  return Object.entries(positionsById)
    .sort(([leftWorkplaneId], [rightWorkplaneId]) =>
      leftWorkplaneId.localeCompare(rightWorkplaneId, undefined, {numeric: true}),
    )
    .map(([workplaneId, position]) => {
      return `${workplaneId}:${position.column}:${position.row}:${position.layer}`;
    })
    .join('|');
}

function appendCharacters(characters: Set<string>, text: string): void {
  for (const character of text) {
    characters.add(character);
  }
}

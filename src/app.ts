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
import {DAG_RANK_FANOUT_ROOT_LABEL_TEXT} from './data/dag-rank-fanout';
import {
  DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX,
  DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX,
  DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX,
  bucketVisibleDagNodes,
  createProjectedDagVisibleNodes,
  resolveWorkplaneLod,
  type WorkplaneLod,
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
  type StageMode,
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
  cloneStageScene,
  createDemoStageScene,
  type StageScene,
} from './scene-model';
import {GRID_LAYER_ZOOM_STEP} from './layer-grid';
import {buildLabelKey, parseLabelKey} from './label-key';
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
import {createSiteMenu} from './docs-shell';
import {
  readStoredAppSettings,
  writeStoredAppSettings,
  type AppMotionPreference,
  type AppOnboardingPreference,
  type AppUiLayout,
  type StoredAppSettings,
} from './site-settings';
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
  normalizeStackCameraState,
  orbitStackCamera,
  scaleStackCameraDistance,
  type StackCameraState,
} from './stack-camera';
import {getCharacterSetFromLabels} from './text/charset';
import {TextLayer} from './text/layer';
import {
  TEXT_STRATEGIES,
  type RgbaColor,
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
const TRON_REFERENCE_WHITE: RgbaColor = [1, 1, 1, 1];

const DEMO_DEEP_ZOOM_STEP = GRID_LAYER_ZOOM_STEP;
const STACK_CAMERA_CONTROL_AZIMUTH_STEP_RADIANS = Math.PI / 18;
const STACK_CAMERA_CONTROL_ELEVATION_STEP_RADIANS = Math.PI / 24;
const STACK_CAMERA_DRAG_RADIANS_PER_PIXEL = 0.0055;
const STACK_CAMERA_WHEEL_ZOOM_EXPONENT = 0.0015;
const MAX_RENDER_FRAME_DELTA_MS = 33.34;
const DAG_ZOOM_BAND_ORDER: WorkplaneLod[] = [
  'graph-point',
  'title-only',
  'label-points',
  'full-workplane',
];
const DAG_ZOOM_ACTIVE_SPAN_TARGET_PX: Record<WorkplaneLod, number> = {
  'full-workplane': DAG_FULL_WORKPLANE_MIN_PROJECTED_SPAN_PX + 4,
  'graph-point': DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX * 0.5,
  'label-points': DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX + 8,
  'title-only':
    (DAG_TITLE_ONLY_MIN_PROJECTED_SPAN_PX + DAG_LABEL_POINTS_MIN_PROJECTED_SPAN_PX) * 0.5,
};
const DAG_ZOOM_DISTANCE_SEARCH_ITERATIONS = 14;

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
type EditableLabelTarget = {
  hint: string;
  key: string;
  mode: '2d-label' | '3d-title';
  text: string;
};
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

const ONBOARDING_FRAME_SETTLE_MS = 420;
const ONBOARDING_TYPING_DELAY_MS = 72;
const ONBOARDING_TYPING_SETTLE_MS = 180;

export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const stageChrome = createStageChrome(root);
  const initialAppSettings = readStoredAppSettings();
  const bootPayload = createStageBootPayload(readStageConfig(window.location.search));
  const stageController = new LumaStageController(
    stageChrome,
    bootPayload.config,
    bootPayload.initialState,
    bootPayload.strategyPanelMode,
    initialAppSettings,
  );
  const siteMenu = createSiteMenu('app', {
    onSettingsChange: (settings) => {
      stageController.applyStoredSettings(settings);
    },
    placement: 'embedded',
  });
  stageChrome.statusPanelMenuSlot.replaceChildren(siteMenu.element);

  await stageController.start();
  window.__LINKER_TEST_HOOKS__ = {
    flushPerformanceTelemetry: () => stageController.flushPerformanceTelemetryForTest(),
    resetPerformanceTelemetry: () => stageController.resetPerformanceTelemetryForTest(),
  };

  return {
    destroy: () => {
      delete window.__LINKER_TEST_HOOKS__;
      siteMenu.destroy();
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
  private motionPreference: AppMotionPreference;
  private onboardingPreference: AppOnboardingPreference;
  private uiLayout: AppUiLayout;
  private workplaneSyncGeneration = 0;
  private workplaneSyncPending = false;

  constructor(
    private readonly chrome: StageChromeElements,
    private readonly config: StageConfig,
    initialState: StageSystemState,
    strategyPanelMode: StrategyPanelMode,
    appSettings: StoredAppSettings,
  ) {
    this.state = initialState;
    this.scene = getActiveWorkplaneDocument(initialState).scene;
    const stackViewState =
      initialState.session.stageMode === '3d-mode' ? createStackViewState(initialState) : null;
    this.renderScene = createTronRenderScene(
      initialState.session.stageMode === '3d-mode' && stackViewState ? stackViewState.scene : this.scene,
      initialState.session.stageMode,
    );
    this.stackBackplates = stackViewState?.backplates ?? [];
    if (stackViewState) {
      this.stackProjector.setSceneBounds(stackViewState.sceneBounds);
      this.stackProjector.setOrbitTarget(stackViewState.orbitTarget, {immediate: true});
    }
    this.stackCameraAnimator.setView(initialState.session.stackCamera);
    this.stackProjector.setStackCamera(this.stackCameraAnimator.getSnapshot());
    this.layoutStrategy = config.layoutStrategy;
    this.lineStrategy = config.lineStrategy;
    this.onboardingPhase = config.onboardingEnabled ? 'running' : 'inactive';
    this.strategyPanelMode =
      strategyPanelMode === 'label-edit' ? strategyPanelMode : DEFAULT_STRATEGY_PANEL_MODE;
    this.textStrategy = config.textStrategy;
    this.motionPreference = appSettings.motionPreference;
    this.onboardingPreference = appSettings.onboardingPreference;
    this.uiLayout = appSettings.uiLayout;
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
    this.syncAppPreferences();
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

  public applyStoredSettings(settings: StoredAppSettings): void {
    this.setAppUiLayout(settings.uiLayout, {persist: false});
    this.setAppMotionPreference(settings.motionPreference, {persist: false});
    this.setAppOnboardingPreference(settings.onboardingPreference, {persist: false});

    if (settings.textStrategy !== this.textStrategy) {
      this.setTextStrategy(settings.textStrategy, {persist: false});
    }

    if (settings.lineStrategy !== this.lineStrategy) {
      this.setLineStrategy(settings.lineStrategy, {persist: false});
    }

    if (settings.preferredStageMode !== this.state.session.stageMode) {
      this.applyPreferredStageMode(settings.preferredStageMode, {persist: false});
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
      let orbitTargetAnimating = false;
      const viewport = this.getViewportSize();
      if (this.state.session.stageMode === '3d-mode') {
        this.syncRenderSceneFromState(undefined, {
          immediateOrbitTarget: false,
          stackCamera: this.stackCameraAnimator.getSnapshot(),
          viewport,
        });
        orbitTargetAnimating = this.stackProjector.advance(deltaMs);
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
      if (
        planeCameraAnimating ||
        stackCameraAnimating ||
        orbitTargetAnimating ||
        this.camera.isAnimating ||
        this.stackCameraAnimator.isAnimating ||
        this.stackProjector.isAnimating
      ) {
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
        nextStackCamera = this.resolveDagZoomStepStackCamera('zoom-in')
          ?? scaleStackCameraDistance(stackCamera, 0.9);
        break;
      case 'zoom-out':
        nextStackCamera = this.resolveDagZoomStepStackCamera('zoom-out')
          ?? scaleStackCameraDistance(stackCamera, 1 / 0.9);
        break;
      case 'reset-camera':
        nextStackCamera = cloneStackCameraState(DEFAULT_STACK_CAMERA_STATE);
        break;
    }

    return this.applyStackCameraState(nextStackCamera, {persist: true});
  }

  private resolveDagZoomStepStackCamera(
    action: 'zoom-in' | 'zoom-out',
  ): StackCameraState | null {
    if (!this.state.document.dag) {
      return null;
    }

    const currentBand = this.getActiveDagZoomBand(this.state.session.stackCamera);
    const reachableBands = this.getReachableDagZoomBands();

    if (!currentBand || reachableBands.length === 0) {
      return null;
    }

    const currentIndex = reachableBands.indexOf(currentBand);

    if (currentIndex < 0) {
      return null;
    }

    const nextIndex = clamp(
      action === 'zoom-in' ? currentIndex + 1 : currentIndex - 1,
      0,
      reachableBands.length - 1,
    );

    if (nextIndex === currentIndex) {
      return cloneStackCameraState(this.state.session.stackCamera);
    }

    const targetBand = reachableBands[nextIndex];
    const targetDistanceScale = this.resolveDagZoomDistanceScaleForBand(targetBand);

    if (targetDistanceScale === null) {
      return null;
    }

    return {
      azimuthRadians: this.state.session.stackCamera.azimuthRadians,
      distanceScale: targetDistanceScale,
      elevationRadians: this.state.session.stackCamera.elevationRadians,
    };
  }

  private getReachableDagZoomBands(): WorkplaneLod[] {
    const farBand = this.getActiveDagZoomBand({
      azimuthRadians: this.state.session.stackCamera.azimuthRadians,
      distanceScale: STACK_CAMERA_DISTANCE_SCALE_MAX,
      elevationRadians: this.state.session.stackCamera.elevationRadians,
    });
    const nearBand = this.getActiveDagZoomBand({
      azimuthRadians: this.state.session.stackCamera.azimuthRadians,
      distanceScale: STACK_CAMERA_DISTANCE_SCALE_MIN,
      elevationRadians: this.state.session.stackCamera.elevationRadians,
    });

    if (!farBand || !nearBand) {
      return [];
    }

    const startIndex = DAG_ZOOM_BAND_ORDER.indexOf(farBand);
    const endIndex = DAG_ZOOM_BAND_ORDER.indexOf(nearBand);

    if (startIndex < 0 || endIndex < 0) {
      return [];
    }

    return DAG_ZOOM_BAND_ORDER.slice(
      Math.min(startIndex, endIndex),
      Math.max(startIndex, endIndex) + 1,
    );
  }

  private resolveDagZoomDistanceScaleForBand(
    targetBand: WorkplaneLod,
  ): number | null {
    const targetSpanPx = DAG_ZOOM_ACTIVE_SPAN_TARGET_PX[targetBand];
    const minScale = STACK_CAMERA_DISTANCE_SCALE_MIN;
    const maxScale = STACK_CAMERA_DISTANCE_SCALE_MAX;
    const minSpanPx = this.measureActiveDagProjectedPlaneSpanPx(
      minScale,
      this.state.session.stackCamera,
    );
    const maxSpanPx = this.measureActiveDagProjectedPlaneSpanPx(
      maxScale,
      this.state.session.stackCamera,
    );

    if (
      minSpanPx === null ||
      maxSpanPx === null ||
      !Number.isFinite(minSpanPx) ||
      !Number.isFinite(maxSpanPx)
    ) {
      return null;
    }

    if (targetSpanPx >= minSpanPx) {
      return minScale;
    }

    if (targetSpanPx <= maxSpanPx) {
      return maxScale;
    }

    let lowScale = minScale;
    let highScale = maxScale;
    let lowSpanPx = minSpanPx;
    let highSpanPx = maxSpanPx;

    for (let iteration = 0; iteration < DAG_ZOOM_DISTANCE_SEARCH_ITERATIONS; iteration += 1) {
      const midScale = (lowScale + highScale) * 0.5;
      const midSpanPx = this.measureActiveDagProjectedPlaneSpanPx(
        midScale,
        this.state.session.stackCamera,
      );

      if (midSpanPx === null || !Number.isFinite(midSpanPx)) {
        return null;
      }

      if (midSpanPx > targetSpanPx) {
        lowScale = midScale;
        lowSpanPx = midSpanPx;
      } else {
        highScale = midScale;
        highSpanPx = midSpanPx;
      }
    }

    return Math.abs(lowSpanPx - targetSpanPx) <= Math.abs(highSpanPx - targetSpanPx)
      ? lowScale
      : highScale;
  }

  private getActiveDagZoomBand(
    stackCamera: StackCameraState,
  ): WorkplaneLod | null {
    const activeProjectedSpanPx = this.measureActiveDagProjectedPlaneSpanPx(
      stackCamera.distanceScale,
      stackCamera,
    );

    return activeProjectedSpanPx === null
      ? null
      : resolveWorkplaneLod(activeProjectedSpanPx);
  }

  private measureActiveDagProjectedPlaneSpanPx(
    distanceScale: number,
    baseStackCamera: StackCameraState,
  ): number | null {
    const activeWorkplaneId = this.state.session.activeWorkplaneId;
    const projectedNodes = createProjectedDagVisibleNodes(
      this.state,
      this.getViewportSize(),
      {
        stackCamera: {
          azimuthRadians: baseStackCamera.azimuthRadians,
          distanceScale,
          elevationRadians: baseStackCamera.elevationRadians,
        },
      },
    );
    const activeProjectedNode =
      projectedNodes.find((node) => node.layout.workplaneId === activeWorkplaneId) ?? null;

    return activeProjectedNode?.projectedPlaneSpanPx ?? null;
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
      this.workplaneSyncPending ||
      this.config.labelSetKind !== 'demo' ||
      document.body.dataset.benchmarkState === 'running'
    ) {
      return;
    }

    const editableTarget = this.getEditableLabelTarget();

    if (!editableTarget) {
      return;
    }

    const nextText = this.chrome.labelInputField.value;

    if (nextText === editableTarget.text) {
      this.syncLabelInputPanel({forceValue: true});
      return;
    }

    if (editableTarget.mode === '3d-title') {
      this.updateActiveWorkplaneTitleText(editableTarget.key, nextText);
      return;
    }

    void this.updateFocusedLabelText(editableTarget.key, nextText);
  };

  private setAppUiLayout(
    layout: AppUiLayout,
    options?: {persist?: boolean},
  ): void {
    if (layout === this.uiLayout) {
      this.syncAppPreferences();
      return;
    }

    this.uiLayout = layout;
    this.syncAppPreferences();

    if (options?.persist !== false) {
      writeStoredAppSettings({uiLayout: layout});
    }
  }

  private setAppMotionPreference(
    preference: AppMotionPreference,
    options?: {persist?: boolean},
  ): void {
    if (preference === this.motionPreference) {
      this.syncAppPreferences();
      return;
    }

    this.motionPreference = preference;
    this.syncAppPreferences();

    if (options?.persist !== false) {
      writeStoredAppSettings({motionPreference: preference});
    }
  }

  private setAppOnboardingPreference(
    preference: AppOnboardingPreference,
    options?: {persist?: boolean},
  ): void {
    if (preference === this.onboardingPreference) {
      this.syncAppPreferences();
      return;
    }

    this.onboardingPreference = preference;
    this.syncAppPreferences();

    if (preference === 'skip' && this.onboardingPhase === 'running') {
      this.skipOnboardingWalkthrough();
    }

    if (options?.persist !== false) {
      writeStoredAppSettings({onboardingPreference: preference});
    }
  }

  private setTextStrategy(
    mode: TextStrategy,
    options?: {persist?: boolean},
  ): void {
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

    if (options?.persist !== false) {
      writeStoredAppSettings({textStrategy: mode});
    }
  }

  private setLineStrategy(
    mode: LineStrategy,
    options?: {persist?: boolean},
  ): void {
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

    if (options?.persist !== false) {
      writeStoredAppSettings({lineStrategy: mode});
    }
  }

  private applyPreferredStageMode(
    mode: StageMode,
    options?: {persist?: boolean},
  ): void {
    this.applyStageModeAction(mode === '2d-mode' ? 'set-2d-mode' : 'set-3d-mode', options);
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
      editPanel: this.chrome.editPanel,
      labelSetKind: this.config.labelSetKind,
      lineStrategy: this.lineStrategy,
      planeCount: getPlaneCount(this.state),
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
    const editableTarget = this.getEditableLabelTarget();
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
        ? editableTarget?.hint ?? 'Title'
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

  private syncAppPreferences(): void {
    document.body.dataset.appUiLayout = this.uiLayout;
    document.body.dataset.appMotionPreference = this.motionPreference;
    document.body.dataset.appOnboardingPreference = this.onboardingPreference;
    this.chrome.stage.dataset.uiLayout = this.uiLayout;
    this.chrome.stage.dataset.appMotionPreference = this.motionPreference;
    this.chrome.statusPanel.dataset.uiLayout = this.uiLayout;
    this.chrome.statusPanel.dataset.appMotionPreference = this.motionPreference;
    this.chrome.strategyModePanel.dataset.uiLayout = this.uiLayout;
    this.chrome.strategyModePanel.dataset.appMotionPreference = this.motionPreference;
  }

  private syncOnboardingPanel(): void {
    const showPanel =
      this.onboardingPhase === 'running' ||
      this.onboardingPhase === 'complete';

    this.chrome.statusPanel.dataset.panelMode = showPanel ? 'onboarding' : 'status';
    this.chrome.statusPanelLabel.textContent = showPanel ? 'Onboard' : 'Status';
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
    const totalSteps = 13;

    this.onboardingPhase = 'running';

    if (this.state.session.stageMode !== '3d-mode') {
      this.applyStageModeAction('set-3d-mode', {persist: false});
    }

    this.setOnboardingStepState({
      body: 'Linker starts in the 3D DAG so the first pass can quickly title workplanes, stitch a readable graph, and show the same calculator pad, menu, and hotkeys the user will keep using.',
      detail: 'This tour stays DAG-first: name workplanes in 3D, connect five nodes, zoom through the LOD bands, then drop into one 2D workplane for local editing.',
      stepCount: totalSteps,
      stepId: 'intro',
      stepIndex: 0,
      targetSelectors: [],
      title: 'Build a five-node DAG in 3D first',
    });
    this.updateStatus();

    try {
      await this.waitOnboardingDelay(runId, ONBOARDING_FRAME_SETTLE_MS);
      await this.waitForOnboardingIdle(runId, {waitForCamera: false});
      await this.runOnboardingWalkthrough(runId, totalSteps);

      if (!this.isOnboardingRunActive(runId)) {
        return;
      }

      this.persistOnboardingCompletion();
      this.onboardingPhase = 'complete';
      this.setOnboardingStepState({
        body: 'The guided run finished on a readable five-node DAG with titled workplanes, bright curved links, one stitched local 2D edit, and the menu reopened for manual exploration.',
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

    const rootTitle = DAG_RANK_FANOUT_ROOT_LABEL_TEXT;
    const firstChildTitle = 'Ingress';
    const secondChildTitle = 'Policy';
    const firstLeafTitle = 'Audit';
    const secondLeafTitle = 'Relay';
    const localDetailTitle = 'Cache';

    await this.showOnboardingControlPadPage('menu', runId);
    await step({
      body: 'Linker starts in the 3D DAG because the graph is the root map. The simple 3x3 menu keeps the calculator pads readable: Map moves the camera, Stage swaps 3D and 2D, DAG lays out workplanes, Edit titles them, and View tunes the scene.',
      detail: 'This first pass stays hotkey-first: C adds a child workplane, [ and ] walk the active DAG node, F jumps to the root, Shift plus Up or Down steps through the LOD bands, and / swaps between the 3D DAG and the focused 2D plane.',
      stepId: 'menu-intro',
      targetSelectors: [
        '.stage-canvas',
        '.strategy-mode-panel',
        '[data-testid="onboard-panel"]',
        'button[data-control-pad-target="navigate"]',
        'button[data-control-pad-target="stage"]',
        'button[data-control-pad-target="dag"]',
        'button[data-control-pad-target="edit"]',
        'button[data-control-pad-target="view"]',
      ],
      title: 'Start from the 3D DAG menu',
    });

    await this.showOnboardingControlPadPage('edit', runId);
    await this.typeOnboardingFocusedLabel(runId, rootTitle);
    await step({
      body: 'The title input works directly in 3D. The active workplane gets a readable name first, so every DAG node can be recognized immediately on the black-and-white graph.',
      detail: `This root is now titled ${rootTitle}. The same title field will name every new workplane as it becomes active.`,
      stepId: 'root-title',
      targetSelectors: [
        '.stage-canvas',
        '.strategy-mode-panel',
        '[data-testid="label-input-field"]',
        '[data-testid="label-input-submit"]',
      ],
      title: 'Title the root without leaving 3D',
    });

    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'KeyC', key: 'c'},
      {highlightSelector: 'button[data-dag-action="spawn-child-workplane"]'},
    );
    await this.showOnboardingControlPadPage('edit', runId);
    await this.typeOnboardingFocusedLabel(runId, firstChildTitle);
    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'KeyC', key: 'c'},
      {highlightSelector: 'button[data-dag-action="spawn-child-workplane"]'},
    );
    await this.showOnboardingControlPadPage('edit', runId);
    await this.typeOnboardingFocusedLabel(runId, secondChildTitle);
    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await step({
      body: 'The first fanout stays entirely in the 3D DAG view. C creates a downstream workplane, F jumps back to the root, and the same title field names each node as it appears, so the graph becomes legible in seconds.',
      detail: `${firstChildTitle} and ${secondChildTitle} are now linked under ${rootTitle}.`,
      stepId: 'first-rank',
      targetSelectors: ['.stage-canvas', '.strategy-mode-panel', 'button[data-dag-action="spawn-child-workplane"]'],
      title: 'Fan out two titled children in 3D',
    });

    await this.navigateToWorkplaneByButtons('wp-2', runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'KeyC', key: 'c'},
      {highlightSelector: 'button[data-dag-action="spawn-child-workplane"]'},
    );
    await this.showOnboardingControlPadPage('edit', runId);
    await this.typeOnboardingFocusedLabel(runId, firstLeafTitle);
    await this.navigateToWorkplaneByButtons('wp-3', runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'KeyC', key: 'c'},
      {highlightSelector: 'button[data-dag-action="spawn-child-workplane"]'},
    );
    await this.showOnboardingControlPadPage('edit', runId);
    await this.typeOnboardingFocusedLabel(runId, secondLeafTitle);
    await this.focusRootWithOnboarding(runId);
    await this.showOnboardingControlPadPage('dag', runId);
    await step({
      body: 'Now the DAG reaches five titled workplanes. The stage hotkeys [ and ] walk the active node, while C keeps extending the graph from the current workplane, so layout stays fast and thumb-friendly.',
      detail: `${firstLeafTitle} hangs under ${firstChildTitle}, and ${secondLeafTitle} hangs under ${secondChildTitle}, so the graph already reads as a stitched 3D dependency tree before any 2D edit starts.`,
      stepId: 'second-rank',
      targetSelectors: [
        '.stage-canvas',
        '.strategy-mode-panel',
        'button[data-workplane-action="select-next-workplane"]',
        'button[data-dag-action="spawn-child-workplane"]',
      ],
      title: 'Finish the five-node 3D DAG',
    });

    await this.zoomOnboardingDagToGraphOverview(runId);
    await step({
      body: 'Shift plus Down snaps outward through the DAG zoom bands. At the far graph overview, every workplane compresses to one projected square symbol so the full dependency shape fits on one TRON-like black canvas.',
      detail: 'This band is for graph recognition: five square node symbols, four bright curved DAG links, and the root still centered.',
      stepId: 'graph-overview',
      targetSelectors: ['.stage-canvas', '.strategy-mode-panel', 'button[data-control="zoom-out"]'],
      title: 'Zoom all the way out',
    });

    await this.navigateToWorkplaneByButtons('wp-4', runId);
    await this.zoomOnboardingDagToTitleOnly(runId);
    await step({
      body: 'Shift plus Up steps inward to the title-only band. The camera auto-centers the active workplane in an isometric view and the nearby DAG nodes become readable grayscale title cards instead of square symbols.',
      detail: `The selected workplane is ${firstLeafTitle}, while the surrounding titles stay readable enough to understand the branch without losing the overall graph.`,
      stepId: 'title-only',
      targetSelectors: ['.stage-canvas', '.strategy-mode-panel', 'button[data-control="zoom-in"]'],
      title: 'Reveal readable workplane titles',
    });

    await this.zoomOnboardingDagToLabelPoint(runId);
    await step({
      body: 'One band closer, the titled workplanes begin exposing their local label markers. This preview band shows which nodes already carry internal content before you commit to a 2D handoff.',
      detail: 'Label-point is the preview band: more detail than title-only, but still light enough to read the wider DAG and its links.',
      stepId: 'label-point',
      targetSelectors: ['.stage-canvas', '.strategy-mode-panel', 'button[data-control="zoom-in"]'],
      title: 'Reveal label markers and local link hints',
    });

    await this.zoomOnboardingDagToFullWorkplane(runId);
    await step({
      body: 'At the closest 3D band, one workplane becomes fully readable without leaving the DAG view. Titles, local text, and local lines all stay legible while the wider graph context remains around it.',
      detail: `This is the bridge into detailed editing: ${firstLeafTitle} is readable as a plane, but it still looks stitched into the wider DAG.`,
      stepId: 'full-workplane',
      targetSelectors: ['.stage-canvas', '.strategy-mode-panel', 'button[data-control="zoom-in"]'],
      title: 'Read one full workplane in 3D',
    });

    await this.openOnboardingPlaneFocus(runId);
    await step({
      body: 'Pressing / swaps cleanly from the 3D full-workplane band into the same workplane in 2D. The camera handoff should feel like one continuous zoom instead of a separate tool change.',
      detail: `The focus stays on ${firstLeafTitle}, so the local plane is ready for fast keyboard editing with the same calculator-style pad.`,
      stepId: 'plane-focus',
      targetSelectors: ['.stage-canvas', '.strategy-mode-panel', 'button[data-stage-mode-action="set-2d-mode"]'],
      title: 'Drop into the same workplane in 2D',
    });

    await this.showOnboardingControlPadPage('navigate', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'ArrowRight', key: 'ArrowRight'},
      {highlightSelector: 'button[data-control="pan-right"]', waitForCamera: false},
    );
    await this.showOnboardingControlPadPage('edit', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Enter', key: 'Enter'},
      {highlightSelector: 'button[data-editor-shortcut="toggle-selection-or-create"]', waitForCamera: false},
    );
    await this.typeOnboardingFocusedLabel(runId, localDetailTitle);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Enter', key: 'Enter'},
      {highlightSelector: 'button[data-editor-shortcut="toggle-selection-or-create"]', waitForCamera: false},
    );
    await this.showOnboardingControlPadPage('navigate', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'ArrowLeft', key: 'ArrowLeft'},
      {highlightSelector: 'button[data-control="pan-left"]', waitForCamera: false},
    );
    await this.showOnboardingControlPadPage('edit', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Enter', key: 'Enter'},
      {highlightSelector: 'button[data-editor-shortcut="toggle-selection-or-create"]', waitForCamera: false},
    );
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Enter', key: 'Enter', shiftKey: true},
      {highlightSelector: 'button[data-editor-action="link-selection"]', waitForCamera: false},
    );
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Escape', key: 'Escape'},
      {highlightSelector: 'button[data-editor-action="clear-selection"]', waitForCamera: false},
    );
    await step({
      body: 'The 2D step stays keyboard-first too. Arrow keys move the local cursor, Enter creates or selects, Shift plus Enter links the ranked pair, and Escape clears the selection without removing the authored result.',
      detail: `${localDetailTitle} is now linked inside ${firstLeafTitle}, proving the DAG node can be stitched internally after it was created and titled in 3D.`,
      stepId: 'local-fill',
      targetSelectors: [
        '.stage-canvas',
        '.strategy-mode-panel',
        'button[data-editor-shortcut="toggle-selection-or-create"]',
        'button[data-editor-action="link-selection"]',
        'button[data-editor-action="clear-selection"]',
      ],
      title: 'Fill and link one workplane in 2D',
    });

    await this.showOnboardingControlPadPage('stage', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Slash', key: '/'},
      {highlightSelector: 'button[data-stage-mode-action="set-3d-mode"]'},
    );
    await this.focusRootWithOnboarding(runId);
    await this.zoomOnboardingDagToTitleOnly(runId);
    await this.showOnboardingControlPadPage('menu', runId);
    await step({
      body: 'Press / to lift the same workplane back into the DAG, then use F to recenter the root. The walkthrough ends on a readable five-node title view with the menu reopened for the next manual action.',
      detail: `The graph now has titled nodes in 3D and one internal ${localDetailTitle} link in 2D, so both layers of CRUD are visible in one clean scene.`,
      stepId: 'stitched-dag',
      targetSelectors: [
        '.stage-canvas',
        '.strategy-mode-panel',
        'button[data-control-pad-action="open-menu"]',
        'button[data-control-pad-target="dag"]',
        'button[data-control-pad-target="edit"]',
      ],
      title: 'Return to the stitched DAG overview',
    });
    await this.waitForOnboardingIdle(runId, {waitForCamera: false});
  }

  private async focusRootWithOnboarding(runId: number): Promise<void> {
    if (this.state.session.activeWorkplaneId === this.state.document.dag?.rootWorkplaneId) {
      return;
    }

    await this.showOnboardingControlPadPage('stage', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'KeyF', key: 'f'},
      {
        highlightSelector: 'button[data-dag-action="focus-root"]',
      },
    );
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
    const keyInput =
      action === 'select-next-workplane'
        ? {code: 'BracketRight', key: ']'}
        : {code: 'BracketLeft', key: '['};

    for (let step = 0; step < Math.abs(targetIndex - currentIndex); step += 1) {
      await this.pressOnboardingHotkey(runId, keyInput, {
        highlightSelector: `button[data-workplane-action="${action}"]`,
      });
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

      await this.pressOnboardingHotkey(
        runId,
        {code: 'ArrowDown', key: 'ArrowDown', shiftKey: true},
        {
          highlightSelector: 'button[data-control="zoom-out"]',
          waitForCamera: true,
        }
      );
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

      await this.pressOnboardingHotkey(
        runId,
        action === 'zoom-in'
          ? {code: 'ArrowUp', key: 'ArrowUp', shiftKey: true}
          : {code: 'ArrowDown', key: 'ArrowDown', shiftKey: true},
        {
          highlightSelector: `button[data-control="${action}"]`,
          waitForCamera: true,
        }
      );
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

      await this.pressOnboardingHotkey(
        runId,
        {code: 'ArrowUp', key: 'ArrowUp', shiftKey: true},
        {
          highlightSelector: 'button[data-control="zoom-in"]',
          waitForCamera: true,
        }
      );
    }

    throw new Error('Timed out while waiting for the onboarding DAG label-point view.');
  }

  private async zoomOnboardingDagToFullWorkplane(runId: number): Promise<void> {
    await this.showOnboardingControlPadPage('navigate', runId);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const dagSnapshot = this.getDagSnapshotState(true);
      const visibleGlyphCount = this.textLayer?.getStats().visibleGlyphCount ?? 0;

      if (
        this.state.session.stageMode === '3d-mode' &&
        dagSnapshot &&
        dagSnapshot.fullWorkplaneCount > 0 &&
        visibleGlyphCount > dagSnapshot.visibleWorkplaneCount
      ) {
        return;
      }

      await this.pressOnboardingHotkey(
        runId,
        {code: 'ArrowUp', key: 'ArrowUp', shiftKey: true},
        {
          highlightSelector: 'button[data-control="zoom-in"]',
          waitForCamera: true,
        }
      );
    }

    throw new Error('Timed out while waiting for the onboarding 3D full workplane detail view.');
  }

  private async openOnboardingPlaneFocus(runId: number): Promise<void> {
    await this.showOnboardingControlPadPage('stage', runId);
    await this.pressOnboardingHotkey(
      runId,
      {code: 'Slash', key: '/'},
      {
        highlightSelector: 'button[data-stage-mode-action="set-2d-mode"]',
        waitForCamera: true,
      }
    );

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const visibleGlyphCount = this.textLayer?.getStats().visibleGlyphCount ?? 0;

      if (
        this.state.session.stageMode === '2d-mode' &&
        visibleGlyphCount > 0
      ) {
        return;
      }

      await this.waitOnboardingDelay(runId, 80);
    }

    throw new Error('Timed out while waiting for the onboarding plane-focus detail view.');
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

  private async pressOnboardingHotkey(
    runId: number,
    input: {
      code: string;
      key: string;
      shiftKey?: boolean;
    },
    options?: {
      highlightSelector?: string;
      settleMs?: number;
      waitForCamera?: boolean;
    },
  ): Promise<void> {
    this.ensureOnboardingRunActive(runId);
    const highlightElement = options?.highlightSelector
      ? document.querySelector<HTMLElement>(options.highlightSelector)
      : null;

    if (highlightElement) {
      highlightElement.dataset.onboardHighlight = 'true';
      highlightElement.dataset.onboardPress = 'true';
      highlightElement.focus?.({preventScroll: true});
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    await this.waitOnboardingDelay(runId, options?.settleMs ?? 110);
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: input.code,
        key: input.key,
        shiftKey: input.shiftKey ?? false,
      }),
    );

    if (highlightElement) {
      delete highlightElement.dataset.onboardPress;
    }

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
    input.form?.requestSubmit();
    await this.waitForOnboardingIdle(runId, {waitForCamera: false});
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
    const effectiveDurationMs =
      this.motionPreference === 'reduced'
        ? Math.min(durationMs, 48)
        : durationMs;
    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), effectiveDurationMs);
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
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-text-strategy]'),
    );
    this.lineStrategyButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-line-strategy]'),
    );
    this.layoutStrategyButtons.push(
      ...this.chrome.strategyModePanel.querySelectorAll<HTMLButtonElement>('[data-layout-strategy]'),
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
    if (this.config.labelSetKind !== 'demo') {
      return 'Demo only';
    }

    return this.getEditableLabelTarget()?.hint ?? 'No focus';
  }

  private getEditableLabelTarget(): EditableLabelTarget | null {
    if (this.config.labelSetKind !== 'demo') {
      return null;
    }

    if (this.state.session.stageMode === '3d-mode') {
      const workplaneId = this.state.session.activeWorkplaneId;
      const titleLabelKey = buildLabelKey(workplaneId, 1, 1, 1);
      const titleLabel = this.scene.labels.find(
        (label) => label.navigation?.key === titleLabelKey,
      );

      return {
        hint: `Title ${workplaneId}`,
        key: titleLabelKey,
        mode: '3d-title',
        text: titleLabel?.text ?? '',
      };
    }

    const focusedLabel = this.getFocusedEditorLabel();
    const editorCursor = this.getEditorCursor();

    if (!editorCursor) {
      return null;
    }

    if (!focusedLabel) {
      return {
        hint: `Ghost ${editorCursor.key}`,
        key: editorCursor.key,
        mode: '2d-label',
        text: '',
      };
    }

    return {
      hint: `Label ${focusedLabel.navigation?.key ?? editorCursor.key}`,
      key: focusedLabel.navigation?.key ?? editorCursor.key,
      mode: '2d-label',
      text: focusedLabel.text,
    };
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
    const editableTarget = this.getEditableLabelTarget();
    const input = this.chrome.labelInputField;
    const submitButton = this.chrome.labelInputSubmitButton;
    const shouldDisableInput =
      this.labelInputPending ||
      this.workplaneSyncPending ||
      this.config.labelSetKind !== 'demo' ||
      editableTarget === null ||
      document.body.dataset.benchmarkState === 'running';
    const shouldSyncValue =
      Boolean(options?.forceValue) ||
      editableTarget?.key !== this.labelInputSyncedKey ||
      (!shouldDisableInput &&
        document.activeElement !== input &&
        editableTarget !== null &&
        editableTarget.text !== this.labelInputSyncedText);

    this.chrome.labelInputHint.textContent = this.getEditableLabelHint();
    input.disabled = shouldDisableInput;
    submitButton.disabled = shouldDisableInput;

    if (!editableTarget) {
      this.labelInputSyncedKey = null;
      this.labelInputSyncedText = '';

      if (shouldSyncValue || options?.forceValue) {
        input.value = '';
      }

      return;
    }

    if (shouldSyncValue) {
      input.value = editableTarget.text;
    }

    this.labelInputSyncedKey = editableTarget.key;
    this.labelInputSyncedText = editableTarget.text;
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

  private updateActiveWorkplaneTitleText(
    labelKey: string,
    nextText: string,
  ): void {
    if (this.config.labelSetKind !== 'demo') {
      return;
    }

    const activeWorkplaneId = this.state.session.activeWorkplaneId;
    const currentWorkplane = this.state.document.workplanesById[activeWorkplaneId];

    if (!currentWorkplane) {
      return;
    }

    const normalizedText = nextText.trim();
    let nextScene = cloneStageScene(currentWorkplane.scene);
    let titleLabel =
      nextScene.labels.find((label) => label.navigation?.key === labelKey) ?? null;

    if (!titleLabel && normalizedText.length > 0) {
      const mutation = addLabelAtStageEditorCursor(nextScene, {
        cursor: {
          column: 1,
          key: labelKey,
          kind: 'ghost',
          layer: 1,
          row: 1,
          workplaneId: activeWorkplaneId,
        },
        selectedLabelKeys: [],
      });

      if (!mutation.changed) {
        this.syncLabelInputPanel({forceValue: true});
        return;
      }

      nextScene = mutation.scene;
      titleLabel =
        nextScene.labels.find((label) => label.navigation?.key === labelKey) ?? null;
    }

    if (!titleLabel) {
      this.syncLabelInputPanel({forceValue: true});
      return;
    }

    const nextSceneTitleText =
      normalizedText.length > 0
        ? normalizedText
        : (titleLabel.navigation?.key ?? titleLabel.text);

    if (titleLabel.text === nextSceneTitleText) {
      this.syncLabelInputPanel({forceValue: true});
      return;
    }

    titleLabel.text = nextSceneTitleText;
    const nextOverrideText =
      normalizedText.length > 0 && normalizedText !== (titleLabel.navigation?.key ?? '')
        ? normalizedText
        : null;

    this.labelInputPending = true;
    this.syncLabelInputPanel();

    try {
      let nextState = cloneStageSystemState(this.state);
      nextState = replaceWorkplaneScene(nextState, activeWorkplaneId, nextScene);
      nextState = replaceWorkplaneLabelTextOverride(
        nextState,
        activeWorkplaneId,
        labelKey,
        nextOverrideText,
      );
      nextState = replaceWorkplaneView(nextState, activeWorkplaneId, {
        ...nextState.session.workplaneViewsById[activeWorkplaneId],
        selectedLabelKey: labelKey,
      });

      this.benchmarkSummary = null;
      document.body.dataset.benchmarkError = '';
      document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
      this.applyStageSystemState(nextState, {forceLabelInput: true, syncQuery: true});
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

  private applyStageModeAction(
    action: StageModeAction,
    options?: {persist?: boolean},
  ): void {
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

    if (options?.persist !== false) {
      writeStoredAppSettings({preferredStageMode: nextState.session.stageMode});
    }
  }

  private applyStageSystemState(
    nextState: StageSystemState,
    options?: {forceLabelInput?: boolean; syncQuery?: boolean},
  ): void {
    const previousState = this.state;
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
    this.applyActiveWorkplaneRuntime(options, nextStackViewState, previousState);
  }

  private getRenderSceneForState(
    state: StageSystemState,
    stackViewState?: StackViewState,
  ): StageScene {
    if (state.session.stageMode === '2d-mode') {
      return createTronRenderScene(getActiveWorkplaneDocument(state).scene, state.session.stageMode);
    }

    return createTronRenderScene(
      (stackViewState ?? createStackViewState(state)).scene,
      state.session.stageMode,
    );
  }

  private syncRenderSceneFromState(
    stackViewState?: StackViewState,
    options?: {
      immediateOrbitTarget?: boolean;
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
      this.stackProjector.setOrbitTarget(nextStackViewState.orbitTarget, {
        immediate: options?.immediateOrbitTarget ?? false,
      });
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
  }, stackViewState?: StackViewState, previousState?: StageSystemState): void {
    const view = getActiveWorkplaneView(this.state);
    const activeWorkplaneId = this.state.session.activeWorkplaneId;

    if (this.state.session.stageMode === '3d-mode') {
      this.seedStackCameraTransition(previousState);
      this.stackCameraAnimator.setTargetView(this.state.session.stackCamera);
    }
    this.syncRenderSceneFromState(stackViewState, {
      immediateOrbitTarget: false,
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
    this.seedWorkplaneTransitionCamera(previousState, view.camera);
    this.camera.setTargetView(view.camera.centerX, view.camera.centerY, view.camera.zoom);
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
      const previousState = this.state;
      this.state = nextState;
      this.applyActiveWorkplaneRuntime(options, nextStackViewState, previousState);
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
      const previousState = this.state;

        this.state = nextState;
      if (this.state.session.stageMode === '3d-mode') {
        this.seedStackCameraTransition(previousState);
        this.stackCameraAnimator.setTargetView(this.state.session.stackCamera);
      }
      this.syncRenderSceneFromState(nextStackViewState, {
        immediateOrbitTarget: false,
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
      this.seedWorkplaneTransitionCamera(previousState, view.camera);
      this.camera.setTargetView(view.camera.centerX, view.camera.centerY, view.camera.zoom);
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

  private seedWorkplaneTransitionCamera(
    previousState: StageSystemState | undefined,
    targetCamera: WorkplaneCameraView,
  ): void {
    if (!previousState || this.state.session.stageMode !== '2d-mode') {
      return;
    }

    const previousStageMode = previousState.session.stageMode;
    const previousWorkplaneId = previousState.session.activeWorkplaneId;
    const nextWorkplaneId = this.state.session.activeWorkplaneId;
    const currentCamera = this.camera.getSnapshot();

    if (
      previousStageMode === '2d-mode' &&
      previousWorkplaneId === nextWorkplaneId &&
      !this.matchesWorkplaneCamera(currentCamera, targetCamera)
    ) {
      return;
    }

    if (
      previousStageMode === '2d-mode' &&
      previousWorkplaneId === nextWorkplaneId &&
      this.matchesWorkplaneCamera(currentCamera, targetCamera)
    ) {
      return;
    }

    if (
      previousStageMode === '2d-mode' &&
      previousWorkplaneId !== nextWorkplaneId &&
      !this.matchesWorkplaneCamera(currentCamera, targetCamera)
    ) {
      return;
    }

    const transitionCamera = this.createWorkplaneTransitionCamera(previousState, targetCamera);
    this.camera.setView(
      transitionCamera.centerX,
      transitionCamera.centerY,
      transitionCamera.zoom,
    );
  }

  private seedStackCameraTransition(previousState: StageSystemState | undefined): void {
    if (!previousState || previousState.session.stageMode !== '3d-mode') {
      return;
    }

    const previousWorkplaneId = previousState.session.activeWorkplaneId;
    const nextWorkplaneId = this.state.session.activeWorkplaneId;

    if (previousWorkplaneId === nextWorkplaneId || this.stackCameraAnimator.isAnimating) {
      return;
    }

    const previousIndex = getWorkplaneIndex(previousState, previousWorkplaneId);
    const nextIndex = getWorkplaneIndex(this.state, nextWorkplaneId);
    const previousDagPosition = previousState.document.dag?.positionsById[previousWorkplaneId] ?? null;
    const nextDagPosition = this.state.document.dag?.positionsById[nextWorkplaneId] ?? null;
    const indexDelta = nextIndex - previousIndex;
    const rankDelta =
      (nextDagPosition?.column ?? 0) - (previousDagPosition?.column ?? 0);
    const laneDelta =
      (nextDagPosition?.row ?? 0) - (previousDagPosition?.row ?? 0);
    const depthDelta =
      (nextDagPosition?.layer ?? 0) - (previousDagPosition?.layer ?? 0);
    const targetStackCamera = this.state.session.stackCamera;
    const azimuthOffset = Math.sign(rankDelta || depthDelta || indexDelta || 1) * 0.075;
    const elevationOffset =
      laneDelta === 0
        ? (depthDelta === 0 ? 0.025 : Math.sign(depthDelta) * 0.03)
        : -Math.sign(laneDelta) * 0.045;
    const seededStackCamera = normalizeStackCameraState({
      azimuthRadians: targetStackCamera.azimuthRadians + azimuthOffset,
      distanceScale: targetStackCamera.distanceScale * 1.08,
      elevationRadians: targetStackCamera.elevationRadians + elevationOffset,
    });

    this.stackCameraAnimator.setView(seededStackCamera);
  }

  private createWorkplaneTransitionCamera(
    previousState: StageSystemState,
    targetCamera: WorkplaneCameraView,
  ): WorkplaneCameraView {
    const previousWorkplaneId = previousState.session.activeWorkplaneId;
    const nextWorkplaneId = this.state.session.activeWorkplaneId;
    const previousIndex = getWorkplaneIndex(previousState, previousWorkplaneId);
    const nextIndex = getWorkplaneIndex(this.state, nextWorkplaneId);
    const previousDagPosition = previousState.document.dag?.positionsById[previousWorkplaneId] ?? null;
    const nextDagPosition = this.state.document.dag?.positionsById[nextWorkplaneId] ?? null;
    const indexDelta = nextIndex - previousIndex;
    const rankDelta =
      (nextDagPosition?.column ?? 0) - (previousDagPosition?.column ?? 0);
    const laneDelta =
      (nextDagPosition?.row ?? 0) - (previousDagPosition?.row ?? 0);
    const depthDelta =
      (nextDagPosition?.layer ?? 0) - (previousDagPosition?.layer ?? 0);
    let offsetX = rankDelta * 0.9 + depthDelta * 0.28;
    let offsetY = -laneDelta * 0.9;

    if (Math.abs(offsetX) + Math.abs(offsetY) <= 0.001) {
      offsetX = Math.sign(indexDelta || 1) * 0.72;
      offsetY = previousState.session.stageMode === '3d-mode' ? -0.48 : 0;
    }

    if (previousState.session.stageMode === '3d-mode') {
      offsetX *= 1.22;
      offsetY = offsetY === 0 ? -0.56 : offsetY * 1.14;
    }

    return {
      centerX: targetCamera.centerX - offsetX,
      centerY: targetCamera.centerY - offsetY,
      zoom: clamp(targetCamera.zoom - (previousState.session.stageMode === '3d-mode' ? 0.42 : 0.24), 0, 40),
    };
  }

  private matchesWorkplaneCamera(
    camera: Pick<ReturnType<Camera2D['getSnapshot']>, 'centerX' | 'centerY' | 'zoom'>,
    targetCamera: WorkplaneCameraView,
  ): boolean {
    return (
      Math.abs(camera.centerX - targetCamera.centerX) <= 0.0001 &&
      Math.abs(camera.centerY - targetCamera.centerY) <= 0.0001 &&
      Math.abs(camera.zoom - targetCamera.zoom) <= 0.0001
    );
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
      cameraAnimating:
        this.camera.isAnimating ||
        this.stackCameraAnimator.isAnimating ||
        this.stackProjector.isAnimating,
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
      const dagZoomBand = this.state.document.dag
        ? this.getActiveDagZoomBand(stackCamera)
        : null;
      const reachableDagZoomBands = dagZoomBand
        ? this.getReachableDagZoomBands()
        : [];
      const farthestDagZoomBand = reachableDagZoomBands[0] ?? null;
      const nearestDagZoomBand =
        reachableDagZoomBands[reachableDagZoomBands.length - 1] ?? null;

      return {
        canMoveDown: stackCamera.elevationRadians < STACK_CAMERA_ELEVATION_MAX_RADIANS - 0.0001,
        canMoveLeft: true,
        canMoveRight: true,
        canMoveUp: stackCamera.elevationRadians > STACK_CAMERA_ELEVATION_MIN_RADIANS + 0.0001,
        canReset: !isStackCameraAtDefault(stackCamera),
        canZoomIn: dagZoomBand
          ? dagZoomBand !== nearestDagZoomBand
          : stackCamera.distanceScale > STACK_CAMERA_DISTANCE_SCALE_MIN + 0.0001,
        canZoomOut: dagZoomBand
          ? dagZoomBand !== farthestDagZoomBand
          : stackCamera.distanceScale < STACK_CAMERA_DISTANCE_SCALE_MAX - 0.0001,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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

function createTronRenderScene(scene: StageScene, stageMode: StageMode): StageScene {
  const themedScene = cloneStageScene(scene);

  themedScene.labels = themedScene.labels.map((label) => ({
    ...label,
    color: createTronLabelColor(label, stageMode),
  }));
  themedScene.links = themedScene.links.map((link) => ({
    ...link,
    color: createTronLinkColor(link.color, stageMode),
    lineWidth: createTronLinkLineWidth(link.lineWidth, stageMode),
  }));

  return themedScene;
}

function createTronLabelColor(
  label: StageScene['labels'][number],
  stageMode: StageMode,
): RgbaColor {
  const sourceColor = label.color ?? TRON_REFERENCE_WHITE;
  const sourceLuma = getPerceivedLuma(sourceColor);
  const layer = label.navigation?.layer ?? null;

  if (stageMode === '2d-mode') {
    const brightness =
      layer === null
        ? clamp(Math.max(sourceLuma, 0.84), 0.72, 1)
        : clamp(Math.max(sourceLuma, 1 - (layer - 1) * 0.12), 0.58, 1);
    const alpha =
      layer === null
        ? clamp(sourceColor[3], 0.74, 1)
        : clamp(sourceColor[3] * (layer === 1 ? 1 : 0.92), 0.7, 1);

    return [brightness, brightness, brightness, alpha];
  }

  if (layer !== null) {
    const brightness = clamp(Math.max(sourceLuma, 0.94 - (layer - 1) * 0.1), 0.56, 0.98);
    const alpha = clamp(sourceColor[3] * (layer === 1 ? 1 : 0.88), 0.58, 1);
    return [brightness, brightness, brightness, alpha];
  }

  const brightness = clamp(sourceLuma, 0.7, 1);
  return [brightness, brightness, brightness, clamp(sourceColor[3], 0.62, 1)];
}

function createTronLinkColor(
  color: StageScene['links'][number]['color'],
  stageMode: StageMode,
): RgbaColor {
  const sourceLuma = getPerceivedLuma(color);

  if (stageMode === '3d-mode') {
    const brightness = clamp(Math.max(sourceLuma, 0.9), 0.9, 1);
    return [brightness, brightness, brightness, clamp(Math.max(color[3], 0.8), 0.8, 1)];
  }

  const brightness = clamp(Math.max(sourceLuma, 0.78), 0.72, 0.96);
  return [brightness, brightness, brightness, clamp(Math.max(color[3], 0.68), 0.64, 0.92)];
}

function createTronLinkLineWidth(lineWidth: number, stageMode: StageMode): number {
  return stageMode === '3d-mode'
    ? Math.max(2.6, lineWidth * 1.08)
    : Math.max(2.2, lineWidth * 1.04);
}

function getPerceivedLuma(color: RgbaColor): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
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

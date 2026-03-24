import {luma, type Device} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {webgpuAdapter} from '@luma.gl/webgpu';

import {Camera2D, type ViewportSize} from './camera';
import {DEMO_LABELS} from './data/labels';
import {
  DEFAULT_BENCHMARK_LABEL_COUNT,
  STATIC_BENCHMARK_DATASET_ID,
  getStaticBenchmarkLabels,
} from './data/static-benchmark';
import {GridRenderer} from './grid';
import {FrameProfiler, type PerfSnapshot} from './perf';
import {TextRenderer} from './text/renderer';
import {
  RENDERER_MODES,
  RENDERER_MODE_OPTIONS,
  type LabelDefinition,
  type RendererMode,
} from './text/types';

const SHELL_SHADER = /* wgsl */ `
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

const DEFAULT_BENCHMARK_ACTION_COUNT = 33;
const BENCHMARK_ACTION_SEQUENCE: ControlAction[] = [
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'pan-right',
  'pan-up',
  'zoom-in',
  'zoom-in',
  'zoom-in',
  'zoom-in',
  'pan-left',
  'pan-down',
  'zoom-in',
  'zoom-in',
  'zoom-in',
  'zoom-in',
  'zoom-in',
  'zoom-in',
  'pan-right',
  'pan-up',
  'zoom-in',
  'zoom-in',
  'pan-left',
  'pan-down',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'zoom-out',
  'reset-camera',
];

type AppState = 'loading' | 'ready' | 'unsupported' | 'error';

type ControlAction =
  | 'pan-up'
  | 'pan-down'
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'reset-camera';

type DatasetName = 'demo' | 'benchmark';

type AppConfig = {
  benchmarkActionCount: number;
  benchmarkEnabled: boolean;
  datasetPreset: string;
  datasetName: DatasetName;
  gpuTimingEnabled: boolean;
  labels: LabelDefinition[];
  requestedLabelCount: number;
  rendererMode: RendererMode;
};

type BenchmarkSummary = {
  bytesUploadedPerFrame: number;
  cpuDrawAvgMs: number;
  cpuFrameAvgMs: number;
  cpuFrameSamples: number;
  cpuTextAvgMs: number;
  glyphCount: number;
  gpuFrameAvgMs: number | null;
  gpuFrameSamples: number;
  gpuSupported: boolean;
  labelCount: number;
  rendererMode: RendererMode;
  submittedGlyphCount: number;
  submittedVertexCount: number;
  visibleChunkCount: number;
  visibleGlyphCount: number;
  visibleLabelCount: number;
};

type ShellElements = {
  canvas: HTMLCanvasElement;
  controls: HTMLDivElement;
  detail: HTMLParagraphElement;
  message: HTMLDivElement;
  shell: HTMLDivElement;
  statusPanel: HTMLElement;
  stats: HTMLParagraphElement;
};

export type AppHandle = {
  destroy: () => void;
};

export async function startApp(root: HTMLElement): Promise<AppHandle> {
  const elements = createShell(root);
  const config = readAppConfig(window.location.search);
  const shell = new WebGPUShell(elements, config);

  await shell.start();

  return {
    destroy: () => shell.destroy(),
  };
}

class WebGPUShell {
  private device: Device | null = null;
  private frameId = 0;
  private backgroundModel: Model | null = null;
  private benchmarkStarted = false;
  private benchmarkSummary: BenchmarkSummary | null = null;
  private grid: GridRenderer | null = null;
  private profiler: FrameProfiler | null = null;
  private text: TextRenderer | null = null;
  private readonly camera = new Camera2D();
  private readonly actionButtons: HTMLButtonElement[] = [];
  private readonly rendererButtons: HTMLButtonElement[] = [];
  private destroyed = false;
  private rendererMode: RendererMode;

  constructor(
    private readonly elements: ShellElements,
    private readonly config: AppConfig,
  ) {
    this.rendererMode = config.rendererMode;
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
        id: 'linker-webgpu-shell',
        type: 'webgpu',
        adapters: [webgpuAdapter],
        createCanvasContext: {
          canvas: this.elements.canvas,
          alphaMode: 'opaque',
          autoResize: true,
          useDevicePixels: true,
        },
      });

      if (this.destroyed) {
        this.device.destroy();
        return;
      }

      this.profiler = new FrameProfiler(this.device, {
        enableGpuTimestamps: this.config.gpuTimingEnabled,
      });
      this.backgroundModel = new Model(this.device, {
        id: 'phase-1-shell',
        source: SHELL_SHADER,
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

      this.grid = new GridRenderer(this.device);
      this.text = new TextRenderer(this.device, this.config.labels, this.rendererMode);
      await this.text.ready;
      this.installInteractionHandlers();
      this.updateRendererButtons();

      this.elements.detail.hidden = true;
      this.elements.message.hidden = true;
      this.elements.canvas.hidden = false;
      this.setState('ready');
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
    this.grid?.destroy();
    this.text?.destroy();
    this.profiler?.destroy();
    this.device?.destroy();
    this.elements.shell.remove();
  }

  private render = (): void => {
    if (
      this.destroyed ||
      !this.device ||
      !this.backgroundModel ||
      !this.grid ||
      !this.text
    ) {
      return;
    }

    try {
      const frameStartedAt = performance.now();
      const viewport = this.getViewportSize();

      const gridStartedAt = performance.now();
      this.grid.update(this.camera, viewport);
      const gridCpuMs = performance.now() - gridStartedAt;

      const textStartedAt = performance.now();
      this.text.update(this.camera, viewport);
      const textCpuMs = performance.now() - textStartedAt;

      const drawStartedAt = performance.now();
      const framebuffer = this.device
        .getDefaultCanvasContext()
        .getCurrentFramebuffer({depthStencilFormat: false});

      const renderPass = this.device.beginRenderPass({
        id: 'phase-1-shell-pass',
        framebuffer,
        clearColor: [0.01, 0.02, 0.04, 1],
        ...this.profiler?.getRenderPassTimingProps(),
      });

      this.backgroundModel.draw(renderPass);
      this.grid.draw(renderPass);
      this.text.draw(renderPass);
      renderPass.end();
      this.profiler?.resolveGpuPass();
      this.device.submit();
      this.profiler?.submitGpuPass();
      const drawCpuMs = performance.now() - drawStartedAt;

      this.profiler?.recordCpuGrid(gridCpuMs);
      this.profiler?.recordCpuText(textCpuMs);
      this.profiler?.recordCpuDraw(drawCpuMs);
      this.profiler?.recordCpuFrame(performance.now() - frameStartedAt);
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
        this.camera.centerX = 0;
        this.camera.centerY = 0;
        this.camera.zoom = 0;
        break;
      default:
        break;
    }
  }

  private getViewportSize(): ViewportSize {
    const rect = this.elements.canvas.getBoundingClientRect();

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

  private handleRendererButtonClick = (event: MouseEvent): void => {
    const button = event.currentTarget;

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const mode = button.dataset.rendererMode;

    if (isRendererMode(mode)) {
      this.setRendererMode(mode);
    }
  };

  private setRendererMode(mode: RendererMode): void {
    if (!this.text || mode === this.rendererMode || document.body.dataset.benchmarkState === 'running') {
      return;
    }

    this.rendererMode = mode;
    this.text.setMode(mode);
    this.benchmarkSummary = null;
    document.body.dataset.benchmarkError = '';
    document.body.dataset.benchmarkState = this.config.benchmarkEnabled ? 'pending' : 'disabled';
    syncRendererQueryParam(mode);
    this.updateRendererButtons();
    this.updateStatus();
  }

  private updateRendererButtons(): void {
    const buttons = this.elements.controls.querySelectorAll<HTMLButtonElement>('[data-renderer-mode]');

    for (const button of buttons) {
      const isActive = button.dataset.rendererMode === this.rendererMode;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-pressed', String(isActive));
    }
  }

  private installInteractionHandlers(): void {
    this.actionButtons.push(
      ...this.elements.controls.querySelectorAll<HTMLButtonElement>('[data-control]'),
    );
    this.rendererButtons.push(
      ...this.elements.controls.querySelectorAll<HTMLButtonElement>('[data-renderer-mode]'),
    );

    for (const button of this.actionButtons) {
      button.addEventListener('click', this.handleActionButtonClick);
    }

    for (const button of this.rendererButtons) {
      button.addEventListener('click', this.handleRendererButtonClick);
    }
  }

  private removeInteractionHandlers(): void {
    for (const button of this.actionButtons) {
      button.removeEventListener('click', this.handleActionButtonClick);
    }

    for (const button of this.rendererButtons) {
      button.removeEventListener('click', this.handleRendererButtonClick);
    }

    this.actionButtons.length = 0;
    this.rendererButtons.length = 0;
  }

  private async runBenchmark(): Promise<void> {
    if (!this.profiler || !this.text || this.benchmarkStarted) {
      return;
    }

    this.benchmarkStarted = true;
    document.body.dataset.benchmarkState = 'running';
    document.body.dataset.benchmarkError = '';
    console.info(
      `Starting benchmark renderer=${this.rendererMode} dataset=${this.config.datasetName} labels=${this.config.labels.length}`,
    );

    try {
      await this.waitForAnimationFrames(4);
      await this.profiler.flushGpuSamples();
      this.profiler.reset();
      this.applyControlAction('reset-camera');
      await this.waitForAnimationFrames(2);

      const actionSequence = buildBenchmarkActionSequence(this.config.benchmarkActionCount);

      for (const action of actionSequence) {
        this.applyControlAction(action);
        await this.waitForAnimationFrames(1);
      }

      await this.waitForAnimationFrames(2);
      await this.profiler.flushGpuSamples();

      const perf = this.profiler.getSnapshot();
      const textStats = this.text.getStats();

      this.benchmarkSummary = {
        bytesUploadedPerFrame: textStats.bytesUploadedPerFrame,
        cpuDrawAvgMs: perf.cpuDrawAvgMs,
        cpuFrameAvgMs: perf.cpuFrameAvgMs,
        cpuFrameSamples: perf.cpuFrameSamples,
        cpuTextAvgMs: perf.cpuTextAvgMs,
        glyphCount: textStats.glyphCount,
        gpuFrameAvgMs: perf.gpuFrameAvgMs,
        gpuFrameSamples: perf.gpuFrameSamples,
        gpuSupported: perf.gpuSupported,
        labelCount: textStats.labelCount,
        rendererMode: this.rendererMode,
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
    document.body.dataset.benchmarkGpuTimingEnabled = String(this.config.gpuTimingEnabled);
    document.body.dataset.benchmarkRequestedLabelCount = String(this.config.requestedLabelCount);
    document.body.dataset.benchmarkDatasetPreset = this.config.datasetPreset;
    document.body.dataset.benchmarkRendererMode = this.rendererMode;

    if (!this.benchmarkSummary) {
      document.body.dataset.benchmarkBytesUploadedPerFrame = '0';
      document.body.dataset.benchmarkCpuDrawAvgMs = '0.000';
      document.body.dataset.benchmarkCpuFrameAvgMs = '0.000';
      document.body.dataset.benchmarkCpuFrameSamples = '0';
      document.body.dataset.benchmarkCpuTextAvgMs = '0.000';
      document.body.dataset.benchmarkGlyphCount = '0';
      document.body.dataset.benchmarkGpuFrameAvgMs = this.config.gpuTimingEnabled ? 'pending' : 'disabled';
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
    this.elements.canvas.hidden = true;
    this.elements.detail.hidden = false;
    this.elements.message.hidden = false;
    this.elements.message.innerHTML = `
      <strong>Startup Failed</strong>
      <p>${escapeHtml(message)}</p>
    `;
    this.elements.detail.textContent =
      'The shell failed after entering the WebGPU path. Check the console and runtime error details.';
  }

  private showUnsupported(message: string): void {
    this.setState('unsupported');
    this.elements.canvas.hidden = true;
    this.elements.detail.hidden = false;
    this.elements.message.hidden = false;
    this.elements.message.innerHTML = `
      <strong>WebGPU Required</strong>
      <p>${escapeHtml(message)}</p>
    `;
    this.elements.detail.textContent =
      'This build intentionally does not fall back to WebGL. It only boots with a working WebGPU implementation.';
  }

  private updateStatus(): void {
    const snapshot = this.camera.getSnapshot();
    const gridStats = this.grid?.getStats();
    const perf = this.profiler?.getSnapshot();
    const textStats = this.text?.getStats();
    const lineCount = gridStats ? gridStats.verticalLines + gridStats.horizontalLines : 0;
    const minorSpacing = gridStats ? formatSpacing(gridStats.minorSpacing) : 'n/a';
    const majorSpacing = gridStats ? formatSpacing(gridStats.majorSpacing) : 'n/a';
    const labelCount = textStats ? textStats.labelCount : 0;
    const glyphCount = textStats ? textStats.glyphCount : 0;
    const rendererMode = textStats ? textStats.rendererMode : this.rendererMode;
    const rendererLabel = getRendererModeLabel(rendererMode);
    const bytesUploadedPerFrame = textStats ? textStats.bytesUploadedPerFrame : 0;
    const submittedGlyphCount = textStats ? textStats.submittedGlyphCount : 0;
    const submittedVertexCount = textStats ? textStats.submittedVertexCount : 0;
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
    document.body.dataset.datasetName = this.config.datasetName;
    document.body.dataset.datasetPreset = this.config.datasetPreset;
    document.body.dataset.datasetLabelCount = String(this.config.labels.length);
    document.body.dataset.gridLineCount = String(lineCount);
    document.body.dataset.gridMinorSpacing = minorSpacing;
    document.body.dataset.gridMajorSpacing = majorSpacing;
    document.body.dataset.rendererMode = rendererMode;
    document.body.dataset.rendererLabel = rendererLabel;
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
    document.body.dataset.perfGpuFrameSamples = String(perf?.gpuFrameSamples ?? 0);
    document.body.dataset.perfGpuSupported = String(perf?.gpuSupported ?? false);

    this.setBenchmarkDatasets();

    this.elements.stats.textContent = [
      `dataset ${this.config.datasetName} (${this.config.labels.length} labels)`,
      `renderer ${rendererLabel}`,
      `center ${snapshot.centerX.toFixed(2)}, ${snapshot.centerY.toFixed(2)}`,
      `zoom ${snapshot.zoom.toFixed(2)}`,
      `scale ${snapshot.pixelsPerWorldUnit.toFixed(1)} px/world`,
      gridStats ? `grid ${lineCount} lines` : 'grid 0 lines',
      gridStats ? `spacing ${minorSpacing} / ${majorSpacing}` : 'spacing n/a',
      textStats
        ? `text ${labelCount} labels / ${visibleLabelCount} visible labels / ${visibleGlyphCount} visible glyphs`
        : 'text 0 labels',
      textStats && visibleChunkCount > 0 ? `chunks ${visibleChunkCount}` : null,
      textStats
        ? `draw ${submittedGlyphCount} glyphs / ${submittedVertexCount} vertices / ${formatBytes(bytesUploadedPerFrame)}`
        : 'draw 0 glyphs',
      textStats ? `glyphs ${glyphCount}` : 'glyphs 0',
      perf ? formatPerfSummary(perf) : 'perf pending',
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

function buildBenchmarkActionSequence(actionCount: number): ControlAction[] {
  const safeCount = Math.max(1, actionCount);
  const actions: ControlAction[] = [];

  for (let index = 0; index < safeCount; index += 1) {
    actions.push(BENCHMARK_ACTION_SEQUENCE[index % BENCHMARK_ACTION_SEQUENCE.length]);
  }

  return actions;
}

function createShell(root: HTMLElement): ShellElements {
  const shell = document.createElement('div');
  shell.className = 'app-shell';

  const canvas = document.createElement('canvas');
  canvas.className = 'app-canvas';
  canvas.dataset.testid = 'gpu-canvas';
  canvas.setAttribute('aria-label', 'luma.gl WebGPU canvas');
  canvas.hidden = true;

  const statusPanel = document.createElement('aside');
  statusPanel.className = 'status-panel';
  statusPanel.dataset.testid = 'status-panel';
  statusPanel.innerHTML = `
    <div class="status-eyebrow">Linker / Luma</div>
    <h1>Text Strategy Lab</h1>
  `;

  const detail = document.createElement('p');
  detail.textContent = 'Checking browser WebGPU support and creating the luma.gl device.';
  statusPanel.append(detail);

  const stats = document.createElement('p');
  stats.className = 'status-stats';
  stats.textContent =
    'renderer Baseline  |  center 0.00, 0.00  |  zoom 0.00  |  scale 56.0 px/world';
  statusPanel.append(stats);

  const controls = document.createElement('div');
  controls.className = 'button-panel';
  controls.dataset.testid = 'button-panel';
  controls.setAttribute('aria-label', 'Button panel');
  const rendererButtons = RENDERER_MODE_OPTIONS.map(
    ({mode, label}) =>
      `<button type="button" class="control-button" data-renderer-mode="${mode}" aria-pressed="false">${label}</button>`,
  ).join('');
  controls.innerHTML = `
    <div class="control-group">
      <div class="control-label">Renderer</div>
      <div class="control-row" data-testid="renderer-panel">
        ${rendererButtons}
      </div>
    </div>
    <div class="control-group">
      <div class="control-label">Camera</div>
      <div class="control-row">
        <button type="button" class="control-button" data-control="zoom-in">Zoom In</button>
        <button type="button" class="control-button" data-control="zoom-out">Zoom Out</button>
        <button type="button" class="control-button" data-control="reset-camera">Reset</button>
      </div>
      <div class="control-pad" aria-label="Camera pan controls">
        <button type="button" class="control-button" data-control="pan-up">Up</button>
        <div class="control-row">
          <button type="button" class="control-button" data-control="pan-left">Left</button>
          <button type="button" class="control-button" data-control="pan-right">Right</button>
        </div>
        <button type="button" class="control-button" data-control="pan-down">Down</button>
      </div>
    </div>
  `;

  const message = document.createElement('div');
  message.className = 'center-message';
  message.dataset.testid = 'app-message';
  message.innerHTML = `
    <strong>Preparing WebGPU</strong>
    <p>Initializing a luma.gl device and fullscreen canvas.</p>
  `;

  shell.append(canvas, statusPanel, controls, message);
  root.replaceChildren(shell);

  return {canvas, controls, detail, message, shell, statusPanel, stats};
}

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPerfSummary(perf: PerfSnapshot): string {
  const cpuFrame = formatMs(perf.cpuFrameAvgMs);
  const cpuText = formatMs(perf.cpuTextAvgMs);
  const gpuFrame =
    perf.gpuFrameAvgMs === null ? 'gpu unsupported' : `gpu ${formatMs(perf.gpuFrameAvgMs)}`;

  return `perf cpu ${cpuFrame} frame / ${cpuText} text / ${gpuFrame}`;
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

  return `${value} B`;
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

function getRendererModeLabel(rendererMode: RendererMode): string {
  return (
    RENDERER_MODE_OPTIONS.find((option) => option.mode === rendererMode)?.label ?? rendererMode
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

function isRendererMode(value: string | null | undefined): value is RendererMode {
  return RENDERER_MODES.includes(value as RendererMode);
}

function parseRendererMode(value: string | null): RendererMode {
  return isRendererMode(value) ? value : 'baseline';
}

function syncRendererQueryParam(rendererMode: RendererMode): void {
  const url = new URL(window.location.href);

  if (rendererMode === 'baseline') {
    url.searchParams.delete('renderer');
  } else {
    url.searchParams.set('renderer', rendererMode);
  }

  window.history.replaceState({}, '', url.toString());
}

function readAppConfig(search: string): AppConfig {
  const params = new URLSearchParams(search);
  const datasetName: DatasetName = params.get('dataset') === 'benchmark' ? 'benchmark' : 'demo';
  const requestedLabelCount =
    datasetName === 'benchmark'
      ? parseBoundedInteger(params.get('labelCount'), DEFAULT_BENCHMARK_LABEL_COUNT, 64, 16384)
      : DEMO_LABELS.length;
  const labels =
    datasetName === 'benchmark' ? getStaticBenchmarkLabels(requestedLabelCount) : DEMO_LABELS;

  return {
    benchmarkActionCount: parseBoundedInteger(
      params.get('benchmarkFrames'),
      DEFAULT_BENCHMARK_ACTION_COUNT,
      8,
      120,
    ),
    benchmarkEnabled: params.get('benchmark') === '1',
    datasetPreset: datasetName === 'benchmark' ? STATIC_BENCHMARK_DATASET_ID : 'demo-v1',
    datasetName,
    gpuTimingEnabled: params.get('gpuTiming') === '1',
    labels,
    requestedLabelCount,
    rendererMode: parseRendererMode(params.get('renderer')),
  };
}

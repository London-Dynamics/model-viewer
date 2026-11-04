/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Camera, Color, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, NeutralToneMapping, NoBlending, NormalBlending, Object3D, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,} from 'three';
import {DenoiseMaterial, GradientEquirectTexture, PhysicalCamera, WebGLPathTracer,} from 'three-gpu-pathtracer';
import {AVERAGE, CENTER, SAH} from 'three-mesh-bvh';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {AmbientOcclusionOptions, LDAmbientOcclusionComposer,} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

import {OidnDenoise} from './OidnDenoise.js';
import {isCrossOriginScript, PathTracerBVHWorker, pathTracerBvhWorkerScriptUrl} from './PathTracerBVHWorker.js';

const PATH_TRACER_DISPLAYS = [
  'progressive',
  'before-denoise',
  'after-denoise',
] as const;
// The WebGPU demo caps a frame at 250k pixels. This WebGL tracer draws that
// budget as one fragment-shader tile. On a heavy model a 250k tile measured
// ~90ms and a new one was submitted every frame, so the GPU queue filled and
// the whole machine stalled. Start smaller, then step the budget from the GPU
// timer so a tile stays near PATH_TRACER_TARGET_GPU_MS. The top step matches
// the demo.
const PATH_TRACER_FRAME_BUDGET_STEPS = [
  4096,
  8192,
  16384,
  32768,
  65536,
  131072,
  250000,
];
const PATH_TRACER_FRAME_BUDGET_INITIAL = 32768;
const PATH_TRACER_TARGET_GPU_MS = 8;

type GpuTimerExt = {
  TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number;
};
// After the pointer is released and the camera stops, wait before tracing so
// a pause in a drag does not start a sample.
const PATH_TRACER_SETTLE_MS = 300;
const DEFAULT_PATH_TRACER_FLOOR_COLOR = '#ffffff';
export const PATH_TRACER_READY_EVENT = 'path-tracer-ready';

const clampUnitInterval = (value: number, fallback: number): number => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
};

const CSS_RGB =
    /^rgba?\(\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)(?:\s*[,/]\s*([0-9.]+%?))?\s*\)$/i;

const cssChannel = (value: string): number => {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  const scaled = value.trim().endsWith('%') ? numeric / 100 : numeric / 255;
  return Math.min(1, Math.max(0, scaled));
};

const parseCssRgb = (value: string):
    {r: number; g: number; b: number; a: number;}|null => {
      const match = CSS_RGB.exec(value.trim());
      if (match == null) {
        return null;
      }
      const alphaSource = match[4];
      const alpha = alphaSource == null ?
          1 :
          alphaSource.trim().endsWith('%') ? Number.parseFloat(alphaSource) / 100 :
                                              Number.parseFloat(alphaSource);
      return {
        r: cssChannel(match[1]),
        g: cssChannel(match[2]),
        b: cssChannel(match[3]),
        a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
      };
    };

const cssByte = (channel: number): string => Math
    .round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0');

// The page shows through the transparent real-time canvas. Walk up from the
// element and composite the first painted backgrounds onto white, which is
// the canvas color when nothing above the viewer is painted.
const pageBackdropKey = (element: HTMLElement): string => {
  const view = element.ownerDocument.defaultView;
  if (view == null) {
    return DEFAULT_PATH_TRACER_FLOOR_COLOR;
  }

  const chain: HTMLElement[] = [];
  for (let node: HTMLElement|null = element; node != null;
       node = node.parentElement) {
    chain.push(node);
  }

  let red = 1;
  let green = 1;
  let blue = 1;
  for (let index = chain.length - 1; index >= 0; index--) {
    const parsed =
        parseCssRgb(view.getComputedStyle(chain[index]).backgroundColor);
    if (parsed == null || parsed.a <= 0) {
      continue;
    }
    red = parsed.r * parsed.a + red * (1 - parsed.a);
    green = parsed.g * parsed.a + green * (1 - parsed.a);
    blue = parsed.b * parsed.a + blue * (1 - parsed.a);
  }

  return `#${cssByte(red)}${cssByte(green)}${cssByte(blue)}`;
};

export const normalizePathTracerFloorColor = (value: string): string => {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() :
                                         DEFAULT_PATH_TRACER_FLOOR_COLOR;
};

export type PathTracerBVHStrategy = 'sah'|'center'|'average';

export interface PathTracerBuildOptions {
  strategy: PathTracerBVHStrategy;
  maxLeafTris: number;
}

export const DEFAULT_PATH_TRACER_BUILD_OPTIONS: PathTracerBuildOptions = {
  strategy: 'sah',
  maxLeafTris: 1,
};

const PATH_TRACER_BVH_STRATEGIES = new Set<PathTracerBVHStrategy>([
  'sah',
  'center',
  'average',
]);

const BVH_STRATEGY = {
  sah: SAH,
  center: CENTER,
  average: AVERAGE,
} as const;

export const resolvePathTracerBuildOptions = (
    current: PathTracerBuildOptions,
    partial?: Partial<PathTracerBuildOptions>|null,
    ): PathTracerBuildOptions => {
  if (partial == null) {
    return {...current};
  }

  const strategy = PATH_TRACER_BVH_STRATEGIES.has(
                       partial.strategy as PathTracerBVHStrategy) ?
      partial.strategy as PathTracerBVHStrategy :
      current.strategy;
  const maxLeafTris =
      partial.maxLeafTris != null && Number.isFinite(partial.maxLeafTris) ?
      Math.max(1, Math.floor(partial.maxLeafTris)) :
      current.maxLeafTris;

  return {strategy, maxLeafTris};
};
const PATH_TRACER_RESET_OPTION_KEYS = [
  'bounces',
  'renderScale',
  'tiles',
  'depthOfField',
  'focalLength',
  'fStop',
  'focusDistance',
  'apertureBlades',
  'apertureRotation',
  'anamorphicRatio',
] as const;

export type PathTracerDisplay = typeof PATH_TRACER_DISPLAYS[number];

export const normalizePathTracerDisplay = (value: string): PathTracerDisplay =>
    (PATH_TRACER_DISPLAYS as readonly string[]).includes(value) ?
    value as PathTracerDisplay :
    DEFAULT_PATH_TRACER_OPTIONS.display;

export interface PathTracerOptions {
  samples: number;
  samplesThreshold: number;
  display: PathTracerDisplay;
  fadeSeconds: number;
  freezeRealtime: boolean;
  bounces: number;
  renderScale: number;
  tiles: Vector2;
  depthOfField: boolean;
  focalLength: number;
  fStop: number;
  focusDistance: number;
  apertureBlades: number;
  apertureRotation: number;
  anamorphicRatio: number;
  denoise: boolean;
  denoiseSigma: number;
  denoiseThreshold: number;
  denoiseKSigma: number;
  floor: boolean;
  softShadow: boolean;
  floorColor: string;
  floorRoughness: number;
  floorMetalness: number;
  floorOpacity: number;
  ambientOcclusionPreviewOptions: AmbientOcclusionOptions|null;
}

export const DEFAULT_PATH_TRACER_OPTIONS: PathTracerOptions = {
  samples: 16,
  samplesThreshold: 6,
  display: 'after-denoise',
  fadeSeconds: 0.3,
  freezeRealtime: true,
  bounces: 5,
  renderScale: 1,
  tiles: new Vector2(3, 3),
  depthOfField: false,
  focalLength: 50,
  fStop: 1.8,
  focusDistance: 5,
  apertureBlades: 0,
  apertureRotation: 0,
  anamorphicRatio: 1,
  denoise: true,
  denoiseSigma: 5,
  denoiseThreshold: 0.1,
  denoiseKSigma: 1,
  floor: false,
  softShadow: false,
  floorColor: DEFAULT_PATH_TRACER_FLOOR_COLOR,
  floorRoughness: 0.2,
  floorMetalness: 0,
  floorOpacity: 1,
  ambientOcclusionPreviewOptions: null,
};

export class LDPathTracerComposer implements EffectComposerInterface {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  private readonly physicalCamera = new PhysicalCamera();
  private readonly denoiseMaterial = new DenoiseMaterial();
  private readonly denoiseQuad = new FullScreenQuad(this.denoiseMaterial);
  private readonly oidn = new OidnDenoise(() => this.requestRender());
  private lastTraceSamples = 0;
  private lastFadeAt = 0;
  private realtimeFrozen = false;
  private stampedRealtimeShadow = false;
  private pathTracer: WebGLPathTracer|null = null;
  private ambientOcclusionPreviewComposer: LDAmbientOcclusionComposer|null =
      null;
  private currentAmbientOcclusionPreviewOptions: AmbientOcclusionOptions|null =
      null;
  private queuedRender: number|null = null;
  private readonly lastCameraWorldMatrix = new Matrix4();
  private readonly lastCameraProjectionMatrix = new Matrix4();
  private readonly meshWorldMatrices = new Map<string, Matrix4>();
  private readonly shadowCatcherCenter = new Vector3();
  private shadowCatcher: Mesh<PlaneGeometry, MeshStandardMaterial>|null = null;
  private shadowCatcherState = '';
  private shadowCatcherMaterialState = '';
  private cameraStateInitialized = false;
  private options: PathTracerOptions = {
    ...DEFAULT_PATH_TRACER_OPTIONS,
    tiles: DEFAULT_PATH_TRACER_OPTIONS.tiles.clone(),
  };
  private buildOptions: PathTracerBuildOptions = {
    ...DEFAULT_PATH_TRACER_BUILD_OPTIONS,
  };
  private ready = false;
  private needsSceneUpdate = true;
  private bvhWorker: PathTracerBVHWorker|null = null;
  private bvhWorkerFailed = false;
  private bvhWorkerFetch: Promise<void>|null = null;
  private sceneBuildInFlight = false;
  private sceneBuildQueued = false;
  private sceneBuildGeneration = 0;
  private disposed = false;
  private environmentStateReady = false;
  // False while the camera moved this frame. Path tracing waits until it is
  // still; that frame only draws the real-time view.
  private cameraSettled = true;
  private readonly frameBudgetSize = new Vector2();
  private frameBudget = PATH_TRACER_FRAME_BUDGET_INITIAL;
  private gpuTimer: GpuTimerExt|null|undefined = undefined;
  private gpuQuery: WebGLQuery|null = null;
  private gpuQueryStartedAt = 0;
  private readonly activePointers = new Set<number>();
  private holdTraceUntil = 0;
  private interactionElement: HTMLElement|null = null;
  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    this.activePointers.add(event.pointerId);
    this.holdTraceUntil = Number.POSITIVE_INFINITY;
    this.requestRender();
  };
  private readonly onPointerUp = (event: PointerEvent) => {
    if (!this.activePointers.delete(event.pointerId)) {
      return;
    }
    if (this.activePointers.size === 0) {
      this.holdTraceUntil = performance.now() + PATH_TRACER_SETTLE_MS;
      this.requestRender();
    }
  };
  private lastEnvironmentIntensity = 1;
  private lastEnvironment: unknown = null;
  private lastBackground: unknown = null;
  private lastBackdropKey = '';
  private lightVisibilityKey = '';
  private readonly tracedBackdropColor = new Color();
  private readonly tracedBackdrop = new GradientEquirectTexture(16);

  constructor(initialOptions?: Partial<PathTracerOptions>) {
    if (initialOptions) {
      this.updateOptions(initialOptions);
    }
  }

  setRenderer(renderer: WebGLRenderer) {
    const rendererUnchanged =
        this.pathTracer != null && this.renderer === renderer;
    this.renderer = renderer;
    this.syncAmbientOcclusionPreview();
    if (!rendererUnchanged) {
      this.rebuildPathTracer();
    }
    this.requestRender();
  }

  setMainScene(scene: ModelScene) {
    const sceneChanged = this.scene !== scene;
    this.scene = scene;
    if (sceneChanged) {
      this.needsSceneUpdate = true;
      this.invalidateReady();
    }
    this.bindInteraction(scene.element);
    this.syncAmbientOcclusionPreview();
    this.syncScene();
    this.requestRender();
  }

  setMainCamera(camera: Camera) {
    const cameraChanged = this.camera !== camera;
    this.camera = camera;
    if (cameraChanged) {
      this.needsSceneUpdate = true;
    }
    this.syncAmbientOcclusionPreview();
    this.syncScene();
    this.requestRender();
  }

  setSize(width: number, height: number) {
    this.realtimeFrozen = false;
    this.pathTracer?.reset();
    this.ambientOcclusionPreviewComposer?.setSize(width, height);
    this.requestRender();
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp) {
    this.cameraSettled = true;
    if (this.scene == null || this.pathTracer == null) {
      return;
    }

    const latestCamera = this.scene.getCamera();
    if (latestCamera !== this.camera) {
      this.camera = latestCamera;
      const pathTracerCamera = this.getPathTracerCamera();
      this.pathTracer.setCamera(pathTracerCamera);
      this.rememberCameraState(pathTracerCamera);
      this.pathTracer.reset();
      this.cameraSettled = false;
    }

    this.syncShadowCatcher();
    this.syncScene();
    this.syncEnvironment();
    this.syncLights();
    this.updateSceneIfGeometryMoved();
    const hadCamera = this.cameraStateInitialized;
    if (this.updateCameraIfNeeded()) {
      this.cameraSettled = false;
      if (hadCamera) {
        this.holdTraceAfterMotion();
      }
    }
    this.ambientOcclusionPreviewComposer?.beforeRender(_time, _delta);
  }

  render(_deltaTime?: DOMHighResTimeStamp) {
    if (this.sceneBuildInFlight || this.pathTracer == null ||
        this.renderer == null || this.scene == null) {
      return;
    }

    this.renderer.toneMapping = this.scene.toneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;

    const {element, exposure} = this.scene;
    const exposureIsNumber =
        typeof exposure === 'number' && !Number.isNaN(exposure);
    const env = element.environmentImage;
    const sky = element.skyboxImage;
    const compensateExposure = this.scene.toneMapping === NeutralToneMapping &&
        (env === 'neutral' || env === 'legacy' || (!env && !sky));
    this.renderer.toneMappingExposure =
        (exposureIsNumber ? exposure : 1.0) * (compensateExposure ? 1.3 : 1.0);

    // Real time while the button is down, the camera is moving, or the settle
    // delay after a release has not elapsed. pausePathTracing skips the sample;
    // resetting drops a trace that is already on screen so the raster view
    // shows on this frame instead of after the in-flight tile.
    this.stampedRealtimeShadow = false;
    // A tile still on the GPU must finish before the next one is submitted.
    // Starting a new ~90ms tile every frame is what stalls the machine.
    const gpuBusy = !this.consumeGpuTiming();
    this.applyFrameBudget();
    const previewRealtime = this.activePointers.size > 0 ||
        !this.cameraSettled || performance.now() < this.holdTraceUntil;
    this.pathTracer.pausePathTracing = previewRealtime;
    if (previewRealtime || this.animationIsPlaying()) {
      this.realtimeFrozen = false;
      if (this.scene != null) {
        this.scene.lockRenderScale = false;
      }
    }
    if (previewRealtime) {
      if (this.oidn.holding || this.pathTracer.samples > 0) {
        this.oidn.reset();
        this.pathTracer.reset();
      }
      this.pathTracer.rasterizeScene = true;
      this.pathTracer.renderSample();
      this.lastTraceSamples = this.pathTracer.samples;
      this.queueNextProgressiveRender();
      if (this.shouldRenderAmbientOcclusionPreview()) {
        this.ambientOcclusionPreviewComposer?.render(_deltaTime);
      }
      this.renderSoftShadowOverlay();
      this.noteFadeFrame();
      this.maybeMarkReady();
      return;
    }

    if (this.pathTracer.samples < this.lastTraceSamples ||
        (this.oidn.holding &&
         this.pathTracer.samples < this.options.samples)) {
      this.oidn.reset();
    }
    this.syncDisplayGate();
    if (this.scene != null) {
      this.scene.lockRenderScale = true;
    }
    if (gpuBusy) {
      // Freeze already has its picture. With freeze off, the realtime view is
      // redrawn every frame, and the soft shadow has to be part of that.
      if (!this.shouldFreezeRealtime()) {
        this.keepRealtimePicture();
        this.renderSoftShadowOverlay();
      }
      this.noteFadeFrame();
      this.queueNextProgressiveRender();
      return;
    }
    this.presentPathTrace();
    if (this.pathTracer.samples < this.lastTraceSamples) {
      this.oidn.reset();
    }
    this.lastTraceSamples = this.pathTracer.samples;
    if (this.oidn.enabled && this.options.display !== 'before-denoise' &&
        this.pathTracer.samples >= this.options.samples) {
      const target = this.pathTracer.target;
      if (target != null) {
        this.oidn.start(
            this.renderer, this.scene, this.scene.getCamera(), target);
      }
    }
    if (this.shouldRenderAmbientOcclusionPreview()) {
      this.ambientOcclusionPreviewComposer?.render(_deltaTime);
    }
    this.renderSoftShadowOverlay();
    this.noteFadeFrame();

    if (this.pathTracer.samples < this.options.samples || this.oidn.pending ||
        (this.isDisplayRevealing() && this.traceOpacity() < 1)) {
      this.queueNextProgressiveRender();
    }
    this.maybeMarkReady();
  }

  setOidnDenoise(enabled: boolean) {
    this.oidn.setEnabled(enabled);
    this.requestRender();
  }

  updateOptions(partial: Partial<PathTracerOptions>) {
    const nextOptions = {
      ...this.options,
      ...partial,
      tiles: partial.tiles?.clone() ?? this.options.tiles.clone(),
    };
    const shouldReset = PATH_TRACER_RESET_OPTION_KEYS.some((key) => {
      const current = this.options[key];
      const next = nextOptions[key];
      return current instanceof Vector2 && next instanceof Vector2 ?
          !current.equals(next) :
          current !== next;
    });

    this.options = nextOptions;
    this.syncAmbientOcclusionPreview();
    this.applyOptions(shouldReset);
    this.requestRender();
  }

  getSamples() {
    return this.pathTracer?.samples ?? 0;
  }

  resetSamples() {
    // Restarts accumulation and keeps the current scene build. Camera moves
    // do the same and do not clear isPathTracerReady.
    this.cameraStateInitialized = false;
    this.pathTracer?.reset();
    this.requestRender();
  }

  get isReady() {
    return this.ready;
  }

  getBuildOptions(): PathTracerBuildOptions {
    return {...this.buildOptions};
  }

  setBuildOptions(partial: Partial<PathTracerBuildOptions>) {
    const next = resolvePathTracerBuildOptions(this.buildOptions, partial);
    if (next.strategy === this.buildOptions.strategy &&
        next.maxLeafTris === this.buildOptions.maxLeafTris) {
      return;
    }

    this.buildOptions = next;
    if (this.renderer != null && this.pathTracer != null) {
      this.rebuildPathTracer();
    }
    this.requestRender();
  }

  get ambientOcclusionPreviewOptions() {
    return this.currentAmbientOcclusionPreviewOptions;
  }

  markSceneDirty() {
    this.invalidateReady();
    this.needsSceneUpdate = true;
    this.meshWorldMatrices.clear();
    this.pathTracer?.reset();
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    this.sceneBuildGeneration++;
    this.sceneBuildQueued = false;
    this.sceneBuildInFlight = false;
    this.disableBvhWorker();
    this.disposePathTracer();
    this.ambientOcclusionPreviewComposer?.dispose();
    this.ambientOcclusionPreviewComposer = null;
    this.currentAmbientOcclusionPreviewOptions = null;
    this.denoiseQuad.dispose();
    this.tracedBackdrop.dispose();
    this.oidn.dispose();
    this.discardGpuTiming();
    if (this.scene != null) {
      this.scene.lockRenderScale = false;
    }
    this.disposeShadowCatcher();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.meshWorldMatrices.clear();
    this.bindInteraction(null);
    if (this.queuedRender != null) {
      window.cancelAnimationFrame(this.queuedRender);
      this.queuedRender = null;
    }
    this.cameraStateInitialized = false;
    this.environmentStateReady = false;
    this.needsSceneUpdate = true;
    this.ready = false;
  }

  private rebuildPathTracer() {
    if (this.renderer == null) {
      return;
    }

    this.disposePathTracer();
    this.invalidateReady();
    this.environmentStateReady = false;
    // 0.0.25 deprecated WebGLPathTracer in favor of WebGPUPathTracer. This
    // composer stays on WebGLPathTracer because model-viewer renders with
    // WebGLRenderer. The constructor warns; WebGPUPathTracer needs a
    // WebGPURenderer, which this element does not create.
    this.pathTracer = new WebGLPathTracer(this.renderer);
    this.pathTracer.renderDelay = 0;
    this.syncDisplayGate();
    this.pathTracer.rasterizeScene = true;
    this.pathTracer.renderToCanvas = true;
    this.pathTracer.renderToCanvasCallback = (target, renderer, quad) =>
        this.renderPathTracerOutput(target, renderer, quad);
    this.pathTracer.rasterizeSceneCallback = (scene, camera) =>
        this.rasterizeRealtimeScene(scene, camera);
    this.applyOptions();
    this.applyBuildOptions();
    this.needsSceneUpdate = true;
    this.sceneBuildGeneration++;
    if (this.sceneBuildInFlight) {
      this.sceneBuildQueued = true;
      return;
    }
    this.syncScene();
  }

  private disposePathTracer() {
    if (this.pathTracer == null) {
      return;
    }

    this.pathTracer.dispose();
    this.pathTracer = null;
  }

  private rememberEnvironmentState() {
    if (this.scene == null) {
      this.environmentStateReady = false;
      return;
    }

    const intensity = this.scene.environmentIntensity;
    this.lastEnvironmentIntensity =
        typeof intensity === 'number' && Number.isFinite(intensity) ?
        intensity :
        1;
    this.lastEnvironment = this.scene.environment;
    this.lastBackground = this.scene.background;
    this.lastBackdropKey = '';
    this.environmentStateReady = true;
  }

  private syncEnvironment() {
    if (this.pathTracer == null || this.scene == null ||
        this.sceneBuildInFlight || this.disposed) {
      return;
    }

    const intensityValue = this.scene.environmentIntensity;
    const intensity =
        typeof intensityValue === 'number' && Number.isFinite(intensityValue) ?
        intensityValue :
        1;
    const environment = this.scene.environment;
    const background = this.scene.background;
    const backdropKey = this.backdropKey();
    if (this.environmentStateReady &&
        intensity === this.lastEnvironmentIntensity &&
        environment === this.lastEnvironment &&
        background === this.lastBackground &&
        backdropKey === this.lastBackdropKey) {
      return;
    }

    this.lastEnvironmentIntensity = intensity;
    this.lastEnvironment = environment;
    this.lastBackground = background;
    this.lastBackdropKey = backdropKey;
    this.environmentStateReady = true;
    // The vendor demo assigns a GradientEquirectTexture as scene.background.
    // The Color shortcut is not enough here: its default gradient is white on
    // top and black on the bottom, and a white page matches the top so the
    // bottom stays black. Paint both ends with the page color, then restore
    // the scene background so the real-time view stays transparent.
    const sceneBackground = this.scene.background;
    if (backdropKey !== '') {
      this.paintTracedBackdrop(backdropKey);
      this.scene.background = this.tracedBackdrop;
    }
    try {
      this.pathTracer.updateEnvironment();
    } finally {
      this.scene.background = sceneBackground;
    }
  }

  private paintTracedBackdrop(color: string) {
    this.tracedBackdropColor.set(color);
    if (this.tracedBackdrop.topColor.equals(this.tracedBackdropColor) &&
        this.tracedBackdrop.bottomColor.equals(this.tracedBackdropColor)) {
      return;
    }
    this.tracedBackdrop.topColor.copy(this.tracedBackdropColor);
    this.tracedBackdrop.bottomColor.copy(this.tracedBackdropColor);
    this.tracedBackdrop.update();
  }

  private backdropKey(): string {
    if (this.scene == null || this.scene.background != null ||
        this.scene.element.skyboxImage) {
      return '';
    }
    return pageBackdropKey(this.scene.element);
  }

  private applyBuildOptions() {
    const generator = (this.pathTracer as unknown as {
                        _generator?: {bvhOptions?: Record<string, unknown>;};
                      } |
                       null)
                          ?._generator;
    if (generator == null) {
      return;
    }

    generator.bvhOptions = {
      ...generator.bvhOptions,
      strategy: BVH_STRATEGY[this.buildOptions.strategy],
      // three-mesh-bvh 0.9.15+ renamed maxLeafTris to targetLeafSize.
      targetLeafSize: this.buildOptions.maxLeafTris,
    };
  }

  private invalidateReady() {
    this.ready = false;
  }

  private maybeMarkReady() {
    // tiles are 3x3 by default, so one renderSample() finishes a single tile
    // and leaves samples at 1/9. A full sample is samples >= 1. Ready tracks
    // the first completed tile, which is what a host can observe on a heavy
    // model before nine tile passes have finished.
    if (this.ready || this.needsSceneUpdate || this.sceneBuildInFlight ||
        this.pathTracer == null || this.pathTracer.samples <= 0 ||
        this.scene == null) {
      return;
    }
    if (!this.hasTraceableMesh()) {
      return;
    }

    this.ready = true;
    this.scene.element.dispatchEvent(new CustomEvent(PATH_TRACER_READY_EVENT, {
      detail: {samples: this.pathTracer.samples},
    }));
  }

  private hasTraceableMesh() {
    if (this.scene == null) {
      return false;
    }

    let found = false;
    this.scene.traverseVisible((object: Object3D) => {
      if (found || !(object as Mesh).isMesh) {
        return;
      }
      if ((object as Mesh).userData?.pathTracerShadowCatcher === true) {
        return;
      }
      found = true;
    });
    return found;
  }

  private applyOptions(reset: boolean = true) {
    if (this.pathTracer == null) {
      return;
    }

    this.pathTracer.bounces = Math.max(1, Math.floor(this.options.bounces));
    this.syncDisplayGate();
    this.pathTracer.renderScale =
        Math.min(1, Math.max(0.1, this.options.renderScale));
    this.pathTracer.tiles.copy(this.options.tiles);
    this.denoiseMaterial.sigma = Math.max(0.001, this.options.denoiseSigma);
    this.denoiseMaterial.threshold =
        Math.max(0.0001, this.options.denoiseThreshold);
    this.denoiseMaterial.kSigma = Math.max(0, this.options.denoiseKSigma);
    if (reset && this.camera != null) {
      this.pathTracer.setCamera(this.getPathTracerCamera());
    }
    if (reset) {
      this.cameraStateInitialized = false;
      this.pathTracer.reset();
    }
  }

  private syncScene() {
    this.syncShadowCatcher();

    if (this.pathTracer == null || this.scene == null || this.camera == null ||
        !this.needsSceneUpdate || this.disposed) {
      return;
    }
    if (this.sceneBuildInFlight) {
      this.sceneBuildQueued = true;
      return;
    }

    this.beginSceneBuild();
  }

  private beginSceneBuild() {
    const pathTracer = this.pathTracer;
    const scene = this.scene;
    if (pathTracer == null || scene == null || this.camera == null ||
        this.disposed) {
      return;
    }

    if (this.shouldFetchCrossOriginWorker()) {
      this.invalidateReady();
      this.sceneBuildInFlight = true;
      this.needsSceneUpdate = false;
      this.fetchCrossOriginWorker();
      return;
    }

    const generation = ++this.sceneBuildGeneration;
    const pathTracerCamera = this.getPathTracerCamera();
    this.invalidateReady();
    this.sceneBuildInFlight = true;
    this.needsSceneUpdate = false;

    const settle = () => {
      if (this.disposed || generation !== this.sceneBuildGeneration) {
        this.sceneBuildInFlight = false;
        if (!this.disposed &&
            (this.needsSceneUpdate || this.sceneBuildQueued)) {
          this.sceneBuildQueued = false;
          this.needsSceneUpdate = true;
          this.syncScene();
        }
        return;
      }

      this.rememberGeometryState();
      this.rememberCameraState(pathTracerCamera);
      this.sceneBuildInFlight = false;
      if (this.needsSceneUpdate || this.sceneBuildQueued) {
        this.sceneBuildQueued = false;
        this.needsSceneUpdate = true;
        this.syncScene();
        return;
      }
      this.rememberEnvironmentState();
      this.requestRender();
    };

    const worker = this.ensureBvhWorker();
    // setScene/setSceneAsync bake visible meshes synchronously, before the
    // BVH promise settles. Hide shadow receivers for that snapshot only.
    const restoreShadowReceivers = this.hideShadowReceivers();
    // The floor is invisible to the real-time view. The tracer only includes
    // visible meshes, so show it for the synchronous scene snapshot.
    if (this.shadowCatcher != null) {
      this.shadowCatcher.visible = true;
    }
    try {
      if (worker != null) {
        pathTracer.setBVHWorker(worker);
        pathTracer.setSceneAsync(scene, pathTracerCamera)
            .then(() => {
              settle();
            })
            .catch((error: unknown) => {
              if (this.disposed || generation !== this.sceneBuildGeneration) {
                settle();
                return;
              }
              console.warn(
                  '[model-viewer] Path tracer BVH worker failed. Building on the main thread.',
                  error);
              this.disableBvhWorker();
              this.bvhWorkerFailed = true;
              this.sceneBuildInFlight = false;
              this.needsSceneUpdate = true;
              this.syncScene();
            });
        return;
      }

      pathTracer.setScene(scene, pathTracerCamera);
    } finally {
      restoreShadowReceivers();
      if (this.shadowCatcher != null) {
        this.shadowCatcher.visible = false;
      }
    }
    settle();
  }

  private shouldFetchCrossOriginWorker(): boolean {
    if (this.bvhWorker != null || this.bvhWorkerFailed ||
        this.bvhWorkerFetch != null || typeof Worker === 'undefined') {
      return false;
    }
    try {
      return isCrossOriginScript(pathTracerBvhWorkerScriptUrl());
    } catch {
      return false;
    }
  }

  private fetchCrossOriginWorker() {
    const generation = this.sceneBuildGeneration;
    this.bvhWorkerFetch =
        PathTracerBVHWorker.open()
            .then((worker) => {
              if (this.disposed || generation !== this.sceneBuildGeneration) {
                worker.dispose();
                return;
              }
              this.bvhWorker = worker;
            })
            .catch((error: unknown) => {
              console.warn(
                  '[model-viewer] Path tracer BVH worker could not be loaded from another origin. Building on the main thread.',
                  error);
              this.bvhWorkerFailed = true;
            })
            .finally(() => {
              this.bvhWorkerFetch = null;
              this.sceneBuildInFlight = false;
              if (this.disposed) {
                return;
              }
              this.needsSceneUpdate = true;
              this.syncScene();
            });
  }

  private ensureBvhWorker(): PathTracerBVHWorker|null {
    if (this.bvhWorker != null || this.bvhWorkerFailed ||
        typeof Worker === 'undefined') {
      return this.bvhWorker;
    }
    try {
      if (isCrossOriginScript(pathTracerBvhWorkerScriptUrl())) {
        return null;
      }
      this.bvhWorker = new PathTracerBVHWorker();
    } catch (error) {
      console.warn(
          '[model-viewer] Path tracer BVH worker is unavailable. Building on the main thread.',
          error);
      this.bvhWorkerFailed = true;
      this.bvhWorker = null;
    }
    return this.bvhWorker;
  }

  private disableBvhWorker() {
    try {
      this.bvhWorker?.dispose();
    } catch {
      // The worker may already have stopped.
    }
    this.bvhWorker = null;
  }

  private syncShadowCatcher() {
    if (this.scene == null) {
      this.removeShadowCatcher();
      return;
    }

    const color = normalizePathTracerFloorColor(this.options.floorColor);
    const roughness = clampUnitInterval(
        this.options.floorRoughness,
        DEFAULT_PATH_TRACER_OPTIONS.floorRoughness);
    const metalness = clampUnitInterval(
        this.options.floorMetalness,
        DEFAULT_PATH_TRACER_OPTIONS.floorMetalness);
    const opacity = clampUnitInterval(
        this.options.floorOpacity, DEFAULT_PATH_TRACER_OPTIONS.floorOpacity);
    const shouldShow =
        (this.options.floor || this.scene.shadowMode === 'path-tracer') &&
        opacity > 0;
    if (!shouldShow) {
      this.removeShadowCatcher();
      return;
    }

    const shadowCatcher = this.ensureShadowCatcher();
    const {boundingBox, size} = this.scene;
    boundingBox.getCenter(this.shadowCatcherCenter);

    const maxDimension = Math.max(size.x, size.z, 1);
    const width = Math.max(size.x, maxDimension) * 2;
    const depth = Math.max(size.z, maxDimension) * 2;
    const gap = 0.001 * maxDimension;
    const geometryState = [
      this.scene.shadowMode,
      width.toFixed(4),
      depth.toFixed(4),
      this.shadowCatcherCenter.x.toFixed(4),
      boundingBox.min.y.toFixed(4),
      this.shadowCatcherCenter.z.toFixed(4),
    ].join('|');
    const materialState =
        [color, roughness.toFixed(4), metalness.toFixed(4), opacity.toFixed(4)]
            .join('|');
    const geometryChanged = geometryState !== this.shadowCatcherState;
    const materialChanged = materialState !== this.shadowCatcherMaterialState;
    if (!geometryChanged && !materialChanged) {
      return;
    }

    if (materialChanged) {
      shadowCatcher.material.color.set(color);
      shadowCatcher.material.roughness = roughness;
      shadowCatcher.material.metalness = metalness;
      shadowCatcher.material.opacity = opacity;
      shadowCatcher.material.transparent = opacity < 1;
      shadowCatcher.material.needsUpdate = true;
      this.shadowCatcherMaterialState = materialState;
    }

    if (geometryChanged) {
      shadowCatcher.position.set(
          this.shadowCatcherCenter.x,
          boundingBox.min.y - gap,
          this.shadowCatcherCenter.z);
      shadowCatcher.rotation.set(-Math.PI / 2, 0, 0);
      shadowCatcher.scale.set(width, depth, 1);
      if (shadowCatcher.parent !== this.scene.target) {
        this.scene.target.add(shadowCatcher);
      }
      this.shadowCatcherState = geometryState;
      this.markSceneDirty();
    }

    (this.pathTracer as any)?.updateMaterials?.();
    if (materialChanged && !geometryChanged) {
      this.pathTracer?.reset();
      this.requestRender();
    }
  }

  private rasterizeRealtimeScene(scene: Object3D, camera: Camera) {
    const renderer = this.renderer;
    if (renderer == null) {
      return;
    }

    // Draw the soft shadow once, after this frame, so it darkens the page
    // showing through the transparent canvas, or the path-traced image once
    // that image is on screen. Leaving the plane in the raster paints a grey
    // card that does not match either background.
    const restoreShadow = this.scene?.shadowMode === 'soft-shadow' ?
        this.scene.shadow?.hideFromPathTracer() :
        undefined;
    try {
      renderer.render(scene as ModelScene, camera);
    } finally {
      restoreShadow?.();
    }
  }

  private syncDisplayGate() {
    const pathTracer = this.pathTracer;
    if (pathTracer == null) {
      return;
    }

    pathTracer.fadeDuration = Math.max(0, this.options.fadeSeconds) * 1000;
    if (this.options.display === 'progressive') {
      pathTracer.minSamples =
          Math.max(1, Math.floor(this.options.samplesThreshold));
      return;
    }
    if (this.isHeldDisplayReady()) {
      pathTracer.minSamples = 1;
      return;
    }
    pathTracer.minSamples = Number.MAX_SAFE_INTEGER;
    this.setTraceOpacity(0);
  }

  private isDisplayRevealing(): boolean {
    if (this.pathTracer == null) {
      return false;
    }
    if (this.options.display === 'progressive') {
      return this.pathTracer.samples >=
          Math.max(1, Math.floor(this.options.samplesThreshold));
    }
    return this.isHeldDisplayReady();
  }

  private isHeldDisplayReady(): boolean {
    const pathTracer = this.pathTracer;
    if (pathTracer == null) {
      return false;
    }
    const finished = pathTracer.samples >= Math.max(1, this.options.samples);
    if (this.options.display === 'before-denoise') {
      return finished;
    }
    if (this.oidn.enabled) {
      return this.oidn.complete || this.oidn.failed;
    }
    return finished;
  }

  private presentPathTrace() {
    const pathTracer = this.pathTracer;
    const renderer = this.renderer;
    if (pathTracer == null || renderer == null) {
      return;
    }

    const quad = this.traceQuad();
    const holdSampling = this.oidn.holding &&
        pathTracer.samples >= this.options.samples;
    const drawDenoised =
        holdSampling && this.shouldDrawDenoisedTrace() && quad != null;
    this.keepRealtimePicture();
    // The realtime picture is already in the framebuffer. Drawing the scene
    // again here clears it, so the fade would rise out of a blank frame.
    pathTracer.rasterizeScene = false;

    if (drawDenoised && quad != null) {
      this.advanceTraceFade();
      if (this.traceOpacity() > 0) {
        this.drawOidn(renderer, quad);
      }
      return;
    }
    if (holdSampling) {
      return;
    }
    this.renderSampleTimed();
  }

  private ensureGpuTimer(): GpuTimerExt|null {
    if (this.gpuTimer !== undefined) {
      return this.gpuTimer;
    }
    const gl =
        this.renderer?.getContext() as WebGL2RenderingContext | undefined;
    this.gpuTimer =
        (gl?.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimerExt |
         null) ??
        null;
    return this.gpuTimer;
  }

  // True when another path-trace tile may be submitted. A pending timer means
  // the previous tile is still on the GPU.
  private consumeGpuTiming(): boolean {
    const query = this.gpuQuery;
    const timer = this.gpuTimer;
    if (query == null || timer == null || this.renderer == null) {
      return true;
    }

    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const waited = performance.now() - this.gpuQueryStartedAt;
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
      // Some drivers never publish the timer. Waiting forever would stop the
      // trace after the first tile. The wall time is a coarse stand-in.
      if (waited < 50) {
        return false;
      }
      gl.deleteQuery(query);
      this.gpuQuery = null;
      this.adaptFrameBudget(waited);
      return true;
    }

    const disjoint = Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT));
    const elapsedNs =
        disjoint ? 0 : Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
    gl.deleteQuery(query);
    this.gpuQuery = null;
    if (!disjoint && elapsedNs > 0) {
      this.adaptFrameBudget(elapsedNs / 1e6);
    }
    return true;
  }

  private discardGpuTiming() {
    const query = this.gpuQuery;
    if (query == null || this.renderer == null) {
      this.gpuQuery = null;
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    gl.deleteQuery(query);
    this.gpuQuery = null;
  }

  private adaptFrameBudget(gpuMs: number) {
    if (!Number.isFinite(gpuMs) || gpuMs < 0.5) {
      return;
    }
    const index = PATH_TRACER_FRAME_BUDGET_STEPS.indexOf(this.frameBudget);
    if (index < 0) {
      this.frameBudget = PATH_TRACER_FRAME_BUDGET_INITIAL;
      return;
    }
    const ratio = PATH_TRACER_TARGET_GPU_MS / gpuMs;
    const scaled = Math.min(4, Math.max(0.25, ratio));
    const estimate = this.frameBudget * Math.sqrt(scaled);
    // One step at a time, and only when the estimate is well clear of the
    // current step, so the tile grid does not restart every frame.
    if (estimate <= this.frameBudget / Math.SQRT2 && index > 0) {
      this.frameBudget = PATH_TRACER_FRAME_BUDGET_STEPS[index - 1];
    } else if (
        estimate >= this.frameBudget * Math.SQRT2 &&
        index < PATH_TRACER_FRAME_BUDGET_STEPS.length - 1) {
      this.frameBudget = PATH_TRACER_FRAME_BUDGET_STEPS[index + 1];
    }
  }

  private renderSampleTimed() {
    const pathTracer = this.pathTracer;
    const renderer = this.renderer;
    if (pathTracer == null || renderer == null) {
      return;
    }

    const samplesBefore = pathTracer.samples;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const timer = this.ensureGpuTimer();
    const query = timer != null ? gl.createQuery() : null;
    if (timer != null && query != null) {
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    }
    pathTracer.renderSample();
    if (timer == null || query == null) {
      return;
    }
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    if (pathTracer.samples > samplesBefore) {
      this.gpuQuery = query;
      this.gpuQueryStartedAt = performance.now();
      return;
    }
    gl.deleteQuery(query);
  }

  private animationIsPlaying(): boolean {
    const element = this.scene?.element as {paused?: boolean}|undefined;
    return element != null && element.paused === false;
  }

  private shouldFreezeRealtime(): boolean {
    return this.options.freezeRealtime && !this.animationIsPlaying();
  }

  /**
   * Draw the realtime view once, then leave those pixels in place until the
   * camera moves or an animation plays. The path-trace fade blends over that
   * picture instead of clearing it.
   */
  private keepRealtimePicture() {
    if (this.realtimeFrozen && this.shouldFreezeRealtime()) {
      return;
    }
    if (this.scene == null || this.camera == null) {
      return;
    }
    this.rasterizeRealtimeScene(this.scene, this.camera);
    this.stampRealtimeShadow();
    this.stampedRealtimeShadow = true;
    this.realtimeFrozen = this.shouldFreezeRealtime();
  }

  private stampRealtimeShadow() {
    if (this.renderer == null || this.scene == null ||
        this.scene.shadowMode !== 'soft-shadow') {
      return;
    }
    this.renderer.resetState();
    this.scene.shadow?.renderFloor(
        this.renderer, this.scene, this.scene.getCamera());
  }

  private shouldDrawDenoisedTrace(): boolean {
    if (!this.oidn.enabled || this.options.display === 'before-denoise') {
      return false;
    }
    if (this.options.display === 'after-denoise') {
      return this.oidn.complete;
    }
    return true;
  }

  private traceQuad(): FullScreenQuad|null {
    return (this.pathTracer as {_quad?: FullScreenQuad}|null)?._quad ?? null;
  }

  private traceOpacity(): number {
    return this.traceQuad()?.material.opacity ?? 0;
  }

  private setTraceOpacity(opacity: number) {
    const material = this.traceQuad()?.material;
    if (material != null) {
      material.opacity = opacity;
    }
  }

  private advanceTraceFade() {
    const material = this.traceQuad()?.material;
    if (material == null) {
      return;
    }
    const duration = Math.max(0, this.options.fadeSeconds) * 1000;
    if (duration === 0) {
      material.opacity = 1;
      return;
    }
    const now = performance.now();
    const delta = this.lastFadeAt === 0 ? 0 : Math.min(100, now - this.lastFadeAt);
    material.opacity = Math.min(1, material.opacity + delta / duration);
  }

  private noteFadeFrame() {
    this.lastFadeAt = performance.now();
  }

  private renderSoftShadowOverlay() {
    if (this.renderer == null || this.scene == null ||
        this.scene.shadowMode !== 'soft-shadow') {
      return;
    }
    // Realtime stays on screen after the pointer is released, and while a
    // hidden trace accumulates. The soft shadow belongs on that picture.
    // The trace stamp is separate, and only when the trace covers the frame.
    // A frozen realtime frame already has its shadow. Drawing it again while
    // the trace fades in would repaint the scene under the crossfade.
    if (this.stampedRealtimeShadow && this.traceOpacity() < 1) {
      return;
    }
    if (this.realtimeFrozen && this.traceOpacity() < 1) {
      return;
    }
    if (this.traceOpacity() >= 1 && !this.options.softShadow) {
      return;
    }

    // The path-tracer quad leaves blending disabled. Reset so the shadow
    // darkens the framebuffer that is already there: the page color while
    // the trace is not on screen, and the path-traced background once it is.
    this.renderer.resetState();
    this.scene.shadow?.renderFloor(
        this.renderer, this.scene, this.scene.getCamera());
  }

  private syncLights() {
    if (this.pathTracer == null || this.scene == null ||
        this.sceneBuildInFlight ||
        (this.pathTracer as {scene?: unknown}).scene == null) {
      return;
    }

    const parts: string[] = [];
    this.scene.traverse((object) => {
      const light = object as {
        isLight?: boolean; uuid: string; visible: boolean; intensity?: number;
        material?: {emissive?: {r: number; g: number; b: number;}; emissiveIntensity?: number; uuid: string;}|
            Array<{emissive?: {r: number; g: number; b: number;}; emissiveIntensity?: number; uuid: string;}>;
      };
      if (light.isLight === true) {
        parts.push(
            `${light.uuid}:${light.visible ? 1 : 0}:${light.intensity ?? 0}`);
      }
      const materials = light.material == null ?
          [] :
          Array.isArray(light.material) ? light.material : [light.material];
      for (const material of materials) {
        if (material.emissive == null || material.emissiveIntensity == null) {
          continue;
        }
        const color = material.emissive.r + material.emissive.g + material.emissive.b;
        if (color <= 0 && material.emissiveIntensity === 0) {
          continue;
        }
        parts.push(`${material.uuid}:${material.emissiveIntensity}`);
      }
    });
    const key = parts.join('|');
    if (key === this.lightVisibilityKey) {
      return;
    }
    this.lightVisibilityKey = key;
    this.pathTracer.updateLights();
    this.pathTracer.updateMaterials();
  }

  private renderPathTracerOutput(
      target: WebGLRenderTarget, renderer: WebGLRenderer,
      quad: FullScreenQuad) {
    if (this.shouldRenderAmbientOcclusionPreview()) {
      return;
    }
    const useSpatialDenoise = this.options.denoise && !this.oidn.enabled &&
        this.options.display !== 'before-denoise' && this.pathTracer != null &&
        (this.options.display === 'after-denoise' ?
             this.pathTracer.samples >= this.options.samples :
             this.pathTracer.samples >= this.options.samplesThreshold);
    if (!useSpatialDenoise) {
      const currentAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      quad.render(renderer);
      renderer.autoClear = currentAutoClear;
      return;
    }

    const sourceMaterial = quad.material;
    this.denoiseMaterial.map = target.texture;
    this.denoiseMaterial.opacity = sourceMaterial.opacity;
    this.denoiseMaterial.transparent = sourceMaterial.opacity < 1;
    this.denoiseMaterial.blending =
        sourceMaterial.opacity < 1 ? NormalBlending : NoBlending;

    const currentAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    this.denoiseQuad.render(renderer);
    renderer.autoClear = currentAutoClear;

    this.denoiseMaterial.blending = NoBlending;
  }

  private drawOidn(renderer: WebGLRenderer, quad: FullScreenQuad) {
    const texture = this.oidn.texture;
    if (texture == null) {
      return;
    }

    const material = quad.material as FullScreenQuad['material']&{
      map: typeof texture | null;
      blending: number;
      transparent: boolean;
      opacity: number;
    };
    const previousMap = material.map;
    const previousBlending = material.blending;
    material.map = texture;
    // Straight crossfade over the realtime picture. NoBlending would replace
    // that picture with a premultiplied trace, and the page would show
    // through as white until the fade finished.
    material.transparent = true;
    material.blending =
        material.opacity < 1 ? NormalBlending : NoBlending;
    const currentAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    quad.render(renderer);
    renderer.autoClear = currentAutoClear;
    material.map = previousMap;
    material.blending = previousBlending;
  }

  private shouldRenderAmbientOcclusionPreview() {
    return this.ambientOcclusionPreviewComposer != null &&
        this.pathTracer != null &&
        this.pathTracer.samples < this.options.samplesThreshold;
  }

  private syncAmbientOcclusionPreview() {
    const options = this.options.ambientOcclusionPreviewOptions;
    this.currentAmbientOcclusionPreviewOptions = options;

    if (options == null) {
      this.ambientOcclusionPreviewComposer?.dispose();
      this.ambientOcclusionPreviewComposer = null;
      return;
    }

    if (this.ambientOcclusionPreviewComposer == null) {
      this.ambientOcclusionPreviewComposer =
          new LDAmbientOcclusionComposer(options);
      if (this.renderer != null) {
        this.ambientOcclusionPreviewComposer.setRenderer(this.renderer);
      }
      if (this.scene != null) {
        this.ambientOcclusionPreviewComposer.setMainScene(this.scene);
      }
      if (this.camera != null) {
        this.ambientOcclusionPreviewComposer.setMainCamera(this.camera);
      }
      return;
    }

    this.ambientOcclusionPreviewComposer.updateOptions(options);
  }

  private ensureShadowCatcher() {
    if (this.shadowCatcher != null) {
      return this.shadowCatcher;
    }

    const material = new MeshStandardMaterial({
      color: DEFAULT_PATH_TRACER_FLOOR_COLOR,
      metalness: DEFAULT_PATH_TRACER_OPTIONS.floorMetalness,
      opacity: DEFAULT_PATH_TRACER_OPTIONS.floorOpacity,
      roughness: DEFAULT_PATH_TRACER_OPTIONS.floorRoughness,
      side: DoubleSide,
      transparent: DEFAULT_PATH_TRACER_OPTIONS.floorOpacity < 1,
    });

    this.shadowCatcher = new Mesh(new PlaneGeometry(1, 1), material);
    this.shadowCatcher.name = 'PathTracerShadowCatcher';
    this.shadowCatcher.visible = false;
    this.shadowCatcher.userData.noHit = true;
    this.shadowCatcher.userData.pathTracerShadowCatcher = true;

    return this.shadowCatcher;
  }

  private removeShadowCatcher() {
    if (this.shadowCatcher == null) {
      return;
    }

    if (this.shadowCatcher.parent != null) {
      this.shadowCatcher.removeFromParent();
      this.markSceneDirty();
    }
    this.shadowCatcherState = '';
    this.shadowCatcherMaterialState = '';
  }

  private disposeShadowCatcher() {
    if (this.shadowCatcher == null) {
      return;
    }

    this.removeShadowCatcher();
    this.shadowCatcher.geometry.dispose();
    this.shadowCatcher.material.dispose();
    this.shadowCatcher = null;
  }

  private hideShadowReceivers(): () => void {
    const shadow = this.scene?.shadow;
    if (shadow == null) {
      return () => {};
    }
    return shadow.hideFromPathTracer();
  }

  private isShadowReceiver(object: Object3D): boolean {
    return this.scene?.shadow?.isExcludedFromPathTracer(object) === true;
  }

  private updateSceneIfGeometryMoved() {
    if (this.scene == null || this.meshWorldMatrices.size === 0) {
      return;
    }

    this.scene.updateMatrixWorld(true);
    const seenMeshes = new Set<string>();
    let changed = false;

    this.scene.traverseVisible((object: Object3D) => {
      if (!(object as any).isMesh || this.isShadowReceiver(object)) {
        return;
      }

      seenMeshes.add(object.uuid);
      const previousMatrix = this.meshWorldMatrices.get(object.uuid);
      if (previousMatrix == null) {
        this.meshWorldMatrices.set(object.uuid, object.matrixWorld.clone());
        changed = true;
      } else if (!previousMatrix.equals(object.matrixWorld)) {
        previousMatrix.copy(object.matrixWorld);
        changed = true;
      }
    });

    for (const uuid of this.meshWorldMatrices.keys()) {
      if (!seenMeshes.has(uuid)) {
        this.meshWorldMatrices.delete(uuid);
        changed = true;
      }
    }

    if (changed) {
      this.needsSceneUpdate = true;
      this.pathTracer?.reset();
      this.syncScene();
    }
  }

  private rememberGeometryState() {
    if (this.scene == null) {
      return;
    }

    this.meshWorldMatrices.clear();
    this.scene.updateMatrixWorld(true);
    this.scene.traverseVisible((object: Object3D) => {
      if ((object as any).isMesh && !this.isShadowReceiver(object)) {
        this.meshWorldMatrices.set(object.uuid, object.matrixWorld.clone());
      }
    });
  }

  private bindInteraction(element: HTMLElement|null) {
    if (this.interactionElement === element) {
      return;
    }
    this.interactionElement?.removeEventListener(
        'pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.interactionElement = element;
    this.activePointers.clear();
    if (element == null) {
      return;
    }
    element.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
  }

  private holdTraceAfterMotion() {
    if (this.activePointers.size > 0) {
      this.holdTraceUntil = Number.POSITIVE_INFINITY;
      return;
    }
    this.holdTraceUntil = performance.now() + PATH_TRACER_SETTLE_MS;
  }

  private applyFrameBudget() {
    const pathTracer = this.pathTracer;
    const renderer = this.renderer;
    if (pathTracer == null || renderer == null) {
      return;
    }

    renderer.getDrawingBufferSize(this.frameBudgetSize);
    const width = Math.max(
        1, Math.floor(pathTracer.renderScale * this.frameBudgetSize.x));
    const height = Math.max(
        1, Math.floor(pathTracer.renderScale * this.frameBudgetSize.y));
    const budgetTiles = Math.max(
        1, Math.ceil(width * height / this.frameBudget));
    let tilesX = Math.ceil(Math.sqrt(budgetTiles));
    let tilesY = Math.ceil(budgetTiles / tilesX);
    tilesX = Math.max(tilesX, Math.max(1, Math.floor(this.options.tiles.x)));
    tilesY = Math.max(tilesY, Math.max(1, Math.floor(this.options.tiles.y)));
    if (pathTracer.tiles.x !== tilesX || pathTracer.tiles.y !== tilesY) {
      const finer = tilesX * tilesY > pathTracer.tiles.x * pathTracer.tiles.y;
      pathTracer.tiles.set(tilesX, tilesY);
      // A finer grid has to apply now. The in-flight sample captured the old
      // tiles, and finishing that sweep would keep submitting the slow ones.
      const taskOwner = (pathTracer as {_pathTracer?: {_task?: unknown};})
                            ._pathTracer;
      if (finer && taskOwner != null) {
        taskOwner._task = null;
      }
    }
  }

  private updateCameraIfNeeded(): boolean {
    if (this.pathTracer == null || this.camera == null) {
      return false;
    }

    const pathTracerCamera = this.getPathTracerCamera();
    pathTracerCamera.updateMatrixWorld();
    if (this.cameraStateInitialized &&
        this.lastCameraWorldMatrix.equals(pathTracerCamera.matrixWorld) &&
        this.lastCameraProjectionMatrix.equals(
            pathTracerCamera.projectionMatrix)) {
      return false;
    }

    this.pathTracer.setCamera(pathTracerCamera);
    this.rememberCameraState(pathTracerCamera);
    return true;
  }

  private rememberCameraState(camera: Camera) {
    camera.updateMatrixWorld();
    this.lastCameraWorldMatrix.copy(camera.matrixWorld);
    this.lastCameraProjectionMatrix.copy(camera.projectionMatrix);
    this.cameraStateInitialized = true;
  }

  private getPathTracerCamera(): Camera {
    if (!this.options.depthOfField ||
        !(this.camera instanceof PerspectiveCamera)) {
      return this.camera!;
    }

    this.physicalCamera.copy(this.camera);
    this.physicalCamera.setFocalLength(Math.max(1, this.options.focalLength));
    this.physicalCamera.fStop = Math.max(0.1, this.options.fStop);
    this.physicalCamera.focusDistance =
        Math.max(0.001, this.options.focusDistance);
    this.physicalCamera.apertureBlades =
        Math.max(0, Math.floor(this.options.apertureBlades));
    this.physicalCamera.apertureRotation = this.options.apertureRotation;
    this.physicalCamera.anamorphicRatio =
        Math.max(0.01, this.options.anamorphicRatio);
    this.physicalCamera.updateProjectionMatrix();
    this.physicalCamera.updateMatrixWorld();

    return this.physicalCamera;
  }

  private queueNextProgressiveRender() {
    if (this.scene == null || this.queuedRender != null) {
      return;
    }

    // Renderer.hasRendered() clears the dirty flag immediately after render().
    // Queue on the next frame so progressive samples keep accumulating.
    this.queuedRender = window.requestAnimationFrame(() => {
      this.queuedRender = null;
      this.scene?.queueRender();
    });
  }

  private requestRender() {
    this.scene?.queueRender();
  }
}

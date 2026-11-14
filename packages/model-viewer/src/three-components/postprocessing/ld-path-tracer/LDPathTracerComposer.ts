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

import {Box3, Camera, CanvasTexture, Color, DirectionalLight, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, Object3D, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector2, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget, WebGPUCoordinateSystem,} from 'three';
import {PhysicalCamera} from 'three-gpu-pathtracer';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {AmbientOcclusionOptions, LDAmbientOcclusionComposer,} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

import {captureSceneBvh, decodeBvhRecords, encodeBvhRecords, hashMeshPositions} from './cache/path-tracer-bvh-cache.js';
import {fnv1aHex, PathTracerCacheFingerprint} from './cache/path-tracer-cache-format.js';
import {PathTracerCacheLoadResult, PathTracerCacheStore, PathTracerCacheTimings} from './cache/path-tracer-cache-store.js';
import {PathTracerCacheFlags, PathTracerCacheInvalidation, PathTracerCacheLoadRequest, PathTracerCacheType} from './cache/path-tracer-cache-types.js';
import {createIrradianceGrid, decodeIrradiancePayload, encodeIrradiancePayload, gridForBounds, IRRADIANCE_MIN_SAMPLES, IRRADIANCE_SLOT_COUNT, IrradianceGridMeta} from './cache/path-tracer-irradiance-cache.js';
import {collectMaterialRecords, diffMaterialWatch, encodeMaterialRecords, MaterialWatchSample, sampleMaterialWatch} from './cache/path-tracer-material-cache.js';
import {resolvePathTracerRenderScale} from './path-tracer-scale.js';
import {isCrossOriginScript, PathTracerBVHWorker, pathTracerBvhWorkerScriptUrl} from './PathTracerBVHWorker.js';
import {applyShadowStretch, DEFAULT_FLOOR_REFLECTION, effectSupport, effectiveFloorMode, FLOOR_OCCLUSION_SAMPLES, footprintFromBounds, PathTracerFloorMode, rectCorners, screenBoundsOfWorldPoints, traceAreaPercent, unionCrops,} from './floor-matte.js';
import {PathTracerFloorPreview} from './floor-preview.js';
import {coverageMarginPixels, expandCropForDenoiseEdge, measureTraceCoverage, TraceCoverageMeasure, TraceCrop,} from './trace-coverage.js';
import {PATH_TRACER_UNAVAILABLE_EVENT, WebGPUPathTracerSession} from './WebGPUPathTracerSession.js';

export const PATH_TRACER_READY_EVENT = 'path-tracer-ready';

const PATH_TRACER_DISPLAYS = [
  'progressive',
  'before-denoise',
  'after-denoise',
] as const;
// Camera damping is already instant (LD_SMOOTH_TIME is 0). This hold used
// to wait out a damped orbit after the pointer released, and it delayed
// every retrace by 300 ms after the camera had already stopped.
const PATH_TRACER_SETTLE_MS = 0;
// Realtime cameras draw layer 0. The floor stays visible so path-trace rays
// hit it, and is placed on this layer so the raster view does not draw it.
const PATH_TRACER_FLOOR_LAYER = 1;
const DEFAULT_PATH_TRACER_FLOOR_COLOR = '#ffffff';

export type PathTracerDisplay = typeof PATH_TRACER_DISPLAYS[number];

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

const parseCssRgb =
    (value: string): {r: number; g: number; b: number; a: number;}|null => {
      const hex = value.trim().match(/^#([0-9a-fA-F]{6})$/);
      if (hex != null) {
        const raw = hex[1];
        return {
          r: parseInt(raw.slice(0, 2), 16) / 255,
          g: parseInt(raw.slice(2, 4), 16) / 255,
          b: parseInt(raw.slice(4, 6), 16) / 255,
          a: 1,
        };
      }
      const match = CSS_RGB.exec(value.trim());
      if (match == null) {
        return null;
      }
      const alphaSource = match[4];
      const alpha = alphaSource == null ? 1 :
          alphaSource.trim().endsWith('%') ?
                                          Number.parseFloat(alphaSource) / 100 :
                                          Number.parseFloat(alphaSource);
      return {
        r: cssChannel(match[1]),
        g: cssChannel(match[2]),
        b: cssChannel(match[3]),
        a: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1,
      };
    };

const cssByte = (channel: number): string =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, '0');

const pageBackdropKey = (element: HTMLElement): string => {
  const view = element.ownerDocument.defaultView;
  if (view == null) {
    return '#ffffff';
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

export const normalizePathTracerDisplay = (value: string): PathTracerDisplay =>
    (PATH_TRACER_DISPLAYS as readonly string[]).includes(value) ?
    value as PathTracerDisplay :
    'after-denoise';

export const normalizePathTracerFloorColor = (value: string): string => {
  const trimmed = value.trim();
  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() :
                                         DEFAULT_PATH_TRACER_FLOOR_COLOR;
};

export interface PathTracerPresentedFrame {
  dataUrl: string;
  width: number;
  height: number;
  samples: number;
}

export interface PathTracerReadyDetail {
  samples: number;
  width: number;
  height: number;
}

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
  'pixelRatio',
  'tiles',
  'depthOfField',
  'focalLength',
  'fStop',
  'focusDistance',
  'apertureBlades',
  'apertureRotation',
  'anamorphicRatio',
  'coverage',
] as const;

export interface PathTracerOptions {
  samples: number;
  samplesThreshold: number;
  display: PathTracerDisplay;
  fadeSeconds: number;
  /**
   * Opacity of the trace while "While tracing" is still sampling or
   * denoising. The picture fades to 1 once that work finishes.
   */
  opacity: number;
  freezeRealtime: boolean;
  /**
   * Trace only the rectangle around the product silhouette, a margin, and
   * the floor. Off keeps the full frame.
   */
  coverage: boolean;
  /** Draw the crop rectangle. The crop still traces when this is off. */
  showRegion: boolean;
  bounces: number;
  renderScale: number;
  /**
   * 0 uses the screen pixel ratio. Larger values trace at least that many
   * pixels per CSS pixel, capped at 4 and at maxTextureSize.
   */
  pixelRatio: number;
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
  floor: PathTracerFloorMode;
  /** Scales the reflected subject. 0 hides the reflection. */
  floorReflection: number;
  softShadow: boolean;
  floorColor: string;
  floorRoughness: number;
  floorMetalness: number;
  floorOpacity: number;
  paused: boolean;
  frameBudget: number;
  multipleImportanceSampling: boolean;
  randomStrategy: 'blue-dither'|'sobol'|'pcg';
  ambientOcclusionPreviewOptions: AmbientOcclusionOptions|null;
}

export const DEFAULT_PATH_TRACER_OPTIONS: PathTracerOptions = {
  // Match the vendor demo sidebar: 16 samples, 15 bounces, show from the
  // first sample. The frame budget below is the value that demo settles on.
  samples: 16,
  samplesThreshold: 1,
  display: 'after-denoise',
  fadeSeconds: 0.3,
  opacity: 1,
  freezeRealtime: true,
  coverage: false,
  showRegion: false,
  bounces: 15,
  renderScale: 1,
  pixelRatio: 0,
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
  floor: 'none',
  floorReflection: DEFAULT_FLOOR_REFLECTION,
  softShadow: false,
  floorColor: DEFAULT_PATH_TRACER_FLOOR_COLOR,
  floorRoughness: 0.2,
  floorMetalness: 0,
  floorOpacity: 1,
  paused: false,
  // 0.0.27 cannot grow the dispatch on its own. This is the budget the
  // vendor demo settles on for a full-resolution frame.
  frameBudget: 4757192,
  multipleImportanceSampling: true,
  randomStrategy: 'sobol',
  ambientOcclusionPreviewOptions: null,
};

export class LDPathTracerComposer implements EffectComposerInterface {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  private readonly physicalCamera = new PhysicalCamera();
  private session: WebGPUPathTracerSession|null = null;
  private pathTracer: WebGPUPathTracerSession|null = null;
  private ambientOcclusionPreviewComposer: LDAmbientOcclusionComposer|null =
      null;
  private currentAmbientOcclusionPreviewOptions: AmbientOcclusionOptions|null =
      null;
  private queuedRender: number|null = null;
  private readonly lastCameraWorldMatrix = new Matrix4();
  private readonly lastCameraProjectionMatrix = new Matrix4();
  private readonly meshWorldMatrices = new Map<string, Matrix4>();
  private shadowCatcher: Mesh<PlaneGeometry, MeshStandardMaterial>|null = null;
  private readonly floorPreview = new PathTracerFloorPreview();
  private floorMode: PathTracerFloorMode = 'none';
  private shadowCatcherState = '';
  private shadowCatcherMaterialState = '';
  private cameraStateInitialized = false;
  private cameraSettled = true;
  private realtimeFrozen = false;
  private realtimePictureKey = '';
  private traceOpacity = 0;
  private lastFadeAt = 0;
  private readonly coverageCamera = new PerspectiveCamera();
  private readonly coverageMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
    side: DoubleSide,
    depthTest: true,
    depthWrite: true,
  });
  private coverageTarget: WebGLRenderTarget|null = null;
  private coveragePixels: Uint8Array|null = null;
  private coverageKey = '';
  private coverageCrop: TraceCrop|null = null;
  // The measured subject rect. coverageCrop may be larger so the denoiser
  // fringe falls outside this one.
  private coverageVisible: TraceCrop|null = null;
  private coverageMeasure: TraceCoverageMeasure|null = null;
  private readonly coverageClear = new Color();
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
  private lastBackdropKey = '';
  private lightVisibilityKey = '';
  private tracePresentTexture: CanvasTexture|null = null;
  private tracePresentQuad: FullScreenQuad|null = null;
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
  private lastEnvironmentIntensity = 1;
  private lastEnvironment: unknown = null;
  private lastBackground: unknown = null;
  private readonly drawingBufferSize = new Vector2();
  private readonly shadowViewport = new Vector4();
  private reportedTracedWidth = 0;
  private reportedTracedHeight = 0;
  private reportedSupersampled = false;
  private readonly pathTracerCache = new PathTracerCacheStore();
  private irradianceGrid = createIrradianceGrid();
  private irradianceMeta: IrradianceGridMeta = {
    slots: IRRADIANCE_SLOT_COUNT,
    origin: [0, 0, 0],
    cellSize: 1,
    minSamples: IRRADIANCE_MIN_SAMPLES,
  };
  private irradianceGeneration = 0;
  private irradianceFromFile = false;
  private materialWatch: MaterialWatchSample[]|null = null;
  private materialWatchReady = false;

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
    this.traceOpacity = 0;
    this.applyRenderScale();
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
    this.syncMaterialWatch();
    this.refreshFrozenRealtime();
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
    if (this.session?.state !== 'ready' || this.pathTracer == null ||
        this.renderer == null || this.scene == null ||
        this.sceneBuildInFlight) {
      this.renderRealtime();
      this.renderSoftShadowOverlay();
      return;
    }

    const interacting = this.activePointers.size > 0 || !this.cameraSettled ||
        performance.now() < this.holdTraceUntil || this.animationIsPlaying();
    if (interacting) {
      // Keep the last rectangle on screen. The next trace measures a new one
      // on its first frame.
      this.coverageKey = '';
      this.pathTracer.setShowRegion(this.options.showRegion);
      this.realtimeFrozen = false;
      this.scene.lockRenderScale = false;
      this.traceOpacity = 0;
      this.lastFadeAt = 0;
      if (this.pathTracer.samples > 0 || this.pathTracer.sampleMin > 0) {
        this.pathTracer.reset();
      }
      this.pathTracer.pause = true;
      this.pathTracer.setOpacity(0);
      this.renderRealtime();
      this.renderSoftShadowOverlay();
      if (this.shouldRenderAmbientOcclusionPreview()) {
        this.ambientOcclusionPreviewComposer?.render(_deltaTime);
      }
      this.queueNextProgressiveRender();
      return;
    }

    this.pathTracer.pause = this.options.paused;
    this.layoutTrace();
    if (!this.realtimeFrozen || !this.shouldFreezeRealtime()) {
      this.renderRealtime();
      this.renderSoftShadowOverlay();
      this.realtimeFrozen = this.shouldFreezeRealtime();
    }
    this.scene.lockRenderScale = this.realtimeFrozen;
    this.pathTracer.show(true);
    this.pathTracer.applyPresentation(
        this.scene.toneMapping, this.presentationExposure());
    this.pathTracer.renderSample();
    this.pathTracer.noteTraceProgress();
    this.presentTrace();
    if (this.shouldRenderAmbientOcclusionPreview()) {
      this.ambientOcclusionPreviewComposer?.render(_deltaTime);
    }
    if (!this.options.paused &&
        (!this.pathTracer.traceSettled || this.traceOpacity < 1)) {
      this.queueNextProgressiveRender();
    }
    this.maybeMarkReady();
    this.publishTracedSize();
  }

  private renderRealtime() {
    if (this.renderer == null || this.scene == null) {
      return;
    }
    this.prepareRendererOutput();
    this.renderer.autoClear = true;
    const camera = this.scene.getCamera();
    if (this.floorMode === 'shadow-reflection' &&
        this.floorPreview.mesh.parent != null) {
      const floorY = this.scene.boundingBox.min.y;
      this.floorPreview.renderReflection(
          this.renderer, this.scene, camera, floorY, this.floorMode);
    }
    this.renderer.render(this.scene, camera);
  }

  private layoutTrace() {
    if (this.pathTracer == null || this.renderer == null ||
        this.scene == null) {
      return;
    }
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    const resolved = resolvePathTracerRenderScale({
      renderScale: this.options.renderScale,
      pixelRatio: this.options.pixelRatio,
      devicePixelRatio: window.devicePixelRatio || 1,
      drawingBufferWidth: this.drawingBufferSize.x,
      drawingBufferHeight: this.drawingBufferSize.y,
      maxTextureSize: this.pathTracer.maxTextureSize,
    });
    const cssWidth = this.scene.element.clientWidth || this.scene.width;
    const cssHeight = this.scene.element.clientHeight || this.scene.height;
    this.pathTracer.setShowRegion(this.options.showRegion);
    this.syncTraceCoverage();
    const visible = this.coverageVisible;
    const buffer = this.drawingBufferSize;
    if (visible == null || buffer.x < 1 || buffer.y < 1) {
      this.coverageCrop = null;
      this.syncPathTracerCamera();
      this.pathTracer.layout(
          cssWidth, cssHeight, resolved.width, resolved.height, 0, 0, true);
      return;
    }
    const scaleX = resolved.width / buffer.x;
    const scaleY = resolved.height / buffer.y;
    const padded =
        expandCropForDenoiseEdge(visible, buffer.x, buffer.y, scaleX, scaleY);
    this.coverageCrop = padded.traced;
    this.syncPathTracerCamera();
    const traced = padded.traced;
    const cssScaleX = cssWidth / buffer.x;
    const cssScaleY = cssHeight / buffer.y;
    this.pathTracer.layout(
        traced.width * cssScaleX,
        traced.height * cssScaleY,
        Math.max(1, Math.round(traced.width * scaleX)),
        Math.max(1, Math.round(traced.height * scaleY)),
        traced.x * cssScaleX,
        traced.y * cssScaleY,
        true,
        {
          x: visible.x * cssScaleX,
          y: visible.y * cssScaleY,
          width: visible.width * cssScaleX,
          height: visible.height * cssScaleY,
        });
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

  get unavailableReason() {
    return this.session?.state === 'unavailable' ? this.session.reason : '';
  }

  get isReady() {
    return this.ready;
  }

  getTracedSize(): {width: number, height: number}|null {
    const target = this.pathTracer?.target;
    if (this.pathTracer == null || target == null ||
        this.pathTracer.samples <= 0 || target.width < 1 || target.height < 1) {
      return null;
    }

    return {width: target.width, height: target.height};
  }

  /**
   * Read the presented WebGPU image at the tracer buffer's own size.
   * OIDN replaces the raw accumulation once every pixel has reached
   * path-tracer-samples, when denoise is on. The bitmap is not resized.
   */
  capturePresentedFrame(options: {fileType?: string,
                                  encoderOptions?: number} = {}):
      PathTracerPresentedFrame {
    if (this.pathTracer == null || this.pathTracer.state !== 'ready') {
      throw new Error('Path tracer is not active');
    }
    if (this.pathTracer.samples <= 0) {
      throw new Error('Path tracer has no samples to capture');
    }
    const traced = this.getTracedSize();
    if (traced == null) {
      throw new Error('Path tracer has not presented a frame');
    }
    const fileType = options.fileType ?? 'image/png';
    return {
      dataUrl: this.pathTracer.captureDataURL(fileType, options.encoderOptions),
      width: traced.width,
      height: traced.height,
      samples: this.pathTracer.samples,
    };
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
    this.session?.setBuildOptions(next);
    this.clearGeometryBounds();
    if (this.pathTracer != null) {
      this.markSceneDirty();
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
    this.bindInteraction(null);
    this.disableBvhWorker();
    this.disposePathTracer();
    this.tracePresentQuad?.dispose();
    this.tracePresentQuad = null;
    this.tracePresentTexture?.dispose();
    this.tracePresentTexture = null;
    this.coverageTarget?.dispose();
    this.coverageTarget = null;
    this.coverageMaterial.dispose();
    this.ambientOcclusionPreviewComposer?.dispose();
    this.ambientOcclusionPreviewComposer = null;
    this.currentAmbientOcclusionPreviewOptions = null;
    this.reportedTracedWidth = 0;
    this.reportedTracedHeight = 0;
    this.reportedSupersampled = false;
    this.disposeShadowCatcher();
    this.floorPreview.dispose();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.meshWorldMatrices.clear();
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
    if (this.renderer == null || this.scene == null) {
      return;
    }

    this.disposePathTracer();
    this.invalidateReady();
    this.environmentStateReady = false;
    const session = new WebGPUPathTracerSession(this.scene.element);
    session.setBuildOptions(this.buildOptions);
    this.session = session;
    void session.start().then(() => {
      if (this.disposed || this.session !== session) {
        session.dispose();
        return;
      }
      if (session.state === 'unavailable') {
        this.scene?.element.dispatchEvent(
            new CustomEvent(PATH_TRACER_UNAVAILABLE_EVENT, {
              detail: {reason: session.reason},
            }));
        this.requestRender();
        return;
      }
      this.pathTracer = session;
      this.applyOptions(false);
      this.needsSceneUpdate = true;
      this.sceneBuildGeneration++;
      this.syncScene();
      this.requestRender();
    });
  }

  private disposePathTracer() {
    this.session?.dispose();
    this.session = null;
    this.pathTracer = null;
  }

  private prepareRendererOutput() {
    if (this.renderer == null || this.scene == null) {
      return;
    }

    this.renderer.toneMapping = this.scene.toneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMappingExposure = this.presentationExposure();
  }

  private presentationExposure(): number {
    if (this.scene == null) {
      return 1;
    }
    const {element, exposure} = this.scene;
    const exposureIsNumber =
        typeof exposure === 'number' && !Number.isNaN(exposure);
    const env = element.environmentImage;
    const sky = element.skyboxImage;
    const compensateExposure = this.scene.toneMapping === NeutralToneMapping &&
        (env === 'neutral' || env === 'legacy' || (!env && !sky));
    return (exposureIsNumber ? exposure : 1) * (compensateExposure ? 1.3 : 1);
  }

  private applyRenderScale() {
    // layoutTrace places either the full frame or the subject crop. Laying the
    // full frame out here would resize the tracer and drop the crop.
    this.layoutTrace();
  }

  private publishTracedSize() {
    const traced = this.getTracedSize();
    if (traced == null || this.scene == null || this.renderer == null ||
        (traced.width === this.reportedTracedWidth &&
         traced.height === this.reportedTracedHeight)) {
      return;
    }

    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    this.reportedTracedWidth = traced.width;
    this.reportedTracedHeight = traced.height;
    const supersampled = traced.width !== this.drawingBufferSize.x ||
        traced.height !== this.drawingBufferSize.y;
    // A screen-sized trace is already covered by the canvas render-scale
    // event. Send a follow-up only while the tracer target differs, and
    // once more when it returns to the drawing buffer.
    if (!supersampled && !this.reportedSupersampled) {
      return;
    }
    this.reportedSupersampled = supersampled;

    const devicePixelRatio = window.devicePixelRatio || 1;
    this.scene.element.dispatchEvent(new CustomEvent('render-scale', {
      detail: {
        reportedDpr: devicePixelRatio,
        renderedDpr: devicePixelRatio,
        minimumDpr: devicePixelRatio,
        pixelWidth: this.drawingBufferSize.x,
        pixelHeight: this.drawingBufferSize.y,
        tracedWidth: traced.width,
        tracedHeight: traced.height,
        reason: supersampled ? 'path-tracer-pixel-ratio' : '',
      },
    }));
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

    const environmentChanged = this.environmentStateReady;
    this.lastEnvironmentIntensity = intensity;
    this.lastEnvironment = environment;
    this.lastBackground = background;
    this.lastBackdropKey = backdropKey;
    this.environmentStateReady = true;
    // No skybox: the page is the background. Leave the scene background empty
    // and clear the trace with alpha 0 so tone mapping cannot recolour it.
    // A real skybox or scene background is traced as usual.
    this.pathTracer.setBackgroundClearAlpha(backdropKey !== '' ? 0 : 1);
    this.pathTracer.updateEnvironment();
    if (environmentChanged) {
      this.invalidatePathTracerCache('environment');
    }
  }

  private clearGeometryBounds() {
    this.scene?.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.geometry != null) {
        mesh.geometry.boundsTree = undefined;
      }
    });
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
    const traced = this.getTracedSize();
    const detail: PathTracerReadyDetail = {
      samples: this.pathTracer.samples,
      width: traced?.width ?? this.pathTracer.target?.width ?? 0,
      height: traced?.height ?? this.pathTracer.target?.height ?? 0,
    };
    this.scene.element.dispatchEvent(new CustomEvent(PATH_TRACER_READY_EVENT, {
      detail,
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
    this.pathTracer.maxSamples = Math.max(1, Math.floor(this.options.samples));
    this.pathTracer.minSamples = 1;
    this.pathTracer.fadeDuration = 1;
    this.applyRenderScale();
    this.pathTracer.setShowRegion(this.options.showRegion);
    this.pathTracer.tiles.copy(this.options.tiles);
    this.pathTracer.setDenoise(
        this.options.denoise && this.options.display !== 'before-denoise');
    this.pathTracer.pause = this.options.paused;
    this.pathTracer.frameBudget = this.options.frameBudget;
    this.pathTracer.multipleImportanceSampling =
        this.options.multipleImportanceSampling;
    this.pathTracer.randomName = this.options.randomStrategy;
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
      this.captureBuiltCaches();
      this.requestRender();
    };

    this.pushBvhCache(pathTracer);
    this.pushIrradiance();
    const worker = this.ensureBvhWorker();
    // WebGPU records every mesh, then skips any object whose visible flag is
    // off. Shader materials have no color and crash the material buffer, so
    // they are detached until setScene has finished. setSceneAsync captures
    // the scene after it awaits.
    const restoreShadowReceivers = this.hideShadowReceivers();
    const detached = this.detachUntraceable();
    const restoreScene = () => {
      this.restoreDetached(detached);
      restoreShadowReceivers();
    };
    if (worker != null) {
      pathTracer.setBVHWorker(worker);
      pathTracer.setSceneAsync(scene, pathTracerCamera)
          .then(() => {
            restoreScene();
            settle();
          })
          .catch((error: unknown) => {
            restoreScene();
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

    try {
      pathTracer.setScene(scene, pathTracerCamera);
    } finally {
      restoreScene();
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
    const reflection = clampUnitInterval(
        this.options.floorReflection,
        DEFAULT_PATH_TRACER_OPTIONS.floorReflection);
    const mode = effectiveFloorMode(this.options.floor, this.scene.shadowMode);
    this.floorMode = opacity > 0 ? mode : 'none';
    if (this.floorMode === 'none') {
      this.removeShadowCatcher();
      return;
    }

    const shadowCatcher = this.ensureShadowCatcher();
    const {boundingBox} = this.scene;
    const subject = footprintFromBounds(
        boundingBox.min.x,
        boundingBox.min.y,
        boundingBox.min.z,
        boundingBox.max.x,
        boundingBox.max.y,
        boundingBox.max.z);
    const towardLight = this.dominantLightDirection();
    const footprint = applyShadowStretch(subject, towardLight);
    const support = effectSupport(footprint);
    const gap = 0.001 * Math.max(subject.halfX, subject.halfZ, 0.05);
    const geometryState = [
      this.floorMode,
      support.halfX.toFixed(4),
      support.halfZ.toFixed(4),
      support.centerX.toFixed(4),
      support.centerZ.toFixed(4),
      subject.floorY.toFixed(4),
      footprint.radius.toFixed(4),
    ].join('|');
    const materialState = [
      color,
      roughness.toFixed(4),
      metalness.toFixed(4),
      opacity.toFixed(4),
      reflection.toFixed(4),
      this.floorMode,
    ].join('|');
    this.floorPreview.sync(
        footprint, this.floorMode, reflection * opacity);
    this.pushCatcherUniforms(footprint, roughness, reflection * opacity);
    if (geometryState === this.shadowCatcherState &&
        materialState === this.shadowCatcherMaterialState) {
      return;
    }

    if (materialState !== this.shadowCatcherMaterialState) {
      // The catcher is a holdout. Opacity stays 1 so rays do not skip it;
      // floorOpacity scales the shadow and the reflection instead.
      shadowCatcher.material.color.set(color);
      shadowCatcher.material.roughness = roughness;
      shadowCatcher.material.metalness = metalness;
      shadowCatcher.material.opacity = 1;
      shadowCatcher.material.transparent = false;
      shadowCatcher.material.needsUpdate = true;
      this.shadowCatcherMaterialState = materialState;
    }

    if (geometryState !== this.shadowCatcherState) {
      const y = subject.floorY - gap;
      shadowCatcher.position.set(support.centerX, y, support.centerZ);
      shadowCatcher.rotation.set(-Math.PI / 2, 0, 0);
      shadowCatcher.scale.set(support.halfX * 2, support.halfZ * 2, 1);
      const preview = this.floorPreview.mesh;
      preview.position.copy(shadowCatcher.position);
      preview.rotation.copy(shadowCatcher.rotation);
      preview.scale.copy(shadowCatcher.scale);
      if (shadowCatcher.parent !== this.scene.target) {
        this.scene.target.add(shadowCatcher);
      }
      if (preview.parent !== this.scene.target) {
        this.scene.target.add(preview);
      }
      this.shadowCatcherState = geometryState;
      this.markSceneDirty();
    }

    this.updateTracedMaterials();
    if (materialState !== '' && geometryState === this.shadowCatcherState) {
      this.pathTracer?.reset();
      this.requestRender();
    }
  }

  private dominantLightDirection(): [number, number, number] {
    const scene = this.scene;
    const direction = new Vector3(0, 1, 0);
    if (scene == null) {
      return [0, 1, 0];
    }
    let best = 0;
    scene.traverse((object) => {
      const light = object as DirectionalLight;
      if (!light.isDirectionalLight || !light.visible) {
        return;
      }
      const intensity = light.intensity ?? 0;
      if (intensity < best) {
        return;
      }
      best = intensity;
      light.getWorldDirection(direction);
      direction.negate();
    });
    if (direction.lengthSq() < 1e-8) {
      return [0, 1, 0];
    }
    direction.normalize();
    return [direction.x, direction.y, direction.z];
  }

  private pushCatcherUniforms(
      footprint: ReturnType<typeof applyShadowStretch>,
      roughness: number,
      reflection: number,
      ) {
    this.session?.setFloorCatcher({
      samples: FLOOR_OCCLUSION_SAMPLES,
      mode: this.floorMode === 'shadow-reflection' ? 2 : 1,
      strength: reflection,
      roughness,
      centerX: footprint.centerX,
      centerZ: footprint.centerZ,
      halfX: footprint.halfX,
      halfZ: footprint.halfZ,
      radius: footprint.radius,
    });
  }

  private renderSoftShadowOverlay() {
    this.paintSoftShadow();
  }

  /**
   * The shadow map is view-independent, but the pass that fills it can run
   * before the model is in place and then never again. Draw it immediately
   * before the floor so the realtime picture and the trace stamp both get it.
   * The map pass changes the viewport, so put the scene viewport back first.
   */
  private paintSoftShadow() {
    const renderer = this.renderer;
    const scene = this.scene;
    const shadow = scene?.shadow;
    if (renderer == null || scene == null || shadow == null ||
        scene.shadowMode !== 'soft-shadow') {
      return;
    }
    renderer.getViewport(this.shadowViewport);
    shadow.needsUpdate = true;
    scene.renderShadow(renderer);
    renderer.setViewport(
        this.shadowViewport.x,
        this.shadowViewport.y,
        this.shadowViewport.z,
        this.shadowViewport.w);
    shadow.renderFloor(renderer, scene, scene.getCamera());
  }

  getDenoiseStatus(): string {
    return this.pathTracer?.denoiseStatus ?? '';
  }

  getTraceCoverage(): TraceCoverageMeasure|null {
    return this.coverageMeasure;
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
    // Camera hits become a shadow over the page instead of a shaded card.
    (material as MeshStandardMaterial&{matte?: boolean}).matte = true;

    this.shadowCatcher = new Mesh(new PlaneGeometry(1, 1), material);
    this.shadowCatcher.name = 'PathTracerShadowCatcher';
    // The hit test ignores visible=false. Keep the mesh visible and off the
    // realtime camera's layer so only the trace draws it.
    this.shadowCatcher.visible = true;
    this.shadowCatcher.layers.set(PATH_TRACER_FLOOR_LAYER);
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
    if (this.floorPreview.mesh.parent != null) {
      this.floorPreview.mesh.removeFromParent();
    }
    this.floorMode = 'none';
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
    if (!(this.camera instanceof PerspectiveCamera)) {
      return this.camera!;
    }
    if (!this.options.depthOfField) {
      return this.coverageCrop == null ?
          this.camera :
          this.prepareCoverageCamera(this.camera);
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
    this.applyCoverageOffset(this.physicalCamera);

    return this.physicalCamera;
  }

  private prepareCoverageCamera(source: PerspectiveCamera): PerspectiveCamera {
    const camera = this.coverageCamera;
    camera.fov = source.fov;
    camera.aspect = source.aspect;
    camera.near = source.near;
    camera.far = source.far;
    camera.zoom = source.zoom;
    camera.filmGauge = source.filmGauge;
    camera.filmOffset = source.filmOffset;
    camera.matrixAutoUpdate = false;
    camera.matrixWorldAutoUpdate = false;
    camera.matrix.copy(source.matrix);
    camera.matrixWorld.copy(source.matrixWorld);
    camera.matrixWorldNeedsUpdate = false;
    this.applyCoverageOffset(camera);
    return camera;
  }

  private applyCoverageOffset(camera: PerspectiveCamera) {
    const crop = this.coverageCrop;
    camera.coordinateSystem = WebGPUCoordinateSystem;
    if (crop == null || crop.width < 1 || crop.height < 1) {
      camera.clearViewOffset();
      return;
    }
    camera.setViewOffset(
        this.drawingBufferSize.x,
        this.drawingBufferSize.y,
        crop.x,
        crop.y,
        crop.width,
        crop.height);
  }

  private syncPathTracerCamera() {
    if (this.pathTracer == null || this.camera == null) {
      return;
    }
    const pathTracerCamera = this.getPathTracerCamera();
    pathTracerCamera.updateMatrixWorld();
    if (this.cameraStateInitialized &&
        this.lastCameraWorldMatrix.equals(pathTracerCamera.matrixWorld) &&
        this.lastCameraProjectionMatrix.equals(
            pathTracerCamera.projectionMatrix)) {
      return;
    }
    this.pathTracer.setCamera(pathTracerCamera);
    this.rememberCameraState(pathTracerCamera);
  }

  private syncTraceCoverage() {
    if (!this.options.coverage || this.renderer == null || this.scene == null ||
        this.camera == null || this.drawingBufferSize.x < 1 ||
        this.drawingBufferSize.y < 1) {
      this.coverageCrop = null;
      this.coverageVisible = null;
      this.coverageMeasure = null;
      this.coverageKey = '';
      return;
    }

    this.camera.updateMatrixWorld();
    this.shadowCatcher?.updateMatrixWorld();
    const buffer = this.drawingBufferSize;
    const key = [
      buffer.x,
      buffer.y,
      this.floorMode,
      this.camera.matrixWorld.elements.join(','),
      this.camera.projectionMatrix.elements.join(','),
      this.shadowCatcher?.matrixWorld.elements.join(',') ?? '',
      this.scene.target.matrixWorld.elements
          .map((value) => Math.round(value * 1e3))
          .join(','),
      this.subjectCoverageSignature(),
    ].join('|');
    if (key === this.coverageKey) {
      return;
    }
    this.coverageKey = key;

    const rgba = this.renderCoverageMask(buffer.x, buffer.y);
    const target = this.coverageTarget;
    if (rgba == null || target == null) {
      this.coverageCrop = null;
      this.coverageVisible = null;
      this.coverageMeasure = null;
      return;
    }
    const measured = measureTraceCoverage(
        rgba,
        target.width,
        target.height,
        buffer.x,
        buffer.y,
        coverageMarginPixels(buffer.x, buffer.y));
    // The raster mask can lock a strip of the subject: a restored BVH and a
    // freshly built one do not hit the same pixels. Project the traceable
    // bounds instead, so a cached load and an uncached load share one crop.
    const projected = this.projectSubjectCrop(buffer.x, buffer.y);
    const floorEffect = this.floorMode === 'none' ?
        null :
        this.projectFloorEffect(buffer.x, buffer.y);
    const withFloor = projected != null && floorEffect != null ?
        unionCrops(projected, floorEffect, buffer.x, buffer.y) :
        projected;
    measured.crop = withFloor;
    measured.tracedPixels = withFloor == null ?
        measured.fullPixels :
        withFloor.width * withFloor.height;
    measured.areaPercent =
        traceAreaPercent(measured.tracedPixels, measured.fullPixels);
    const cropLabel = measured.crop == null ?
        `100% (full ${buffer.x}x${buffer.y})` :
        `${measured.areaPercent.toFixed(1)}% (${measured.crop.width}x${
            measured.crop.height} of ${buffer.x}x${buffer.y})`;
    console.info(
        `[model-viewer] path tracer crop ${cropLabel} floor=${this.floorMode}`);
    this.coverageMeasure = measured;
    this.coverageVisible = measured.crop;
    this.coverageCrop = measured.crop;
    // An empty read is usually the model not being ready yet. A read during
    // the BVH build sees whichever meshes are still attached, and locking
    // that crop makes a cached load (which finishes the build first) trace
    // a different rectangle from an uncached load. Both cases remeasure.
    if (measured.maskPixels === 0 || this.sceneBuildInFlight) {
      this.coverageKey = '';
    }
  }

  /**
   * Meshes the subject crop is allowed to see. Shader materials, the
   * environment model, and the soft-shadow planes paint solid white under
   * the override material and stretch the crop. They stay out of the mask
   * and out of this signature, so a cached load and an uncached load measure
   * the same pixels once the traceable meshes are in the scene.
   */
  private projectSubjectCrop(fullWidth: number, fullHeight: number): TraceCrop|
      null {
    const camera = this.camera;
    const scene = this.scene;
    if (!(camera instanceof PerspectiveCamera) || scene == null ||
        fullWidth < 1 || fullHeight < 1) {
      return null;
    }
    camera.updateMatrixWorld();
    scene.updateMatrixWorld(true);
    const corner = new Vector3();
    let minX = fullWidth;
    let minY = fullHeight;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !object.visible || mesh.geometry == null ||
          this.isExcludedFromSubjectCoverage(object)) {
        return;
      }
      const position = mesh.geometry.getAttribute('position');
      if (position == null || position.count < 1) {
        return;
      }
      let lx0 = Infinity;
      let ly0 = Infinity;
      let lz0 = Infinity;
      let lx1 = -Infinity;
      let ly1 = -Infinity;
      let lz1 = -Infinity;
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        if (x < lx0) lx0 = x;
        if (y < ly0) ly0 = y;
        if (z < lz0) lz0 = z;
        if (x > lx1) lx1 = x;
        if (y > ly1) ly1 = y;
        if (z > lz1) lz1 = z;
      }
      const xs = [lx0, lx1];
      const ys = [ly0, ly1];
      const zs = [lz0, lz1];
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) {
            corner.set(x, y, z).applyMatrix4(mesh.matrixWorld).project(camera);
            if (corner.z < -1 || corner.z > 1) {
              continue;
            }
            const px = (corner.x * 0.5 + 0.5) * fullWidth;
            const py = (1 - (corner.y * 0.5 + 0.5)) * fullHeight;
            minX = Math.min(minX, px);
            minY = Math.min(minY, py);
            maxX = Math.max(maxX, px);
            maxY = Math.max(maxY, py);
            count++;
          }
        }
      }
    });
    if (count === 0 || maxX <= minX || maxY <= minY) {
      return null;
    }
    const margin = coverageMarginPixels(fullWidth, fullHeight);
    const left = Math.max(0, Math.floor(minX - margin));
    const top = Math.max(0, Math.floor(minY - margin));
    const right = Math.min(fullWidth, Math.ceil(maxX + margin));
    const bottom = Math.min(fullHeight, Math.ceil(maxY + margin));
    const crop = {x: left, y: top, width: right - left, height: bottom - top};
    if (crop.width < 1 || crop.height < 1 ||
        crop.width * crop.height >= fullWidth * fullHeight * 0.92) {
      return null;
    }
    return crop;
  }

  private projectFloorEffect(fullWidth: number, fullHeight: number): TraceCrop|
      null {
    const camera = this.camera;
    const scene = this.scene;
    if (!(camera instanceof PerspectiveCamera) || scene == null ||
        this.floorMode === 'none') {
      return null;
    }
    const box = scene.boundingBox;
    if (box.isEmpty()) {
      return null;
    }
    const subject = footprintFromBounds(
        box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
    const footprint =
        applyShadowStretch(subject, this.dominantLightDirection());
    return screenBoundsOfWorldPoints(
        rectCorners(effectSupport(footprint)), camera, fullWidth, fullHeight);
  }

  private isExcludedFromSubjectCoverage(object: Object3D): boolean {
    if (object.userData?.pathTracerShadowCatcher === true ||
        object.userData?.pathTracerFloorPreview === true) {
      return true;
    }
    if (this.isShadowReceiver(object)) {
      return true;
    }
    if (this.shouldDetachFromTrace(object)) {
      return true;
    }
    const environment = this.scene?.environmentRoot;
    if (environment != null &&
        (object === environment || this.containsObject(environment, object))) {
      return true;
    }
    return false;
  }

  private subjectCoverageSignature(): string {
    const scene = this.scene;
    if (scene == null) {
      return '';
    }
    const ids: string[] = [];
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !object.visible ||
          this.isExcludedFromSubjectCoverage(object)) {
        return;
      }
      ids.push(mesh.uuid);
    });
    ids.sort();
    return ids.join(',');
  }

  private disableCoverageFrustumCulling(): () => void {
    const changed: Array<{mesh: Mesh; frustumCulled: boolean}> = [];
    this.scene?.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || mesh.frustumCulled === false) {
        return;
      }
      changed.push({mesh, frustumCulled: mesh.frustumCulled});
      mesh.frustumCulled = false;
    });
    return () => {
      for (const entry of changed) {
        entry.mesh.frustumCulled = entry.frustumCulled;
      }
    };
  }

  private hideExcludedCoverage(): () => void {
    const hidden: Object3D[] = [];
    this.scene?.traverse((object) => {
      if (!object.visible || !this.isExcludedFromSubjectCoverage(object)) {
        return;
      }
      object.visible = false;
      hidden.push(object);
    });
    return () => {
      for (const object of hidden) {
        object.visible = true;
      }
    };
  }

  private renderCoverageMask(fullWidth: number, fullHeight: number): Uint8Array
      |null {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.camera;
    if (renderer == null || scene == null || camera == null) {
      return null;
    }

    const longest = Math.max(fullWidth, fullHeight);
    const scale = longest > 480 ? 480 / longest : 1;
    const maskWidth = Math.max(1, Math.round(fullWidth * scale));
    const maskHeight = Math.max(1, Math.round(fullHeight * scale));
    if (this.coverageTarget == null) {
      this.coverageTarget = new WebGLRenderTarget(maskWidth, maskHeight);
    } else if (
        this.coverageTarget.width !== maskWidth ||
        this.coverageTarget.height !== maskHeight) {
      this.coverageTarget.setSize(maskWidth, maskHeight);
    }
    const pixelCount = maskWidth * maskHeight * 4;
    if (this.coveragePixels == null ||
        this.coveragePixels.length !== pixelCount) {
      this.coveragePixels = new Uint8Array(pixelCount);
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousAlpha = renderer.getClearAlpha();
    const previousBackground = scene.background;
    const previousOverride = scene.overrideMaterial;
    const layerMask = camera.layers.mask;
    renderer.getClearColor(this.coverageClear);
    renderer.getViewport(this.shadowViewport);

    renderer.setRenderTarget(this.coverageTarget);
    // The path tracer presents into the previous crop. Leaving that viewport
    // in place clips the next mask to the strip, and the crop then locks there.
    renderer.setViewport(0, 0, maskWidth, maskHeight);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);
    renderer.autoClear = true;
    scene.background = null;
    scene.overrideMaterial = this.coverageMaterial;
    // The soft-shadow plane is not part of the trace. Painted solid, it
    // stretches the crop from the product down to the near edge of the shadow.
    const restoreShadowReceivers = this.hideShadowReceivers();
    const restoreExcluded = this.hideExcludedCoverage();
    const restoreCulling = this.disableCoverageFrustumCulling();
    try {
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(
          this.coverageTarget,
          0,
          0,
          maskWidth,
          maskHeight,
          this.coveragePixels);
    } finally {
      restoreCulling();
      restoreExcluded();
      restoreShadowReceivers();
      camera.layers.mask = layerMask;
      scene.overrideMaterial = previousOverride;
      scene.background = previousBackground;
      renderer.setClearColor(this.coverageClear, previousAlpha);
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(
          this.shadowViewport.x,
          this.shadowViewport.y,
          this.shadowViewport.z,
          this.shadowViewport.w);
    }
    return this.coveragePixels;
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

  private presentTrace() {
    const pathTracer = this.pathTracer;
    const renderer = this.renderer;
    if (pathTracer == null || renderer == null) {
      return;
    }
    if (this.isTraceRevealed()) {
      this.advanceTraceFade();
    } else {
      this.traceOpacity = 0;
    }
    const stamp = this.options.softShadow &&
        this.scene?.shadowMode === 'soft-shadow' && this.traceOpacity >= 1;
    if (stamp) {
      pathTracer.setOpacity(0);
      this.drawTraceIntoCanvas();
      renderer.resetState();
      this.paintSoftShadow();
      return;
    }
    pathTracer.setOpacity(this.traceOpacity);
  }

  private isTraceRevealed(): boolean {
    const pathTracer = this.pathTracer;
    if (pathTracer == null) {
      return false;
    }
    const cap = Math.max(1, this.options.samples);
    const threshold = Math.max(1, Math.floor(this.options.samplesThreshold));
    if (this.options.display === 'progressive') {
      return pathTracer.sampleMin >= threshold ||
          pathTracer.samples >= threshold;
    }
    if (this.options.display === 'before-denoise') {
      return pathTracer.sampleMin >= cap;
    }
    if (this.options.denoise) {
      return pathTracer.traceSettled || pathTracer.denoiseFailed;
    }
    return pathTracer.sampleMin >= cap;
  }

  private traceOpacityTarget(): number {
    const working = Math.min(1, Math.max(0, this.options.opacity));
    if (this.options.display === 'progressive' && this.pathTracer != null &&
        !this.pathTracer.traceSettled) {
      return working;
    }
    return 1;
  }

  private advanceTraceFade() {
    const duration = Math.max(0, this.options.fadeSeconds) * 1000;
    const target = this.traceOpacityTarget();
    if (duration === 0) {
      this.traceOpacity = target;
      return;
    }
    const now = performance.now();
    const delta =
        this.lastFadeAt === 0 ? 0 : Math.min(100, now - this.lastFadeAt);
    this.lastFadeAt = now;
    if (this.traceOpacity < target) {
      this.traceOpacity =
          Math.min(target, this.traceOpacity + delta / duration);
    } else if (this.traceOpacity > target) {
      this.traceOpacity =
          Math.max(target, this.traceOpacity - delta / duration);
    }
  }

  // The traced canvas includes a denoise margin. Sample only the visible crop.
  private cropPresentTexture() {
    const texture = this.tracePresentTexture;
    if (texture == null) {
      return;
    }
    const traced = this.coverageCrop;
    const visible = this.coverageVisible;
    if (traced == null || visible == null || traced.width < 1 ||
        traced.height < 1) {
      texture.offset.set(0, 0);
      texture.repeat.set(1, 1);
      return;
    }
    const left = (visible.x - traced.x) / traced.width;
    const bottom = ((traced.y + traced.height) - (visible.y + visible.height)) /
        traced.height;
    texture.offset.set(left, bottom);
    texture.repeat.set(
        visible.width / traced.width, visible.height / traced.height);
  }

  private drawTraceIntoCanvas() {
    const pathTracer = this.pathTracer;
    const renderer = this.renderer;
    if (pathTracer == null || renderer == null) {
      return;
    }
    if (this.tracePresentTexture == null ||
        this.tracePresentTexture.image !== pathTracer.canvas) {
      this.tracePresentQuad?.dispose();
      this.tracePresentTexture?.dispose();
      this.tracePresentTexture = new CanvasTexture(pathTracer.canvas);
      this.tracePresentTexture.colorSpace = SRGBColorSpace;
      const material = new MeshBasicMaterial({
        map: this.tracePresentTexture,
        depthTest: false,
        depthWrite: false,
      });
      this.tracePresentQuad = new FullScreenQuad(material);
    }
    this.tracePresentTexture.needsUpdate = true;
    this.cropPresentTexture();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const crop = this.coverageVisible ?? this.coverageCrop;
    renderer.getViewport(this.shadowViewport);
    if (crop != null) {
      const glY = this.drawingBufferSize.y - crop.y - crop.height;
      renderer.setViewport(crop.x, glY, crop.width, crop.height);
    }
    this.tracePresentQuad?.render(renderer);
    renderer.setViewport(
        this.shadowViewport.x,
        this.shadowViewport.y,
        this.shadowViewport.z,
        this.shadowViewport.w);
    renderer.autoClear = autoClear;
  }

  private shouldFreezeRealtime(): boolean {
    return this.options.freezeRealtime && !this.animationIsPlaying();
  }

  // The frozen realtime frame stays while the camera is still. A sidebar
  // change that alters that picture drops it so the next frame draws once
  // and freezes the new one.
  private refreshFrozenRealtime() {
    const scene = this.scene;
    if (scene == null) {
      return;
    }
    const environment = this.lastEnvironment as {uuid?: string} | null;
    const background = this.lastBackground as {uuid?: string} | null;
    const key = [
      scene.exposure,
      scene.toneMapping,
      scene.shadowMode,
      scene.shadowIntensity,
      scene.shadowSoftness,
      this.lastEnvironmentIntensity,
      environment?.uuid ?? '',
      background?.uuid ??
          (this.lastBackground == null ? '' : String(this.lastBackground)),
      this.lightVisibilityKey,
    ].join('|');
    if (this.realtimePictureKey !== '' && key !== this.realtimePictureKey) {
      this.realtimeFrozen = false;
    }
    this.realtimePictureKey = key;
  }

  private animationIsPlaying(): boolean {
    const element = this.scene?.element as {paused?: boolean} | undefined;
    return element != null && element.paused === false;
  }

  private backdropKey(): string {
    if (this.scene == null || this.scene.background != null ||
        this.scene.element.skyboxImage) {
      return '';
    }
    return pageBackdropKey(this.scene.element);
  }

  private syncLights() {
    if (this.pathTracer == null || this.scene == null ||
        this.sceneBuildInFlight) {
      return;
    }
    const parts: string[] = [];
    this.scene.traverse((object) => {
      const light = object as {
        isLight?: boolean;
        uuid: string;
        visible: boolean;
        intensity?: number;
        material?: {emissiveIntensity?: number; uuid: string;}|
            Array<{emissiveIntensity?: number; uuid: string;}>;
      };
      if (light.isLight === true) {
        parts.push(
            `${light.uuid}:${light.visible ? 1 : 0}:${light.intensity ?? 0}`);
      }
      const materials = light.material == null ? [] :
          Array.isArray(light.material)        ? light.material :
                                                 [light.material];
      for (const material of materials) {
        if (material.emissiveIntensity == null) {
          continue;
        }
        parts.push(`${material.uuid}:${material.emissiveIntensity}`);
      }
    });
    const key = parts.join('|');
    if (key === this.lightVisibilityKey) {
      return;
    }
    const lightsChanged = this.lightVisibilityKey !== '';
    this.lightVisibilityKey = key;
    this.pathTracer.updateLights();
    this.updateTracedMaterials();
    if (lightsChanged) {
      this.invalidatePathTracerCache('environment');
    }
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

  /**
   * Shader materials have no colour. They are detached while the scene is
   * built, then restored, and a later material edit walks the live scene.
   * Packing one of them reads `color.r` and throws before the retrace starts.
   */
  private updateTracedMaterials() {
    const detached = this.detachUntraceable();
    try {
      this.pathTracer?.updateMaterials();
    } finally {
      this.restoreDetached(detached);
    }
  }

  private detachUntraceable():
      Array<{parent: Object3D; object: Object3D; index: number}> {
    const scene = this.scene;
    if (scene == null) {
      return [];
    }
    const victims: Object3D[] = [];
    scene.traverse((object) => {
      if (victims.some(
              (victim) => victim === object.parent ||
                  this.containsObject(victim, object))) {
        return;
      }
      if (this.shouldDetachFromTrace(object)) {
        victims.push(object);
      }
    });
    const detached: Array<{parent: Object3D; object: Object3D; index: number}> =
        [];
    for (const object of victims) {
      const parent = object.parent;
      if (parent == null) {
        continue;
      }
      const index = parent.children.indexOf(object);
      parent.remove(object);
      detached.push({parent, object, index});
    }
    return detached;
  }

  private containsObject(root: Object3D, object: Object3D): boolean {
    let parent = object.parent;
    while (parent != null) {
      if (parent === root) {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  private shouldDetachFromTrace(object: Object3D): boolean {
    if (this.isShadowReceiver(object)) {
      return true;
    }
    const material = (object as Mesh).material as {color?: unknown} |
        Array<{color?: unknown}>| undefined;
    if (material == null) {
      return false;
    }
    const list = Array.isArray(material) ? material : [material];
    return list.some((entry) => entry != null && entry.color == null);
  }

  setPathTracerCacheFlags(flags: Partial<PathTracerCacheFlags>&{
    enabled?: Partial<PathTracerCacheFlags['enabled']>;
    load?: Partial<PathTracerCacheFlags['load']>;
  }) {
    const irradianceWas = this.pathTracerCache.flags.enabled.irradiance;
    this.pathTracerCache.setFlags(flags);
    if (this.session != null) {
      this.pushBvhCache(this.session);
    }
    if (!irradianceWas && this.pathTracerCache.flags.enabled.irradiance) {
      this.irradianceFromFile = this.pathTracerCache.has('irradiance');
    }
    this.pushIrradiance();
  }

  getPathTracerCacheStatus(): {
    flags: PathTracerCacheFlags,
    sizes: Record<PathTracerCacheType, number>,
    timings: PathTracerCacheTimings,
    lastLoad: PathTracerCacheLoadResult|null,
    fingerprint: PathTracerCacheFingerprint,
  } {
    const session = this.session;
    return {
      flags: {
        enabled: {...this.pathTracerCache.flags.enabled},
        load: {...this.pathTracerCache.flags.load},
        verifyFingerprint: this.pathTracerCache.flags.verifyFingerprint,
      },
      sizes: {
        bvh: this.pathTracerCache.sizeOf('bvh'),
        irradiance: this.pathTracerCache.sizeOf('irradiance') ||
            (this.pathTracerCache.flags.enabled.irradiance ?
                 this.irradianceGrid.byteLength :
                 0),
        materials: this.pathTracerCache.sizeOf('materials'),
      },
      timings: {
        bvhBuildMs:
            session?.bvhBuildMs ?? this.pathTracerCache.timings.bvhBuildMs,
        bvhRestored: session?.bvhRestored ?? 0,
        bvhBuilt: session?.bvhBuilt ?? 0,
        firstSampleMs: session?.firstSampleMs ?? null,
        convergedMs: session?.convergedMs ?? null,
      },
      lastLoad: this.pathTracerCache.lastLoad,
      fingerprint: {...this.pathTracerCache.fingerprint},
    };
  }

  async exportPathTracerCache(types?: readonly PathTracerCacheType[]):
      Promise<Blob> {
    await this.captureLiveCaches();
    const fingerprint = this.currentFingerprint();
    this.pathTracerCache.fingerprint = fingerprint;
    return this.pathTracerCache.exportBlob(fingerprint, types);
  }

  async loadPathTracerCache(
      source: string|Blob|ArrayBuffer|Uint8Array,
      request: PathTracerCacheLoadRequest = {},
      ): Promise<PathTracerCacheLoadResult> {
    const bytes = await cacheSourceBytes(source);
    const fingerprint = this.currentFingerprint();
    this.pathTracerCache.fingerprint = fingerprint;
    const result = this.pathTracerCache.loadBytes(bytes, fingerprint, request);
    if (!result.accepted) {
      return result;
    }
    this.applyLoadedCache(result.applied);
    return result;
  }

  clearPathTracerCache(types?: PathTracerCacheType|
                       readonly PathTracerCacheType[]) {
    const list =
        types == null ? undefined : (Array.isArray(types) ? types : [types]);
    this.pathTracerCache.clear(list);
    const cleared = list ?? (['bvh', 'irradiance', 'materials'] as const);
    if (cleared.includes('bvh') && this.session != null) {
      this.session.setBvhCache(null, this.pathTracerCache.flags.enabled.bvh);
    }
    if (cleared.includes('irradiance')) {
      this.irradianceGrid = createIrradianceGrid();
      this.irradianceFromFile = false;
      this.irradianceGeneration++;
      this.pushIrradiance();
    }
  }

  invalidatePathTracerCache(reason: PathTracerCacheInvalidation):
      PathTracerCacheType[] {
    const cleared = this.pathTracerCache.invalidate(reason);
    if (reason === 'geometry') {
      this.materialWatch = null;
      this.materialWatchReady = false;
    }
    if (cleared.includes('irradiance')) {
      this.irradianceGrid = createIrradianceGrid();
      this.irradianceFromFile = false;
      this.irradianceGeneration++;
      this.pushIrradiance();
    }
    if (cleared.includes('bvh') && this.session != null) {
      this.session.setBvhCache(null, false);
    }
    if (reason === 'material-swap' || reason === 'material-adjust') {
      this.updateTracedMaterials();
    }
    return cleared;
  }

  private currentFingerprint(): PathTracerCacheFingerprint {
    const element = this.scene?.element as {
      src?: string;
      environmentImage?: string;
      skyboxImage?: string;
    }
    |undefined;
    const geometry = this.scene == null ? '' : hashMeshPositions(this.scene);
    const environment = [
      element?.environmentImage ?? '',
      element?.skyboxImage ?? '',
      String(this.scene?.environmentIntensity ?? ''),
      String(this.scene?.exposure ?? ''),
    ].join('|');
    const settings = [
      this.options.bounces,
      this.buildOptions.strategy,
      this.buildOptions.maxLeafTris,
      this.options.floor,
      this.options.floorReflection,
      this.options.floorColor,
      this.options.floorRoughness,
      this.options.floorMetalness,
      this.options.multipleImportanceSampling ? 1 : 0,
      this.lightVisibilityKey,
    ].join('|');
    return {
      glb: fnv1aHex(`${element?.src ?? ''}\n${geometry}`),
      environment: fnv1aHex(environment),
      settings: fnv1aHex(settings),
    };
  }

  private pushBvhCache(session: WebGPUPathTracerSession) {
    const entry = this.pathTracerCache.get('bvh');
    if (!this.pathTracerCache.flags.enabled.bvh || entry == null) {
      session.setBvhCache(null, this.pathTracerCache.flags.enabled.bvh);
      return;
    }
    session.setBvhCache(
        decodeBvhRecords(entry.bytes), this.pathTracerCache.flags.enabled.bvh);
  }

  private pushIrradiance() {
    const session = this.session;
    if (session == null) {
      return;
    }
    if (!this.pathTracerCache.flags.enabled.irradiance) {
      session.setIrradianceCache(null, this.irradianceGeneration);
      return;
    }
    this.fitIrradianceBounds();
    session.setIrradianceCache(
        {
          grid: this.irradianceGrid,
          origin: this.irradianceMeta.origin,
          cellSize: this.irradianceMeta.cellSize,
          minSamples: this.irradianceMeta.minSamples,
          read: true,
          write: true,
        },
        this.irradianceGeneration);
  }

  private fitIrradianceBounds() {
    if (this.irradianceFromFile || this.scene == null) {
      return;
    }
    const box = new Box3().setFromObject(this.scene);
    if (box.isEmpty()) {
      return;
    }
    const fit = gridForBounds(
        [box.min.x, box.min.y, box.min.z], [box.max.x, box.max.y, box.max.z]);
    if (fit.cellSize === this.irradianceMeta.cellSize &&
        fit.origin[0] === this.irradianceMeta.origin[0] &&
        fit.origin[1] === this.irradianceMeta.origin[1] &&
        fit.origin[2] === this.irradianceMeta.origin[2]) {
      return;
    }
    this.irradianceMeta = {
      ...this.irradianceMeta,
      origin: fit.origin,
      cellSize: fit.cellSize,
    };
    this.irradianceGeneration++;
  }

  private applyLoadedCache(applied: readonly PathTracerCacheType[]) {
    if (applied.includes('bvh')) {
      this.clearGeometryBounds();
      this.markSceneDirty();
    }
    if (applied.includes('irradiance')) {
      const entry = this.pathTracerCache.get('irradiance');
      if (entry != null) {
        const decoded = decodeIrradiancePayload(
            entry.bytes, entry.meta as Partial<IrradianceGridMeta>);
        this.irradianceGrid = decoded.grid;
        this.irradianceMeta = decoded.meta;
        this.irradianceFromFile = true;
        this.irradianceGeneration++;
        this.pushIrradiance();
      }
    }
    if (applied.includes('materials')) {
      this.materialWatch = null;
      this.materialWatchReady = false;
    }
  }

  private captureBuiltCaches(stamp = true) {
    const started = performance.now();
    if (this.scene == null) {
      return;
    }
    if (this.pathTracerCache.flags.enabled.bvh) {
      const records = captureSceneBvh(this.scene);
      this.pathTracerCache.set(
          'bvh', encodeBvhRecords(records), {meshes: records.length});
    }
    if (this.pathTracerCache.flags.enabled.materials) {
      const records = collectMaterialRecords(this.scene);
      this.pathTracerCache.set(
          'materials', encodeMaterialRecords(records), {count: records.length});
    }
    this.fitIrradianceBounds();
    this.pushIrradiance();
    if (!stamp || this.session == null) {
      return;
    }
    if (this.session.prepStartedAt == null) {
      this.session.prepStartedAt = started;
    }
    this.session.prepFinishedAt = performance.now();
  }

  private async captureLiveCaches() {
    this.captureBuiltCaches(false);
    if (!this.pathTracerCache.flags.enabled.irradiance ||
        this.session == null) {
      return;
    }
    const read = await this.session.readIrradianceGrid();
    if (read != null) {
      const grid = createIrradianceGrid(this.irradianceMeta.slots);
      grid.set(read.subarray(0, grid.length));
      this.irradianceGrid = grid;
    }
    const encoded =
        encodeIrradiancePayload(this.irradianceGrid, this.irradianceMeta);
    this.pathTracerCache.set('irradiance', encoded.bytes, {...encoded.meta});
  }

  private syncMaterialWatch() {
    if (this.scene == null || this.sceneBuildInFlight) {
      return;
    }
    const next = sampleMaterialWatch(this.scene);
    if (!this.materialWatchReady || this.materialWatch == null) {
      this.materialWatch = next;
      this.materialWatchReady = true;
      return;
    }
    const delta = diffMaterialWatch(this.materialWatch, next);
    this.materialWatch = next;
    if (delta != null) {
      this.invalidatePathTracerCache(delta);
    }
  }

  private restoreDetached(
      detached: Array<{parent: Object3D; object: Object3D; index: number}>) {
    for (let i = detached.length - 1; i >= 0; i--) {
      const {parent, object, index} = detached[i];
      object.parent = parent;
      const clamped = Math.min(Math.max(0, index), parent.children.length);
      parent.children.splice(clamped, 0, object);
    }
  }
}

const cacheSourceBytes = async(
    source: string|Blob|ArrayBuffer|Uint8Array,
    ): Promise<Uint8Array> => {
  if (typeof source === 'string') {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(
          `Path tracer cache ${source} responded with ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  if (source instanceof Uint8Array) {
    return source;
  }
  if (source instanceof ArrayBuffer) {
    return new Uint8Array(source);
  }
  return new Uint8Array(await source.arrayBuffer());
};

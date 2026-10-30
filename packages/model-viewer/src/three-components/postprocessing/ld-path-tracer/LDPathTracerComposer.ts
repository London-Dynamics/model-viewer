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

import {Camera, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, NeutralToneMapping, Object3D, PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,} from 'three';
import {PhysicalCamera} from 'three-gpu-pathtracer';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {AmbientOcclusionOptions, LDAmbientOcclusionComposer,} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

import {resolvePathTracerRenderScale} from './path-tracer-scale.js';
import {isCrossOriginScript, PathTracerBVHWorker, pathTracerBvhWorkerScriptUrl} from './PathTracerBVHWorker.js';
import {PATH_TRACER_UNAVAILABLE_EVENT, WebGPUPathTracerSession} from './WebGPUPathTracerSession.js';

export const PATH_TRACER_READY_EVENT = 'path-tracer-ready';

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
] as const;

export interface PathTracerOptions {
  samples: number;
  samplesThreshold: number;
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
  paused: boolean;
  frameBudget: number;
  multipleImportanceSampling: boolean;
  randomStrategy: 'blue-dither'|'sobol'|'pcg';
  ambientOcclusionPreviewOptions: AmbientOcclusionOptions|null;
}

export const DEFAULT_PATH_TRACER_OPTIONS: PathTracerOptions = {
  samples: 32,
  samplesThreshold: 6,
  bounces: 5,
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
  paused: false,
  frameBudget: 250000,
  multipleImportanceSampling: true,
  randomStrategy: 'blue-dither',
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
  private readonly shadowCatcherCenter = new Vector3();
  private shadowCatcher: Mesh<PlaneGeometry, MeshStandardMaterial>|null = null;
  private shadowCatcherState = '';
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
  private lastEnvironmentIntensity = 1;
  private lastEnvironment: unknown = null;
  private lastBackground: unknown = null;
  private readonly drawingBufferSize = new Vector2();
  private reportedTracedWidth = 0;
  private reportedTracedHeight = 0;
  private reportedSupersampled = false;

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
    this.applyRenderScale();
    this.pathTracer?.reset();
    this.ambientOcclusionPreviewComposer?.setSize(width, height);
    this.requestRender();
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp) {
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
    }

    this.syncShadowCatcher();
    this.syncScene();
    this.syncEnvironment();
    this.updateSceneIfGeometryMoved();
    this.updateCameraIfNeeded();
    this.ambientOcclusionPreviewComposer?.beforeRender(_time, _delta);
  }

  render(_deltaTime?: DOMHighResTimeStamp) {
    if (this.session?.state !== 'ready' || this.pathTracer == null ||
        this.renderer == null || this.scene == null ||
        this.sceneBuildInFlight) {
      this.renderRealtime();
      return;
    }

    this.layoutTrace();
    this.pathTracer.renderSample();
    this.pathTracer.show(this.pathTracer.samples > 0);
    if (this.pathTracer.samples <= 0) {
      this.renderRealtime();
    }
    if (this.shouldRenderAmbientOcclusionPreview()) {
      this.ambientOcclusionPreviewComposer?.render(_deltaTime);
    }
    this.renderSoftShadowOverlay();

    if (this.pathTracer.samples < this.options.samples) {
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
    this.renderer.render(this.scene, this.scene.getCamera());
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
    this.pathTracer.layout(
        cssWidth, cssHeight, resolved.width, resolved.height);
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
    this.disableBvhWorker();
    this.disposePathTracer();
    this.ambientOcclusionPreviewComposer?.dispose();
    this.ambientOcclusionPreviewComposer = null;
    this.currentAmbientOcclusionPreviewOptions = null;
    this.reportedTracedWidth = 0;
    this.reportedTracedHeight = 0;
    this.reportedSupersampled = false;
    this.disposeShadowCatcher();
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

    const {element, exposure} = this.scene;
    const exposureIsNumber =
        typeof exposure === 'number' && !Number.isNaN(exposure);
    const env = element.environmentImage;
    const sky = element.skyboxImage;
    const compensateExposure = this.scene.toneMapping === NeutralToneMapping &&
        (env === 'neutral' || env === 'legacy' || (!env && !sky));
    this.renderer.toneMappingExposure =
        (exposureIsNumber ? exposure : 1.0) * (compensateExposure ? 1.3 : 1.0);
  }

  private applyRenderScale() {
    if (this.pathTracer == null || this.renderer == null) {
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
    const cssWidth = this.scene?.element.clientWidth || this.scene?.width || 0;
    const cssHeight =
        this.scene?.element.clientHeight || this.scene?.height || 0;
    this.pathTracer.layout(
        cssWidth, cssHeight, resolved.width, resolved.height);
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
    if (this.environmentStateReady &&
        intensity === this.lastEnvironmentIntensity &&
        environment === this.lastEnvironment &&
        background === this.lastBackground) {
      return;
    }

    this.lastEnvironmentIntensity = intensity;
    this.lastEnvironment = environment;
    this.lastBackground = background;
    this.environmentStateReady = true;
    this.pathTracer.updateEnvironment();
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
    this.pathTracer.minSamples =
        Math.max(1, Math.floor(this.options.samplesThreshold));
    this.applyRenderScale();
    this.pathTracer.tiles.copy(this.options.tiles);
    this.pathTracer.setDenoise(this.options.denoise);
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
      this.requestRender();
    };

    const worker = this.ensureBvhWorker();
    // setScene/setSceneAsync bake visible meshes synchronously, before the
    // BVH promise settles. Hide shadow receivers for that snapshot only.
    const restoreShadowReceivers = this.hideShadowReceivers();
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

    const shouldShow = this.scene.shadowMode === 'path-tracer' &&
        this.scene.shadowIntensity > 0;
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
    const opacity = Math.min(1, Math.max(0, this.scene.shadowIntensity));

    const nextState = [
      this.scene.shadowMode,
      opacity.toFixed(4),
      width.toFixed(4),
      depth.toFixed(4),
      this.shadowCatcherCenter.x.toFixed(4),
      boundingBox.min.y.toFixed(4),
      this.shadowCatcherCenter.z.toFixed(4),
    ].join('|');

    if (nextState === this.shadowCatcherState) {
      return;
    }

    shadowCatcher.position.set(
        this.shadowCatcherCenter.x,
        boundingBox.min.y - gap,
        this.shadowCatcherCenter.z);
    shadowCatcher.rotation.set(-Math.PI / 2, 0, 0);
    shadowCatcher.scale.set(width, depth, 1);
    shadowCatcher.material.opacity = opacity;
    shadowCatcher.material.transparent = opacity < 1;
    shadowCatcher.material.needsUpdate = true;

    if (shadowCatcher.parent !== this.scene.target) {
      this.scene.target.add(shadowCatcher);
    }

    this.shadowCatcherState = nextState;
    this.markSceneDirty();
    (this.pathTracer as any)?.updateMaterials?.();
  }

  private renderSoftShadowOverlay() {
    if (this.renderer == null || this.scene == null ||
        this.scene.shadowMode !== 'soft-shadow') {
      return;
    }

    this.scene.shadow?.renderFloor(
        this.renderer, this.scene, this.scene.getCamera());
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
      color: 0xd9d9d9,
      metalness: 0,
      opacity: 1,
      roughness: 1,
      side: DoubleSide,
      transparent: false,
    });

    this.shadowCatcher = new Mesh(new PlaneGeometry(1, 1), material);
    this.shadowCatcher.name = 'PathTracerShadowCatcher';
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

  private updateCameraIfNeeded() {
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

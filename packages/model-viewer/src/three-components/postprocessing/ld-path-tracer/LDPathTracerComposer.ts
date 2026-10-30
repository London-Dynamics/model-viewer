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

import {Camera, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NeutralToneMapping, NoBlending, NoToneMapping, NormalBlending, Object3D, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector2, Vector3, WebGLRenderer} from 'three';
import {PhysicalCamera} from 'three-gpu-pathtracer/src/objects/PhysicalCamera.js';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {AmbientOcclusionOptions, LDAmbientOcclusionComposer,} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

import {cloneProgressiveSettings, DEFAULT_PROGRESSIVE_SETTINGS, ProgressiveSettings} from './progressive/options.js';
import {ProgressivePipeline} from './progressive/ProgressivePipeline.js';
import {fitCameraAspect} from './progressive/surface-bake.js';
import {DEFAULT_TRACE_COMPOSITE_OPTIONS, TRACE_LINEAR_SCALE, TraceComposite, TraceCompositeOptions, TraceMode, TraceView} from './progressive/trace-composite.js';
import {WebGPUBeautyTrace} from './progressive/webgpu-beauty-trace.js';

export const PATH_TRACER_READY_EVENT = 'path-tracer-ready';

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
  'tiles',
  'depthOfField',
  'focalLength',
  'fStop',
  'focusDistance',
  'apertureBlades',
  'apertureRotation',
  'anamorphicRatio',
  'traceMode',
  'traceExclude',
  'traceExcludedCastShadow',
] as const;

export interface PathTracerOptions {
  samples: number;
  samplesThreshold: number;
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
  ambientOcclusionPreviewOptions: AmbientOcclusionOptions|null;
  /** full beauty, traced shadows over real-time, or traced lighting. */
  traceMode: TraceMode;
  /** composite, the raw trace pass, or the real-time render. */
  traceView: TraceView;
  /** What stays out of the trace; see TraceCompositeOptions.exclude. */
  traceExclude: string;
  traceExcludedCastShadow: boolean;
  /** Traced ground catcher strength in the composite modes. */
  traceGroundShadow: number;
}

export const DEFAULT_PATH_TRACER_OPTIONS: PathTracerOptions = {
  samples: 16,
  samplesThreshold: 6,
  bounces: 15,
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
  ambientOcclusionPreviewOptions: null,
  traceMode: DEFAULT_TRACE_COMPOSITE_OPTIONS.mode,
  traceView: DEFAULT_TRACE_COMPOSITE_OPTIONS.view,
  traceExclude: DEFAULT_TRACE_COMPOSITE_OPTIONS.exclude,
  traceExcludedCastShadow: DEFAULT_TRACE_COMPOSITE_OPTIONS.excludedCastShadow,
  traceGroundShadow: DEFAULT_TRACE_COMPOSITE_OPTIONS.groundShadow,
};

/**
 * Beauty samples come only from WebGPUPathTracer. The raster view stays on
 * the WebGL canvas. There is no WebGL path-tracer fallback.
 */
export class LDPathTracerComposer implements EffectComposerInterface {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  private readonly physicalCamera = new PhysicalCamera();
  private ambientOcclusionPreviewComposer: LDAmbientOcclusionComposer|null =
      null;
  private currentAmbientOcclusionPreviewOptions: AmbientOcclusionOptions|null =
      null;
  private queuedRender: number|null = null;
  private renderTicket = 0;
  private readonly meshWorldMatrices = new Map<string, Matrix4>();
  private readonly shadowCatcherCenter = new Vector3();
  private shadowCatcher: Mesh<PlaneGeometry, MeshStandardMaterial>|null = null;
  private shadowCatcherState = '';
  private options: PathTracerOptions = {
    ...DEFAULT_PATH_TRACER_OPTIONS,
    tiles: DEFAULT_PATH_TRACER_OPTIONS.tiles.clone(),
  };
  private buildOptions: PathTracerBuildOptions = {
    ...DEFAULT_PATH_TRACER_BUILD_OPTIONS,
  };
  private ready = false;
  private disposed = false;
  private progressiveSettings: ProgressiveSettings =
      cloneProgressiveSettings(DEFAULT_PROGRESSIVE_SETTINGS);
  private pipeline: ProgressivePipeline|null = null;
  private traceBlit: FullScreenQuad|null = null;
  private lookStamp = '';
  private readonly beautyTrace = new WebGPUBeautyTrace();
  private readonly composite = new TraceComposite();

  constructor(initialOptions?: Partial<PathTracerOptions>) {
    if (initialOptions) {
      this.updateOptions(initialOptions);
    }
  }

  setRenderer(renderer: WebGLRenderer) {
    const rendererUnchanged = this.renderer === renderer;
    this.renderer = renderer;
    this.syncAmbientOcclusionPreview();
    if (!rendererUnchanged) {
      this.beautyTrace.reset();
      this.invalidateReady();
    }
    this.requestRender();
  }

  setMainScene(scene: ModelScene) {
    const sceneChanged = this.scene !== scene;
    this.scene = scene;
    if (sceneChanged) {
      this.invalidateReady();
      this.meshWorldMatrices.clear();
      this.beautyTrace.reset();
      this.composite.invalidate();
    }
    this.syncAmbientOcclusionPreview();
    this.syncScene();
    this.requestRender();
  }

  setMainCamera(camera: Camera) {
    const cameraChanged = this.camera !== camera;
    this.camera = camera;
    if (cameraChanged) {
      this.beautyTrace.reset();
    }
    this.syncAmbientOcclusionPreview();
    this.syncScene();
    this.requestRender();
  }

  setSize(width: number, height: number) {
    if (this.camera != null) {
      fitCameraAspect(this.camera, width, height);
    }
    this.beautyTrace.reset();
    this.ambientOcclusionPreviewComposer?.setSize(width, height);
    this.requestRender();
  }

  beforeRender(time: DOMHighResTimeStamp, delta: DOMHighResTimeStamp) {
    if (this.isProgressiveMode()) {
      this.beforeRenderProgressive();
      return;
    }
    if (this.scene == null) {
      return;
    }

    const latestCamera = this.scene.getCamera();
    if (latestCamera !== this.camera) {
      this.camera = latestCamera;
      this.beautyTrace.reset();
    }

    this.syncShadowCatcher();
    this.syncScene();
    this.updateSceneIfGeometryMoved();
    this.ambientOcclusionPreviewComposer?.beforeRender(time, delta);
  }

  render(deltaTime?: DOMHighResTimeStamp) {
    if (this.isProgressiveMode()) {
      this.renderProgressive();
      return;
    }
    if (this.renderer == null || this.scene == null) {
      return;
    }

    this.applyOutputState(false);
    const proxy = this.composite.sync(this.scene, this.compositeOptions());
    if (proxy != null) {
      this.renderComposite(proxy);
      return;
    }
    this.beautyTrace.setLinearOutput(null);
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.scene.getCamera());
    this.followLook(false);
    this.sampleBeauty();
    if (this.options.traceView !== 'realtime') {
      this.compositeBeauty(1);
    }
    if (this.shouldRenderAmbientOcclusionPreview()) {
      this.ambientOcclusionPreviewComposer?.render(deltaTime);
    }
    this.renderSoftShadowOverlay();

    if (this.beautyTrace.samples < this.options.samples &&
        (this.beautyTrace.active || this.beautyTrace.canStart())) {
      this.queueNextProgressiveRender();
    }
    this.maybeMarkReady();
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
    if (shouldReset) {
      this.beautyTrace.reset();
      this.invalidateReady();
    }
    this.requestRender();
  }

  getSamples() {
    return this.beautyTrace.samples;
  }

  /** Sample cap reached and the denoiser, when on, has finished. */
  isTraceSettled(): boolean {
    return this.beautyTrace.settled();
  }

  /** Names of the meshes the current exclusion setting keeps out of the trace. */
  getExcludedMeshNames(): string[] {
    return this.composite.excludedMeshes().map((mesh) => mesh.name);
  }

  private compositeOptions(): TraceCompositeOptions {
    return {
      mode: this.options.traceMode,
      view: this.options.traceView,
      exclude: this.options.traceExclude,
      excludedCastShadow: this.options.traceExcludedCastShadow,
      groundShadow: this.options.traceGroundShadow,
    };
  }

  /**
   * Shadows, lighting, or full with exclusions: trace the proxy scene in
   * linear light and mix it with linear real-time passes. Tone mapping and
   * exposure are applied once, in the composite, so real-time and trace
   * share one look.
   */
  private renderComposite(proxy: Scene) {
    const renderer = this.renderer!;
    const scene = this.scene!;
    this.beautyTrace.setLinearOutput(TRACE_LINEAR_SCALE);
    if (!this.disposed &&
        (this.beautyTrace.canStart() || this.beautyTrace.active)) {
      try {
        this.beautyTrace.sample(
            proxy,
            this.traceCamera(),
            renderer,
            this.options.bounces,
            this.options.samples,
            this.options.denoise,
            this.options.renderScale);
      } catch (error) {
        console.warn('[model-viewer] WebGPU composite trace sample failed.', error);
      }
    }
    const texture =
        this.beautyTrace.samples >= this.options.samplesThreshold ?
        this.beautyTrace.outputTexture() :
        null;
    this.composite.draw(
        renderer, scene, scene.getCamera(), texture, this.compositeOptions());
    if (this.beautyTrace.samples < this.options.samples &&
        (this.beautyTrace.active || this.beautyTrace.canStart())) {
      this.queueNextProgressiveRender();
    }
    this.maybeMarkReady();
  }

  get isReady() {
    return this.ready;
  }

  /**
   * Camera handed to WebGPUPathTracer. Depth of field uses PhysicalCamera
   * so the same focal settings reach the tracer when that pass samples.
   */
  traceCamera(): Camera {
    if (!this.options.depthOfField ||
        !(this.camera instanceof PerspectiveCamera)) {
      return this.camera ?? this.physicalCamera;
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

  getBuildOptions(): PathTracerBuildOptions {
    return {...this.buildOptions};
  }

  isProgressiveMode(): boolean {
    return this.progressiveSettings.mode === 'progressive' && !this.disposed;
  }

  getRuntimeOptions(): PathTracerBuildOptions&ProgressiveSettings {
    return {
      ...this.buildOptions,
      ...cloneProgressiveSettings(this.progressiveSettings),
    };
  }

  setProgressiveSettings(settings: ProgressiveSettings) {
    this.progressiveSettings = cloneProgressiveSettings(settings);
    if (settings.mode !== 'progressive') {
      this.pipeline?.dispose();
      this.pipeline = null;
      this.requestRender();
      return;
    }
    if (this.pipeline == null) {
      this.pipeline = new ProgressivePipeline(
          this.progressiveHost(), this.progressiveSettings);
    } else {
      this.pipeline.setSettings(this.progressiveSettings);
    }
    this.requestRender();
  }

  getProgressiveReadout() {
    return this.pipeline?.readout() ?? null;
  }

  isContactShadowReady(): boolean {
    return this.pipeline?.contactReadyFlag === true;
  }

  isTextureAoReady(): boolean {
    return this.pipeline?.aoReadyFlag === true;
  }

  isLightLayersReady(): boolean {
    return this.pipeline?.lightsReadyFlag === true;
  }

  isProbesReady(): boolean {
    return this.pipeline?.probesReadyFlag === true;
  }

  shaderAoMix(): number {
    return this.pipeline?.shaderAoMix() ?? 1;
  }

  noteProgressiveFrame(ms: number) {
    this.pipeline?.noteFrame(ms);
  }

  compositeProgressiveTrace() {
    const view = this.progressiveSettings.view;
    if (view !== 'beauty') {
      return;
    }
    const fade = this.pipeline?.traceFadeValue ?? 0;
    this.compositeBeauty(fade);
  }

  setBuildOptions(partial: Partial<PathTracerBuildOptions>) {
    const next = resolvePathTracerBuildOptions(this.buildOptions, partial);
    if (next.strategy === this.buildOptions.strategy &&
        next.maxLeafTris === this.buildOptions.maxLeafTris) {
      return;
    }

    this.buildOptions = next;
    this.beautyTrace.reset();
    this.invalidateReady();
    this.requestRender();
  }

  get ambientOcclusionPreviewOptions() {
    return this.currentAmbientOcclusionPreviewOptions;
  }

  markSceneDirty() {
    this.composite.invalidate();
    this.invalidateReady();
    this.meshWorldMatrices.clear();
    this.beautyTrace.reset();
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    this.ambientOcclusionPreviewComposer?.dispose();
    this.ambientOcclusionPreviewComposer = null;
    this.currentAmbientOcclusionPreviewOptions = null;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.traceBlit?.dispose();
    this.traceBlit = null;
    this.beautyTrace.dispose();
    this.composite.dispose();
    this.disposeShadowCatcher();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.meshWorldMatrices.clear();
    this.queuedRender = null;
    this.ready = false;
  }

  private beforeRenderProgressive() {
    if (this.scene == null) {
      return;
    }
    this.camera = this.scene.getCamera();
    if (this.pipeline == null) {
      this.pipeline = new ProgressivePipeline(
          this.progressiveHost(), this.progressiveSettings);
    }
    this.pipeline.tick(performance.now());
  }

  private renderProgressive() {
    const started = performance.now();
    if (this.renderer == null || this.scene == null) {
      return;
    }
    const review = this.progressiveSettings.view === 'occlusion' ||
        this.progressiveSettings.view === 'bake';
    this.applyOutputState(review);
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.scene.getCamera());
    this.followLook(review);
    this.compositeProgressiveTrace();
    this.pipeline?.noteFrame(performance.now() - started);
    if (this.pipeline?.keepRendering()) {
      this.queueNextProgressiveRender();
    }
  }

  /**
   * Exposure, tone mapping, environment intensity or rotation changed. A
   * settled trace is no longer sampled, so present it once more: the WebGPU
   * present picks up the new tone mapping and exposure, and an environment
   * change restarts accumulation on the same BVH.
   */
  private followLook(review: boolean) {
    if (review || this.renderer == null || this.scene == null) {
      return;
    }
    const rotation = this.scene.environmentRotation;
    const stamp = [
      this.renderer.toneMapping,
      this.renderer.toneMappingExposure,
      this.scene.environmentIntensity,
      rotation.x,
      rotation.y,
      rotation.z,
    ].join(',');
    if (stamp === this.lookStamp) {
      return;
    }
    const first = this.lookStamp === '';
    this.lookStamp = stamp;
    if (first || !this.beautyTrace.presented) {
      return;
    }
    this.sampleBeauty();
    this.queueNextProgressiveRender();
  }

  private applyOutputState(review: boolean) {
    if (this.renderer == null || this.scene == null) {
      return;
    }
    this.renderer.toneMapping = review ? NoToneMapping : this.scene.toneMapping;
    this.renderer.outputColorSpace = SRGBColorSpace;
    const {element, exposure} = this.scene;
    const exposureIsNumber =
        typeof exposure === 'number' && !Number.isNaN(exposure);
    const env = element.environmentImage;
    const sky = element.skyboxImage;
    const compensateExposure = this.scene.toneMapping === NeutralToneMapping &&
        (env === 'neutral' || env === 'legacy' || (!env && !sky));
    this.renderer.toneMappingExposure = review ?
        1 :
        (exposureIsNumber ? exposure : 1.0) * (compensateExposure ? 1.3 : 1.0);
  }

  private progressiveHost() {
    return {
      renderer: () => this.renderer,
      scene: () => this.scene,
      camera: () => this.scene?.getCamera() ?? this.camera,
      requestRender: () => this.requestRender(),
      dispatch: (name: string, detail: Record<string, unknown>) => {
        this.scene?.element.dispatchEvent(new CustomEvent(name, {detail}));
      },
      buildTrace: () => {},
      traceReady: () => this.scene != null && this.renderer != null,
      occlusionSamples: () => 0,
      resetTrace: () => {
        this.beautyTrace.reset();
      },
      sampleTrace: () => this.sampleBeauty(),
      traceSamples: () => this.beautyTrace.samples,
      maxSamples: () => Math.max(1, this.options.samples),
      traceSettled: () => this.beautyTrace.settled(),
      invalidateTrace: () => {
        this.invalidateReady();
        this.beautyTrace.reset();
      },
      // The WebGL shadow pass is gone. These stay so the pipeline can keep
      // its camera-invalidation hooks until the atlas bake fills them in.
      shadowLayerReady: () => false,
      shadowMs: () => 0,
      shadowStale: () => false,
      markShadowStale: () => {},
      restartShadow: () => {},
    };
  }

  /** One WebGPU sample. -1 when the device is missing or still opening. */
  private sampleBeauty(): number {
    if (this.scene == null || this.renderer == null || this.disposed) {
      return -1;
    }
    if (!this.beautyTrace.canStart() && !this.beautyTrace.active) {
      return -1;
    }
    this.concealOverlays();
    try {
      return this.withBakeEnvironment(() => this.beautyTrace.sample(
          this.scene!,
          this.traceCamera(),
          this.renderer!,
          this.options.bounces,
          this.options.samples,
          this.options.denoise,
          this.options.renderScale));
    } catch (error) {
      console.warn('[model-viewer] WebGPU beauty trace sample failed.', error);
      return -1;
    } finally {
      this.revealOverlays();
    }
  }

  private compositeBeauty(fade: number) {
    const gpu = this.beautyTrace.outputTexture();
    if (fade <= 0.001 || gpu == null || this.renderer == null ||
        this.beautyTrace.samples < this.options.samplesThreshold) {
      return;
    }
    const blit = this.ensureTraceBlit();
    const material = blit.material as MeshBasicMaterial;
    material.map = gpu;
    // Already tone mapped and sRGB encoded by the WebGPU present.
    material.toneMapped = false;
    material.opacity = fade;
    material.transparent = fade < 0.999;
    material.blending = fade < 0.999 ? NormalBlending : NoBlending;
    material.depthTest = false;
    material.depthWrite = false;
    const previousClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    blit.render(this.renderer);
    this.renderer.autoClear = previousClear;
    material.blending = NoBlending;
  }

  private ensureTraceBlit(): FullScreenQuad {
    if (this.traceBlit == null) {
      this.traceBlit = new FullScreenQuad(new MeshBasicMaterial({
        toneMapped: false,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }));
    }
    return this.traceBlit;
  }

  private withBakeEnvironment<T>(fn: () => T): T {
    const scene = this.scene;
    const environment = this.pipeline?.bakeEnvironment() ?? null;
    if (scene == null || environment == null) {
      return fn();
    }
    const previous = scene.environment;
    scene.environment = environment;
    try {
      return fn();
    } finally {
      scene.environment = previous;
    }
  }

  private concealOverlays() {
    this.scene?.traverse((object) => {
      const hide = object.userData?.progressiveOverlay === true ||
          object.userData?.noHit === true ||
          object.userData?.pathTracerShadowCatcher === true;
      if (hide && object.visible) {
        object.userData.progressiveOverlayWasVisible = true;
        object.visible = false;
      }
    });
  }

  private revealOverlays() {
    this.scene?.traverse((object) => {
      if (object.userData?.progressiveOverlayWasVisible === true) {
        object.visible = true;
        object.userData.progressiveOverlayWasVisible = false;
      }
    });
  }

  private syncScene() {
    this.syncAmbientOcclusionPreview();
  }

  private invalidateReady() {
    this.ready = false;
  }

  private maybeMarkReady() {
    if (this.ready || this.beautyTrace.samples <= 0 || this.scene == null) {
      return;
    }
    if (!this.hasTraceableMesh()) {
      return;
    }

    this.ready = true;
    this.scene.element.dispatchEvent(new CustomEvent(PATH_TRACER_READY_EVENT, {
      detail: {samples: this.beautyTrace.samples},
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
        this.beautyTrace.samples < this.options.samplesThreshold;
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

  private updateSceneIfGeometryMoved() {
    if (this.scene == null) {
      return;
    }
    if (this.meshWorldMatrices.size === 0) {
      this.rememberGeometryState();
      return;
    }

    this.scene.updateMatrixWorld(true);
    const seenMeshes = new Set<string>();
    let changed = false;

    this.scene.traverseVisible((object: Object3D) => {
      if (!(object as Mesh).isMesh) {
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
      this.beautyTrace.reset();
      this.composite.invalidate();
      this.invalidateReady();
      this.rememberGeometryState();
    }
  }

  private rememberGeometryState() {
    if (this.scene == null) {
      return;
    }

    this.meshWorldMatrices.clear();
    this.scene.updateMatrixWorld(true);
    this.scene.traverseVisible((object: Object3D) => {
      if ((object as Mesh).isMesh) {
        this.meshWorldMatrices.set(object.uuid, object.matrixWorld.clone());
      }
    });
  }

  private queueNextProgressiveRender() {
    if (this.scene == null || this.queuedRender != null) {
      return;
    }

    // Renderer.hasRendered() clears the dirty flag right after render(), in
    // the same task. A microtask runs after that, so the very next animation
    // frame renders again. A requestAnimationFrame callback lands after the
    // renderer's own frame callback, which skipped every other frame and
    // halved the trace rate.
    const ticket = ++this.renderTicket;
    this.queuedRender = ticket;
    queueMicrotask(() => {
      if (this.queuedRender !== ticket) {
        return;
      }
      this.queuedRender = null;
      this.scene?.queueRender();
    });
  }

  private requestRender() {
    this.scene?.queueRender();
  }
}

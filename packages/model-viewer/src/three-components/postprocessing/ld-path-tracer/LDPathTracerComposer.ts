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

import {Camera, DataTexture, DoubleSide, EquirectangularReflectionMapping, FloatType, FrontSide, Light, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, MultiplyBlending, NeutralToneMapping, NoBlending, NoToneMapping, NormalBlending, Object3D, PerspectiveCamera, PlaneGeometry, RGBAFormat, ShaderMaterial, Side, SRGBColorSpace, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,} from 'three';
import {DenoiseMaterial, PathTracingSceneGenerator, PhysicalCamera, WebGLPathTracer,} from 'three-gpu-pathtracer';
import {PhysicalPathTracingMaterial} from 'three-gpu-pathtracer/src/materials/pathtracing/PhysicalPathTracingMaterial.js';
import {AVERAGE, CENTER, SAH} from 'three-mesh-bvh';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {AmbientOcclusionOptions, LDAmbientOcclusionComposer,} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

import {isCrossOriginScript, PathTracerBVHWorker, pathTracerBvhWorkerScriptUrl} from './PathTracerBVHWorker.js';
import {cloneProgressiveSettings, DEFAULT_PROGRESSIVE_SETTINGS, ProgressiveSettings} from './progressive/options.js';
import {ProgressivePipeline} from './progressive/ProgressivePipeline.js';
import {FactorEncoder, openLevel, usableFactorScale} from './progressive/surface-bake.js';
import {WebGPUBeautyTrace} from './progressive/webgpu-beauty-trace.js';

/**
 * three-gpu-pathtracer 0.0.27 reads an undeclared `length` on the second
 * scene build, so a camera move or a follow-up build throws. Clearing the
 * cached material ids takes the short-circuit path and still refreshes the
 * material index.
 */
const patchSceneGenerator = () => {
  const prototype = PathTracingSceneGenerator.prototype as PathTracingSceneGenerator & {
    generate(onProgress?: ((...args: unknown[]) => void)|null): unknown;
    _materialUuids?: string[]|null;
  };
  const original = prototype.generate;
  if ((original as {_ldPatched?: boolean})._ldPatched) {
    return;
  }
  const patched = function(
      this: {_materialUuids?: string[]|null},
      onProgress?: ((...args: unknown[]) => void)|null) {
    this._materialUuids = null;
    return original.call(this, onProgress ?? null);
  };
  (patched as {_ldPatched?: boolean})._ldPatched = true;
  prototype.generate = patched as typeof original;
};
patchSceneGenerator();

const PATH_TRACER_FADE_DURATION_MS = 600;
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
}

export const DEFAULT_PATH_TRACER_OPTIONS: PathTracerOptions = {
  samples: 32,
  samplesThreshold: 6,
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
  ambientOcclusionPreviewOptions: null,
};

export class LDPathTracerComposer implements EffectComposerInterface {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  private readonly physicalCamera = new PhysicalCamera();
  private readonly denoiseMaterial = new DenoiseMaterial();
  private readonly denoiseQuad = new FullScreenQuad(this.denoiseMaterial);
  private fireflyClamp: ShaderMaterial|null = null;
  private fireflyQuad: FullScreenQuad|null = null;
  private fireflyTarget: WebGLRenderTarget|null = null;
  private pathTracer: WebGLPathTracer|null = null;
  private occlusionTracer: WebGLPathTracer|null = null;
  private occlusionReady = false;
  private occlusionScale = 0;
  private occlusionBounces = -1;
  private occlusionDivide: ShaderMaterial|null = null;
  private occlusionQuad: FullScreenQuad|null = null;
  private uniformEnv: DataTexture|null = null;
  private whiteMaterial = new Map<Side, MeshPhysicalMaterial>();
  private savedMeshMaterials: Array<{mesh: Mesh; material: Mesh['material']}> =
      [];
  private hiddenLights: Light[] = [];
  private sceneBuildKind: 'beauty'|'occlusion' = 'beauty';
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
  private progressiveSettings: ProgressiveSettings =
      cloneProgressiveSettings(DEFAULT_PROGRESSIVE_SETTINGS);
  private pipeline: ProgressivePipeline|null = null;
  private traceSceneReady = false;
  private denoisedSample = -1;
  private traceHoldTarget: WebGLRenderTarget|null = null;
  private traceBlit: FullScreenQuad|null = null;
  private shadowStage: 'shadow'|'full' = 'full';
  private shadowHold: WebGLRenderTarget|null = null;
  private shadowQuad: FullScreenQuad|null = null;
  private shadowMaterial: ShaderMaterial|null = null;
  private shadowStartedAt = 0;
  private shadowReadyMs = 0;
  private shadowScale = 1;
  private shadowStale = false;
  private readonly factorEncoder = new FactorEncoder();
  private readonly beautyTrace = new WebGPUBeautyTrace();

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
    this.pathTracer?.reset();
    this.ambientOcclusionPreviewComposer?.setSize(width, height);
    this.requestRender();
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp) {
    if (this.isProgressiveMode()) {
      this.beforeRenderProgressive();
      return;
    }
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
    this.updateSceneIfGeometryMoved();
    this.updateCameraIfNeeded();
    this.ambientOcclusionPreviewComposer?.beforeRender(_time, _delta);
  }

  render(_deltaTime?: DOMHighResTimeStamp) {
    if (this.isProgressiveMode()) {
      this.renderProgressive();
      return;
    }
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

    this.pathTracer.renderSample();
    if (this.shouldRenderAmbientOcclusionPreview()) {
      this.ambientOcclusionPreviewComposer?.render(_deltaTime);
    }
    this.renderSoftShadowOverlay();

    if (this.pathTracer.samples < this.options.samples) {
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
    this.applyOptions(shouldReset);
    this.requestRender();
  }

  getSamples() {
    return this.pathTracer?.samples ?? 0;
  }

  get isReady() {
    return this.ready;
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
    const environmentChanged =
        settings.occlusionEnvironment !== this.progressiveSettings.occlusionEnvironment;
    this.progressiveSettings = cloneProgressiveSettings(settings);
    if (this.usesShadowPass() && this.shadowHold == null) {
      this.shadowStage = 'shadow';
      this.shadowStartedAt = 0;
      this.shadowStale = false;
      this.traceSceneReady = false;
      this.needsSceneUpdate = true;
    } else if (!this.usesShadowPass() && this.shadowStage === 'shadow') {
      this.shadowStage = 'full';
      this.traceSceneReady = false;
      this.needsSceneUpdate = true;
    }
    if ((settings.view === 'occlusion' || settings.view === 'bake') &&
        !this.occlusionReady) {
      this.needsSceneUpdate = true;
    }
    if (environmentChanged) {
      this.occlusionReady = false;
      this.occlusionTracer?.reset();
      this.needsSceneUpdate = true;
    }
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
    if (this.needsSceneUpdate) {
      this.syncScene();
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
    if (view === 'realtime' || view === 'bake') {
      return;
    }
    if (view === 'occlusion') {
      this.compositeOcclusion();
      return;
    }
    this.compositeShadowHold();
    const fade = this.pipeline?.traceFadeValue ?? 0;
    const gpu = this.beautyTrace.outputTexture();
    if (gpu != null && fade > 0.001 && this.renderer != null) {
      const blit = this.ensureTraceBlit();
      const material = blit.material as MeshBasicMaterial;
      material.map = gpu;
      material.toneMapped = true;
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
      return;
    }
    if (fade <= 0.001 || this.pathTracer == null || this.renderer == null ||
        this.pathTracer.target == null) {
      return;
    }
    const reveal = this.progressiveSettings.traceRevealSamples;
    const live = this.pathTracer.samples >= reveal;
    if (!live && this.traceHoldTarget == null &&
        this.pipeline?.traceHoldImage !== true) {
      return;
    }
    if (live && this.options.denoise &&
        this.denoisedSample !== this.pathTracer.samples) {
      this.blitTrace(this.pathTracer.target, true);
      this.denoisedSample = this.pathTracer.samples;
    } else if (!live && this.traceHoldTarget == null) {
      this.blitTrace(this.pathTracer.target, false);
    }
    const map = this.traceHoldTarget?.texture ?? this.pathTracer.target.texture;
    const blit = this.ensureTraceBlit();
    const material = blit.material as MeshBasicMaterial;
    material.map = map;
    material.map.colorSpace = LinearSRGBColorSpace;
    material.toneMapped = true;
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
    this.occlusionReady = false;
    this.needsSceneUpdate = true;
    this.meshWorldMatrices.clear();
    this.pathTracer?.reset();
    this.occlusionTracer?.reset();
    this.requestRender();
  }

  dispose() {
    this.disposed = true;
    this.sceneBuildGeneration++;
    this.sceneBuildQueued = false;
    this.sceneBuildInFlight = false;
    this.disableBvhWorker();
    try {
      this.pathTracer?.dispose();
    } catch {
      // three-gpu-pathtracer 0.0.23 references a private dispose member that
      // is not present. The renderer-owned WebGL context is still released by
      // model-viewer; swallow that package bug during feature teardown.
    }
    this.pathTracer = null;
    try {
      this.occlusionTracer?.dispose();
    } catch {
      // Same private-dispose bug as the beauty tracer.
    }
    this.occlusionTracer = null;
    this.occlusionQuad?.dispose();
    this.occlusionQuad = null;
    this.occlusionDivide?.dispose();
    this.occlusionDivide = null;
    this.uniformEnv?.dispose();
    this.uniformEnv = null;
    for (const material of this.whiteMaterial.values()) {
      material.dispose();
    }
    this.whiteMaterial.clear();
    this.ambientOcclusionPreviewComposer?.dispose();
    this.ambientOcclusionPreviewComposer = null;
    this.currentAmbientOcclusionPreviewOptions = null;
    this.denoiseQuad.dispose();
    this.fireflyQuad?.dispose();
    this.fireflyClamp?.dispose();
    this.fireflyTarget?.dispose();
    this.pipeline?.dispose();
    this.pipeline = null;
    this.traceBlit?.dispose();
    this.traceBlit = null;
    this.traceHoldTarget?.dispose();
    this.traceHoldTarget = null;
    this.shadowHold?.dispose();
    this.shadowHold = null;
    this.shadowQuad?.dispose();
    this.shadowQuad = null;
    this.shadowMaterial?.dispose();
    this.shadowMaterial = null;
    this.factorEncoder.dispose();
    this.beautyTrace.dispose();
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
    this.needsSceneUpdate = true;
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
    if (this.progressiveSettings.view === 'occlusion') {
      this.sampleOcclusionView();
    }
  }

  private renderProgressive() {
    const started = performance.now();
    if (this.renderer == null || this.scene == null) {
      return;
    }
    this.applyOutputState();
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.scene.getCamera());
    if (this.progressiveSettings.view === 'occlusion') {
      this.sampleOcclusionView();
    }
    this.compositeProgressiveTrace();
    this.pipeline?.noteFrame(performance.now() - started);
    if (this.pipeline?.keepRendering()) {
      this.queueNextProgressiveRender();
    }
  }

  private applyOutputState() {
    if (this.renderer == null || this.scene == null) {
      return;
    }
    const review = this.progressiveSettings.view === 'occlusion' ||
        this.progressiveSettings.view === 'bake';
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
      buildTrace: () => {
        if (this.sceneBuildInFlight || this.traceSceneReady) {
          return;
        }
        this.needsSceneUpdate = true;
        this.syncScene();
      },
      traceReady: () => this.traceSceneReady && !this.sceneBuildInFlight,
      prepareOcclusion: () => {
        if (this.occlusionReady || this.sceneBuildInFlight) {
          return;
        }
        this.needsSceneUpdate = true;
        this.syncScene();
      },
      occlusionReady: () => this.occlusionReady && !this.sceneBuildInFlight,
      occlusionMaterial: () => this.occlusionMaterial(),
      bounces: () => Math.max(1, Math.floor(this.options.bounces)),
      setOcclusionScale: (value: number) => {
        this.occlusionScale = value;
      },
      occlusionSamples: () => this.occlusionTracer?.samples ?? 0,
      resetTrace: () => {
        if (this.shadowStage === 'shadow') {
          this.pathTracer?.reset();
          return;
        }
        if (this.pathTracer != null && this.pathTracer.samples > 0) {
          this.blitTrace(this.pathTracer.target, this.options.denoise);
        }
        this.pathTracer?.reset();
        this.beautyTrace.reset();
        this.denoisedSample = -1;
      },
      sampleTrace: () => {
        if (this.shadowStage === 'full' && this.scene != null &&
            this.renderer != null && this.beautyTrace.canStart() &&
            this.traceSceneReady && !this.sceneBuildInFlight) {
          try {
            return this.beautyTrace.sample(
                this.scene,
                this.scene.getCamera(),
                this.renderer,
                this.options.bounces,
                this.options.samples,
                this.options.denoise,
                this.options.renderScale);
          } catch (error) {
            console.warn(
                '[model-viewer] WebGPU beauty trace sample failed.', error);
            return -1;
          }
        }
        if (this.pathTracer == null || !this.traceSceneReady ||
            this.sceneBuildInFlight) {
          return -1;
        }
        this.pathTracer.renderToCanvas = false;
        this.pathTracer.pausePathTracing = false;
        if (this.shadowStage !== 'shadow') {
          this.clampPathTracerFireflies();
        }
        const started = performance.now();
        try {
          this.pathTracer.renderSample();
        } catch (error) {
          console.warn(
              '[model-viewer] Progressive trace sample failed.', error);
          return -1;
        }
        const elapsed = performance.now() - started;
        if (this.shadowStage === 'shadow' &&
            this.pathTracer.samples >=
                this.progressiveSettings.shadowPass.samples) {
          this.finishShadowPass();
        }
        this.maybeMarkReady();
        return elapsed;
      },
      traceSamples: () => {
        if (this.shadowStage !== 'full') {
          return 0;
        }
        if (this.beautyTrace.active) {
          return this.beautyTrace.samples;
        }
        return this.pathTracer?.samples ?? 0;
      },
      maxSamples: () => Math.max(1, this.options.samples),
      invalidateTrace: () => {
        this.traceSceneReady = false;
        this.invalidateReady();
        if (this.usesShadowPass()) {
          this.shadowStage = 'shadow';
          this.shadowStartedAt = 0;
          this.shadowStale = false;
        }
      },
      shadowLayerReady: () =>
          this.shadowStage === 'full' && this.shadowHold != null,
      shadowMs: () => this.shadowReadyMs,
      shadowStale: () => this.shadowStale,
      markShadowStale: () => {
        if (!this.usesShadowPass()) {
          return;
        }
        if (this.shadowStage === 'shadow') {
          this.pathTracer?.reset();
          return;
        }
        this.shadowStale = true;
      },
      restartShadow: () => {
        if (!this.usesShadowPass()) {
          this.shadowStale = false;
          return;
        }
        this.shadowStale = false;
        this.shadowStage = 'shadow';
        this.shadowStartedAt = performance.now();
        this.traceSceneReady = false;
        this.needsSceneUpdate = true;
        this.syncScene();
      },
    };
  }

  private ensureTraceBlit(): FullScreenQuad {
    if (this.traceBlit == null) {
      this.traceBlit = new FullScreenQuad(new MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
      }));
    }
    return this.traceBlit;
  }

  private blitTrace(source: WebGLRenderTarget|null, denoise: boolean) {
    if (source == null || this.renderer == null) {
      return;
    }
    if (this.traceHoldTarget == null ||
        this.traceHoldTarget.width !== source.width ||
        this.traceHoldTarget.height !== source.height) {
      this.traceHoldTarget?.dispose();
      this.traceHoldTarget =
          new WebGLRenderTarget(source.width, source.height, {
            type: source.texture.type,
            format: RGBAFormat,
            depthBuffer: false,
          });
    }
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.traceHoldTarget);
    if (denoise) {
      this.denoiseMaterial.map = source.texture;
      this.denoiseMaterial.opacity = 1;
      this.denoiseMaterial.transparent = false;
      this.denoiseQuad.render(this.renderer);
    } else {
      const blit = this.ensureTraceBlit();
      const material = blit.material as MeshBasicMaterial;
      material.map = source.texture;
      material.opacity = 1;
      material.transparent = false;
      blit.render(this.renderer);
    }
    this.sanitizeHeldRadiance();
    this.renderer.setRenderTarget(previous);
  }

  /**
   * Fireflies are clamped on the sample, before it is blended in.
   * This pass only drops NaN and inf that survived that clamp. Scaling the
   * averaged picture here would leave the specks in place and darken
   * whatever had already converged.
   */
  private sanitizeHeldRadiance() {
    if (this.renderer == null || this.traceHoldTarget == null) {
      return;
    }
    if (this.fireflyTarget == null ||
        this.fireflyTarget.width !== this.traceHoldTarget.width ||
        this.fireflyTarget.height !== this.traceHoldTarget.height) {
      this.fireflyTarget?.dispose();
      this.fireflyTarget = new WebGLRenderTarget(
          this.traceHoldTarget.width, this.traceHoldTarget.height, {
            type: this.traceHoldTarget.texture.type,
            format: RGBAFormat,
            depthBuffer: false,
          });
    }
    if (this.fireflyClamp == null) {
      this.fireflyClamp = new ShaderMaterial({
        uniforms: {
          tDiffuse: {value: null},
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float peak = max(color.r, max(color.g, color.b));
            // NaN and inf fail a plain less-than and show up white.
            if (!(peak < 1e8)) color.rgb = vec3(0.0);
            gl_FragColor = color;
          }
        `,
        depthTest: false,
        depthWrite: false,
      });
      this.fireflyQuad = new FullScreenQuad(this.fireflyClamp);
    }
    this.fireflyClamp.uniforms.tDiffuse.value = this.traceHoldTarget.texture;
    this.renderer.setRenderTarget(this.fireflyTarget);
    this.fireflyQuad!.render(this.renderer);
    const blit = this.ensureTraceBlit();
    const material = blit.material as MeshBasicMaterial;
    material.map = this.fireflyTarget.texture;
    material.opacity = 1;
    material.transparent = false;
    this.renderer.setRenderTarget(this.traceHoldTarget);
    blit.render(this.renderer);
  }

  private withBakeEnvironment(fn: () => void) {
    const scene = this.scene;
    const environment = this.pipeline?.bakeEnvironment() ?? null;
    if (scene == null || environment == null) {
      fn();
      return;
    }
    const previous = scene.environment;
    scene.environment = environment;
    try {
      fn();
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

  private rebuildPathTracer() {
    if (this.renderer == null) {
      return;
    }

    this.disposePathTracer();
    this.invalidateReady();
    this.pathTracer = new WebGLPathTracer(this.renderer);
    this.pathTracer.renderDelay = 0;
    this.pathTracer.fadeDuration = PATH_TRACER_FADE_DURATION_MS;
    this.pathTracer.rasterizeScene = true;
    this.pathTracer.renderToCanvas = true;
    this.pathTracer.renderToCanvasCallback = (target, renderer, quad) =>
        this.renderPathTracerOutput(target, renderer, quad);
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

    try {
      this.pathTracer.dispose();
    } catch {
      // three-gpu-pathtracer 0.0.23 references a private dispose member that
      // is not present. Drop the instance so a replacement can be created.
    }
    this.pathTracer = null;
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
      maxLeafTris: this.buildOptions.maxLeafTris,
    };
  }

  private invalidateReady() {
    this.ready = false;
    this.traceSceneReady = false;
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

  private clampPathTracerFireflies() {
    const tracer = this.pathTracer as unknown as {
      _pathTracer?: {material?: {fragmentShader: string; needsUpdate: boolean}};
      _lowResPathTracer?: {material?: {fragmentShader: string; needsUpdate: boolean}};
    };
    for (const pass of [tracer._pathTracer, tracer._lowResPathTracer]) {
      const material = pass?.material;
      if (material == null || material.fragmentShader.includes('ldFireflyClamp')) {
        continue;
      }
      const needle = 'gl_FragColor.a *= opacity;';
      if (!material.fragmentShader.includes(needle)) {
        continue;
      }
      // Direct samples of a white surface in the studio HDR sit near
      // luminance 2.7. 8 leaves that distribution alone and cuts the
      // indirect spike before the 1/(n+1) blend.
      material.fragmentShader = material.fragmentShader.replace(
          needle,
          `{
            // ldFireflyClamp: finished sample, before the accumulation weight.
            float ldLum = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            if ( !( ldLum <= 8.0 ) ) {
              gl_FragColor.rgb *= ldLum > 8.0 ? ( 8.0 / ldLum ) : 0.0;
            }
          }
          ${needle}`);
      material.needsUpdate = true;
    }
  }

  private usesShadowPass(): boolean {
    return this.progressiveSettings.mode === 'progressive' &&
        this.progressiveSettings.view === 'beauty' &&
        this.progressiveSettings.shadowPass.enabled;
  }

  private beautyMaterial(): PhysicalPathTracingMaterial|null {
    const tracer = this.pathTracer as unknown as {
      _pathTracer?: {material?: PhysicalPathTracingMaterial};
    }|null;
    return tracer?._pathTracer?.material ?? null;
  }

  private applyShadowPreset() {
    const tracer = this.pathTracer;
    if (tracer == null) {
      return;
    }
    const pass = this.progressiveSettings.shadowPass;
    tracer.bounces = Math.min(2, Math.max(1, Math.floor(pass.bounces)));
    tracer.renderScale = Math.min(1, Math.max(0.1, pass.renderScale));
    tracer.tiles.set(1, 1);
    tracer.filterGlossyFactor = 0;
    tracer.minSamples = 1;
    this.setBackgroundAlpha(this.beautyMaterial(), 0);
  }

  private setBackgroundAlpha(
      material: PhysicalPathTracingMaterial|null, value: number) {
    const uniform = material?.uniforms?.backgroundAlpha;
    if (uniform != null) {
      uniform.value = value;
    }
  }

  private finishShadowPass() {
    this.captureShadow();
    this.shadowReadyMs = Math.max(
        1, performance.now() - (this.shadowStartedAt || performance.now()));
    this.shadowStage = 'full';
    this.shadowStale = false;
    this.applyOptions(false);
    this.setBackgroundAlpha(this.beautyMaterial(), 1);
    this.traceSceneReady = false;
    this.needsSceneUpdate = true;
    this.pathTracer?.reset();
    this.denoisedSample = -1;
    this.syncScene();
  }

  private captureShadow() {
    const source = this.pathTracer?.target;
    const renderer = this.renderer;
    if (source == null || renderer == null) {
      return;
    }
    if (this.shadowHold == null || this.shadowHold.width !== source.width ||
        this.shadowHold.height !== source.height) {
      this.shadowHold?.dispose();
      this.shadowHold = new WebGLRenderTarget(source.width, source.height, {
        type: FloatType,
        format: RGBAFormat,
        depthBuffer: false,
      });
    }
    const previous = renderer.getRenderTarget();
    source.texture.colorSpace = LinearSRGBColorSpace;
    renderer.setRenderTarget(this.shadowHold);
    if (this.progressiveSettings.shadowPass.denoise) {
      this.denoiseMaterial.map = source.texture;
      this.denoiseMaterial.opacity = 1;
      this.denoiseMaterial.transparent = false;
      this.denoiseQuad.render(renderer);
    } else {
      const blit = this.ensureTraceBlit();
      const blitMaterial = blit.material as MeshBasicMaterial;
      blitMaterial.map = source.texture;
      blitMaterial.opacity = 1;
      blitMaterial.transparent = false;
      blitMaterial.blending = NoBlending;
      blit.render(renderer);
    }
    renderer.setRenderTarget(previous);
    const bytes = this.factorEncoder.encode(
        renderer, this.shadowHold, this.shadowHold.width, this.shadowHold.height);
    const values = new Float32Array(this.shadowHold.width * this.shadowHold.height);
    values.fill(-1);
    let peak = 0;
    for (let i = 0; i < values.length; i++) {
      if (bytes[i * 4 + 3] < 128) {
        continue;
      }
      const sample =
          (bytes[i * 4] + bytes[i * 4 + 1] + bytes[i * 4 + 2]) / (3 * 255);
      values[i] = sample;
      if (sample > peak) {
        peak = sample;
      }
    }
    console.info(
        '[model-viewer] Shadow layer readback peak', peak.toFixed(3),
        'scale', usableFactorScale(openLevel(values)).toFixed(3));
    if (!(peak > 0.02)) {
      console.warn(
          '[model-viewer] Shadow pass readback is black. The GPU path did not return texels.');
      this.shadowScale = 1;
      return;
    }
    this.shadowScale = usableFactorScale(openLevel(values));
  }

  private compositeShadowHold() {
    const weight = this.pipeline?.shadowComposite ?? 0;
    if (weight <= 0.001 || this.shadowHold == null || this.renderer == null) {
      return;
    }
    if (this.shadowMaterial == null) {
      this.shadowMaterial = new ShaderMaterial({
        uniforms: {
          tDiffuse: {value: null},
          scale: {value: 1},
          weight: {value: 1},
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float scale;
          uniform float weight;
          varying vec2 vUv;
          void main() {
            vec4 shadow = texture2D(tDiffuse, vUv);
            float divisor = (scale > 0.02 && scale < 8.0) ? scale : 1.0;
            vec3 factor = shadow.rgb / divisor;
            float cover = shadow.a * weight;
            gl_FragColor = vec4(mix(vec3(1.0), clamp(factor, 0.0, 1.0), cover), 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        blending: MultiplyBlending,
        transparent: true,
      });
      this.shadowQuad = new FullScreenQuad(this.shadowMaterial);
    }
    const material = this.shadowMaterial;
    material.uniforms.tDiffuse.value = this.shadowHold.texture;
    this.shadowHold.texture.colorSpace = LinearSRGBColorSpace;
    material.uniforms.scale.value = this.shadowScale;
    material.uniforms.weight.value = weight;
    material.blending = MultiplyBlending;
    const previousClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.shadowQuad!.render(this.renderer);
    this.renderer.autoClear = previousClear;
  }

  private applyOptions(reset: boolean = true) {
    if (this.pathTracer == null) {
      return;
    }
    if (this.shadowStage === 'shadow') {
      this.applyShadowPreset();
      return;
    }

    this.pathTracer.bounces = Math.max(1, Math.floor(this.options.bounces));
    this.clampPathTracerFireflies();
    // Secondary glossy hits are what blow out into fireflies at low sample
    // counts. Roughen them a little.
    this.pathTracer.filterGlossyFactor = Math.max(
        this.pathTracer.filterGlossyFactor, 0.45);
    this.pathTracer.minSamples =
        Math.max(1, Math.floor(this.options.samplesThreshold));
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
      if (this.occlusionBounces !== Math.floor(this.options.bounces)) {
        this.occlusionReady = false;
        this.occlusionTracer?.reset();
        this.needsSceneUpdate = true;
      }
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

    this.sceneBuildKind = this.shouldBuildOcclusion() ? 'occlusion' : 'beauty';
    this.beginSceneBuild();
  }

  private shouldBuildOcclusion(): boolean {
    if (this.occlusionReady || !this.isProgressiveMode()) {
      return false;
    }
    const view = this.progressiveSettings.view;
    if (view === 'occlusion' || view === 'bake') {
      return true;
    }
    if (this.usesShadowPass()) {
      return false;
    }
    return this.progressiveSettings.bake.textureAO.enabled;
  }

  private ensureOcclusionTracer(): WebGLPathTracer|null {
    if (this.renderer == null) {
      return null;
    }
    if (this.occlusionTracer == null) {
      const tracer = new WebGLPathTracer(this.renderer);
      tracer.renderToCanvas = false;
      tracer.renderDelay = 0;
      tracer.fadeDuration = 0;
      tracer.minSamples = 1;
      tracer.filterGlossyFactor = 0;
      this.occlusionTracer = tracer;
      this.applyBuildOptionsTo(tracer);
    }
    this.occlusionTracer.bounces = Math.max(1, Math.floor(this.options.bounces));
    this.occlusionTracer.filterGlossyFactor = 0;
    this.occlusionTracer.tiles.copy(this.options.tiles);
    this.occlusionTracer.renderScale =
        Math.min(1, Math.max(0.1, this.options.renderScale));
    return this.occlusionTracer;
  }

  private applyBuildOptionsTo(tracer: WebGLPathTracer) {
    const generator = (tracer as unknown as {
                        _generator?: {bvhOptions?: Record<string, unknown>;};
                      })._generator;
    if (generator == null) {
      return;
    }
    generator.bvhOptions = {
      ...generator.bvhOptions,
      strategy: BVH_STRATEGY[this.buildOptions.strategy],
      maxLeafTris: this.buildOptions.maxLeafTris,
    };
  }

  private occlusionMaterial(): PhysicalPathTracingMaterial|null {
    const tracer = this.occlusionTracer as unknown as {
      _pathTracer?: {material?: PhysicalPathTracingMaterial};
    }|null;
    return tracer?._pathTracer?.material ?? null;
  }

  private sampleOcclusionView() {
    const tracer = this.occlusionTracer;
    if (tracer == null || !this.occlusionReady || this.sceneBuildInFlight ||
        this.renderer == null) {
      return;
    }
    if (tracer.samples >= this.options.samples) {
      return;
    }
    tracer.renderToCanvas = false;
    tracer.pausePathTracing = false;
    tracer.bounces = Math.max(1, Math.floor(this.options.bounces));
    tracer.filterGlossyFactor = 0;
    this.setBackgroundAlpha(this.occlusionMaterial(), 0);
    try {
      tracer.renderSample();
    } catch (error) {
      console.warn('[model-viewer] Occlusion view sample failed.', error);
    }
  }

  private compositeOcclusion() {
    const tracer = this.occlusionTracer;
    const target = tracer?.target;
    if (tracer == null || target == null || this.renderer == null ||
        tracer.samples < 1) {
      return;
    }
    if (this.occlusionDivide == null) {
      this.occlusionDivide = new ShaderMaterial({
        uniforms: {
          tDiffuse: {value: null},
          scale: {value: 1},
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float scale;
          varying vec2 vUv;
          void main() {
            vec3 color = texture2D(tDiffuse, vUv).rgb;
            float divisor = (scale > 0.02 && scale < 8.0) ? scale : 1.0;
            gl_FragColor = vec4(color / divisor, 1.0);
          }
        `,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    }
    const divide = this.occlusionDivide;
    divide.uniforms.tDiffuse.value = target.texture;
    target.texture.colorSpace = LinearSRGBColorSpace;
    const scale = this.occlusionScale;
    divide.uniforms.scale.value = scale > 0.02 && scale < 8 ? scale : 1;
    if (this.occlusionQuad == null) {
      this.occlusionQuad = new FullScreenQuad(divide);
    }
    const previousClear = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.occlusionQuad.render(this.renderer);
    this.renderer.autoClear = previousClear;
  }

  private ensureUniformEnv(): DataTexture {
    if (this.uniformEnv != null) {
      return this.uniformEnv;
    }
    const data = new Float32Array(32 * 16 * 4);
    data.fill(1);
    const texture = new DataTexture(data, 32, 16, RGBAFormat, FloatType);
    texture.mapping = EquirectangularReflectionMapping;
    texture.colorSpace = LinearSRGBColorSpace;
    texture.needsUpdate = true;
    this.uniformEnv = texture;
    return texture;
  }

  private withOcclusionEnvironment(build: () => void) {
    const scene = this.scene;
    if (scene == null ||
        this.progressiveSettings.occlusionEnvironment !== 'uniform') {
      build();
      return;
    }
    const previous = scene.environment;
    const previousIntensity = scene.environmentIntensity;
    scene.environment = this.ensureUniformEnv();
    scene.environmentIntensity = 1;
    try {
      build();
    } finally {
      scene.environment = previous;
      scene.environmentIntensity = previousIntensity;
    }
  }

  private whiteFor(side: Side): MeshPhysicalMaterial {
    const cached = this.whiteMaterial.get(side);
    if (cached != null) {
      return cached;
    }
    const material = new MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
      clearcoat: 0,
      transmission: 0,
      sheen: 0,
      iridescence: 0,
      specularIntensity: 0,
      emissive: 0x000000,
      emissiveIntensity: 0,
      side,
    });
    this.whiteMaterial.set(side, material);
    return material;
  }

  private pushWhiteMaterials() {
    this.savedMeshMaterials = [];
    this.hiddenLights = [];
    this.scene?.traverse((object) => {
      const light = object as Light;
      if (light.isLight && light.visible) {
        light.visible = false;
        this.hiddenLights.push(light);
      }
      const mesh = object as Mesh;
      if (!mesh.isMesh || mesh.userData?.noHit === true ||
          mesh.userData?.pathTracerShadowCatcher === true) {
        return;
      }
      this.savedMeshMaterials.push({mesh, material: mesh.material});
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((entry) => this.whiteFor(
            (entry as MeshStandardMaterial)?.side ?? FrontSide));
      } else {
        const side = (mesh.material as MeshStandardMaterial)?.side ?? FrontSide;
        mesh.material = this.whiteFor(side);
      }
    });
  }

  private popWhiteMaterials() {
    for (const entry of this.savedMeshMaterials) {
      entry.mesh.material = entry.material;
    }
    this.savedMeshMaterials = [];
    for (const light of this.hiddenLights) {
      light.visible = true;
    }
    this.hiddenLights = [];
  }

  private beginSceneBuild() {
    const occlusion = this.sceneBuildKind === 'occlusion';
    const pathTracer = occlusion ? this.ensureOcclusionTracer() : this.pathTracer;
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

    if (!occlusion && this.shadowStage === 'shadow' && this.shadowStartedAt === 0) {
      this.shadowStartedAt = performance.now();
    }
    const generation = ++this.sceneBuildGeneration;
    const pathTracerCamera = this.getPathTracerCamera();
    this.invalidateReady();
    this.sceneBuildInFlight = true;
    this.needsSceneUpdate = false;
    this.concealOverlays();

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
      if (occlusion) {
        this.occlusionReady = true;
        this.occlusionBounces = Math.floor(this.options.bounces);
        this.setBackgroundAlpha(this.occlusionMaterial(), 0);
        const view = this.progressiveSettings.view;
        if (view === 'beauty' || view === 'realtime') {
          this.needsSceneUpdate = true;
          this.syncScene();
          return;
        }
        this.requestRender();
        return;
      }
      this.traceSceneReady = true;
      if (this.shadowStage === 'shadow') {
        this.withOcclusionEnvironment(() => {
          this.pathTracer?.updateEnvironment();
        });
        this.applyShadowPreset();
        this.pathTracer?.reset();
      } else {
        this.withBakeEnvironment(() => {
          this.pathTracer?.updateEnvironment();
        });
      }
      if (this.needsSceneUpdate || this.sceneBuildQueued) {
        this.sceneBuildQueued = false;
        this.needsSceneUpdate = true;
        this.syncScene();
        return;
      }
      this.requestRender();
    };

    const worker = this.ensureBvhWorker();
    const whiteScene = occlusion || this.shadowStage === 'shadow';
    const snapshot = (build: () => void) => {
      if (!whiteScene) {
        build();
        return;
      }
      this.pushWhiteMaterials();
      try {
        this.withOcclusionEnvironment(build);
      } finally {
        this.popWhiteMaterials();
      }
    };
    if (worker != null) {
      pathTracer.setBVHWorker(worker);
      let pending: Promise<unknown> = Promise.resolve();
      snapshot(() => {
        pending = pathTracer.setSceneAsync(scene, pathTracerCamera);
      });
      this.revealOverlays();
      pending
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

    snapshot(() => {
      pathTracer.setScene(scene, pathTracerCamera);
    });
    this.revealOverlays();
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

  private renderPathTracerOutput(
      target: WebGLRenderTarget, renderer: WebGLRenderer,
      quad: FullScreenQuad) {
    if (this.shouldRenderAmbientOcclusionPreview()) {
      return;
    }

    if (!this.options.denoise || this.pathTracer == null ||
        this.pathTracer.samples < this.options.samplesThreshold) {
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

  private updateSceneIfGeometryMoved() {
    if (this.scene == null || this.meshWorldMatrices.size === 0) {
      return;
    }

    this.scene.updateMatrixWorld(true);
    const seenMeshes = new Set<string>();
    let changed = false;

    this.scene.traverseVisible((object: Object3D) => {
      if (!(object as any).isMesh) {
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
      if ((object as any).isMesh) {
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

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

import {initUNetFromURL} from 'oidn-web';
import {Camera, Mesh, Object3D, Scene, Vector2} from 'three';
import {OIDNDenoiser, RANDOM_BLUE_DITHER, RANDOM_PCG, RANDOM_SOBOL, WebGPUPathTracer} from 'three-gpu-pathtracer/webgpu';
import {AVERAGE, CENTER, MeshBVH, SAH} from 'three-mesh-bvh';
import {WebGPURenderer} from 'three/webgpu';

import {downloadIrradianceKernel, installIrradianceKernel, IrradianceKernelTracer, IrradianceKernelUpload, uninstallIrradianceKernel, uploadIrradianceKernel} from './cache/install-irradiance-kernel.js';
import {installShadowCatcher} from './cache/install-shadow-catcher.js';
import {restoreSceneBvh, SerializedBvhMesh} from './cache/path-tracer-bvh-cache.js';
import {PathTracerBVHWorker} from './PathTracerBVHWorker.js';

const OIDN_AUX_WEIGHTS =
    'https://raw.githubusercontent.com/gkjohnson/three-gpu-pathtracer/v0.0.27/example/src/denoise/rt_hdr_alb_nrm.tza';

const BVH_STRATEGY = {
  sah: SAH,
  center: CENTER,
  average: AVERAGE,
} as const;

export type PathTracerRandomName = 'blue-dither'|'sobol'|'pcg';

const RANDOM_STRATEGY = {
  'blue-dither': RANDOM_BLUE_DITHER,
  sobol: RANDOM_SOBOL,
  pcg: RANDOM_PCG,
} as const;

export const PATH_TRACER_UNAVAILABLE_EVENT = 'path-tracer-unavailable';

interface OIDNTileInputs {
  progress?:
      ((output: unknown, tileData: unknown, tile: unknown, index?: number,
        count?: number) => unknown)|null;
}

interface OIDNTileExecutor {
  tileExecute: (inputs: OIDNTileInputs) => unknown;
  tileExecuteWatched?: boolean;
}

/**
 * WebGPU path tracer on its own canvas, stacked over model-viewer's WebGL
 * view. The WebGL renderer keeps drawing the real-time frame. This canvas
 * covers it once samples exist. There is no WebGL path tracer and no second
 * trace implementation: if WebGPU cannot start, state is `unavailable` and
 * the caller keeps the real-time view.
 */
export class WebGPUPathTracerSession {
  readonly canvas: HTMLCanvasElement;
  readonly tiles = new Vector2(1, 1);
  state: 'idle'|'pending'|'ready'|'unavailable' = 'idle';
  reason = '';
  samples = 0;
  sampleMin = 0;
  maxSamples = 0;
  fadeDuration = 1;
  denoiseFailed = false;
  private denoiseTile = 0;
  private denoiseTileCount = 0;
  bounces = 5;
  minSamples = 1;
  renderScale = 1;
  pause = false;
  frameBudget = 4757192;
  multipleImportanceSampling = true;
  randomName: PathTracerRandomName = 'sobol';
  tracedWidth = 0;
  tracedHeight = 0;
  maxTextureSize = 8192;

  private renderer: WebGPURenderer|null = null;
  private tracer: WebGPUPathTracer|null = null;
  private denoiser: OIDNDenoiser|null = null;
  private tracedScene: Scene|null = null;
  private denoiseWanted = false;
  private worker: PathTracerBVHWorker|null = null;
  private buildOptions:
      {strategy: 'sah'|'center'|'average', maxLeafTris: number} = {
        strategy: 'sah',
        maxLeafTris: 1,
      };
  private disposed = false;
  private startPromise: Promise<void>|null = null;
  private bvhRecords: SerializedBvhMesh[]|null = null;
  bvhCacheEnabled = false;
  bvhBuildMs = 0;
  bvhStartedAt: number|null = null;
  bvhFinishedAt: number|null = null;
  prepStartedAt: number|null = null;
  prepFinishedAt: number|null = null;
  traceLoopStartedAt: number|null = null;
  bvhRestored = 0;
  bvhBuilt = 0;
  firstSampleMs: number|null = null;
  convergedMs: number|null = null;
  benchBackend: 'default'|'megakernel' = 'default';
  samplesReadyAt: number|null = null;
  denoiseInvokeAt: number|null = null;
  denoisePassAt: number|null = null;
  denoiseFinishedAt: number|null = null;
  denoiseTileAt: number[] = [];
  denoiseFocus = '';
  denoiseVisibility = '';
  private traceStartedAt = 0;
  private sawSample = false;
  private sawSettled = false;
  private irradianceUpload: IrradianceKernelUpload|null = null;
  private irradianceGeneration = -1;
  private irradianceUploadedGeneration = -2;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'path-tracer-webgpu';
    // The shadow template hides every canvas until it has this class.
    this.canvas.classList.add('show');
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '2';
    this.canvas.style.visibility = 'hidden';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.region = document.createElement('div');
    this.region.style.position = 'absolute';
    this.region.style.pointerEvents = 'none';
    this.region.style.zIndex = '20';
    this.region.style.transform = 'translateZ(1px)';
    this.region.style.boxSizing = 'border-box';
    this.region.style.boxShadow = 'inset 0 0 0 2px #ff4d00';
    this.region.style.display = 'none';
    this.region.setAttribute('aria-hidden', 'true');
  }

  private readonly region: HTMLDivElement;
  private showRegion = false;

  get target(): {width: number, height: number}|null {
    if (this.tracedWidth < 1 || this.tracedHeight < 1 || this.samples <= 0) {
      return null;
    }
    return {width: this.tracedWidth, height: this.tracedHeight};
  }

  setBuildOptions(
      options: {strategy: 'sah'|'center'|'average', maxLeafTris: number}) {
    this.buildOptions = {...options};
  }

  setBVHWorker(worker: PathTracerBVHWorker|null) {
    this.worker = worker;
  }

  setBvhCache(records: SerializedBvhMesh[]|null, enabled: boolean) {
    this.bvhRecords = records;
    this.bvhCacheEnabled = enabled;
  }

  setIrradianceCache(upload: IrradianceKernelUpload|null, generation: number) {
    this.irradianceUpload = upload;
    this.irradianceGeneration = generation;
    if (this.tracedScene != null) {
      this.syncIrradianceKernel();
    }
  }

  async readIrradianceGrid(): Promise<Float32Array|null> {
    const tracer = this.tracer as IrradianceKernelTracer | null;
    const kernel = tracer?._ldIrradianceKernel;
    if (tracer == null || kernel == null) {
      return null;
    }
    return downloadIrradianceKernel(tracer, kernel);
  }

  start(): Promise<void> {
    if (this.startPromise != null) {
      return this.startPromise;
    }
    this.state = 'pending';
    this.startPromise = this.startNow();
    return this.startPromise;
  }

  private async startNow() {
    const gpu = (navigator as Navigator & {
                  gpu?: {
                    requestAdapter: () => Promise<{
                      limits?: {maxTextureDimension2D?: number},
                    }|null>,
                  },
                }).gpu;
    if (gpu == null) {
      this.markUnavailable('WebGPU is not available in this browser');
      return;
    }

    let adapter: {limits?: {maxTextureDimension2D?: number}}|null = null;
    try {
      adapter = await Promise.race([
        gpu.requestAdapter(),
        new Promise<null>((resolve) => {
          window.setTimeout(() => resolve(null), 5000);
        }),
      ]);
    } catch (error) {
      this.markUnavailable(
          error instanceof Error ? error.message : String(error));
      return;
    }
    if (adapter == null || this.disposed) {
      this.markUnavailable('WebGPU did not provide an adapter');
      return;
    }

    const limit = adapter.limits?.maxTextureDimension2D;
    if (typeof limit === 'number' && limit > 0) {
      this.maxTextureSize = limit;
    }

    const root = this.host.shadowRoot ?? this.host;
    const parent = root.querySelector('.slot.canvas') ?? root;
    parent.appendChild(this.canvas);
    parent.appendChild(this.region);

    let renderer: WebGPURenderer;
    try {
      const storageLimit =
          (adapter.limits as {maxStorageBuffersPerShaderStage?: number}|
           undefined)
              ?.maxStorageBuffersPerShaderStage ??
          8;
      renderer = new WebGPURenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        requiredLimits: storageLimit >= 10 ?
            {maxStorageBuffersPerShaderStage: 10} :
            {},
      });
      await renderer.init();
    } catch (error) {
      this.canvas.remove();
      this.region.remove();
      this.markUnavailable(
          error instanceof Error ? error.message :
                                   'WebGPU renderer failed to start');
      return;
    }
    if (this.disposed) {
      renderer.dispose();
      this.canvas.remove();
      this.region.remove();
      return;
    }

    this.renderer = renderer;
    const tracer = new WebGPUPathTracer(renderer);
    tracer.renderDelay = 0;
    tracer.dynamicLowRes = true;
    tracer.synchronizeRenderSize = false;
    this.tracer = tracer;
    installShadowCatcher(tracer as unknown as IrradianceKernelTracer);
    // Bench probe only. Pages leave this unset, so the stock wavefront
    // backend is unchanged. The irradiance cache still swaps in its kernel.
    const benchBackend =
        (globalThis as {__ldBenchBackend?: string}).__ldBenchBackend;
    this.benchBackend = benchBackend === 'megakernel' ? 'megakernel' : 'default';
    this.applyTracerFields(false);
    this.state = 'ready';
    if (this.denoiseWanted) {
      void this.attachDenoiser();
    }
  }

  setDenoise(enabled: boolean) {
    this.denoiseWanted = enabled;
    this.denoiseFailed = false;
    if (!enabled) {
      this.tracer?.setDenoiser(null);
      this.denoiser?.dispose();
      this.denoiser = null;
      this.denoiseTile = 0;
      this.denoiseTileCount = 0;
      return;
    }
    if (this.state === 'ready') {
      void this.attachDenoiser();
    }
  }

  setShowRegion(show: boolean) {
    this.showRegion = show;
    this.region.style.display = show ? 'block' : 'none';
  }

  layout(
      cssWidth: number, cssHeight: number, tracedWidth: number,
      tracedHeight: number, originX = 0, originY = 0, updateRegion = false,
      visible?: {x: number, y: number, width: number, height: number}) {
    this.canvas.style.left = `${originX}px`;
    this.canvas.style.top = `${originY}px`;
    this.canvas.style.right = 'auto';
    this.canvas.style.bottom = 'auto';
    this.canvas.style.width = `${Math.max(1, cssWidth)}px`;
    this.canvas.style.height = `${Math.max(1, cssHeight)}px`;
    if (visible == null) {
      this.canvas.style.clipPath = '';
    } else {
      const top = Math.max(0, visible.y - originY);
      const right =
          Math.max(0, originX + cssWidth - (visible.x + visible.width));
      const bottom =
          Math.max(0, originY + cssHeight - (visible.y + visible.height));
      const left = Math.max(0, visible.x - originX);
      this.canvas.style.clipPath =
          `inset(${top}px ${right}px ${bottom}px ${left}px)`;
    }
    if (updateRegion) {
      if (visible == null) {
        this.placeRegion(originX, originY, cssWidth, cssHeight);
      } else {
        this.placeRegion(visible.x, visible.y, visible.width, visible.height);
      }
    }
    const width = Math.max(1, Math.floor(tracedWidth));
    const height = Math.max(1, Math.floor(tracedHeight));
    if (width === this.tracedWidth && height === this.tracedHeight) {
      return;
    }
    this.tracedWidth = width;
    this.tracedHeight = height;
    this.renderer?.setSize(width, height, false);
    this.tracer?.setSize(width, height);
  }

  private placeRegion(
      originX: number, originY: number, cssWidth: number, cssHeight: number) {
    this.region.style.left = `${originX}px`;
    this.region.style.top = `${originY}px`;
    this.region.style.width = `${Math.max(1, cssWidth)}px`;
    this.region.style.height = `${Math.max(1, cssHeight)}px`;
    this.region.style.display = this.showRegion ? 'block' : 'none';
  }

  show(visible: boolean) {
    this.canvas.style.visibility = visible ? 'visible' : 'hidden';
  }

  setOpacity(opacity: number) {
    const next = Math.min(1, Math.max(0, opacity));
    this.canvas.style.opacity = String(next);
  }

  /**
   * True once the kernel has stopped at maxSamples and, when denoise is on,
   * the OIDN pass has finished. A failed denoiser settles on the raw trace.
   */
  /** performance.now() when the current trace clock started. */
  get traceOriginAt(): number {
    return this.traceStartedAt;
  }

  get traceSettled(): boolean {
    if (this.maxSamples <= 0 || this.sampleMin < this.maxSamples) {
      return false;
    }
    if (!this.denoiseWanted || this.denoiseFailed) {
      return true;
    }
    return this.denoiser?.complete === true;
  }

  /**
   * Sidebar text for the OIDN pass. Empty when denoise is off. Tile counts
   * arrive with the first finished tile; before that the weights may still
   * be loading, so the line says the pass has started.
   */
  get denoiseStatus(): string {
    if (this.denoiseFailed) {
      return 'denoise failed';
    }
    if (!this.denoiseWanted) {
      return '';
    }
    if (this.denoiser?.complete === true) {
      return 'denoise finished';
    }
    if (this.denoiser?.running === true) {
      if (this.denoiseTileCount > 0) {
        return `denoise ${this.denoiseTile}/${this.denoiseTileCount}`;
      }
      return 'denoise started';
    }
    return 'denoise waiting';
  }

  setScene(scene: Object3D, camera: Camera, boundsReady = false) {
    if (!boundsReady) {
      this.prepareBounds(scene, () => this.assignBoundsSync(scene));
    }
    this.tracedScene = scene as Scene;
    this.beginTraceClock();
    this.tracer?.setScene(scene as Scene, camera);
    this.applyBenchBackend();
    this.syncIrradianceKernel();
  }

  private applyBenchBackend() {
    if (this.benchBackend !== 'megakernel') {
      return;
    }
    const tracer = this.tracer as WebGPUPathTracer & {
      useMegakernel?: (enabled: boolean) => void;
      _pathTracer?: {constructor?: {name?: string}};
    };
    if (tracer == null || typeof tracer.useMegakernel !== 'function') {
      return;
    }
    if (tracer._pathTracer?.constructor?.name === 'MegaKernelPathTracer') {
      return;
    }
    tracer.useMegakernel(true);
  }

  async setSceneAsync(scene: Object3D, camera: Camera) {
    await this.prepareBounds(scene, () => this.assignBounds(scene));
    this.setScene(scene, camera, true);
  }

  setCamera(camera: Camera) {
    const tracer = this.tracer;
    if (tracer == null) {
      return;
    }
    tracer.setCamera(camera);
    // setCamera leaves the denoiser on the previous camera. A crop then
    // denoises the beauty pass with full-frame albedo and normals, which
    // comes back purple on glass and other surfaces.
    if (this.tracedScene != null) {
      this.denoiser?.setScene(this.tracedScene, camera);
    }
  }

  updateEnvironment() {
    this.tracer?.updateEnvironment();
  }

  updateMaterials() {
    this.tracer?.updateMaterials();
  }

  updateLights() {
    this.tracer?.updateLights();
  }

  reset() {
    this.samples = 0;
    this.sampleMin = 0;
    this.denoiseTile = 0;
    this.denoiseTileCount = 0;
    this.beginTraceClock();
    this.tracer?.reset();
    this.show(false);
    this.setOpacity(0);
  }

  noteTraceProgress() {
    if (this.traceStartedAt === 0) {
      this.traceStartedAt = performance.now();
    }
    if (!this.sawSample && (this.samples > 0 || this.sampleMin > 0)) {
      this.sawSample = true;
      this.firstSampleMs = performance.now() - this.traceStartedAt;
    }
    if (this.samplesReadyAt == null && this.maxSamples > 0 &&
        this.sampleMin >= this.maxSamples) {
      this.samplesReadyAt = performance.now();
    }
    if (this.denoiseFinishedAt == null && this.denoiser?.complete === true) {
      this.denoiseFinishedAt = performance.now();
      this.denoiseFocus = document.hasFocus() ? 'focus' : 'blur';
      this.denoiseVisibility = document.visibilityState;
    }
    if (!this.sawSettled && this.traceSettled) {
      this.sawSettled = true;
      this.convergedMs = performance.now() - this.traceStartedAt;
    }
  }

  /**
   * The blit that puts the trace on screen uses this WebGPU renderer. The
   * viewer's tone mapping lives on the WebGL renderer, so copy it across or
   * the linear HDR image is only sRGB-encoded and the shadows wash out.
   */
  applyPresentation(toneMapping: number, exposure: number) {
    const renderer = this.renderer as {toneMapping: number, toneMappingExposure: number}|null;
    if (renderer == null) {
      return;
    }
    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = exposure;
  }

  /**
   * A page-coloured backdrop cannot be painted into the trace. Tone mapping
   * moves that colour, so the crop no longer matches the page. Clear the
   * background with alpha 0 and the page shows through the misses unchanged.
   */
  setBackgroundClearAlpha(alpha: number) {
    this.renderer?.setClearColor(0x000000, alpha);
    this.canvas.style.backgroundColor = 'transparent';
  }

  renderSample() {
    const tracer = this.tracer;
    if (tracer == null) {
      return;
    }
    if (this.traceLoopStartedAt == null) {
      this.traceLoopStartedAt = performance.now();
    }
    this.applyTracerFields(false);
    tracer.renderSample();
    void tracer.getSampleCountsAsync().then((counts) => {
      if (!this.disposed) {
        this.samples = counts.avg;
        this.sampleMin = counts.min;
        this.noteTraceProgress();
      }
    });
    this.noteTraceProgress();
  }

  captureDataURL(fileType: string, encoderOptions?: number): string {
    return this.canvas.toDataURL(fileType, encoderOptions);
  }

  dispose() {
    this.disposed = true;
    this.tracer?.setDenoiser(null);
    this.denoiser?.dispose();
    this.denoiser = null;
    this.tracer?.dispose();
    this.tracer = null;
    this.renderer?.dispose();
    this.renderer = null;
    this.canvas.remove();
    this.region.remove();
    this.state = 'idle';
  }

  private markUnavailable(reason: string) {
    if (this.disposed) {
      return;
    }
    this.state = 'unavailable';
    this.reason = reason;
    this.show(false);
  }

  private appliedRandom: PathTracerRandomName|null = null;

  private applyTracerFields(resetOnBounce: boolean) {
    const tracer = this.tracer;
    if (tracer == null) {
      return;
    }
    if (tracer.maxBounces !== this.bounces) {
      tracer.maxBounces = this.bounces;
    } else if (resetOnBounce) {
      tracer.reset();
    }
    tracer.minSamples = this.minSamples;
    tracer.fadeDuration = this.fadeDuration;
    if (tracer.maxSamples !== this.maxSamples) {
      tracer.maxSamples = this.maxSamples;
    }
    tracer.pause = this.pause;
    tracer.frameBudget = this.frameBudget;
    tracer.renderScale = 1;
    tracer.synchronizeRenderSize = false;
    if (tracer.multipleImportanceSampling !== this.multipleImportanceSampling) {
      tracer.setMultipleImportanceSampling(this.multipleImportanceSampling);
    }
    const random = RANDOM_STRATEGY[this.randomName];
    if (this.appliedRandom !== this.randomName) {
      tracer.setRandom(random);
      this.appliedRandom = this.randomName;
    }
  }

  private async attachDenoiser() {
    if (this.tracer == null || this.renderer == null || this.denoiser != null) {
      return;
    }
    try {
      const denoiser = new OIDNDenoiser({
        initUNetFromURL,
        auxWeightsUrl: OIDN_AUX_WEIGHTS,
        useAuxiliaryBuffers: true,
        maxTileSize: 512,
        dynamicTile: false,
      });
      this.watchDenoiseTiles(denoiser);
      this.watchDenoiseClock(denoiser);
      this.denoiser = denoiser;
      this.tracer.setDenoiser(denoiser);
    } catch (error) {
      this.denoiseFailed = true;
      console.warn(
          '[model-viewer] WebGPU path tracer could not attach the OIDN denoiser. The trace stays raw.',
          error);
    }
  }

  private watchDenoiseTiles(denoiser: OIDNDenoiser) {
    const host = denoiser as OIDNDenoiser & {
      _initUNet: (useAuxiliary: boolean) => Promise<OIDNTileExecutor>;
    };
    const init = host._initUNet.bind(host);
    host._initUNet = async (useAuxiliary: boolean) => {
      const unet = await init(useAuxiliary);
      if (unet.tileExecuteWatched === true) {
        return unet;
      }
      const execute = unet.tileExecute.bind(unet);
      unet.tileExecute = (inputs: OIDNTileInputs) => {
        const report = inputs.progress;
        inputs.progress = async (
            output: unknown,
            tileData: unknown,
            tile: unknown,
            index?: number,
            count?: number) => {
          if (typeof index === 'number' && typeof count === 'number') {
            this.denoiseTile = index + 1;
            this.denoiseTileCount = count;
            this.denoiseTileAt.push(performance.now());
          }
          if (report != null) {
            await report(output, tileData, tile, index, count);
          }
        };
        return execute(inputs);
      };
      unet.tileExecuteWatched = true;
      return unet;
    };
  }

  private watchDenoiseClock(denoiser: OIDNDenoiser) {
    const host = denoiser as unknown as {
      update: (target: unknown) => unknown;
      denoise: (...args: unknown[]) => Promise<unknown>;
    };
    const update = host.update.bind(host);
    host.update = (target: unknown) => {
      if (this.denoiseInvokeAt == null && denoiser.complete !== true &&
          denoiser.running !== true) {
        this.denoiseInvokeAt = performance.now();
        this.denoiseFocus = document.hasFocus() ? 'focus' : 'blur';
        this.denoiseVisibility = document.visibilityState;
      }
      return update(target);
    };
    const denoise = host.denoise.bind(host);
    host.denoise = async (...args: unknown[]) => {
      if (this.denoisePassAt == null) {
        this.denoisePassAt = performance.now();
      }
      return denoise(...args);
    };
  }

  private beginTraceClock() {
    this.traceStartedAt = performance.now();
    this.traceLoopStartedAt = null;
    this.sawSample = false;
    this.sawSettled = false;
    this.firstSampleMs = null;
    this.convergedMs = null;
    this.samplesReadyAt = null;
    this.denoiseInvokeAt = null;
    this.denoisePassAt = null;
    this.denoiseFinishedAt = null;
    this.denoiseTileAt = [];
    this.denoiseFocus = '';
    this.denoiseVisibility = '';
  }

  private prepareBounds(scene: Object3D, build: () => void|Promise<void>):
      void|Promise<void> {
    this.bvhRestored = 0;
    if (this.bvhCacheEnabled && this.bvhRecords != null) {
      this.bvhRestored = restoreSceneBvh(scene, this.bvhRecords).restored;
    }
    let pending = 0;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.geometry != null &&
          mesh.geometry.boundsTree == null &&
          mesh.userData?.pathTracerShadowCatcher !== true) {
        pending++;
      }
    });
    this.bvhBuilt = pending;
    const start = performance.now();
    this.bvhStartedAt = start;
    const finish = () => {
      this.bvhFinishedAt = performance.now();
      this.bvhBuildMs = this.bvhFinishedAt - start;
    };
    const result = build();
    if (result != null &&
        typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).then(finish);
    }
    finish();
    return undefined;
  }

  private syncIrradianceKernel() {
    const tracer = this.tracer as IrradianceKernelTracer | null;
    if (tracer == null || this.state !== 'ready') {
      return;
    }
    if (this.irradianceUpload == null) {
      uninstallIrradianceKernel(tracer);
      return;
    }
    const started = performance.now();
    try {
      const kernel = installIrradianceKernel(tracer);
      if (this.irradianceUploadedGeneration !== this.irradianceGeneration) {
        uploadIrradianceKernel(kernel, this.irradianceUpload);
        this.irradianceUploadedGeneration = this.irradianceGeneration;
        return;
      }
      kernel.cacheRead = this.irradianceUpload.read ? 1 : 0;
      kernel.cacheWrite = this.irradianceUpload.write ? 1 : 0;
      if (kernel.peer != null) {
        kernel.peer.cacheWrite = kernel.cacheWrite;
      }
    } catch (error) {
      console.warn(
          '[model-viewer] Path tracer irradiance cache could not attach. Tracing continues without it.',
          error);
      uninstallIrradianceKernel(tracer);
    } finally {
      if (this.prepStartedAt == null) {
        this.prepStartedAt = started;
      }
    }
  }

  private assignBoundsSync(scene: Object3D) {
    const options = this.meshBvhOptions();
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || mesh.geometry == null ||
          mesh.geometry.boundsTree != null) {
        return;
      }
      mesh.geometry.boundsTree = new MeshBVH(mesh.geometry, options);
    });
  }

  private async assignBounds(scene: Object3D) {
    const worker = this.worker;
    const options = this.meshBvhOptions();
    const meshes: Mesh[] = [];
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.geometry != null &&
          mesh.geometry.boundsTree == null) {
        meshes.push(mesh);
      }
    });
    for (const mesh of meshes) {
      const geometry = mesh.geometry;
      if (worker == null) {
        geometry.boundsTree = new MeshBVH(geometry, options);
        continue;
      }
      geometry.boundsTree = await worker.generate(geometry, options);
    }
  }

  private meshBvhOptions() {
    return {
      strategy: BVH_STRATEGY[this.buildOptions.strategy],
      targetLeafSize: this.buildOptions.maxLeafTris,
    };
  }
}

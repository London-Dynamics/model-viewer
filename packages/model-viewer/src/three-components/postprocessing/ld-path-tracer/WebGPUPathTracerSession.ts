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

import {Camera, Mesh, Object3D, Scene, Vector2} from 'three';
import {OIDNDenoiser, RANDOM_BLUE_DITHER, RANDOM_PCG, RANDOM_SOBOL, WebGPUPathTracer} from 'three-gpu-pathtracer/webgpu';
import {initUNetFromURL} from 'oidn-web';
import {AVERAGE, CENTER, MeshBVH, SAH} from 'three-mesh-bvh';
import {WebGPURenderer} from 'three/webgpu';

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
  bounces = 5;
  minSamples = 1;
  renderScale = 1;
  pause = false;
  frameBudget = 250000;
  multipleImportanceSampling = true;
  randomName: PathTracerRandomName = 'blue-dither';
  tracedWidth = 0;
  tracedHeight = 0;
  maxTextureSize = 8192;

  private renderer: WebGPURenderer|null = null;
  private tracer: WebGPUPathTracer|null = null;
  private denoiser: OIDNDenoiser|null = null;
  private denoiseWanted = false;
  private worker: PathTracerBVHWorker|null = null;
  private buildOptions:
      {strategy: 'sah'|'center'|'average', maxLeafTris: number} = {
        strategy: 'sah',
        maxLeafTris: 1,
      };
  private disposed = false;
  private startPromise: Promise<void>|null = null;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'path-tracer-webgpu';
    this.canvas.style.position = 'absolute';
    this.canvas.style.inset = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '2';
    this.canvas.style.visibility = 'hidden';
    this.canvas.setAttribute('aria-hidden', 'true');
  }

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

    let renderer: WebGPURenderer;
    try {
      renderer = new WebGPURenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
      });
      await renderer.init();
    } catch (error) {
      this.canvas.remove();
      this.markUnavailable(
          error instanceof Error ? error.message :
                                   'WebGPU renderer failed to start');
      return;
    }
    if (this.disposed) {
      renderer.dispose();
      this.canvas.remove();
      return;
    }

    this.renderer = renderer;
    const tracer = new WebGPUPathTracer(renderer);
    tracer.renderDelay = 0;
    tracer.dynamicLowRes = true;
    tracer.synchronizeRenderSize = false;
    this.tracer = tracer;
    this.applyTracerFields(false);
    this.state = 'ready';
    if (this.denoiseWanted) {
      void this.attachDenoiser();
    }
  }

  setDenoise(enabled: boolean) {
    this.denoiseWanted = enabled;
    if (!enabled) {
      this.tracer?.setDenoiser(null);
      this.denoiser?.dispose();
      this.denoiser = null;
      return;
    }
    if (this.state === 'ready') {
      void this.attachDenoiser();
    }
  }

  layout(
      cssWidth: number, cssHeight: number, tracedWidth: number,
      tracedHeight: number) {
    this.canvas.style.width = `${Math.max(1, cssWidth)}px`;
    this.canvas.style.height = `${Math.max(1, cssHeight)}px`;
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

  show(visible: boolean) {
    this.canvas.style.visibility = visible ? 'visible' : 'hidden';
  }

  setScene(scene: Object3D, camera: Camera) {
    this.assignBoundsSync(scene);
    this.tracer?.setScene(scene as Scene, camera);
  }

  async setSceneAsync(scene: Object3D, camera: Camera) {
    await this.assignBounds(scene);
    this.setScene(scene, camera);
  }

  setCamera(camera: Camera) {
    this.tracer?.setCamera(camera);
  }

  updateEnvironment() {
    this.tracer?.updateEnvironment();
  }

  updateMaterials() {
    this.tracer?.updateMaterials();
  }

  reset() {
    this.samples = 0;
    this.tracer?.reset();
    this.show(false);
  }

  renderSample() {
    const tracer = this.tracer;
    if (tracer == null) {
      return;
    }
    this.applyTracerFields(false);
    tracer.renderSample();
    void tracer.getSampleCountsAsync().then((counts) => {
      if (!this.disposed) {
        this.samples = counts.avg;
      }
    });
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
      this.denoiser = denoiser;
      this.tracer.setDenoiser(denoiser);
    } catch (error) {
      console.warn(
          '[model-viewer] WebGPU path tracer could not attach the OIDN denoiser. The trace stays raw.',
          error);
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

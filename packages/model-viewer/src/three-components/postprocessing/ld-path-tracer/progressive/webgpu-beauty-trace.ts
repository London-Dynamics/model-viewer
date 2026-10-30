/// <reference types="@webgpu/types" />
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

import {Camera, CanvasTexture, Mesh, MeshBasicMaterial, Scene, SRGBColorSpace, Vector2, WebGLRenderer} from 'three';

import {fitCameraAspect} from './surface-bake.js';

/**
 * Guided OIDN weights. Same-origin, served from the bake cache. A CDN fetch
 * left the denoiser running forever, so the tracer never presented a clean frame.
 */
const AUX_WEIGHTS_PATH = '/bake-cache/rt_hdr_alb_nrm.tza';

/** Same budget the drag-and-drop viewer uses for a desktop frame. */
const FRAME_BUDGET = 250000;

type Denoiser = {
  complete: boolean;
  running: boolean;
};

type GpuTracer = {
  frameBudget: number;
  maxBounces: number;
  maxSamples: number;
  renderScale: number;
  minSamples: number;
  renderDelay: number;
  setRandom(random: object): void;
  setMultipleImportanceSampling(value: boolean): void;
  setDenoiser(denoiser: object|null): void;
  setUpscaler(upscaler: object|null): void;
  setScene(scene: Scene, camera: Camera): void;
  updateCamera(): void;
  updateEnvironment(): void;
  renderSample(): void;
  reset(): void;
  dispose(): void;
  _lastSampleCounts?: {min: number; avg: number;};
};

/**
 * Full beauty trace on the library's WebGPU path tracer: blue-dither
 * sampling, an adaptive frame budget, OIDN, then FSR upscale. The raster
 * view stays on WebGL. This canvas is only the trace picture.
 */
export class WebGPUBeautyTrace {
  readonly canvas = document.createElement('canvas');
  private renderer: {
    setSize(w: number, h: number, updateStyle?: boolean): void;
    dispose(): void;
    toneMapping: number;
    toneMappingExposure: number;
    outputColorSpace: string;
  }|null = null;
  private tracer: GpuTracer|null = null;
  private texture: CanvasTexture|null = null;
  private starting: Promise<boolean>|null = null;
  private failed = false;
  private disposed = false;
  private boundScene: Scene|null = null;
  private cameraStamp = '';
  private environmentStamp = '';
  private readonly standIn = new MeshBasicMaterial({visible: false});
  private denoise = true;
  private denoiser: Denoiser|null = null;
  presented = false;
  samples = 0;

  /** True once the sample cap is reached and OIDN, when enabled, has finished. */
  settled(): boolean {
    if (this.failed) {
      return true;
    }
    if (this.tracer == null || this.samples < this.tracer.maxSamples) {
      return false;
    }
    if (!this.denoise || this.denoiser == null) {
      return true;
    }
    return this.denoiser.complete;
  }

  private denoiseBusy(): boolean {
    if (this.denoiser == null || this.tracer == null) {
      return false;
    }
    if (this.denoiser.running) {
      return true;
    }
    return this.samples >= this.tracer.maxSamples && !this.denoiser.complete;
  }

  canStart(): boolean {
    return !this.failed && typeof navigator !== 'undefined' &&
        navigator.gpu != null;
  }

  get active(): boolean {
    return this.tracer != null;
  }

  /** Begin GPU init. Later calls are cheap once the tracer exists. */
  start(
      width: number, height: number, bounces: number, samples: number,
      denoise: boolean, renderScale: number) {
    if (this.tracer != null || this.starting != null || !this.canStart()) {
      return;
    }
    this.starting = this.boot(width, height, bounces, samples, denoise, renderScale)
        .catch((error: unknown) => {
          console.warn(
              '[model-viewer] WebGPU beauty trace is unavailable.', error);
          this.failed = true;
          this.starting = null;
          return false;
        });
  }

  private async boot(
      width: number, height: number, bounces: number, samples: number,
      denoise: boolean, renderScale: number): Promise<boolean> {
    const [{WebGPURenderer}, gpu, oidn, upscaler] = await Promise.all([
      import('three/webgpu'),
      import('three-gpu-pathtracer/webgpu'),
      import('oidn-web'),
      import('@pmndrs/upscaler'),
    ]);
    const adapter = await navigator.gpu.requestAdapter();
    const requiredLimits: Record<string, number> = {};
    const limits = adapter?.limits;
    if (limits != null) {
      for (const key of ['maxBufferSize', 'maxStorageBufferBindingSize'] as const) {
        const value = limits[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          requiredLimits[key] = value;
        }
      }
    }
    const info = (adapter as {info?: {description?: string; architecture?: string; vendor?: string;}}|null)?.info;
    console.info(
        '[model-viewer] WebGPU adapter',
        info?.description ?? info?.architecture ?? info?.vendor ?? 'ready');
    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
      requiredLimits,
    } as object);
    await renderer.init();
    renderer.setSize(width, height, false);
    const pathTracer = new gpu.WebGPUPathTracer(renderer) as GpuTracer;
    pathTracer.frameBudget = FRAME_BUDGET;
    pathTracer.maxBounces = Math.max(1, bounces);
    pathTracer.maxSamples = Math.max(1, samples);
    pathTracer.renderScale = Math.min(1, Math.max(0.1, renderScale));
    pathTracer.minSamples = 1;
    pathTracer.renderDelay = 0;
    pathTracer.setRandom(gpu.RANDOM_BLUE_DITHER);
    pathTracer.setMultipleImportanceSampling(true);
    this.denoise = denoise;
    if (denoise) {
      const weights = new URL(AUX_WEIGHTS_PATH, location.href).toString();
      const denoiser = new gpu.OIDNDenoiser({
        initUNetFromURL: oidn.initUNetFromURL,
        auxWeightsUrl: weights,
        maxTileSize: 512,
        dynamicTile: false,
      });
      this.denoiser = denoiser;
      pathTracer.setDenoiser(denoiser);
    }
    pathTracer.setUpscaler(new gpu.FSRUpscaler({
      Upscaler: upscaler.Upscaler,
      sharpness: 1,
    }));
    if (this.disposed) {
      pathTracer.dispose();
      renderer.dispose();
      this.starting = null;
      return false;
    }
    this.renderer = renderer;
    this.tracer = pathTracer;
    this.starting = null;
    return true;
  }

  private cameraKey(camera: Camera): string {
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    const projection = camera.projectionMatrix.elements;
    const quantize = (value: number) => Math.round(value * 1000) / 1000;
    return `${quantize(world[12])},${quantize(world[13])},${quantize(world[14])},${quantize(projection[0])},${quantize(projection[5])},${quantize(projection[10])}`;
  }

  private rememberCamera(camera: Camera) {
    const stamp = this.cameraKey(camera);
    if (stamp === this.cameraStamp || this.tracer == null || this.denoiseBusy()) {
      return;
    }
    this.cameraStamp = stamp;
    this.tracer.updateCamera();
    this.samples = 0;
  }

  /**
   * The WebGPU tracer writes every material in the scene graph, hidden ones
   * included, and reads .color from each. Shader-only helpers such as the
   * soft shadow's blur plane have none, so they get a stand-in while the
   * scene is bound.
   */
  private withTraceableMaterials<T>(scene: Scene, fn: () => T): T {
    const swapped: Array<[Mesh, Mesh['material']]> = [];
    scene.traverse((object) => {
      const mesh = object as Mesh;
      const material = mesh.material;
      if (material == null) {
        return;
      }
      const list = Array.isArray(material) ? material : [material];
      if (list.some((entry) => entry != null && (entry as MeshBasicMaterial).color == null)) {
        swapped.push([mesh, material]);
        mesh.material = this.standIn;
      }
    });
    try {
      return fn();
    } finally {
      for (const [mesh, material] of swapped) {
        mesh.material = material;
      }
    }
  }

  private environmentKey(scene: Scene) {
    const rotation = scene.environmentRotation;
    const quantize = (value: number) => Math.round(value * 1e4) / 1e4;
    return `${scene.environment?.uuid ?? ''},${quantize(scene.environmentIntensity)},${quantize(rotation.x)},${quantize(rotation.y)},${quantize(rotation.z)}`;
  }

  /** Environment intensity or rotation changed: same BVH, new lighting. */
  private rememberEnvironment(scene: Scene) {
    const stamp = this.environmentKey(scene);
    if (stamp === this.environmentStamp || this.tracer == null || this.denoiseBusy()) {
      return;
    }
    this.environmentStamp = stamp;
    this.tracer.updateEnvironment();
    this.samples = 0;
  }

  /** One frame of the viewer path. -1 while the GPU device is still opening. */
  sample(
      scene: Scene, camera: Camera, gl: WebGLRenderer, bounces: number,
      samples: number, denoise: boolean, renderScale: number): number {
    const size = new Vector2();
    gl.getDrawingBufferSize(size);
    const width = Math.max(1, size.x);
    const height = Math.max(1, size.y);
    fitCameraAspect(camera, width, height);
    this.start(width, height, bounces, samples, denoise, renderScale);
    if (this.tracer == null) {
      return -1;
    }
    this.renderer?.setSize(width, height, false);
    this.matchOutput(gl);
    const nextBounces = Math.max(1, bounces);
    const nextSamples = Math.max(1, samples);
    if (this.tracer.maxBounces !== nextBounces) {
      this.tracer.maxBounces = nextBounces;
    }
    if (this.tracer.maxSamples !== nextSamples) {
      this.tracer.maxSamples = nextSamples;
    }
    this.tracer.renderScale = Math.min(1, Math.max(0.1, renderScale));
    if (this.boundScene !== scene) {
      if (!this.denoiseBusy()) {
        this.withTraceableMaterials(scene, () => this.tracer!.setScene(scene, camera));
        this.boundScene = scene;
        this.cameraStamp = this.cameraKey(camera);
        this.environmentStamp = this.environmentKey(scene);
        this.presented = false;
        this.samples = 0;
      }
    } else {
      this.rememberCamera(camera);
      this.rememberEnvironment(scene);
    }
    const started = performance.now();
    this.tracer.renderSample();
    this.presented = true;
    const count = this.tracer._lastSampleCounts?.min ?? 0;
    if (count > this.samples) {
      this.samples = count;
    }
    return performance.now() - started;
  }

  /**
   * The canvas is the final picture: the WebGPU present applies the WebGL
   * view's tone mapping and exposure and encodes sRGB, so the composite must
   * read it as sRGB and not tone map it again.
   */
  private matchOutput(gl: WebGLRenderer) {
    const renderer = this.renderer;
    if (renderer == null) {
      return;
    }
    renderer.toneMapping = gl.toneMapping;
    renderer.toneMappingExposure = gl.toneMappingExposure;
    renderer.outputColorSpace = SRGBColorSpace;
  }

  outputTexture(): CanvasTexture|null {
    if (!this.presented) {
      return null;
    }
    if (this.texture == null) {
      this.texture = new CanvasTexture(this.canvas);
      this.texture.colorSpace = SRGBColorSpace;
    }
    this.texture.needsUpdate = true;
    return this.texture;
  }

  reset() {
    this.tracer?.reset();
    this.presented = false;
    this.samples = 0;
    this.boundScene = null;
    this.environmentStamp = '';
  }

  dispose() {
    this.disposed = true;
    this.tracer?.dispose();
    this.renderer?.dispose();
    this.texture?.dispose();
    this.standIn.dispose();
    this.tracer = null;
    this.renderer = null;
    this.texture = null;
    this.presented = false;
  }
}

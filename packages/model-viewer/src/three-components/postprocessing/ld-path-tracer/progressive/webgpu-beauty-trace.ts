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

import {Camera, CanvasTexture, LinearSRGBColorSpace, Scene, Vector2, WebGLRenderer} from 'three';

/**
 * Guided OIDN weights shipped with three-gpu-pathtracer 0.0.27's viewer.
 * The library does not bundle them.
 */
const AUX_WEIGHTS_URL =
    'https://cdn.jsdelivr.net/gh/gkjohnson/three-gpu-pathtracer@0.0.27/example/src/denoise/rt_hdr_alb_nrm.tza';

/** Same budget the drag-and-drop viewer uses for a desktop frame. */
const FRAME_BUDGET = 250000;

type GpuTracer = {
  frameBudget: number;
  maxBounces: number;
  maxSamples: number;
  renderScale: number;
  minSamples: number;
  renderDelay: number;
  setRandom(random: object): void;
  setDenoiser(denoiser: object|null): void;
  setUpscaler(upscaler: object|null): void;
  setScene(scene: Scene, camera: Camera): void;
  updateCamera(): void;
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
  private renderer: {setSize(w: number, h: number, updateStyle?: boolean): void; dispose(): void;}|null = null;
  private tracer: GpuTracer|null = null;
  private texture: CanvasTexture|null = null;
  private starting: Promise<boolean>|null = null;
  private failed = false;
  private boundScene: Scene|null = null;
  private cameraStamp = '';
  presented = false;
  samples = 0;

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
    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: false,
    });
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
    if (denoise) {
      pathTracer.setDenoiser(new gpu.OIDNDenoiser({
        initUNetFromURL: oidn.initUNetFromURL,
        auxWeightsUrl: AUX_WEIGHTS_URL,
        maxTileSize: 512,
        dynamicTile: false,
      }));
    }
    pathTracer.setUpscaler(new gpu.FSRUpscaler({
      Upscaler: upscaler.Upscaler,
      sharpness: 1,
    }));
    this.renderer = renderer;
    this.tracer = pathTracer;
    this.starting = null;
    return true;
  }

  private cameraKey(camera: Camera): string {
    camera.updateMatrixWorld();
    const world = camera.matrixWorld.elements;
    const projection = camera.projectionMatrix.elements;
    return `${world[12]},${world[13]},${world[14]},${projection[0]},${projection[5]},${projection[10]}`;
  }

  private rememberCamera(camera: Camera) {
    const stamp = this.cameraKey(camera);
    if (stamp === this.cameraStamp || this.tracer == null) {
      this.cameraStamp = stamp;
      return;
    }
    this.cameraStamp = stamp;
    this.tracer.updateCamera();
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
    this.start(width, height, bounces, samples, denoise, renderScale);
    if (this.tracer == null) {
      return -1;
    }
    this.renderer?.setSize(width, height, false);
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
      this.tracer.setScene(scene, camera);
      this.boundScene = scene;
      this.cameraStamp = this.cameraKey(camera);
      this.presented = false;
      this.samples = 0;
    } else {
      this.rememberCamera(camera);
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

  outputTexture(): CanvasTexture|null {
    if (!this.presented) {
      return null;
    }
    if (this.texture == null) {
      this.texture = new CanvasTexture(this.canvas);
      this.texture.colorSpace = LinearSRGBColorSpace;
    }
    this.texture.needsUpdate = true;
    return this.texture;
  }

  reset() {
    this.tracer?.reset();
    this.presented = false;
    this.samples = 0;
    this.boundScene = null;
  }

  dispose() {
    this.tracer?.dispose();
    this.renderer?.dispose();
    this.texture?.dispose();
    this.tracer = null;
    this.renderer = null;
    this.texture = null;
    this.presented = false;
  }
}

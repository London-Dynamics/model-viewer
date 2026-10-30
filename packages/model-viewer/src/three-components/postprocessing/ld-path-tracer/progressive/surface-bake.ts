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

import {BufferAttribute, Camera, ClampToEdgeWrapping, DataTexture, FloatType, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter, NoColorSpace, NoToneMapping, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RGBAFormat, RenderTarget, Scene, UnsignedByteType, Vector3} from 'three';

import {dilateFactor, pushPullFill} from './atlas-plan.js';

/**
 * Atlas camera the WebGPU path tracer already calls for a primary ray.
 * uv is the lightmap texel. Origin is the stored position plus a normal
 * bias, direction points outward along that normal, and an empty texel
 * returns false. An inward ray self-hits and the texel stays black.
 */
export type AtlasBakeCamera = 'getCameraRay';

/** Same desktop budget the drag-and-drop viewer uses for one frame. */
const FRAME_BUDGET = 250000;

/**
 * 1 cm along the stored normal, on the outside. The ray then leaves along
 * that same normal. 2 mm aimed back in was a self-hit, and the texel
 * stayed at the cleared black.
 */

/** Guided OIDN weights. The harness serves this from the bake cache. */
const AUX_WEIGHTS_PATH = '/bake-cache/rt_hdr_alb_nrm.tza';

export interface AtlasStages {
  bvh: number;
  samples: number;
  denoise: number;
  readback: number;
}

type Denoiser = {
  complete: boolean;
  running: boolean;
  texture: {isTexture?: boolean}|null;
  init(renderer: unknown): void;
  update(target: unknown): unknown;
  denoise(color: unknown, albedo?: unknown, normal?: unknown): Promise<void>;
  dispose(): void;
};

type GpuTracer = {
  frameBudget: number;
  maxBounces: number;
  maxTransparentBounces: number;
  maxSamples: number;
  reset(): void;
  renderScale: number;
  minSamples: number;
  renderDelay: number;
  dynamicLowRes: boolean;
  synchronizeRenderSize: boolean;
  target: unknown;
  setRandom(random: object): void;
  setMultipleImportanceSampling(value: boolean): void;
  setDenoiser(denoiser: Denoiser|null): void;
  setScene(scene: Scene, camera: object): void;
  updateMaterials(): void;
  updateEnvironment(): void;
  setSize(x: number, y: number): void;
  renderSample(): void;
  useMegakernel(value: boolean): void;
  getSampleCountsAsync(): Promise<{min: number; max: number; avg: number;}>;
  dispose(): void;
  _lastSampleCounts?: {min: number; avg: number;};
};

type GpuRenderer = {
  toneMapping: number;
  outputColorSpace: string;
  init(): Promise<void>;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setRenderTarget(target: RenderTarget|null): void;
  render(scene: Scene, camera: OrthographicCamera): void;
  dispose(): void;
  backend: {
    device?: {queue: {onSubmittedWorkDone(): Promise<void>;}};
    copyTextureToBuffer(texture: unknown, x: number, y: number, width: number, height: number, faceIndex: number): Promise<ArrayBufferView>;
  };
  readRenderTargetPixelsAsync(target: RenderTarget, x: number, y: number, width: number, height: number): Promise<ArrayBufferView>;
  domElement: HTMLCanvasElement;
};

/**
 * Scatter world position and normal into one sample per uv1 texel.
 * Each record is xyz, normal xyz, uv. Empty charts are simply absent.
 */
export function packSurface(root: Object3D, resolution: number):
    {surface: Float32Array; count: number;} {
  const size = Math.max(1, resolution);
  const grid = new Int32Array(size * size);
  grid.fill(-1);
  const surface = new Float32Array(size * size * 8);
  let count = 0;
  const tmp = new Vector3();
  const nrm = new Vector3();
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const geometry = mesh.geometry;
    const uv = geometry.getAttribute('uv1') as BufferAttribute | undefined;
    const position = geometry.getAttribute('position') as BufferAttribute |
        undefined;
    const normal = geometry.getAttribute('normal') as BufferAttribute |
        undefined;
    const index = geometry.getIndex();
    if (uv == null || position == null) {
      return;
    }
    const triCount = index != null ? Math.floor(index.count / 3) :
                                      Math.floor(position.count / 3);
    mesh.updateWorldMatrix(true, false);
    const world = mesh.matrixWorld;
    for (let tri = 0; tri < triCount; tri++) {
      const i0 = index != null ? index.getX(tri * 3) : tri * 3;
      const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
      const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
      const u0 = uv.getX(i0);
      const v0 = uv.getY(i0);
      const u1 = uv.getX(i1);
      const v1 = uv.getY(i1);
      const u2 = uv.getX(i2);
      const v2 = uv.getY(i2);
      const minX = Math.max(0, Math.floor(Math.min(u0, u1, u2) * size));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(u0, u1, u2) * size));
      const minY = Math.max(0, Math.floor(Math.min(v0, v1, v2) * size));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(v0, v1, v2) * size));
      const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
      if (Math.abs(denom) < 1e-8) {
        continue;
      }
      const bary = (pu: number, pv: number): [number, number, number] => {
        const w0 = ((v1 - v2) * (pu - u2) + (u2 - u1) * (pv - v2)) / denom;
        const w1 = ((v2 - v0) * (pu - u2) + (u0 - u2) * (pv - v2)) / denom;
        return [w0, w1, 1 - w0 - w1];
      };
      const covers = (w: [number, number, number]) =>
        w[0] >= -1e-4 && w[1] >= -1e-4 && w[2] >= -1e-4;
      const p0x = position.getX(i0);
      const p0y = position.getY(i0);
      const p0z = position.getZ(i0);
      const p1x = position.getX(i1);
      const p1y = position.getY(i1);
      const p1z = position.getZ(i1);
      const p2x = position.getX(i2);
      const p2y = position.getY(i2);
      const p2z = position.getZ(i2);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const pu = (x + 0.5) / size;
          const pv = (y + 0.5) / size;
          let [w0, w1, w2] = bary(pu, pv);
          if (!covers([w0, w1, w2])) {
            // The centre sits just outside, but the bilinear footprint of a
            // seam still reads this texel. Keep it when the triangle touches
            // the texel, and clamp the sample onto the triangle.
            const x0 = x / size;
            const x1 = (x + 1) / size;
            const y0 = y / size;
            const y1 = (y + 1) / size;
            const touched = covers(bary(x0, y0)) || covers(bary(x1, y0)) ||
                covers(bary(x0, y1)) || covers(bary(x1, y1)) ||
                (u0 >= x0 && u0 <= x1 && v0 >= y0 && v0 <= y1) ||
                (u1 >= x0 && u1 <= x1 && v1 >= y0 && v1 <= y1) ||
                (u2 >= x0 && u2 <= x1 && v2 >= y0 && v2 <= y1);
            if (!touched) {
              continue;
            }
            w0 = Math.max(0, w0);
            w1 = Math.max(0, w1);
            w2 = Math.max(0, w2);
            const sum = w0 + w1 + w2 || 1;
            w0 /= sum;
            w1 /= sum;
            w2 /= sum;
          }
          const slot = y * size + x;
          if (grid[slot] !== -1) {
            continue;
          }
          tmp.set(
                  p0x * w0 + p1x * w1 + p2x * w2,
                  p0y * w0 + p1y * w1 + p2y * w2,
                  p0z * w0 + p1z * w1 + p2z * w2)
              .applyMatrix4(world);
          if (normal != null) {
            nrm.set(
                    normal.getX(i0) * w0 + normal.getX(i1) * w1 +
                        normal.getX(i2) * w2,
                    normal.getY(i0) * w0 + normal.getY(i1) * w1 +
                        normal.getY(i2) * w2,
                    normal.getZ(i0) * w0 + normal.getZ(i1) * w1 +
                        normal.getZ(i2) * w2)
                .transformDirection(world)
                .normalize();
          } else {
            nrm.set(0, 1, 0);
          }
          const o = count * 8;
          surface[o] = tmp.x;
          surface[o + 1] = tmp.y;
          surface[o + 2] = tmp.z;
          surface[o + 3] = nrm.x;
          surface[o + 4] = nrm.y;
          surface[o + 5] = nrm.z;
          surface[o + 6] = pu;
          surface[o + 7] = pv;
          grid[slot] = count;
          count++;
        }
      }
    }
  });
  const packed = new Float32Array(Math.max(8, count * 8));
  packed.set(surface.subarray(0, count * 8));
  return {surface: packed, count};
}

/**
 * UV-space shadow / occlusion atlas on WebGPUPathTracer.
 *
 * The primary ray comes from getCameraRay. There is no WebGL path tracer
 * and no FSR upscale. OIDN is guided by the atlas (white albedo and the
 * stored normals), not by a camera raster of the scene.
 */
export class AtlasBake {
  readonly camera: AtlasBakeCamera = 'getCameraRay';
  readonly stages: AtlasStages = {bvh: -1, samples: -1, denoise: -1, readback: -1};
  /** One renderSample is one wavefront step. sceneBuilds stays 1 after boot. */
  readonly frames = {
    count: 0,
    cpuMsMax: 0,
    cpuMsMean: 0,
    gpuMsMax: 0,
    gpuMsMean: 0,
    sceneBuilds: 0,
    bounces: 0,
    frameBudget: 0,
    filled: 0,
    pixels: 0,
  };

  private ready = false;
  private failed = false;
  private locked = false;
  private starting: Promise<boolean>|null = null;
  private surface: Float32Array|null = null;
  private surfaceCount = 0;
  private resolution = 0;
  private scene: Scene|null = null;
  private sampleTarget = 16;
  /** Few bounces, not the beauty trace's 15. Two never escaped the cabinet. */
  private bounceTarget = 4;
  private cpuMsSum = 0;
  private gpuMsSum = 0;
  private loggedSamples = -1;
  private denoiseStarted = false;
  private denoiseTask: Promise<void>|null = null;
  beforeCrop: {x: number; y: number; size: number; rgba: Uint8ClampedArray;}|null = null;
  afterCrop: {x: number; y: number; size: number; rgba: Uint8ClampedArray;}|null = null;
  /** Normalised chart texels before gutter dilation, so a seam crop can show the crack. */
  crackFactor: Float32Array|null = null;
  private constantUp = false;
  /**
   * 'authored' shoots along the mesh normal, like a Cycles bake. 'centroid'
   * flips every texel when most normals face the model centre.
   */
  normalMode: 'authored'|'centroid' = 'authored';
  /**
   * 'sky' divides each texel by the unoccluded irradiance for its normal
   * (order-2 SH of the environment), so the atlas is a shadow ratio that
   * multiplies the real-time IBL. 'peak' divides by the 98th percentile.
   */
  normalize: 'sky'|'peak' = 'sky';
  private normalData: Float32Array|null = null;
  /**
   * 1 traces the authored side only. 2 traces half the samples along +n and
   * half along -n and keeps the brighter sky ratio, which lets light from
   * under a thin panel show on its top face, so it is opt-in.
   */
  sides: 1|2 = 1;
  /**
   * Metres the atlas ray starts off the surface. It must stay well under the
   * thinnest panel, or origins on one face land past the opposite face.
   */
  normalBias = 0.0005;
  private sidePass = 0;
  private flipping: Promise<void>|null = null;
  private frontRaw: Float32Array|null = null;
  private preRatio = false;
  private normalTexture: DataTexture|null = null;
  private albedoTex: unknown = null;
  private guideTex: unknown = null;
  private samples = 0;
  private factorData: Float32Array|null = null;
  private reading: Promise<void>|null = null;
  private renderer: GpuRenderer|null = null;
  private tracer: GpuTracer|null = null;
  private denoiser: Denoiser|null = null;
  private white: MeshStandardMaterial|null = null;
  private startedAt = 0;

  /** True once the WebGPU atlas camera is installed. A bare instance is not. */
  get implemented(): boolean {
    return this.ready;
  }

  /** GPU missing or the device failed. The pipeline then keeps shader AO. */
  get unavailable(): boolean {
    return this.failed;
  }

  /**
   * CPU stamp. Eight floats per texel: world position, world normal, uv.
   * Ignored once the device has started.
   */
  setSurface(surface: Float32Array, count: number, resolution: number) {
    if (this.locked) {
      return;
    }
    this.surface = surface;
    this.surfaceCount = count;
    this.resolution = Math.max(1, Math.floor(resolution));
  }

  /** Open the device and install getCameraRay. Later calls are ignored. */
  start(scene: Scene, samples = 16, bounces = 2) {
    this.scene = scene;
    this.sampleTarget = Math.max(1, samples);
    this.bounceTarget = Math.max(1, bounces);
    if (this.tracer != null || this.starting != null || this.failed) {
      return;
    }
    if (this.surface == null || this.surfaceCount <= 0 || this.resolution <= 0) {
      return;
    }
    if (typeof navigator === 'undefined' || navigator.gpu == null) {
      this.failed = true;
      return;
    }
    this.locked = true;
    this.starting = this.boot().catch((error: unknown) => {
      console.warn('[model-viewer] WebGPU atlas bake is unavailable.', error);
      this.failed = true;
      this.starting = null;
      this.ready = false;
      return false;
    });
  }

  /** One tracer frame. Zero until the atlas camera is installed. */
  step(): number {
    if (!this.ready || this.tracer == null || this.failed) {
      return 0;
    }
    if (this.factorData != null) {
      return this.samples;
    }
    if (this.denoiseStarted) {
      return this.samples;
    }
    if (this.reading == null && this.flipping == null) {
      const started = performance.now();
      this.tracer.renderSample();
      this.noteCpu(performance.now() - started);
    }
    return this.samples;
  }

  /**
   * One wavefront step, then yield. Waiting on onSubmittedWorkDone deadlocked
   * against the tracer's sample-count readback, so the page stopped after a
   * few samples. The step itself is the budgeted dispatch.
   */
  async syncFrame(): Promise<{ms: number; samples: number;}> {
    if (this.denoiseTask != null) {
      await this.denoiseTask;
      return {ms: 0, samples: this.samples};
    }
    const started = performance.now();
    const samples = this.step();
    const ms = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 0));
    this.gpuMsSum += ms;
    this.frames.gpuMsMax = Math.max(this.frames.gpuMsMax, ms);
    this.frames.gpuMsMean = this.gpuMsSum / Math.max(1, this.frames.count);
    if (this.frames.count <= 8 || samples !== this.loggedSamples) {
      this.loggedSamples = samples;
      console.info('FRAME', JSON.stringify({
        n: this.frames.count,
        cpuMs: Math.round(ms * 10) / 10,
        samples,
        bounces: this.frames.bounces,
        frameBudget: this.frames.frameBudget,
        filled: this.frames.filled,
        pixels: this.frames.pixels,
        sceneBuilds: this.frames.sceneBuilds,
      }));
    }
    return {ms, samples};
  }

  /** Ignore the atlas and shoot straight up. Isolates the environment from the texel lookup. */
  useConstantUpRay() {
    this.constantUp = true;
  }

  /** Stop sampling and denoise whatever is in the target. */
  forceDenoise() {
    this.samples = Math.max(this.samples, this.sampleTarget);
    this.beginDenoise();
  }

  /** One readback, only while sampling is paused, so it cannot stall the next dispatch. */
  async measure(): Promise<number> {
    if (this.tracer == null) {
      return this.samples;
    }
    await this.renderer?.backend.device?.queue.onSubmittedWorkDone();
    const counts = await this.tracer.getSampleCountsAsync();
    if (this.flipping != null) {
      return this.reportedSamples();
    }
    if (counts.min > this.samples) {
      this.samples = counts.min;
    }
    if (this.samples >= this.passTarget()) {
      this.beginDenoise();
    }
    return this.reportedSamples();
  }

  private passTarget(): number {
    return this.sides === 2 ? Math.max(1, Math.ceil(this.sampleTarget / 2)) :
                              this.sampleTarget;
  }

  private reportedSamples(): number {
    if (this.sides !== 2) {
      return this.samples;
    }
    return this.sidePass === 0 ? Math.min(this.samples, this.passTarget() - 1) :
                                 this.passTarget() + this.samples;
  }

  /** Keep the +n pass, flip the atlas normals and trace again. */
  private async flipSide() {
    const tracer = this.tracer;
    const normals = this.normalData;
    if (tracer == null || normals == null || this.normalTexture == null) {
      this.sides = 1;
      this.flipping = null;
      this.beginDenoise();
      return;
    }
    const started = performance.now();
    await this.renderer?.backend.device?.queue.onSubmittedWorkDone();
    this.frontRaw = await this.copyFloatTarget(tracer.target);
    for (let i = 0; i < normals.length; i += 4) {
      normals[i] = -normals[i];
      normals[i + 1] = -normals[i + 1];
      normals[i + 2] = -normals[i + 2];
    }
    this.normalTexture.needsUpdate = true;
    tracer.reset();
    this.samples = 0;
    this.sidePass = 1;
    console.info('SIDE_FLIP', JSON.stringify({
      atMs: Math.round(performance.now() - this.startedAt),
      ms: Math.round(performance.now() - started),
    }));
    this.flipping = null;
  }

  private beginDenoise() {
    if (this.denoiseStarted || this.denoiser == null || this.tracer == null) {
      return;
    }
    if (this.sides === 2 && this.sidePass === 0) {
      if (this.flipping == null) {
        this.flipping = this.flipSide();
      }
      return;
    }
    this.denoiseStarted = true;
    if (this.stages.samples < 0) {
      this.stages.samples = Math.round(performance.now() - this.startedAt);
      console.info('STAGE_SAMPLES', this.stages.samples, 'frames', this.frames.count);
    }
    this.denoiseTask = this.runDenoise();
  }

  private async runDenoise() {
    const denoiser = this.denoiser;
    const tracer = this.tracer;
    const renderer = this.renderer;
    if (denoiser == null || tracer == null || renderer == null) {
      this.failed = true;
      return;
    }
    const target = tracer.target as {width?: number; height?: number;};
    console.info('DENOISE_TARGET', target?.width ?? 0, target?.height ?? 0);
    const raw = await this.copyFloatTarget(target);
    this.combineSides(raw);
    const crop = pickCrop(raw, this.resolution, 320);
    const scale = cropScale(raw, this.resolution, crop);
    this.beforeCrop = paintCrop(raw, this.resolution, crop, scale);
    console.info('OIDN_CROP', crop.x, crop.y, crop.size, scale);
    const fillStarted = performance.now();
    const mask = this.mask ?? new Uint8Array(this.resolution * this.resolution);
    const finite = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) {
      finite[i] = mask[i] === 1 && Number.isFinite(raw[i]) ? 1 : 0;
    }
    const filled = pushPullFill(raw, finite, this.resolution);
    const color = this.filledColorTexture(filled);
    this.fillGuide(finite);
    console.info('PUSH_PULL', Math.round(performance.now() - fillStarted));
    const started = performance.now();
    let promiseMs = -1;
    let promiseError: unknown = null;
    const promised = denoiser.denoise(color, this.albedoTex, this.guideTex)
        .then(() => {
          promiseMs = performance.now() - started;
          console.info('OIDN_PROMISE', JSON.stringify({
            ms: Math.round(promiseMs),
            complete: denoiser.complete,
            running: denoiser.running,
          }));
        })
        .catch((error: unknown) => {
          promiseError = error;
        });
    const deadline = started + 120000;
    while (!denoiser.complete) {
      if (promiseError != null) {
        console.warn('[model-viewer] WebGPU atlas denoise failed.', promiseError);
        this.failed = true;
        this.ready = false;
        return;
      }
      if (performance.now() > deadline) {
        console.info('OIDN_STUCK', JSON.stringify({
          running: denoiser.running,
          complete: denoiser.complete,
          ms: Math.round(performance.now() - started),
        }));
        this.failed = true;
        this.ready = false;
        return;
      }
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    await promised;
    await renderer.backend.device?.queue.onSubmittedWorkDone();
    const ms = performance.now() - started;
    let execution: unknown = null;
    try {
      const unets = (denoiser as unknown as {
        _unets?: {aux?: Promise<{_lastExecution?: unknown;}>;};
      })._unets;
      const unet = await unets?.aux;
      execution = unet?._lastExecution ?? null;
    } catch {
      execution = null;
    }
    this.stages.denoise = Math.round(ms);
    console.info('OIDN_DONE', JSON.stringify({
      ms: Math.round(ms),
      promiseMs: Math.round(promiseMs),
      execution,
    }));
    if (ms < 100) {
      console.info('OIDN_TOO_FAST', Math.round(ms));
    }
    if (denoiser.texture == null) {
      console.info('OIDN_NO_TEXTURE');
      this.failed = true;
      this.ready = false;
      return;
    }
    const denoised = await this.copyFloatTarget(denoiser.texture);
    this.afterCrop = paintCrop(denoised, this.resolution, crop, scale);
    await this.readFactor(denoised);
  }

  /** raw holds the -n pass. Replace it with max(+n, -n) sky ratios. */
  private combineSides(raw: Float32Array) {
    const front = this.frontRaw;
    const normals = this.normalData;
    const mask = this.mask;
    if (front == null || normals == null || mask == null) {
      return;
    }
    const sh = irradianceSH(this.scene?.environment ?? null,
                            this.scene?.environmentIntensity ?? 1);
    if (sh == null) {
      for (let i = 0; i < raw.length; i++) {
        if (Number.isFinite(front[i]) && !(raw[i] >= front[i])) {
          raw[i] = front[i];
        }
      }
      console.info('SIDES_COMBINED', JSON.stringify({sky: false}));
      return;
    }
    const started = performance.now();
    const back = new Float32Array(mask.length);
    const forward = new Float32Array(mask.length);
    let skyMax = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 1) {
        continue;
      }
      const x = normals[i * 4];
      const y = normals[i * 4 + 1];
      const z = normals[i * 4 + 2];
      back[i] = irradianceLum(sh, x, y, z);
      forward[i] = irradianceLum(sh, -x, -y, -z);
      skyMax = Math.max(skyMax, back[i], forward[i]);
    }
    const floor = Math.max(1e-4, skyMax * 0.02);
    let backWins = 0;
    let count = 0;
    let sum = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] !== 1) {
        continue;
      }
      const f = Number.isFinite(front[i]) ? front[i] / Math.max(forward[i], floor) : NaN;
      const b = Number.isFinite(raw[i]) ? raw[i] / Math.max(back[i], floor) : NaN;
      let value = Number.isFinite(f) ? f : b;
      if (Number.isFinite(b) && b > value) {
        value = b;
        backWins++;
      }
      raw[i] = Math.min(1, Math.max(0, value));
      if (Number.isFinite(raw[i])) {
        sum += raw[i];
        count++;
      }
      normals[i * 4] = -normals[i * 4];
      normals[i * 4 + 1] = -normals[i * 4 + 1];
      normals[i * 4 + 2] = -normals[i * 4 + 2];
    }
    this.preRatio = true;
    this.frontRaw = null;
    console.info('SIDES_COMBINED', JSON.stringify({
      sky: true,
      backWins,
      count,
      mean: count ? sum / count : 0,
      skyMax,
      ms: Math.round(performance.now() - started),
    }));
  }

  private filledColorTexture(filled: Float32Array): DataTexture {
    const resolution = this.resolution;
    const rgba = new Float32Array(resolution * resolution * 4);
    for (let i = 0; i < filled.length; i++) {
      const value = Number.isFinite(filled[i]) ? filled[i] : 0;
      const offset = i * 4;
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = value;
      rgba[offset + 3] = 1;
    }
    const texture = new DataTexture(rgba, resolution, resolution, RGBAFormat, FloatType);
    texture.colorSpace = NoColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.wrapS = ClampToEdgeWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.flipY = false;
    texture.needsUpdate = true;
    return texture;
  }

  /** Nearest-chart normals in the gutter, so the guided filter has no zero normal. */
  private fillGuide(valid: Uint8Array) {
    const guide = this.guideTex as DataTexture|null;
    const data = guide?.image?.data as Uint8Array|undefined;
    if (guide == null || data == null) {
      return;
    }
    const resolution = this.resolution;
    const texels = resolution * resolution;
    const nx = new Float32Array(texels);
    const ny = new Float32Array(texels);
    const nz = new Float32Array(texels);
    for (let i = 0; i < texels; i++) {
      if (valid[i] !== 1) {
        continue;
      }
      const offset = i * 4;
      nx[i] = data[offset] / 255 * 2 - 1;
      ny[i] = data[offset + 1] / 255 * 2 - 1;
      nz[i] = data[offset + 2] / 255 * 2 - 1;
    }
    const fx = pushPullFill(nx, valid, resolution);
    const fy = pushPullFill(ny, valid, resolution);
    const fz = pushPullFill(nz, valid, resolution);
    for (let i = 0; i < texels; i++) {
      let x = fx[i];
      let y = fy[i];
      let z = fz[i];
      const len = Math.hypot(x, y, z) || 1;
      x /= len;
      y /= len;
      z /= len;
      const offset = i * 4;
      data[offset] = Math.round((x * 0.5 + 0.5) * 255);
      data[offset + 1] = Math.round((y * 0.5 + 0.5) * 255);
      data[offset + 2] = Math.round((z * 0.5 + 0.5) * 255);
      data[offset + 3] = 255;
    }
    guide.needsUpdate = true;
  }

  private async copyFloatTarget(source: unknown): Promise<Float32Array> {
    const resolution = this.resolution;
    const renderer = this.renderer!;
    let pixels: ArrayBufferView;
    try {
      pixels = await renderer.backend.copyTextureToBuffer(
          source as never, 0, 0, resolution, resolution, 0);
    } catch (error) {
      console.warn('[model-viewer] Direct atlas read failed, blitting.', error);
      pixels = await this.blitRead(renderer, source, resolution);
    }
    const out = new Float32Array(resolution * resolution);
    const bytesPerTexel = pixels instanceof Float32Array ? 16 : 8;
    const rowBytes = Math.ceil((resolution * bytesPerTexel) / 256) * 256;
    const stride = rowBytes / (pixels instanceof Float32Array ? 4 : 2);
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        out[y * resolution + x] = luminance(pixels, y * stride + x * 4);
      }
    }
    return out;
  }

  private noteCpu(ms: number) {
    this.frames.count += 1;
    this.cpuMsSum += ms;
    this.frames.cpuMsMax = Math.max(this.frames.cpuMsMax, ms);
    this.frames.cpuMsMean = this.cpuMsSum / this.frames.count;
    if (this.frames.count <= 6) {
      console.info('FRAME_CPU', JSON.stringify({
        n: this.frames.count,
        ms: Math.round(ms * 10) / 10,
        sceneBuilds: this.frames.sceneBuilds,
      }));
    }
  }

  /**
   * One factor per texel, -1 where the chart is empty. Null until OIDN
   * has finished and the atlas has been read back. Not the presented canvas.
   */
  factor(): Float32Array|null {
    return this.factorData;
  }

  dispose() {
    this.failed = true;
    this.ready = false;
    this.tracer?.dispose();
    this.denoiser?.dispose();
    this.renderer?.dispose();
    this.white?.dispose();
    this.tracer = null;
    this.denoiser = null;
    this.renderer = null;
    this.white = null;
    this.factorData = null;
  }

  private weightsUrl(): string {
    if (typeof location === 'undefined') {
      return AUX_WEIGHTS_PATH;
    }
    return new URL(AUX_WEIGHTS_PATH, location.href).toString();
  }

  private async boot(): Promise<boolean> {
    const resolution = this.resolution;
    const scene = this.scene;
    const surface = this.surface;
    if (scene == null || surface == null) {
      this.failed = true;
      return false;
    }
    const rasterStart = performance.now();
    const baked = this.texturesFromSurface(surface, this.surfaceCount, resolution);
    this.normalData = baked.normalData;
    this.normalTexture = baked.normal;
    console.info('STAGE_RASTER', Math.round(performance.now() - rasterStart), this.surfaceCount);

    const [{WebGPURenderer}, gpu, oidn, tsl, bvh] = await Promise.all([
      import('three/webgpu'),
      import('three-gpu-pathtracer/webgpu'),
      import('oidn-web'),
      import('three/tsl'),
      import('three-mesh-bvh/webgpu') as Promise<unknown> as Promise<{
        wgslTagFn: (tokens: TemplateStringsArray, ...args: unknown[]) => unknown;
        rayStruct: unknown;
      }>,
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
        '[model-viewer] WebGPU atlas adapter',
        info?.description ?? info?.architecture ?? info?.vendor ?? 'ready');

    const canvas = document.createElement('canvas');
    const renderer = new WebGPURenderer({
      canvas,
      antialias: false,
      requiredLimits,
    } as object) as unknown as GpuRenderer;
    await renderer.init();
    renderer.setSize(resolution, resolution, false);
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;

    const pathTracer = new gpu.WebGPUPathTracer(renderer as never) as unknown as GpuTracer;
    pathTracer.frameBudget = FRAME_BUDGET;
    pathTracer.maxBounces = this.bounceTarget;
    pathTracer.maxTransparentBounces = 1;
    pathTracer.maxSamples = this.sampleTarget;
    pathTracer.renderScale = 1;
    // minSamples > 0 makes renderSample tally the whole atlas every frame.
    pathTracer.minSamples = 0;
    pathTracer.renderDelay = 0;
    pathTracer.dynamicLowRes = false;
    pathTracer.synchronizeRenderSize = false;
    pathTracer.setSize(resolution, resolution);
    pathTracer.setRandom(gpu.RANDOM_BLUE_DITHER);
    pathTracer.setMultipleImportanceSampling(true);
    // One frameBudget of pixels per step. The wavefront slot pool stopped
    // launching rays after two samples on this atlas.
    pathTracer.useMegakernel(true);
    pathTracer.setMultipleImportanceSampling(true);
    pathTracer.maxBounces = this.bounceTarget;
    pathTracer.maxTransparentBounces = 1;
    pathTracer.maxSamples = this.sampleTarget;
    pathTracer.frameBudget = FRAME_BUDGET;
    pathTracer.minSamples = 0;
    pathTracer.renderDelay = 0;
    pathTracer.dynamicLowRes = false;
    pathTracer.synchronizeRenderSize = false;
    pathTracer.setSize(resolution, resolution);

    const denoiser = new gpu.OIDNDenoiser({
      initUNetFromURL: oidn.initUNetFromURL,
      auxWeightsUrl: this.weightsUrl(),
      maxTileSize: 512,
      dynamicTile: false,
    }) as Denoiser;
    // Not passed to setDenoiser. That path read the whole atlas back on every
    // frame and the read stalled the next dispatch. init() only loads weights.
    denoiser.init(renderer);
    this.albedoTex = baked.albedo;
    this.guideTex = baked.guide;
    this.denoiser = denoiser;

    const posNode = tsl.texture(baked.position);
    const nrmNode = tsl.texture(baked.normal);
    const rayCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const atlasCamera = rayCamera as OrthographicCamera & {
      getCameraRayFn: () => {update: () => boolean; fn: unknown;};
    };
    atlasCamera.matrixWorld = new Matrix4();
    atlasCamera.getCameraRayFn = () => ({
      update() {
        return false;
      },
      fn: bvh.wgslTagFn/* wgsl */ `
        fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${bvh.rayStruct}> ) -> bool {
          ${this.constantUp ? `(*ray).origin = vec3f(0.0, 5.0, 0.0);
          (*ray).direction = vec3f(0.0, 1.0, 0.0);
          (*ray).maxDist = 0.0;
          return true;` : ''}
          let pixel = vec2i(uv * resolution);
          // The atlas stamp stores v = 0 in row 0. The wavefront pixel's v
          // grows downward, so read the stamp from the opposite row.
          let sampleAt = vec2i(pixel.x, i32(resolution.y) - 1 - pixel.y);
          let stored = textureLoad( ${posNode}, sampleAt, 0 );
          if ( stored.a < 0.5 ) {
            return false;
          }
          let normal = normalize( textureLoad( ${nrmNode}, sampleAt, 0 ).xyz );
          (*ray).origin = stored.xyz + normal * ${this.normalBias.toFixed(6)};
          // The tracer jitters uv by a fresh rand2 per sample, so the
          // sub-texel offset is two uniforms. Spend them on a cosine lobe:
          // the texel then averages irradiance, not the one radiance along n.
          let xi = fract( uv * resolution );
          let radius = sqrt( xi.x );
          let phi = 6.28318530718 * xi.y;
          let helper = select( vec3f( 1.0, 0.0, 0.0 ), vec3f( 0.0, 1.0, 0.0 ), abs( normal.x ) > 0.9 );
          let tangent = normalize( cross( helper, normal ) );
          let bitangent = cross( normal, tangent );
          (*ray).direction = normalize( tangent * ( radius * cos( phi ) ) +
              bitangent * ( radius * sin( phi ) ) +
              normal * sqrt( max( 0.0, 1.0 - xi.x ) ) );
          (*ray).maxDist = 0.0;
          return true;
        }
      `,
    });

    const saved: Array<{mesh: Mesh; material: Mesh['material'];}> = [];
    const white = new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 1,
      metalness: 0,
    });
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) {
        return;
      }
      if (mesh.userData?.noHit === true ||
          mesh.userData?.progressiveOverlay === true ||
          mesh.userData?.pathTracerShadowCatcher === true) {
        return;
      }
      saved.push({mesh, material: mesh.material});
      mesh.material = white;
    });
    this.startedAt = performance.now();
    this.frames.sceneBuilds += 1;
    try {
      pathTracer.setScene(scene, atlasCamera);
      // A primary miss samples the background, not the environment. With no
      // background that miss is the clear color, which is black, so an
      // outward ray under open sky never becomes light.
      const previousBackground = scene.background;
      if (scene.background == null && scene.environment != null) {
        scene.background = scene.environment;
      }
      pathTracer.updateMaterials();
      pathTracer.updateEnvironment();
      scene.background = previousBackground;
    } finally {
      for (const entry of saved) {
        entry.mesh.material = entry.material;
      }
    }
    pathTracer.synchronizeRenderSize = false;
    pathTracer.setSize(resolution, resolution);
    this.stages.bvh = Math.round(performance.now() - this.startedAt);
    this.frames.bounces = this.bounceTarget;
    this.frames.frameBudget = pathTracer.frameBudget;
    this.frames.filled = this.surfaceCount;
    this.frames.pixels = resolution * resolution;
    console.info('STAGE_BVH', this.stages.bvh);
    console.info('BAKE_PLAN', JSON.stringify({
      bounces: this.bounceTarget,
      backend: 'megakernel',
      frameBudget: pathTracer.frameBudget,
      slots: Math.min(pathTracer.frameBudget, resolution * resolution),
      pixels: this.frames.pixels,
      filled: this.frames.filled,
      fill: this.frames.filled / this.frames.pixels,
      emptySkipped: this.frames.pixels - this.frames.filled,
      sceneBuilds: this.frames.sceneBuilds,
    }));

    this.white = white;
    this.renderer = renderer;
    this.tracer = pathTracer;
    this.denoiser = denoiser;
    this.mask = baked.mask;
    this.starting = null;
    this.ready = true;
    return true;
  }

  private mask: Uint8Array|null = null;

  private texturesFromSurface(
      surface: Float32Array, count: number, resolution: number) {
    const texels = resolution * resolution;
    const position = new Float32Array(texels * 4);
    const normal = new Float32Array(texels * 4);
    const guide = new Uint8Array(texels * 4);
    const albedoData = new Uint8Array(texels * 4);
    albedoData.fill(255);
    const mask = new Uint8Array(texels);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      cx += surface[i * 8];
      cy += surface[i * 8 + 1];
      cz += surface[i * 8 + 2];
    }
    const inv = count > 0 ? 1 / count : 0;
    cx *= inv;
    cy *= inv;
    cz *= inv;
    let away = 0;
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const dot = (surface[o] - cx) * surface[o + 3] +
          (surface[o + 1] - cy) * surface[o + 4] +
          (surface[o + 2] - cz) * surface[o + 5];
      if (dot > 0) {
        away++;
      }
    }
    const flipNormals =
        this.normalMode === 'centroid' && count > 0 && away < count * 0.5;
    console.info('NORMALS', JSON.stringify({
      away,
      count,
      mode: this.normalMode,
      flipOutward: flipNormals,
    }));
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const u = surface[o + 6];
      const v = surface[o + 7];
      const x = Math.min(resolution - 1, Math.max(0, Math.floor(u * resolution)));
      const y = Math.min(resolution - 1, Math.max(0, Math.floor(v * resolution)));
      const slot = y * resolution + x;
      const p = slot * 4;
      position[p] = surface[o];
      position[p + 1] = surface[o + 1];
      position[p + 2] = surface[o + 2];
      position[p + 3] = 1;
      const sign = flipNormals ? -1 : 1;
      normal[p] = surface[o + 3] * sign;
      normal[p + 1] = surface[o + 4] * sign;
      normal[p + 2] = surface[o + 5] * sign;
      normal[p + 3] = 1;
      guide[p] = Math.round((normal[p] * 0.5 + 0.5) * 255);
      guide[p + 1] = Math.round((normal[p + 1] * 0.5 + 0.5) * 255);
      guide[p + 2] = Math.round((normal[p + 2] * 0.5 + 0.5) * 255);
      guide[p + 3] = 255;
      mask[slot] = 1;
    }
    const positionTex = new DataTexture(position, resolution, resolution, RGBAFormat, FloatType);
    positionTex.magFilter = NearestFilter;
    positionTex.minFilter = NearestFilter;
    positionTex.wrapS = ClampToEdgeWrapping;
    positionTex.wrapT = ClampToEdgeWrapping;
    positionTex.flipY = false;
    positionTex.needsUpdate = true;
    const normalTex = new DataTexture(normal, resolution, resolution, RGBAFormat, FloatType);
    normalTex.magFilter = NearestFilter;
    normalTex.minFilter = NearestFilter;
    normalTex.wrapS = ClampToEdgeWrapping;
    normalTex.wrapT = ClampToEdgeWrapping;
    normalTex.flipY = false;
    normalTex.needsUpdate = true;
    const guideTex = new DataTexture(guide, resolution, resolution, RGBAFormat, UnsignedByteType);
    guideTex.magFilter = NearestFilter;
    guideTex.minFilter = NearestFilter;
    guideTex.flipY = false;
    guideTex.needsUpdate = true;
    const albedo = new DataTexture(albedoData, resolution, resolution, RGBAFormat, UnsignedByteType);
    albedo.magFilter = NearestFilter;
    albedo.minFilter = NearestFilter;
    albedo.flipY = false;
    albedo.needsUpdate = true;
    return {position: positionTex, normal: normalTex, guide: guideTex, albedo, mask, normalData: normal};
  }

  private async readFactor(grid?: Float32Array) {
    const renderer = this.renderer;
    const tracer = this.tracer;
    const denoiser = this.denoiser;
    const mask = this.mask;
    const resolution = this.resolution;
    if (renderer == null || tracer == null || mask == null) {
      this.failed = true;
      return;
    }
    const started = performance.now();
    let pixels: ArrayBufferView|null = null;
    if (grid == null) {
      const denoised = denoiser?.complete === true ? denoiser.texture : null;
      const source = denoised ?? tracer.target;
      try {
        pixels = await renderer.backend.copyTextureToBuffer(
            source, 0, 0, resolution, resolution, 0);
      } catch (directError) {
        console.warn('[model-viewer] Direct atlas read failed, blitting.', directError);
        pixels = await this.blitRead(renderer, source, resolution);
      }
    }

    const factor = new Float32Array(resolution * resolution);
    factor.fill(-1);
    const lums: number[] = [];
    let rawMaxUnclamped = 0;
    const bytesPerTexel = pixels instanceof Float32Array ? 16 : 8;
    const rowBytes = pixels == null ? 0 :
        Math.ceil((resolution * bytesPerTexel) / 256) * 256;
    const stride = pixels == null ? 0 :
        rowBytes / (pixels instanceof Float32Array ? 4 : 2);
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const slot = y * resolution + x;
        if (mask[slot] !== 1) {
          continue;
        }
        const lum = grid != null
          ? grid[slot]
          : luminance(pixels as ArrayBufferView, y * stride + x * 4);
        if (!Number.isFinite(lum)) {
          continue;
        }
        rawMaxUnclamped = Math.max(rawMaxUnclamped, lum);
        const clamped = Math.min(lum, 8);
        factor[slot] = clamped;
        lums.push(clamped);
      }
    }
    lums.sort((a, b) => a - b);
    let rawSum = 0;
    for (let i = 0; i < lums.length; i++) {
      rawSum += lums[i];
    }
    const rawMean = lums.length === 0 ? 0 : rawSum / lums.length;
    const rawMax = lums.length === 0 ? 0 : lums[lums.length - 1];
    const peak = lums.length === 0 ? 1 :
        Math.max(1e-4, lums[Math.min(lums.length - 1, Math.floor(lums.length * 0.98))]);
    console.info('RAW_LUM', JSON.stringify({
      count: lums.length,
      mean: rawMean,
      max: rawMaxUnclamped,
      clampedMax: rawMax,
      peak,
    }));
    const sh = this.normalize === 'sky' && !this.preRatio ?
        irradianceSH(this.scene?.environment ?? null,
                     this.scene?.environmentIntensity ?? 1) :
        null;
    const normals = this.normalData;
    if (sh != null && normals != null) {
      const shStart = performance.now();
      let ratioSum = 0;
      let ratioCount = 0;
      let skyMax = 0;
      for (let i = 0; i < factor.length; i++) {
        if (factor[i] >= 0) {
          skyMax = Math.max(skyMax, irradianceLum(sh, normals[i * 4], normals[i * 4 + 1], normals[i * 4 + 2]));
        }
      }
      const floor = Math.max(1e-4, skyMax * 0.02);
      for (let i = 0; i < factor.length; i++) {
        if (factor[i] >= 0) {
          const sky = irradianceLum(sh, normals[i * 4], normals[i * 4 + 1], normals[i * 4 + 2]);
          factor[i] = Math.min(1, Math.max(0, factor[i] / Math.max(sky, floor)));
          ratioSum += factor[i];
          ratioCount++;
        }
      }
      console.info('SKY_RATIO', JSON.stringify({
        mean: ratioCount ? ratioSum / ratioCount : 0,
        skyMax,
        floor,
        ms: Math.round(performance.now() - shStart),
      }));
    } else {
      const divisor = this.preRatio ? 1 : peak;
      for (let i = 0; i < factor.length; i++) {
        if (factor[i] >= 0) {
          factor[i] = Math.min(1, Math.max(0, factor[i] / divisor));
        }
      }
    }
    // Gutters are still empty here. Dilate only the denoised chart texels,
    // after the blit, so the filter's own padding is what sampling reads.
    this.crackFactor = factor.slice();
    const emptyBefore = countEmpty(factor);
    dilateFactor(factor, resolution, 8);
    console.info('DILATE_AFTER_READBACK', JSON.stringify({
      radius: 8,
      emptyBefore,
      emptyAfter: countEmpty(factor),
    }));
    this.factorData = factor;
    this.stages.readback = Math.round(performance.now() - started);
    let peakSeen = 0;
    let lit = 0;
    for (let i = 0; i < factor.length; i++) {
      if (factor[i] > 0) {
        lit++;
        peakSeen = Math.max(peakSeen, factor[i]);
      }
    }
    let covered = 0;
    for (let i = 0; i < factor.length; i++) {
      if (factor[i] >= 0) {
        covered++;
      }
    }
    console.info(
        'STAGE_READBACK', this.stages.readback, 'lit', lit, 'peak', peakSeen,
        'coverage', covered / factor.length);
  }

  private async blitRead(renderer: GpuRenderer, source: unknown, resolution: number): Promise<ArrayBufferView> {
    const target = new RenderTarget(resolution, resolution, {
      type: FloatType,
      format: RGBAFormat,
      depthBuffer: false,
      colorSpace: LinearSRGBColorSpace,
    });
    const geometry = new PlaneGeometry(2, 2);
    const uv = geometry.getAttribute('uv') as BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setY(i, 1 - uv.getY(i));
    }
    const material = new MeshBasicMaterial({
      map: source as MeshBasicMaterial['map'],
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(geometry, material);
    const blit = new Scene();
    blit.add(quad);
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const previousTone = renderer.toneMapping;
    const previousSpace = renderer.outputColorSpace;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setRenderTarget(target);
    renderer.render(blit, camera);
    renderer.setRenderTarget(null);
    renderer.toneMapping = previousTone;
    renderer.outputColorSpace = previousSpace;
    const pixels = await renderer.readRenderTargetPixelsAsync(
        target, 0, 0, resolution, resolution);
    target.dispose();
    material.dispose();
    geometry.dispose();
    return pixels;
  }
}

const pickCrop = (
    grid: Float32Array, resolution: number, size: number,
): {x: number; y: number; size: number;} => {
  let bestX = 0;
  let bestY = 0;
  let best = -1;
  const step = 64;
  for (let y = 0; y + size <= resolution; y += step) {
    for (let x = 0; x + size <= resolution; x += step) {
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let yy = y; yy < y + size; yy += 4) {
        for (let xx = x; xx < x + size; xx += 4) {
          const value = grid[yy * resolution + xx];
          if (!Number.isFinite(value) || value <= 0) continue;
          sum += value;
          sum2 += value * value;
          n++;
        }
      }
      if (n < 20) continue;
      const mean = sum / n;
      const variance = sum2 / n - mean * mean;
      if (variance > best) {
        best = variance;
        bestX = x;
        bestY = y;
      }
    }
  }
  return {x: bestX, y: bestY, size};
};

const cropScale = (
    grid: Float32Array, resolution: number,
    crop: {x: number; y: number; size: number;},
): number => {
  const values: number[] = [];
  for (let y = crop.y; y < crop.y + crop.size; y++) {
    for (let x = crop.x; x < crop.x + crop.size; x++) {
      const value = grid[y * resolution + x];
      if (Number.isFinite(value) && value > 0) values.push(Math.min(value, 8));
    }
  }
  values.sort((a, b) => a - b);
  const hi = values.length
    ? values[Math.min(values.length - 1, Math.floor(values.length * 0.98))]
    : 1;
  return hi > 1e-4 ? hi : 1;
};

const paintCrop = (
    grid: Float32Array, resolution: number,
    crop: {x: number; y: number; size: number;}, scale: number,
): {x: number; y: number; size: number; rgba: Uint8ClampedArray;} => {
  const rgba = new Uint8ClampedArray(crop.size * crop.size * 4);
  for (let y = 0; y < crop.size; y++) {
    for (let x = 0; x < crop.size; x++) {
      const value = grid[(crop.y + y) * resolution + crop.x + x];
      const byte = Math.round(
          Math.min(1, Math.max(0, (Number.isFinite(value) ? value : 0) / scale)) * 255);
      const offset = (y * crop.size + x) * 4;
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = byte;
      rgba[offset + 3] = 255;
    }
  }
  return {x: crop.x, y: crop.y, size: crop.size, rgba};
};

const countEmpty = (value: Float32Array): number => {
  let empty = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] < 0) {
      empty++;
    }
  }
  return empty;
};

/**
 * Order-2 SH irradiance of an equirect environment (Ramamoorthi and
 * Hanrahan), already convolved with the cosine lobe. 9 x RGB.
 */
const irradianceSH = (env: unknown, intensity: number): Float32Array|null => {
  const texture = env as {image?: {data?: ArrayBufferView; width?: number; height?: number;}}|null;
  const image = texture?.image;
  const data = image?.data;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (data == null || width <= 0 || height <= 0) {
    return null;
  }
  const isFloat = data instanceof Float32Array;
  const half = data instanceof Uint16Array;
  if (!isFloat && !half) {
    return null;
  }
  const channels = (data as Float32Array).length / (width * height);
  const read = (index: number) => isFloat ? (data as Float32Array)[index] :
                                            halfToFloat((data as Uint16Array)[index]);
  const sh = new Float64Array(27);
  const step = Math.max(1, Math.floor(width / 512));
  const dPhi = (2 * Math.PI / width) * step;
  const dTheta = (Math.PI / height) * step;
  for (let row = 0; row < height; row += step) {
    // Row 0 is the top of the file. HDRLoader flips on upload, so it is +Y.
    const lat = Math.PI / 2 - ((row + 0.5) / height) * Math.PI;
    const cosLat = Math.cos(lat);
    const y = Math.sin(lat);
    const weight = dPhi * dTheta * cosLat;
    for (let col = 0; col < width; col += step) {
      const phi = ((col + 0.5) / width - 0.5) * 2 * Math.PI;
      const x = Math.cos(phi) * cosLat;
      const z = Math.sin(phi) * cosLat;
      const o = (row * width + col) * channels;
      const r = read(o) * weight;
      const g = read(o + 1) * weight;
      const b = read(o + 2) * weight;
      const basis = shBasis(x, y, z);
      for (let k = 0; k < 9; k++) {
        sh[k * 3] += r * basis[k];
        sh[k * 3 + 1] += g * basis[k];
        sh[k * 3 + 2] += b * basis[k];
      }
    }
  }
  const band = [Math.PI, 2 * Math.PI / 3, 2 * Math.PI / 3, 2 * Math.PI / 3,
                Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4];
  const out = new Float32Array(27);
  for (let k = 0; k < 9; k++) {
    for (let c = 0; c < 3; c++) {
      // Irradiance over pi: the radiance a white Lambertian surface returns.
      out[k * 3 + c] = sh[k * 3 + c] * band[k] * intensity / Math.PI;
    }
  }
  return out;
};

const shBasis = (x: number, y: number, z: number): number[] => [
  0.282095,
  0.488603 * y,
  0.488603 * z,
  0.488603 * x,
  1.092548 * x * y,
  1.092548 * y * z,
  0.315392 * (3 * z * z - 1),
  1.092548 * x * z,
  0.546274 * (x * x - y * y),
];

const irradianceLum = (sh: Float32Array, x: number, y: number, z: number): number => {
  const basis = shBasis(x, y, z);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let k = 0; k < 9; k++) {
    r += sh[k * 3] * basis[k];
    g += sh[k * 3 + 1] * basis[k];
    b += sh[k * 3 + 2] * basis[k];
  }
  return Math.max(0, 0.2126 * r + 0.7152 * g + 0.0722 * b);
};

const luminance = (pixels: ArrayBufferView, offset: number): number => {
  if (pixels instanceof Float32Array) {
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const view = pixels as unknown as Uint16Array;
  const r = halfToFloat(view[offset]);
  const g = halfToFloat(view[offset + 1]);
  const b = halfToFloat(view[offset + 2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const halfToFloat = (half: number): number => {
  const sign = (half & 0x8000) >> 15;
  const exponent = (half & 0x7c00) >> 10;
  const fraction = half & 0x03ff;
  if (exponent === 0) {
    return (sign ? -1 : 1) * Math.pow(2, -14) * (fraction / 1024);
  }
  if (exponent === 0x1f) {
    return fraction ? NaN : (sign ? -Infinity : Infinity);
  }
  return (sign ? -1 : 1) * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
};

/**
 * The view camera must match the pixels it is drawn into. Resizing the
 * renderer to the atlas (a square) and then to the panel without this
 * leaves the model squashed.
 */
export function fitCameraAspect(camera: Camera, width: number, height: number) {
  const view = camera as PerspectiveCamera;
  if (view.isPerspectiveCamera !== true || !(height > 0)) {
    return;
  }
  const aspect = width / height;
  if (Math.abs(view.aspect - aspect) < 1e-4) {
    return;
  }
  view.aspect = aspect;
  view.updateProjectionMatrix();
}

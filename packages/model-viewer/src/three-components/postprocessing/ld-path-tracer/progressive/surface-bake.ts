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

import {BufferAttribute, Camera, ClampToEdgeWrapping, DataTexture, FloatType, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter, NoToneMapping, Object3D, OrthographicCamera, PerspectiveCamera, PlaneGeometry, RGBAFormat, RenderTarget, Scene, UnsignedByteType, Vector3} from 'three';

import {dilateFactor} from './atlas-plan.js';

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
const NORMAL_BIAS = 0.01;

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
          const w0 = ((v1 - v2) * (pu - u2) + (u2 - u1) * (pv - v2)) / denom;
          const w1 = ((v2 - v0) * (pu - u2) + (u0 - u2) * (pv - v2)) / denom;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) {
            continue;
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
  private constantUp = false;
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
      if (this.denoiser?.complete && this.reading == null) {
        this.reading = this.finishRead();
      }
      return this.samples;
    }
    if (this.reading == null) {
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
    if (counts.min > this.samples) {
      this.samples = counts.min;
    }
    if (this.samples >= this.sampleTarget) {
      this.beginDenoise();
    }
    return this.samples;
  }

  private beginDenoise() {
    if (this.denoiseStarted || this.denoiser == null || this.tracer == null) {
      return;
    }
    this.denoiseStarted = true;
    if (this.stages.samples < 0) {
      this.stages.samples = Math.round(performance.now() - this.startedAt);
      console.info('STAGE_SAMPLES', this.stages.samples, 'frames', this.frames.count);
    }
    const target = this.tracer.target as {width?: number; height?: number;};
    console.info('DENOISE_TARGET', target?.width ?? 0, target?.height ?? 0);
    this.denoiser.denoise(target, this.albedoTex, this.guideTex).then(() => {
      if (this.stages.denoise < 0) {
        this.stages.denoise = Math.round(performance.now() - this.startedAt);
        console.info('STAGE_DENOISE', this.stages.denoise);
      }
    }).catch((error: unknown) => {
      console.warn('[model-viewer] WebGPU atlas denoise failed.', error);
      this.failed = true;
      this.ready = false;
    });
  }

  private finishRead(): Promise<void> {
    return this.readFactor().catch((error: unknown) => {
      console.warn('[model-viewer] WebGPU atlas readback failed.', error);
      this.failed = true;
      this.ready = false;
    });
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
          (*ray).origin = stored.xyz + normal * ${NORMAL_BIAS};
          (*ray).direction = normal;
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
    const flipNormals = count > 0 && away < count * 0.5;
    console.info('NORMALS', JSON.stringify({
      away,
      count,
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
    return {position: positionTex, normal: normalTex, guide: guideTex, albedo, mask};
  }

  private async readFactor() {
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
    const denoised = denoiser?.complete === true ? denoiser.texture : null;
    const source = denoised ?? tracer.target;
    let pixels: ArrayBufferView;
    try {
      pixels = await renderer.backend.copyTextureToBuffer(
          source, 0, 0, resolution, resolution, 0);
    } catch (directError) {
      console.warn('[model-viewer] Direct atlas read failed, blitting.', directError);
      pixels = await this.blitRead(renderer, source, resolution);
    }

    const factor = new Float32Array(resolution * resolution);
    factor.fill(-1);
    const lums: number[] = [];
    let rawMaxUnclamped = 0;
    const bytesPerTexel = pixels instanceof Float32Array ? 16 : 8;
    const rowBytes = Math.ceil((resolution * bytesPerTexel) / 256) * 256;
    const stride = rowBytes / (pixels instanceof Float32Array ? 4 : 2);
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const slot = y * resolution + x;
        if (mask[slot] !== 1) {
          continue;
        }
        const o = y * stride + x * 4;
        const lum = luminance(pixels, o);
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
    for (let i = 0; i < factor.length; i++) {
      if (factor[i] >= 0) {
        factor[i] = Math.min(1, Math.max(0, factor[i] / peak));
      }
    }
    dilateFactor(factor, resolution);
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

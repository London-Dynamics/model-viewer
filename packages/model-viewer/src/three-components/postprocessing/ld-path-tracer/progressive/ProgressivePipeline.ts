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

import {AdditiveBlending, BufferAttribute, BufferGeometry, Camera, ClampToEdgeWrapping, Color, DataTexture, DoubleSide, EquirectangularReflectionMapping, FloatType, FrontSide, LinearFilter, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RGBAFormat, Texture, Vector3, WebGLRenderer, WebGLRenderTarget} from 'three';
import {SAH} from 'three-mesh-bvh';
import {PhysicalPathTracingMaterial} from 'three-gpu-pathtracer/src/materials/pathtracing/PhysicalPathTracingMaterial.js';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {ModelScene} from '../../../ModelScene.js';
import {PathTracerBVHWorker} from '../PathTracerBVHWorker.js';

import {blurOcclusion, contactGroundY, ContactJob, expandPenumbraByHeight, stepContactRays} from './contact-shadow.js';
import {createFade, fadeSettled, FadeState, shaderAoMix as mixShaderAo, stepFade} from './fade.js';
import {ChangeKind, planInvalidation} from './invalidation.js';
import {directAtPoint, emissiveAtPoint, EmissiveSample, PunctualSample} from './lighting.js';
import {openLevel, SurfaceFactorBake, usableFactorScale} from './surface-bake.js';
import {cloneProgressiveSettings, progressiveBakeKey, ProgressiveSettings} from './options.js';
import {placeProbe, ProbeBaker} from './probe-baker.js';
import {applyUvJob, createUvJob, planAtlasTiles, stepUvJob, uv1IsValid, UvJob, UvTile} from './uv2.js';

export interface ProgressiveHost {
  renderer(): WebGLRenderer|null;
  scene(): ModelScene|null;
  camera(): Camera|null;
  requestRender(): void;
  dispatch(name: string, detail: Record<string, unknown>): void;
  buildTrace(): void;
  traceReady(): boolean;
  prepareOcclusion(): void;
  occlusionReady(): boolean;
  occlusionMaterial(): PhysicalPathTracingMaterial|null;
  bounces(): number;
  setOcclusionScale(value: number): void;
  occlusionSamples(): number;
  resetTrace(): void;
  sampleTrace(): number;
  traceSamples(): number;
  maxSamples(): number;
  invalidateTrace(): void;
  shadowLayerReady(): boolean;
  shadowMs(): number;
  shadowStale(): boolean;
  markShadowStale(): void;
  restartShadow(): void;
}

export interface LayerReadout {
  ready: boolean;
  fade: number;
  progress: number;
}

export interface ProgressiveReadout {
  /** What the pipeline is doing right now, for on-screen progress. */
  activity: string;
  /**
   * Progress of the current step, 0–1. Negative when the step has no
   * measurable cursor (BVH build).
   */
  step: number;
  contactShadow: LayerReadout;
  textureAO: LayerReadout;
  lightLayers: LayerReadout;
  probes: LayerReadout;
  fullTrace:
      {samples: number; fade: number; revealed: boolean; idleMs: number;};
  occlusionSamples: number;
  occlusionScale: number;
  shadowMs: number;
  frameMs:
      {last: number; mean: number; max: number; p95: number; count: number;};
  cpuSliceMs: {last: number; max: number;};
  bakeMs: {
    contactShadow: number; textureAO: number; lightLayers: number;
    probes: number;
  };
}

interface LightBake {
  id: string;
  fade: FadeState;
  weight: () => number;
  data: Float32Array;
  cursor: number;
  done: boolean;
  texture: DataTexture|null;
  punctual: PunctualSample|null;
  emissive: EmissiveSample[]|null;
}

interface UvTask {
  mesh: Mesh;
  job: UvJob;
}

const tmp = new Vector3();
const tmp2 = new Vector3();
const tmpN = new Vector3();
const tmpCam = new Matrix4();

const materialList = (mesh: Mesh): MeshStandardMaterial[] => {
  const source = mesh.material;
  const list = Array.isArray(source) ? source : [source];
  return list.filter((material): material is MeshStandardMaterial =>
      (material as MeshStandardMaterial)?.isMeshStandardMaterial === true);
};

/** Glass and other transmissive surfaces let light through in the trace. */
const materialBlocksAmbient = (material: MeshStandardMaterial): boolean => {
  const transmission =
      (material as MeshStandardMaterial & {transmission?: number}).transmission ??
      0;
  return transmission <= 0.02 && (material.opacity ?? 1) >= 0.98;
};

/** A shared chart cannot store both sides of a shell. Regenerate UV2. */
const uvMustBeGenerated = (mesh: Mesh): boolean => {
  for (const material of materialList(mesh)) {
    if (material.side === DoubleSide || material.side !== FrontSide) {
      return true;
    }
  }
  return false;
};

const isBakeMesh = (object: Object3D): object is Mesh => {
  const mesh = object as Mesh;
  if (!mesh.isMesh || mesh.geometry?.getAttribute('position') == null) {
    return false;
  }
  const data = mesh.userData ?? {};
  return data.progressiveOverlay !== true && data.noHit !== true &&
      data.pathTracerShadowCatcher !== true;
};

export class ProgressivePipeline {
  private settings: ProgressiveSettings;
  private phase: 'fadeout'|'collect'|'bvh'|'bake'|'probes'|'done' = 'collect';
  private disposed = false;
  private hiddenVisibility: Array<{object: Object3D; visible: boolean;}> = [];
  private generation = 0;
  private bakeKey = '';
  private geometryKey = '';
  private materialKey = '';
  private lightKey = '';
  private envKey = '';
  private sawFingerprint = false;
  private lastNow = 0;
  private idleMs = 0;
  private readonly cameraMatrix = new Matrix4();
  private cameraReady = false;
  private worker: PathTracerBVHWorker|null = null;
  private workerFailed = false;
  private bvh: import('three-mesh-bvh').MeshBVH|null = null;
  private bvhPending = false;
  private positions: Float32Array|null = null;
  private indices: Uint32Array|null = null;
  private meshes: Mesh[] = [];
  private fillMesh = 0;
  private fillVertex = 0;
  private vertexBase = 0;
  private write = 0;
  private contact: ContactJob|null = null;
  private contactFade = createFade();
  private contactReady = false;
  private contactMesh: Mesh|null = null;
  private contactTexture: DataTexture|null = null;
  private uvTasks: UvTask[] = [];
  private uvCursor = 0;
  private uvReady = false;
  private tileOf = new Map<Mesh, UvTile>();
  private tilesReady = false;
  private areaMesh = 0;
  private areaTri = 0;
  private areaPartial = 0;
  private meshAreas: number[] = [];
  private factorBake: SurfaceFactorBake|null = null;
  private factorScale = 1;
  private occlusionScaleSent = false;
  private shadowMs = 0;
  private shadowNoted = false;
  /** A few path-tracer samples, then denoise. Not the old ray estimator. */
  private static readonly SHADOW_SAMPLES = 4;
  private boundAoView = '';
  private uvPlaced = new Set<Mesh>();
  private geometryOwner = new Map<BufferGeometry, Mesh>();
  private overlapSkips = 0;
  private replaced = new Map<Mesh, BufferGeometry>();
  private surface: Float32Array|null = null;
  private surfaceGrid: Int32Array|null = null;
  private surfaceDone = false;
  private surfaceCount = 0;
  private surfaceMesh = 0;
  private surfaceTri = 0;
  private surfacePass = 0;
  private aoCursor = 0;
  private aoFade = createFade();
  private aoReady = false;
  private aoTexture: DataTexture|null = null;
  private lights: LightBake[] = [];
  private lightCursor = 0;
  private lightFade = createFade();
  private lightsReady = false;
  private lightTarget: WebGLRenderTarget|null = null;
  private lightQuad: FullScreenQuad|null = null;
  private lightMaterial: MeshBasicMaterial|null = null;
  private savedMaterials = new Map < MeshStandardMaterial, {
    aoMap: Texture|null;
    aoMapIntensity: number;
    lightMap: Texture|null;
    lightMapIntensity: number;
    envMap: Texture|null;
    envMapIntensity: number;
    onBeforeCompile: MeshStandardMaterial['onBeforeCompile'];
    customProgramCacheKey: MeshStandardMaterial['customProgramCacheKey'];
  }
  > ();
  private probes: ProbeBaker[] = [];
  private probeIndex = 0;
  private probeFade = createFade();
  private probesReady = false;
  private traceFade = createFade();
  private traceHold = false;
  private traceBuildRequested = false;
  private customEnv: Texture|null = null;
  private customEnvUrl = '';
  private captureSky: Texture|null = null;
  private captureSkyRequested = false;
  private frameSamples: number[] = [];
  private cpuLast = 0;
  private cpuMax = 0;
  private bakeMs = {contactShadow: 0, textureAO: 0, lightLayers: 0, probes: 0};
  private contactStamp = 0;
  private aoStamp = 0;
  private lightStamp = 0;
  private probeStamp = 0;
  private sent = new Set<string>();
  private lastProgress = new Map<string, number>();

  constructor(
      private readonly host: ProgressiveHost, settings: ProgressiveSettings) {
    this.settings = cloneProgressiveSettings(settings);
    this.bakeKey = progressiveBakeKey(this.settings);
  }

  setSettings(settings: ProgressiveSettings) {
    const previous = this.settings;
    this.settings = cloneProgressiveSettings(settings);
    const nextKey = progressiveBakeKey(this.settings);
    if (nextKey !== this.bakeKey) {
      this.bakeKey = nextKey;
      this.requestRestart();
    }
    if (previous.environment !== this.settings.environment) {
      this.noteChange('environment');
    }
    if (this.settings.environment &&
        this.settings.environment !== this.customEnvUrl) {
      this.loadEnvironment(this.settings.environment);
    }
    if (this.settings.view === 'bake' && previous.view !== 'bake' &&
        this.settings.bake.textureAO.enabled && this.aoTexture == null) {
      this.aoReady = false;
      this.shadowNoted = false;
      this.requestRestart();
    }
    if (previous.view !== this.settings.view) {
      this.discardPresentation();
    }
  }

  /** Drop the on-screen trace so the next samples start from the raster. */
  discardPresentation() {
    this.traceFade = {value: 0, target: 0};
    this.traceHold = false;
    this.traceBuildRequested = false;
  }

  get shadowComposite(): number {
    if (!this.settings.shadowPass.enabled || this.settings.view !== 'beauty' ||
        !this.host.shadowLayerReady() || this.host.shadowStale()) {
      return 0;
    }
    return this.aoFade.value * (1 - this.traceFade.value);
  }

  get traceFadeValue(): number {
    return this.traceFade.value;
  }

  get traceHoldImage(): boolean {
    return this.traceHold;
  }

  shaderAoMix(): number {
    return mixShaderAo(
        this.contactFade.value, this.aoFade.value, this.traceFade.value);
  }

  get contactReadyFlag(): boolean {
    return this.settings.bake.contactShadow.enabled && this.contactReady;
  }
  get aoReadyFlag(): boolean {
    return this.settings.bake.textureAO.enabled && this.aoReady &&
        this.aoTexture != null;
  }
  get lightsReadyFlag(): boolean {
    return this.settings.lights.include && this.lightsReady &&
        this.lights.length > 0;
  }
  get probesReadyFlag(): boolean {
    return this.settings.probes.enabled && this.probesReady;
  }

  bakeEnvironment(): Texture|null {
    return this.customEnv;
  }

  keepRendering(): boolean {
    return this.needsFrame();
  }

  readout(): ProgressiveReadout {
    const frames = this.frameSamples;
    const sorted = frames.slice().sort((a, b) => a - b);
    const sum = frames.reduce((acc, value) => acc + value, 0);
    const p95 = sorted.length === 0 ?
        0 :
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const activity = this.describeActivity();
    return {
      activity: activity.label,
      step: activity.step,
      contactShadow: this.layer(
          this.contactReady, this.contactFade.value, this.contactProgress()),
      textureAO: this.layer(this.aoReady, this.aoFade.value, this.aoProgress()),
      lightLayers: this.layer(
          this.lightsReady, this.lightFade.value, this.lightProgress()),
      probes: this.layer(
          this.probesReady, this.probeFade.value, this.probeProgress()),
      fullTrace: {
        samples: this.host.traceSamples(),
        fade: this.traceFade.value,
        revealed: this.traceHold && this.traceFade.value > 0.98,
        idleMs: this.idleMs,
      },
      occlusionSamples: this.host.occlusionSamples(),
      occlusionScale: this.occlusionScaleSent ? this.factorScale : 0,
      shadowMs: this.shadowMs,
      frameMs: {
        last: frames.length ? frames[frames.length - 1] : 0,
        mean: frames.length ? sum / frames.length : 0,
        max: frames.reduce((acc, value) => Math.max(acc, value), 0),
        p95,
        count: frames.length,
      },
      cpuSliceMs: {last: this.cpuLast, max: this.cpuMax},
      bakeMs: {...this.bakeMs},
    };
  }

  noteFrame(ms: number) {
    this.frameSamples.push(ms);
    if (this.frameSamples.length > 240) {
      this.frameSamples.shift();
    }
  }

  tick(now: number) {
    if (this.disposed) {
      return;
    }
    const delta = this.lastNow === 0 ? 16 : Math.min(100, now - this.lastNow);
    this.lastNow = now;
    this.stepAllFades(delta);
    this.watchCamera(delta);
    this.watchScene();
    if (this.phase === 'fadeout') {
      if (this.fadesHidden()) {
        this.resetResources();
        this.phase = 'collect';
      }
    } else {
      const shadowPending = this.shadowPending();
      const sliceStart = performance.now();
      if (!shadowPending) {
        this.stepWork(this.settings.budgetMs);
      }
      this.cpuLast = performance.now() - sliceStart;
      this.cpuMax = Math.max(this.cpuMax, this.cpuLast);
      if (shadowPending || this.cpuLast < this.settings.budgetMs * 0.85) {
        this.stepGpu();
      }
    }
    this.applyVisuals();
    this.emitEvents();
    if (this.needsFrame()) {
      this.host.requestRender();
    }
  }

  hideProduct(hide: boolean) {
    const scene = this.host.scene();
    if (scene == null) {
      return;
    }
    if (hide) {
      this.hiddenVisibility = [];
      scene.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh) {
          return;
        }
        if (mesh.userData?.progressiveOverlay === true ||
            (mesh.userData?.noHit !== true &&
             mesh.userData?.pathTracerShadowCatcher !== true)) {
          this.hiddenVisibility.push({object, visible: object.visible});
          object.visible = false;
        }
      });
      return;
    }
    for (const entry of this.hiddenVisibility) {
      entry.object.visible = entry.visible;
    }
    this.hiddenVisibility = [];
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.resetResources();
    this.restoreMaterials();
    this.restoreGeometry();
    this.worker?.dispose();
    this.worker = null;
    this.customEnv?.dispose();
    this.customEnv = null;
    if (this.captureSkyRequested) {
      this.captureSky?.dispose();
    }
    this.captureSky = null;
    this.captureSkyRequested = false;
  }

  private layer(ready: boolean, fade: number, progress: number): LayerReadout {
    return {ready, fade, progress};
  }

  private stepAllFades(delta: number) {
    const ms = this.settings.fadeMs;
    this.contactFade = stepFade(this.contactFade, delta, ms);
    this.aoFade = stepFade(this.aoFade, delta, ms);
    this.lightFade = stepFade(this.lightFade, delta, ms);
    this.probeFade = stepFade(this.probeFade, delta, ms);
    this.traceFade = stepFade(this.traceFade, delta, ms);
    for (const light of this.lights) {
      light.fade = stepFade(light.fade, delta, ms);
    }
    if (this.traceFade.target === 0 && this.traceFade.value < 0.01) {
      this.traceHold = false;
    }
  }

  private fadesHidden(): boolean {
    return fadeSettled(this.contactFade) && this.contactFade.value < 0.01 &&
        fadeSettled(this.aoFade) && this.aoFade.value < 0.01 &&
        fadeSettled(this.lightFade) && this.lightFade.value < 0.01 &&
        fadeSettled(this.probeFade) && this.probeFade.value < 0.01 &&
        fadeSettled(this.traceFade) && this.traceFade.value < 0.01;
  }

  private watchCamera(delta: number) {
    const camera = this.host.camera();
    if (camera == null) {
      return;
    }
    camera.updateMatrixWorld();
    tmpCam.multiplyMatrices(camera.projectionMatrix, camera.matrixWorld);
    if (!this.cameraReady) {
      this.cameraMatrix.copy(tmpCam);
      this.cameraReady = true;
      this.idleMs = 0;
      return;
    }
    if (!this.cameraMatrix.equals(tmpCam)) {
      this.cameraMatrix.copy(tmpCam);
      this.idleMs = 0;
      this.noteChange('camera');
      return;
    }
    this.idleMs += delta;
  }

  private watchScene() {
    const scene = this.host.scene();
    if (scene == null) {
      return;
    }
    const geometry = this.geometryFingerprint(scene);
    const material = this.materialFingerprint(scene);
    const light = this.lightFingerprint(scene);
    const env =
        `${scene.environment?.uuid ?? ''}|${this.settings.environment ?? ''}`;
    if (!this.sawFingerprint) {
      this.geometryKey = geometry;
      this.materialKey = material;
      this.lightKey = light;
      this.envKey = env;
      this.sawFingerprint = true;
      return;
    }
    if (geometry !== this.geometryKey) {
      this.geometryKey = geometry;
      this.materialKey = material;
      this.lightKey = light;
      this.noteChange('geometry');
      return;
    }
    if (material !== this.materialKey) {
      this.materialKey = material;
      this.noteChange('material');
    }
    if (light !== this.lightKey) {
      this.lightKey = light;
      this.syncLightWeights();
      this.noteChange('light');
    }
    if (env !== this.envKey) {
      this.envKey = env;
      this.noteChange('environment');
    }
  }

  private noteChange(kind: ChangeKind) {
    const plan = planInvalidation(kind);
    if (plan.restartBakes) {
      this.requestRestart();
      return;
    }
    if (plan.restartFullTrace) {
      if (kind === 'camera') {
        // The held trace and shadow are screen-space. A fade would leave the
        // old view stuck while the camera moves, so drop them on this frame
        // and show the raster until the camera is idle again.
        this.dropTraceForCamera();
      } else {
        this.traceFade = {...this.traceFade, target: 0};
        this.host.resetTrace();
        this.host.invalidateTrace();
        this.traceBuildRequested = false;
      }
    }
    if (plan.restartProbes) {
      this.probeFade = {...this.probeFade, target: 0};
      this.probesReady = false;
      this.sent.delete('probes-ready');
      for (const probe of this.probes) {
        probe.dispose();
      }
      this.probes = [];
      this.probeIndex = 0;
      if (this.phase === 'done' || this.phase === 'probes') {
        this.phase = 'probes';
      }
    }
  }

  private dropTraceForCamera() {
    const hidden = this.traceFade.target === 0 && this.traceFade.value < 0.01;
    this.traceFade = {value: 0, target: 0};
    this.traceHold = false;
    if (!hidden) {
      this.host.resetTrace();
    }
    if (this.settings.shadowPass.enabled && this.settings.view === 'beauty') {
      this.host.markShadowStale();
    }
  }

  private requestRestart() {
    this.contactFade = {...this.contactFade, target: 0};
    this.aoFade = {...this.aoFade, target: 0};
    this.lightFade = {...this.lightFade, target: 0};
    this.probeFade = {...this.probeFade, target: 0};
    this.traceFade = {...this.traceFade, target: 0};
    this.host.resetTrace();
    this.host.invalidateTrace();
    this.traceBuildRequested = false;
    this.shadowNoted = false;
    this.shadowMs = 0;
    this.sent.clear();
    if (this.contactFade.value < 0.01 && this.aoFade.value < 0.01 &&
        this.lightFade.value < 0.01 && this.probeFade.value < 0.01 &&
        this.traceFade.value < 0.01) {
      this.resetResources();
      this.phase = 'collect';
      return;
    }
    this.phase = 'fadeout';
  }

  private stepWork(budgetMs: number) {
    if (this.phase === 'collect') {
      this.stepCollect(budgetMs);
    } else if (this.phase === 'bvh') {
      this.ensureWorker();
    } else if (this.phase === 'bake') {
      this.stepBake(budgetMs);
    }
  }

  private stepCollect(budgetMs: number) {
    const scene = this.host.scene();
    if (scene == null || scene.size.lengthSq() < 1e-8) {
      return;
    }
    if (this.positions == null) {
      scene.updateMatrixWorld(true);
      this.meshes = [];
      scene.traverseVisible((object) => {
        if (isBakeMesh(object)) {
          this.meshes.push(object);
        }
      });
      if (!this.settings.bake.contactShadow.enabled &&
          !this.settings.lights.include) {
        this.phase = 'bake';
        this.prepareBakeJobs();
        return;
      }
      let vertices = 0;
      let corners = 0;
      for (const mesh of this.meshes) {
        const position = mesh.geometry.getAttribute('position');
        const index = mesh.geometry.getIndex();
        vertices += position.count;
        corners += index != null ? index.count : position.count;
      }
      this.positions = new Float32Array(vertices * 3);
      this.indices = new Uint32Array(corners);
      this.fillMesh = 0;
      this.fillVertex = 0;
      this.vertexBase = 0;
      this.write = 0;
    }
    const start = performance.now();
    const matrix = new Matrix4();
    while (this.fillMesh < this.meshes.length) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      const mesh = this.meshes[this.fillMesh];
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      matrix.copy(mesh.matrixWorld);
      while (this.fillVertex < position.count) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        tmp.fromBufferAttribute(position as BufferAttribute, this.fillVertex)
            .applyMatrix4(matrix);
        const o = (this.vertexBase + this.fillVertex) * 3;
        this.positions![o] = tmp.x;
        this.positions![o + 1] = tmp.y;
        this.positions![o + 2] = tmp.z;
        this.fillVertex++;
      }
      const count = index != null ? index.count : position.count;
      this.appendOccluders(mesh, index, count);
      this.vertexBase += position.count;
      this.fillVertex = 0;
      this.fillMesh++;
    }
    this.phase = 'bvh';
    this.startBvh();
  }

  private ensureWorker() {
    if (!this.bvhPending && this.bvh == null) {
      this.startBvh();
    }
  }

  private startBvh() {
    if (this.positions == null || this.indices == null || this.bvhPending) {
      return;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setIndex(new BufferAttribute(this.indices.subarray(0, this.write), 1));
    const generation = this.generation;
    this.bvhPending = true;
    const finish = (bvh: import('three-mesh-bvh').MeshBVH) => {
      if (this.disposed || generation !== this.generation) {
        return;
      }
      this.bvh = bvh;
      this.bvhPending = false;
      this.phase = 'bake';
      this.prepareBakeJobs();
    };
    try {
      if (this.worker == null && !this.workerFailed) {
        this.worker = new PathTracerBVHWorker();
      }
    } catch (error) {
      console.warn(
          '[model-viewer] Progressive bake BVH worker is unavailable.', error);
      this.workerFailed = true;
    }
    if (this.worker != null && !this.workerFailed) {
      this.worker
          .generate(
              geometry, {strategy: SAH, maxLeafTris: 8, setBoundingBox: true})
          .then(finish)
          .catch((error: unknown) => {
            if (this.disposed || generation !== this.generation) {
              return;
            }
            console.warn(
                '[model-viewer] Progressive bake BVH worker failed. Building on the main thread.',
                error);
            this.workerFailed = true;
            this.bvhPending = false;
            import('three-mesh-bvh').then(({MeshBVH}) => {finish(new MeshBVH(geometry, {strategy : SAH, maxLeafTris : 8}));});
          });
      return;
    }
    import('three-mesh-bvh').then(({MeshBVH}) => {finish(new MeshBVH(geometry, {strategy : SAH, maxLeafTris : 8}));});
  }

  private prepareBakeJobs() {
    const scene = this.host.scene();
    const needsLocalBvh = this.settings.bake.contactShadow.enabled ||
        this.settings.lights.include;
    if (scene == null || (needsLocalBvh && this.bvh == null)) {
      return;
    }
    const size = scene.size;
    const box = scene.boundingBox;
    const center = box.getCenter(tmp);
    if (this.settings.bake.contactShadow.enabled) {
      const resolution = this.settings.bake.contactShadow.resolution;
      const softness = this.settings.bake.contactShadow.softness;
      // How high above the ground still counts as the footprint. The
      // penumbra radius is this clearance times heightScale, so a wheel
      // stays tight and a case on castors only softens by its own gap.
      const falloff = Math.max(size.y * 0.4, 0.18);
      const heightScale = 0.8 + softness;
      const margin = falloff * heightScale;
      const width = Math.max(size.x, 0.05) + margin * 2;
      const depth = Math.max(size.z, 0.05) + margin * 2;
      const groundY = this.positions != null ?
          contactGroundY(this.positions) :
          box.min.y;
      this.contact = {
        resolution,
        centerX: center.x,
        centerZ: center.z,
        width,
        depth,
        y: groundY,
        softnessRadius: 0,
        samples: 1,
        maxDistance: falloff,
        penumbraDistance: falloff,
        grid: new Float32Array(resolution * resolution),
        heights: new Float32Array(resolution * resolution).fill(-1),
        heightScale,
        cursor: 0,
      };
      this.contactStamp = performance.now();
    } else {
      this.contactReady = true;
    }
    const ownsShadow = this.settings.shadowPass.enabled &&
        this.settings.view === 'beauty';
    const wantUv = !ownsShadow && (this.settings.bake.textureAO.enabled ||
                                   (this.settings.lights.include &&
                                    this.sceneHasLights()));
    this.uvTasks = [];
    this.uvPlaced.clear();
    this.geometryOwner.clear();
    this.tilesReady = !wantUv;
    this.areaMesh = 0;
    this.areaTri = 0;
    this.areaPartial = 0;
    this.meshAreas = new Array(this.meshes.length).fill(0);
    this.factorBake?.dispose();
    this.factorBake = null;
    this.factorScale = 1;
    this.occlusionScaleSent = false;
    if (!ownsShadow) {
      this.shadowMs = 0;
    }
    this.uvReady = !wantUv;
    if (ownsShadow) {
      this.aoReady = this.shadowNoted;
    } else if (!this.settings.bake.textureAO.enabled) {
      this.aoReady = true;
    } else {
      this.aoReady = false;
    }
    if (!this.settings.lights.include || !this.sceneHasLights()) {
      this.lightsReady = true;
    }
    this.aoStamp = performance.now();
    this.lightStamp = performance.now();
  }

  private sceneHasLights(): boolean {
    const scene = this.host.scene();
    if (scene == null) {
      return false;
    }
    let found = false;
    scene.traverse((object) => {
      const light = object as Object3D & {
        isPointLight?: boolean;
        isSpotLight?: boolean;
        isDirectionalLight?: boolean;
      };
      if (light.isPointLight || light.isSpotLight || light.isDirectionalLight) {
        found = true;
      }
      const mesh = object as Mesh;
      const material = mesh.material as MeshStandardMaterial | undefined;
      if (material?.emissive != null && material.emissive.getHex() !== 0 &&
          (material.emissiveIntensity ?? 1) > 0.001) {
        found = true;
      }
    });
    return found;
  }

  private stepBake(budgetMs: number) {
    const start = performance.now();
    if (this.contact != null && this.bvh != null && !this.contactReady) {
      const done = stepContactRays(
          this.contact, this.bvh, Math.max(0.5, budgetMs * 0.45));
      if (done) {
        this.publishContact();
      }
    }
    const remain = budgetMs - (performance.now() - start);
    if (remain <= 0) {
      return;
    }
    if (!this.uvReady) {
      this.stepUv(remain * 0.6);
    }
    if (this.uvReady && !this.surfaceDone &&
        (this.settings.bake.textureAO.enabled ||
         this.settings.lights.include)) {
      this.stepSurface(Math.max(0.4, budgetMs - (performance.now() - start)));
    }
    if (this.surfaceDone && this.settings.bake.textureAO.enabled &&
        !this.aoReady) {
      this.stepAo(Math.max(0.4, budgetMs - (performance.now() - start)));
    }
    if ((this.aoReady || !this.settings.bake.textureAO.enabled) &&
        this.surfaceDone && this.settings.lights.include && !this.lightsReady &&
        this.bvh != null) {
      this.stepLights(Math.max(0.4, budgetMs - (performance.now() - start)));
    }
    if (this.cpuBakesDone()) {
      this.phase = this.settings.probes.enabled ? 'probes' : 'done';
      this.probeStamp = performance.now();
    }
  }

  private cpuBakesDone(): boolean {
    const contactOk =
        !this.settings.bake.contactShadow.enabled || this.contactReady;
    const aoOk = !this.settings.bake.textureAO.enabled || this.aoReady;
    const lightOk = !this.settings.lights.include || this.lightsReady;
    const uvOk = this.uvReady;
    return contactOk && aoOk && lightOk && uvOk;
  }

  private stepUv(budgetMs: number) {
    const start = performance.now();
    if (!this.tilesReady) {
      this.stepMeshAreas(budgetMs);
      if (!this.tilesReady) {
        return;
      }
      this.planTiles();
      this.createUvJobs();
      if (this.uvTasks.length === 0) {
        this.uvReady = true;
        return;
      }
    }
    while (this.uvCursor < this.uvTasks.length) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      const task = this.uvTasks[this.uvCursor];
      stepUvJob(task.job, budgetMs - (performance.now() - start));
      if (!task.job.done) {
        return;
      }
      this.applyUv(task.mesh, task.job);
      this.uvCursor++;
    }
    this.applyPlannedTiles();
    this.uvReady = true;
  }

  /** World-space area, a few triangles at a time, so the atlas can be sized in texels per metre. */
  private stepMeshAreas(budgetMs: number) {
    const start = performance.now();
    while (this.areaMesh < this.meshes.length) {
      const mesh = this.meshes[this.areaMesh];
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      if (position == null) {
        this.meshAreas[this.areaMesh] = 0;
        this.areaMesh++;
        this.areaTri = 0;
        this.areaPartial = 0;
        continue;
      }
      mesh.updateWorldMatrix(true, false);
      const e = mesh.matrixWorld.elements;
      const triCount = index != null ? Math.floor(index.count / 3) :
                                       Math.floor(position.count / 3);
      const world = (vertex: number): [number, number, number] => {
        const x = position.getX(vertex);
        const y = position.getY(vertex);
        const z = position.getZ(vertex);
        return [
          e[0] * x + e[4] * y + e[8] * z + e[12],
          e[1] * x + e[5] * y + e[9] * z + e[13],
          e[2] * x + e[6] * y + e[10] * z + e[14],
        ];
      };
      while (this.areaTri < triCount) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        const tri = this.areaTri++;
        const i0 = index != null ? index.getX(tri * 3) : tri * 3;
        const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
        const a = world(i0);
        const b = world(i1);
        const c = world(i2);
        const abx = b[0] - a[0];
        const aby = b[1] - a[1];
        const abz = b[2] - a[2];
        const acx = c[0] - a[0];
        const acy = c[1] - a[1];
        const acz = c[2] - a[2];
        const cx = aby * acz - abz * acy;
        const cy = abz * acx - abx * acz;
        const cz = abx * acy - aby * acx;
        this.areaPartial += 0.5 * Math.hypot(cx, cy, cz);
      }
      this.meshAreas[this.areaMesh] = this.areaPartial;
      this.areaPartial = 0;
      this.areaTri = 0;
      this.areaMesh++;
    }
    this.tilesReady = true;
  }

  private planTiles() {
    this.tileOf.clear();
    const resolution = Math.max(8, this.settings.bake.textureAO.resolution);
    const weights = this.meshes.map((_, index) => this.meshAreas[index] || 0);
    const tiles = planAtlasTiles(weights, resolution);
    let minDensity = Infinity;
    let maxDensity = 0;
    for (let n = 0; n < this.meshes.length; n++) {
      const tile = tiles[n];
      if (tile == null) {
        continue;
      }
      this.tileOf.set(this.meshes[n], tile);
      const metres = Math.sqrt(Math.max(this.meshAreas[n] || 0, 1e-8));
      const density = tile.w / metres;
      minDensity = Math.min(minDensity, density);
      maxDensity = Math.max(maxDensity, density);
    }
    if (this.meshes.length > 0) {
      console.info(
          'AO texels/m',
          Number.isFinite(minDensity) ? minDensity.toFixed(1) : '0',
          'to',
          maxDensity.toFixed(1));
    }
  }

  private createUvJobs() {
    const resolution = this.settings.bake.textureAO.resolution;
    for (const mesh of this.meshes) {
      this.exclusiveGeometry(mesh);
      const source = mesh.geometry;
      if (uv1IsValid(source, resolution) && !uvMustBeGenerated(mesh)) {
        continue;
      }
      const job = createUvJob(source, resolution, this.tileOf.get(mesh) ?? null);
      if (job != null) {
        this.uvTasks.push({mesh, job});
      }
    }
  }

  /** Meshes that kept their own UV2 still have to land in a private tile. */
  private applyPlannedTiles() {
    const resolution = Math.max(8, this.settings.bake.textureAO.resolution);
    for (const mesh of this.meshes) {
      if (this.uvPlaced.has(mesh)) {
        continue;
      }
      const tile = this.tileOf.get(mesh);
      if (tile == null) {
        continue;
      }
      this.fitUvTile(
          mesh, tile.x / resolution, tile.y / resolution, tile.w / resolution);
    }
  }

  private fitUvTile(mesh: Mesh, ox: number, oy: number, side: number) {
    const uv = mesh.geometry.getAttribute('uv1');
    if (uv == null || side <= 0) {
      return;
    }
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, uv.getX(i) * side + ox, uv.getY(i) * side + oy);
    }
    uv.needsUpdate = true;
  }

  /**
   * Two nodes often share one geometry. Scaling UV2 in place would apply
   * the second tile on top of the first and stack both charts.
   */
  private exclusiveGeometry(mesh: Mesh) {
    const geometry = mesh.geometry;
    const owner = this.geometryOwner.get(geometry);
    if (owner != null && owner !== mesh) {
      const clone = geometry.clone();
      if (!this.replaced.has(mesh)) {
        this.replaced.set(mesh, geometry);
        mesh.userData.progressiveSourceGeometry = geometry;
      }
      mesh.geometry = clone;
      this.geometryOwner.set(clone, mesh);
      return;
    }
    if (owner == null) {
      this.geometryOwner.set(geometry, mesh);
    }
  }

  private applyUv(mesh: Mesh, job: UvJob) {
    const source = mesh.geometry;
    const next = applyUvJob(source, job);
    if (next == null) {
      return;
    }
    if (next !== source) {
      const original = mesh.userData.progressiveSourceGeometry as
          BufferGeometry |
          undefined;
      if (original == null) {
        mesh.userData.progressiveSourceGeometry = source;
        this.replaced.set(mesh, source);
      } else if (source !== original) {
        source.dispose();
      }
      mesh.geometry = next;
    }
    this.uvPlaced.add(mesh);
  }

  /** Skip glass groups. An opaque sibling on the same mesh still occludes. */
  private appendOccluders(
      mesh: Mesh,
      index: BufferAttribute|null,
      count: number) {
    const materials = materialList(mesh);
    const groups = mesh.geometry.groups;
    const writeRange = (start: number, end: number) => {
      const last = Math.min(count, end);
      for (let i = start; i < last; i++) {
        const vertex = index != null ? index.getX(i) : i;
        this.indices![this.write++] = this.vertexBase + vertex;
      }
    };
    if (materials.length === 0) {
      writeRange(0, count);
      return;
    }
    if (groups.length > 1 && materials.length > 1) {
      for (const group of groups) {
        const material = materials[group.materialIndex ?? 0];
        if (material != null && materialBlocksAmbient(material)) {
          writeRange(group.start, group.start + group.count);
        }
      }
      return;
    }
    if (materials.every(materialBlocksAmbient)) {
      writeRange(0, count);
    }
  }

  private stepSurface(budgetMs: number) {
    const resolution = this.settings.bake.textureAO.resolution;
    if (this.surface == null || this.surfaceGrid == null) {
      this.surface = new Float32Array(resolution * resolution * 8 * 2);
      this.surfaceGrid = new Int32Array(resolution * resolution);
      this.surfaceGrid.fill(-1);
      this.surfaceCount = 0;
      this.surfaceMesh = 0;
      this.surfaceTri = 0;
      this.surfacePass = 0;
      this.overlapSkips = 0;
    }
    const grid = this.surfaceGrid;
    const start = performance.now();
    while (this.surfacePass < 2) {
      while (this.surfaceMesh < this.meshes.length) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        const mesh = this.meshes[this.surfaceMesh];
        const uv = mesh.geometry.getAttribute('uv1');
        const position = mesh.geometry.getAttribute('position');
        const normal = mesh.geometry.getAttribute('normal');
        const index = mesh.geometry.getIndex();
        if (uv == null || position == null) {
          this.surfaceMesh++;
          this.surfaceTri = 0;
          continue;
        }
        const triCount = index != null ? Math.floor(index.count / 3) :
                                         Math.floor(position.count / 3);
        mesh.updateWorldMatrix(true, false);
        const mode = this.surfacePass === 0 ? 'center' : 'corner';
        while (this.surfaceTri < triCount) {
          if (performance.now() - start >= budgetMs) {
            return;
          }
          const tri = this.surfaceTri++;
          const i0 = index != null ? index.getX(tri * 3) : tri * 3;
          const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
          const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
          this.rasterTriangle(
              mesh, uv, position, normal, i0, i1, i2, resolution, grid, mode);
        }
        this.surfaceMesh++;
        this.surfaceTri = 0;
      }
      this.surfacePass++;
      this.surfaceMesh = 0;
      this.surfaceTri = 0;
    }
    console.info('AO raster overlaps', this.overlapSkips);
    this.stampVertexTexels(resolution);
    this.compactSurface(resolution);
    this.surfaceDone = true;
  }

  private rasterTriangle(
      mesh: Mesh,
      uv: import('three')
          .BufferAttribute|import('three')
          .InterleavedBufferAttribute,
      position: import('three')
          .BufferAttribute|import('three')
          .InterleavedBufferAttribute,
      normal: import('three')
          .BufferAttribute|import('three')
          .InterleavedBufferAttribute|null,
      i0: number, i1: number, i2: number, resolution: number,
      grid: Int32Array, mode: 'center'|'corner') {
    const ax = uv.getX(i0);
    const ay = uv.getY(i0);
    const bx = uv.getX(i1);
    const by = uv.getY(i1);
    const cx = uv.getX(i2);
    const cy = uv.getY(i2);
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * resolution));
    const maxX =
        Math.min(resolution - 1, Math.ceil(Math.max(ax, bx, cx) * resolution));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * resolution));
    const maxY =
        Math.min(resolution - 1, Math.ceil(Math.max(ay, by, cy) * resolution));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const slot = y * resolution + x;
        if (grid[slot] !== -1 && mode !== 'center') {
          continue;
        }
        const px = (x + 0.5) / resolution;
        const py = (y + 0.5) / resolution;
        const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denom) < 1e-8) {
          continue;
        }
        // Centre pass owns the texel. Corner pass only fills texels whose
        // centres sit just outside a triangle, which used to stay white.
        const half = 0.5 / resolution;
        const probes = mode === 'center' ?
            [px, py] :
            [
              px - half, py - half,
              px + half, py - half,
              px - half, py + half,
              px + half, py + half,
            ];
        let w0 = 0;
        let w1 = 0;
        let w2 = 0;
        let covered = false;
        for (let p = 0; p < probes.length; p += 2) {
          const qx = probes[p];
          const qy = probes[p + 1];
          const a = ((by - cy) * (qx - cx) + (cx - bx) * (qy - cy)) / denom;
          const b = ((cy - ay) * (qx - cx) + (ax - cx) * (qy - cy)) / denom;
          const c = 1 - a - b;
          if (a >= -1e-4 && b >= -1e-4 && c >= -1e-4) {
            w0 = a;
            w1 = b;
            w2 = c;
            covered = true;
            break;
          }
        }
        if (!covered) {
          continue;
        }
        if (grid[slot] !== -1) {
          this.overlapSkips++;
          continue;
        }
        tmp.fromBufferAttribute(position, i0).multiplyScalar(w0);
        tmp2.fromBufferAttribute(position, i1).multiplyScalar(w1);
        tmp.add(tmp2);
        tmp2.fromBufferAttribute(position, i2).multiplyScalar(w2);
        tmp.add(tmp2).applyMatrix4(mesh.matrixWorld);
        if (normal != null) {
          tmpN.fromBufferAttribute(normal, i0).multiplyScalar(w0);
          tmp2.fromBufferAttribute(normal, i1).multiplyScalar(w1);
          tmpN.add(tmp2);
          tmp2.fromBufferAttribute(normal, i2).multiplyScalar(w2);
          tmpN.add(tmp2).transformDirection(mesh.matrixWorld).normalize();
        } else {
          tmpN.set(0, 1, 0);
        }
        const o = this.surfaceCount * 8;
        if (o + 8 > this.surface!.length) {
          const grown = new Float32Array(this.surface!.length * 2);
          grown.set(this.surface!);
          this.surface = grown;
        }
        this.surface![o] = tmp.x;
        this.surface![o + 1] = tmp.y;
        this.surface![o + 2] = tmp.z;
        this.surface![o + 3] = tmpN.x;
        this.surface![o + 4] = tmpN.y;
        this.surface![o + 5] = tmpN.z;
        this.surface![o + 6] = px;
        this.surface![o + 7] = py;
        grid[slot] = this.surfaceCount;
        this.surfaceCount++;
      }
    }
  }

  /** Every vertex UV must land on a written texel, or the shelf shows white. */
  private stampVertexTexels(resolution: number) {
    const grid = this.surfaceGrid;
    if (grid == null || this.surface == null) {
      return;
    }
    let surface: Float32Array = this.surface;
    for (const mesh of this.meshes) {
      const uv = mesh.geometry.getAttribute('uv1');
      const position = mesh.geometry.getAttribute('position');
      const normal = mesh.geometry.getAttribute('normal');
      const index = mesh.geometry.getIndex();
      if (uv == null || position == null) {
        continue;
      }
      mesh.updateWorldMatrix(true, false);
      const corners = index != null ? index.count : position.count;
      for (let corner = 0; corner < corners; corner++) {
        const vertex = index != null ? index.getX(corner) : corner;
        const u = Math.min(1 - 1e-4, Math.max(0, uv.getX(vertex)));
        const v = Math.min(1 - 1e-4, Math.max(0, uv.getY(vertex)));
        const x = Math.min(resolution - 1, Math.floor(u * resolution));
        const y = Math.min(resolution - 1, Math.floor(v * resolution));
        const slot = y * resolution + x;
        if (grid[slot] !== -1) {
          continue;
        }
        let o = this.surfaceCount * 8;
        if (o + 8 > surface.length) {
          const grown: Float32Array =
              new Float32Array(Math.max(surface.length * 2, o + 8));
          grown.set(surface);
          surface = grown;
          this.surface = grown;
          o = this.surfaceCount * 8;
        }
        tmp.fromBufferAttribute(position as BufferAttribute, vertex)
            .applyMatrix4(mesh.matrixWorld);
        if (normal != null) {
          tmpN.fromBufferAttribute(normal as BufferAttribute, vertex)
              .transformDirection(mesh.matrixWorld)
              .normalize();
        } else {
          tmpN.set(0, 1, 0);
        }
        surface[o] = tmp.x;
        surface[o + 1] = tmp.y;
        surface[o + 2] = tmp.z;
        surface[o + 3] = tmpN.x;
        surface[o + 4] = tmpN.y;
        surface[o + 5] = tmpN.z;
        surface[o + 6] = (x + 0.5) / resolution;
        surface[o + 7] = (y + 0.5) / resolution;
        grid[slot] = this.surfaceCount;
        this.surfaceCount++;
      }
    }
  }

  private compactSurface(resolution: number) {
    const packed = new Float32Array(Math.max(8, this.surfaceCount * 8));
    packed.set(this.surface!.subarray(0, this.surfaceCount * 8));
    this.surface = packed;
    this.surfaceGrid = null;
    if (!this.settings.bake.textureAO.enabled) {
      this.aoReady = true;
    } else {
      this.aoCursor = 0;
    }
    if (this.settings.lights.include) {
      this.buildLightList(resolution);
    } else {
      this.lightsReady = true;
    }
    if (this.surfaceCount === 0) {
      this.aoReady = true;
      this.lightsReady = true;
    }
  }

  /**
   * The texture is the path tracer, frozen. Each texel runs the same shader
   * as the shadow view. There is no separate occlusion heuristic.
   */
  private shadowPending(): boolean {
    return this.settings.shadowPass.enabled && this.settings.view === 'beauty' &&
        !this.host.shadowLayerReady();
  }

  private noteShadowLayer() {
    if (!this.settings.shadowPass.enabled || this.settings.view !== 'beauty' ||
        this.shadowNoted || !this.host.shadowLayerReady()) {
      return;
    }
    this.shadowNoted = true;
    this.shadowMs = this.host.shadowMs();
    this.aoReady = true;
    this.aoFade = {...this.aoFade, target: 1};
    console.info(
        '[model-viewer] Shadow layer ready in', Math.round(this.shadowMs),
        'ms');
  }

  private stepAo(_budgetMs: number) {
    if (this.settings.shadowPass.enabled && this.settings.view === 'beauty') {
      return;
    }
    if (this.surface == null || this.surfaceCount === 0) {
      this.aoReady = true;
      return;
    }
    const renderer = this.host.renderer();
    const source = this.host.occlusionMaterial();
    if (renderer == null || source == null || !this.host.occlusionReady()) {
      this.host.prepareOcclusion();
      return;
    }
    const samples = ProgressivePipeline.SHADOW_SAMPLES;
    const resolution = Math.min(128, this.settings.bake.textureAO.resolution);
    if (this.factorBake == null) {
      this.factorBake = new SurfaceFactorBake(renderer, source);
      this.factorBake.setSurfaces(this.surface, this.surfaceCount, resolution);
      this.aoCursor = 0;
      return;
    }
    try {
      const done = this.factorBake.step();
      this.aoCursor = Math.min(samples, Math.floor(done));
      if (done + 1e-3 < samples) {
        return;
      }
      try {
        this.factorBake.denoise(renderer);
      } catch (error) {
        console.warn('[model-viewer] Shadow denoise failed.', error);
      }
      const image = this.factorBake.read(renderer);
      this.factorScale = usableFactorScale(openLevel(image));
      if (!this.occlusionScaleSent) {
        this.host.setOcclusionScale(this.factorScale);
        this.occlusionScaleSent = true;
      }
      this.bakeMs.textureAO = performance.now() - this.aoStamp;
      this.publishFactor(image, image, resolution);
      this.factorBake.dispose();
      this.factorBake = null;
    } catch (error) {
      console.warn(
          '[model-viewer] Surface factor bake failed.', error);
      this.factorBake?.dispose();
      this.factorBake = null;
      this.aoReady = true;
    }
  }

  private buildLightList(resolution: number) {
    const scene = this.host.scene();
    this.lights = [];
    if (scene == null) {
      this.lightsReady = true;
      return;
    }
    const texels = resolution * resolution * 4;
    scene.traverse((object) => {
      const light = object as Object3D & {
        isPointLight?: boolean;
        isSpotLight?: boolean;
        isDirectionalLight?: boolean;
        intensity: number;
        color: Color;
      };
      if (light.isPointLight || light.isSpotLight || light.isDirectionalLight) {
        const sample = this.punctualSample(light);
        const baked = Math.max(1e-4, sample.intensity);
        const bake: LightBake = {
          id: `punctual:${light.uuid}`,
          fade: createFade(0, 0),
          weight: () => light.visible ? Math.max(0, light.intensity) / baked : 0,
          data: new Float32Array(texels),
          cursor: 0,
          done: false,
          texture: null,
          punctual: sample,
          emissive: null,
        };
        this.lights.push(bake);
      }
    });
    const groups = new Map < string, {
      material: MeshStandardMaterial;
      meshes: Mesh[]
    }
    > ();
    for (const mesh of this.meshes) {
      const materials =
          Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as MeshStandardMaterial;
        if (standard.emissive == null || standard.emissive.getHex() === 0) {
          continue;
        }
        if ((standard.emissiveIntensity ?? 1) <= 0.001) {
          continue;
        }
        const group =
            groups.get(standard.uuid) ?? {material: standard, meshes: []};
        group.meshes.push(mesh);
        groups.set(standard.uuid, group);
      }
    }
    groups.forEach((group) => {
      const samples = this.emissiveSamples(group.material, group.meshes);
      const baked = group.material.emissiveIntensity ?? 1;
      this.lights.push({
        id: `emissive:${group.material.uuid}`,
        fade: createFade(0, 0),
        weight: () =>
            (group.material.emissiveIntensity ?? 1) / Math.max(1e-4, baked),
        data: new Float32Array(texels),
        cursor: 0,
        done: false,
        texture: null,
        punctual: null,
        emissive: samples,
      });
    });
    if (!this.settings.lights.separateLayers && this.lights.length > 1) {
      const first = this.lights[0];
      first.id = 'combined';
      first.weight = () => 1;
      this.lights = [first];
    }
    if (this.lights.length === 0) {
      this.lightsReady = true;
    }
    this.lightCursor = 0;
  }

  private punctualSample(light: Object3D&{
    intensity: number;
    color: Color;
    isSpotLight?: boolean;
    isDirectionalLight?: boolean;
    distance?: number;
    decay?: number;
    angle?: number;
    target?: Object3D;
  }): PunctualSample {
    const position = new Vector3();
    light.getWorldPosition(position);
    const target = new Vector3();
    light.target?.getWorldPosition(target);
    const direction = target.sub(position.clone()).normalize();
    if (direction.lengthSq() < 1e-8) {
      direction.set(0, -1, 0);
    }
    const kind = light.isSpotLight ? 'spot' :
        light.isDirectionalLight   ? 'directional' :
                                     'point';
    return {
      kind,
      px: position.x,
      py: position.y,
      pz: position.z,
      dx: direction.x,
      dy: direction.y,
      dz: direction.z,
      colorR: light.color.r,
      colorG: light.color.g,
      colorB: light.color.b,
      distance: light.distance ?? 0,
      angle: light.angle ?? Math.PI / 3,
      decay: light.decay ?? 2,
      intensity: Math.max(0, light.intensity),
    };
  }

  private emissiveSamples(material: MeshStandardMaterial, meshes: Mesh[]):
      EmissiveSample[] {
    const found: EmissiveSample[] = [];
    const color = material.emissive;
    for (const mesh of meshes) {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex();
      if (position == null) {
        continue;
      }
      const triCount = index != null ? Math.floor(index.count / 3) :
                                       Math.floor(position.count / 3);
      const stride = Math.max(1, Math.floor(triCount / 24));
      mesh.updateWorldMatrix(true, false);
      for (let tri = 0; tri < triCount && found.length < 24; tri += stride) {
        const i0 = index != null ? index.getX(tri * 3) : tri * 3;
        const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
        tmp.fromBufferAttribute(position as BufferAttribute, i0);
        tmp2.fromBufferAttribute(position as BufferAttribute, i1);
        tmpN.fromBufferAttribute(position as BufferAttribute, i2);
        const ab = tmp2.clone().sub(tmp);
        const ac = tmpN.clone().sub(tmp);
        const cross = ab.cross(ac);
        const area = cross.length() * 0.5;
        if (area < 1e-8) {
          continue;
        }
        const center = tmp.clone().add(tmp2).add(tmpN).multiplyScalar(1 / 3);
        center.applyMatrix4(mesh.matrixWorld);
        cross.transformDirection(mesh.matrixWorld).normalize();
        found.push({
          x: center.x,
          y: center.y,
          z: center.z,
          nx: cross.x,
          ny: cross.y,
          nz: cross.z,
          r: color.r * (material.emissiveIntensity ?? 1),
          g: color.g * (material.emissiveIntensity ?? 1),
          b: color.b * (material.emissiveIntensity ?? 1),
          area: area * stride,
        });
      }
    }
    return found;
  }

  private stepLights(budgetMs: number) {
    if (this.lights.length === 0 || this.surface == null || this.bvh == null) {
      this.lightsReady = true;
      return;
    }
    const start = performance.now();
    while (this.lightCursor < this.lights.length) {
      const light = this.lights[this.lightCursor];
      while (light.cursor < this.surfaceCount) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        const o = light.cursor * 8;
        const rgb = light.punctual != null ? directAtPoint(
                                                 this.bvh,
                                                 this.surface[o],
                                                 this.surface[o + 1],
                                                 this.surface[o + 2],
                                                 this.surface[o + 3],
                                                 this.surface[o + 4],
                                                 this.surface[o + 5],
                                                 light.punctual) :
                                             emissiveAtPoint(
                                                 this.bvh,
                                                 this.surface[o],
                                                 this.surface[o + 1],
                                                 this.surface[o + 2],
                                                 this.surface[o + 3],
                                                 this.surface[o + 4],
                                                 this.surface[o + 5],
                                                 light.emissive ?? []);
        const resolution = this.settings.bake.textureAO.resolution;
        const x = Math.min(
            resolution - 1, Math.floor(this.surface[o + 6] * resolution));
        const y = Math.min(
            resolution - 1, Math.floor(this.surface[o + 7] * resolution));
        const texel = (y * resolution + x) * 4;
        light.data[texel] += rgb[0];
        light.data[texel + 1] += rgb[1];
        light.data[texel + 2] += rgb[2];
        light.data[texel + 3] = 1;
        light.cursor++;
      }
      light.done = true;
      this.publishLight(light);
      this.lightCursor++;
    }
    this.lightsReady = true;
    this.lightFade = {...this.lightFade, target: 1};
    this.bakeMs.lightLayers = performance.now() - this.lightStamp;
  }

  private stepGpu() {
    if (this.phase === 'probes') {
      this.stepProbes();
    }
    if (this.settings.view === 'beauty' && this.settings.shadowPass.enabled) {
      this.noteShadowLayer();
    }
    // The screen-space shadow samples before the UV atlas. The full-material
    // trace starts once that layer is stored.
    if (this.shadowPending() || this.aoReady ||
        !this.settings.bake.textureAO.enabled) {
      this.stepTrace();
    }
  }

  private stepProbes() {
    const renderer = this.host.renderer();
    const scene = this.host.scene();
    const camera = this.host.camera();
    if (renderer == null || scene == null || camera == null) {
      return;
    }
    if (!this.settings.probes.enabled) {
      this.phase = 'done';
      return;
    }
    if (this.probeFade.target === 0 && this.probesReady &&
        this.probeFade.value > 0.02) {
      return;
    }
    if (this.probes.length === 0) {
      const count = this.settings.probes.count;
      const center = scene.boundingBox.getCenter(new Vector3());
      for (let i = 0; i < count; i++) {
        const probe = new ProbeBaker(this.settings.probes.resolution);
        const position =
            placeProbe(center, scene.size, camera, i, count, new Vector3());
        probe.setPosition(
            position.x,
            position.y,
            position.z,
            Math.max(scene.size.length() * 8, 10));
        this.probes.push(probe);
      }
      this.probeIndex = 0;
    }
    const probe = this.probes[this.probeIndex];
    if (probe == null) {
      this.finishProbes();
      return;
    }
    this.ensureCaptureSky(scene);
    if (this.captureSky == null) {
      return;
    }
    probe.step(
        renderer, scene, this.captureSky, (hide) => this.hideProduct(hide));
    if (probe.done) {
      console.info('PROBE skyScale', probe.skyScale.toFixed(3));
      this.probeIndex++;
      if (this.probeIndex >= this.probes.length) {
        this.finishProbes();
      }
    }
  }

  private finishProbes() {
    this.probesReady = true;
    this.probeFade = {...this.probeFade, target: 1};
    this.bakeMs.probes = performance.now() - this.probeStamp;
    this.phase = 'done';
  }

  private stepTrace() {
    const view = this.settings.view;
    if (view === 'occlusion' || view === 'bake' || view === 'realtime') {
      return;
    }
    if (this.host.shadowStale() &&
        this.idleMs >= this.settings.idleDelayMs) {
      this.host.restartShadow();
      this.shadowNoted = false;
      this.aoFade = {...this.aoFade, target: 0};
      this.aoReady = false;
      return;
    }
    const shadowing = this.shadowPending();
    if (!shadowing && this.idleMs < this.settings.idleDelayMs) {
      return;
    }
    if (!this.traceBuildRequested) {
      this.traceBuildRequested = true;
      this.host.buildTrace();
      return;
    }
    if (!this.host.traceReady()) {
      return;
    }
    if (this.host.traceSamples() >= this.host.maxSamples()) {
      return;
    }
    const ms = this.host.sampleTrace();
    if (ms >= 0) {
      this.cpuMax = Math.max(this.cpuMax, ms);
    }
    if (!shadowing &&
        this.host.traceSamples() >= this.settings.traceRevealSamples) {
      this.traceHold = true;
      this.traceFade = {...this.traceFade, target: 1};
    }
  }

  private publishContact() {
    if (this.contact == null) {
      return;
    }
    expandPenumbraByHeight(
        this.contact.grid,
        this.contact.heights,
        this.contact.resolution,
        this.contact.width,
        this.contact.depth,
        this.contact.heightScale);
    const radius = 1;
    const grid =
        blurOcclusion(this.contact.grid, this.contact.resolution, radius);
    const data =
        new Uint8Array(this.contact.resolution * this.contact.resolution * 4);
    for (let i = 0; i < grid.length; i++) {
      data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, grid[i])) * 255);
    }
    this.contactTexture?.dispose();
    this.contactTexture = new DataTexture(
        data, this.contact.resolution, this.contact.resolution, RGBAFormat);
    this.contactTexture.colorSpace = LinearSRGBColorSpace;
    this.contactTexture.needsUpdate = true;
    this.contactTexture.wrapS = ClampToEdgeWrapping;
    this.contactTexture.wrapT = ClampToEdgeWrapping;
    this.contactTexture.minFilter = LinearFilter;
    this.contactTexture.magFilter = LinearFilter;
    this.contactTexture.generateMipmaps = false;
    const scene = this.host.scene();
    if (this.contactMesh == null && scene != null) {
      const material = new MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        side: FrontSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.contactMesh = new Mesh(new PlaneGeometry(1, 1), material);
      this.contactMesh.name = 'ProgressiveContactShadow';
      this.contactMesh.userData.progressiveOverlay = true;
      this.contactMesh.userData.noHit = true;
      this.contactMesh.renderOrder = 2;
      scene.target.add(this.contactMesh);
    }
    const material = this.contactMesh?.material as MeshBasicMaterial;
    if (material != null) {
      material.map = this.contactTexture;
      material.needsUpdate = true;
    }
    if (this.contactMesh != null && this.contact != null) {
      this.contactMesh.position.set(
          this.contact.centerX, this.contact.y, this.contact.centerZ);
      this.contactMesh.rotation.set(-Math.PI / 2, 0, 0);
      this.contactMesh.scale.set(this.contact.width, this.contact.depth, 1);
    }
    this.contactReady = true;
    this.contactFade = {...this.contactFade, target: 1};
    this.bakeMs.contactShadow = performance.now() - this.contactStamp;
  }

  /** Ratio of path-traced irradiance to the unoccluded irradiance. No blur. */
  private publishFactor(
      front: Float32Array, back: Float32Array, resolution: number) {
    const scale = usableFactorScale(this.factorScale);
    const ratio = (source: Float32Array) => {
      const out = new Float32Array(source.length);
      out.fill(-1);
      for (let i = 0; i < source.length; i++) {
        if (source[i] >= 0) {
          out[i] = source[i] / scale;
        }
      }
      return out;
    };
    const frontRatio = ratio(front);
    const backRatio = ratio(back);
    const data = new Uint8Array(resolution * resolution * 4);
    for (let i = 0; i < frontRatio.length; i++) {
      const frontByte = frontRatio[i] < 0 ?
          255 :
          Math.round(Math.min(1, Math.max(0, frontRatio[i])) * 255);
      const backByte = backRatio[i] < 0 ?
          frontByte :
          Math.round(Math.min(1, Math.max(0, backRatio[i])) * 255);
      if (frontRatio[i] < 0 && backRatio[i] < 0) {
        data[i * 4] = 255;
        data[i * 4 + 1] = 255;
        data[i * 4 + 2] = 255;
        data[i * 4 + 3] = 0;
      } else {
        data[i * 4] = frontByte;
        data[i * 4 + 1] = backByte;
        data[i * 4 + 2] = frontByte;
        data[i * 4 + 3] = 255;
      }
    }
    this.uploadAo(data, resolution);
  }

  private uploadAo(data: Uint8Array, resolution: number) {
    this.aoTexture?.dispose();
    this.aoTexture = new DataTexture(data, resolution, resolution, RGBAFormat);
    this.aoTexture.colorSpace = LinearSRGBColorSpace;
    this.aoTexture.wrapS = ClampToEdgeWrapping;
    this.aoTexture.wrapT = ClampToEdgeWrapping;
    this.aoTexture.minFilter = LinearFilter;
    this.aoTexture.magFilter = LinearFilter;
    this.aoTexture.generateMipmaps = false;
    this.aoTexture.channel = 1;
    this.aoTexture.needsUpdate = true;
    this.bindAoView();
    this.aoReady = true;
    this.aoFade = {...this.aoFade, target: 1};
    this.bakeMs.textureAO = performance.now() - this.aoStamp;
  }

  private publishLight(light: LightBake) {
    const resolution = this.settings.bake.textureAO.resolution;
    light.texture = new DataTexture(
        light.data, resolution, resolution, RGBAFormat, FloatType);
    light.texture.colorSpace = LinearSRGBColorSpace;
    light.texture.minFilter = LinearFilter;
    light.texture.magFilter = LinearFilter;
    light.texture.generateMipmaps = false;
    light.texture.needsUpdate = true;
    light.fade = {...light.fade, target: light.weight()};
  }

  private compositeLights() {
    const renderer = this.host.renderer();
    if (renderer == null || !this.lightsReady) {
      return;
    }
    const resolution = this.settings.bake.textureAO.resolution;
    if (this.lightTarget == null) {
      this.lightTarget = new WebGLRenderTarget(resolution, resolution, {
        type: FloatType,
        format: RGBAFormat,
        depthBuffer: false,
        colorSpace: LinearSRGBColorSpace,
      });
      this.lightTarget.texture.channel = 1;
      this.lightTarget.texture.colorSpace = LinearSRGBColorSpace;
      this.lightMaterial = new MeshBasicMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.lightQuad = new FullScreenQuad(this.lightMaterial);
    }
    const previous = renderer.getRenderTarget();
    const previousClear = renderer.autoClear;
    renderer.setRenderTarget(this.lightTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    for (const light of this.lights) {
      if (light.texture == null || light.fade.value <= 0.001) {
        continue;
      }
      this.lightMaterial!.map = light.texture;
      this.lightMaterial!.opacity = light.fade.value * this.lightFade.value;
      this.lightQuad!.render(renderer);
    }
    renderer.setRenderTarget(previous);
    renderer.autoClear = previousClear;
    this.forStandardMaterials((material) => {
      this.remember(material);
      if (material.lightMap !== this.lightTarget!.texture) {
        material.lightMap = this.lightTarget!.texture;
        material.lightMapIntensity = 1;
        material.needsUpdate = true;
      }
    });
  }

  private applyProbeEnv() {
    let nearest = this.probes[0];
    const camera = this.host.camera();
    if (camera != null && this.probes.length > 1) {
      camera.getWorldPosition(tmp);
      let best = Infinity;
      for (const candidate of this.probes) {
        const distance = tmp.distanceToSquared(candidate.position);
        if (distance < best && candidate.done) {
          best = distance;
          nearest = candidate;
        }
      }
    }
    const probeMap = nearest?.productMapTarget?.texture ?? null;
    const show = this.probeFade.value > 0.5 && probeMap != null;
    const scene = this.host.scene();
    // Exposure stays on the tone mapper. This matches environmentIntensity
    // and corrects a cubemap sky that came out dimmer than the HDR.
    const intensity =
        (scene?.environmentIntensity ?? 1) * (nearest?.skyScale ?? 1);
    this.forStandardMaterials((material) => {
      this.remember(material);
      const saved = this.savedMaterials.get(material);
      const next = show ? probeMap : (saved?.envMap ?? null);
      if (material.envMap !== next ||
          (show && material.envMapIntensity !== intensity)) {
        material.envMap = next;
        if (show) {
          material.envMapIntensity = intensity;
        } else if (saved != null) {
          material.envMapIntensity = saved.envMapIntensity;
        }
        material.needsUpdate = true;
      }
    });
  }

  private syncRealtimeShadow() {
    const scene = this.host.scene();
    const shadow = scene?.shadow;
    if (shadow == null || scene == null) {
      return;
    }
    const mix = this.settings.bake.contactShadow.enabled ? this.contactFade.value : 0;
    shadow.setIntensity(scene.shadowIntensity * (1 - mix));
  }

  private applyVisuals() {
    const material =
        this.contactMesh?.material as MeshBasicMaterial | undefined;
    if (material != null) {
      material.opacity =
          this.settings.bake.contactShadow.opacity * this.contactFade.value;
      material.transparent = true;
      this.contactMesh!.visible = this.contactFade.value > 0.01;
    }
    this.syncRealtimeShadow();
    if (this.aoTexture != null) {
      this.bindAoView();
    }
    if (this.lights.some((light) => light.texture != null)) {
      this.compositeLights();
    }
    if (this.probesReady) {
      this.applyProbeEnv();
    }
  }

  /**
   * beauty multiplies the factor onto realtime lighting. bake shows the
   * factor itself on white. realtime and the shadow view leave the model
   * unoccluded so the path tracer picture is the only occlusion.
   */
  private bindAoView() {
    const view = this.settings.view;
    const token = view + (this.aoTexture?.uuid ?? '');
    if (token === this.boundAoView) {
      if (view === 'beauty' && this.aoTexture != null) {
        this.forStandardMaterials((material) => {
          material.aoMapIntensity = this.aoFade.value;
        });
      }
      return;
    }
    this.boundAoView = token;
    const showFactor = view === 'bake';
    const hide = view === 'realtime' || view === 'occlusion';
    this.forStandardMaterials((material) => {
      this.remember(material);
      const saved = this.savedMaterials.get(material);
      material.aoMap = hide ? (saved?.aoMap ?? null) : this.aoTexture;
      material.aoMapIntensity = hide ? (saved?.aoMapIntensity ?? 1) : (
          showFactor ? 1 : this.aoFade.value);
      material.toneMapped = view !== 'bake';
      const key = showFactor ? 'ld-bake-factor' : 'ld-ao-front-back';
      material.onBeforeCompile = (shader, renderer) => {
        saved?.onBeforeCompile?.call(material, shader, renderer);
        if (hide || material.aoMap == null) {
          return;
        }
        shader.fragmentShader = shader.fragmentShader.replace(
            /texture2D\( aoMap, vAoMapUv \)\.r/g,
            '( gl_FrontFacing ? texture2D( aoMap, vAoMapUv ).r : texture2D( aoMap, vAoMapUv ).g )');
        if (showFactor) {
          shader.fragmentShader = shader.fragmentShader.replace(
              '#include <dithering_fragment>',
              `{
                vec4 ldFactor = texture2D( aoMap, vAoMapUv );
                float ldF = gl_FrontFacing ? ldFactor.r : ldFactor.g;
                gl_FragColor.rgb = vec3( ldF );
              }
              #include <dithering_fragment>`);
        }
      };
      material.customProgramCacheKey = () => key;
      material.needsUpdate = true;
    });
  }

  private remember(material: MeshStandardMaterial) {
    if (this.savedMaterials.has(material)) {
      return;
    }
    this.savedMaterials.set(material, {
      aoMap: material.aoMap ?? null,
      aoMapIntensity: material.aoMapIntensity,
      lightMap: material.lightMap ?? null,
      lightMapIntensity: material.lightMapIntensity,
      envMap: material.envMap ?? null,
      envMapIntensity: material.envMapIntensity,
      onBeforeCompile: material.onBeforeCompile,
      customProgramCacheKey: material.customProgramCacheKey,
    });
  }

  private forStandardMaterials(
      visit: (material: MeshStandardMaterial) => void) {
    const seen = new Set<MeshStandardMaterial>();
    for (const mesh of this.meshes) {
      const materials =
          Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        const standard = material as MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial || seen.has(standard)) {
          continue;
        }
        seen.add(standard);
        visit(standard);
      }
    }
  }

  private syncLightWeights() {
    for (const light of this.lights) {
      light.fade = {...light.fade, target: Math.max(0, light.weight())};
    }
  }

  private emitEvents() {
    if (this.settings.bake.contactShadow.enabled) {
      this.emit(
          'contact-shadow-ready',
          this.contactReady,
          this.contactFade.value,
          this.contactProgress(),
          this.bakeMs.contactShadow);
    }
    if (this.settings.bake.textureAO.enabled) {
      this.emit(
          'ao-ready',
          this.aoReady,
          this.aoFade.value,
          this.aoProgress(),
          this.bakeMs.textureAO);
    }
    if (this.settings.lights.include) {
      this.emit(
          'light-layers-ready',
          this.lightsReady,
          this.lightFade.value,
          this.lightProgress(),
          this.bakeMs.lightLayers);
    }
    if (this.settings.probes.enabled) {
      this.emit(
          'probes-ready',
          this.probesReady,
          this.probeFade.value,
          this.probeProgress(),
          this.bakeMs.probes);
    }
  }

  private emit(
      name: string, ready: boolean, fade: number, progress: number,
      elapsedMs: number) {
    if (!this.settings || this.settings.mode !== 'progressive') {
      return;
    }
    const now = performance.now();
    if (ready) {
      if (this.sent.has(name)) {
        return;
      }
      this.sent.add(name);
    } else if (now - (this.lastProgress.get(name) ?? 0) < 200) {
      return;
    }
    this.lastProgress.set(name, now);
    this.host.dispatch(name, {progress, ready, fade, elapsedMs});
  }

  private describeActivity(): {label: string; step: number;} {
    if (this.phase === 'fadeout') {
      return {label: 'fading previous bake', step: 0};
    }
    if (this.phase === 'collect') {
      const total = this.meshes.length;
      if (this.positions == null || total === 0) {
        return {label: 'waiting for scene', step: 0};
      }
      return {
        label: `collecting geometry ${this.fillMesh}/${total} meshes`,
        step: this.fillMesh / total,
      };
    }
    if (this.phase === 'bvh') {
      return {label: 'building BVH', step: -1};
    }
    if (this.phase === 'probes') {
      const step = this.probeProgress();
      return {label: `probes ${Math.round(step * 100)}%`, step};
    }
    if (this.phase === 'done') {
      const samples = this.host.traceSamples();
      const max = this.host.maxSamples();
      if (this.idleMs >= this.settings.idleDelayMs && samples < max) {
        return {
          label: `full trace ${samples}/${max} samples`,
          step: max === 0 ? 1 : samples / max,
        };
      }
      return {label: 'idle', step: 1};
    }
    if (this.contact != null && !this.contactReady) {
      const step = this.contactProgress();
      return {label: `contact shadow ${Math.round(step * 100)}%`, step};
    }
    if (!this.uvReady) {
      if (!this.tilesReady) {
        const total = Math.max(1, this.meshes.length);
        return {
          label: `measuring surface ${this.areaMesh}/${this.meshes.length}`,
          step: this.areaMesh / total,
        };
      }
      const total = Math.max(1, this.uvTasks.length);
      const task = this.uvTasks[this.uvCursor];
      const job = task?.job;
      const mesh = task?.mesh.name ? ` ${task.mesh.name}` : '';
      if (job == null) {
        return {
          label: `UV2 ${this.uvCursor}/${this.uvTasks.length}`,
          step: this.uvCursor / total,
        };
      }
      const slice = this.uvSlice(job);
      return {
        label: `UV2 ${job.phase}${mesh} ${this.uvCursor + 1}/${
            this.uvTasks.length} · ${slice.label}`,
        step: (this.uvCursor + slice.step) / total,
      };
    }
    if (!this.surfaceDone &&
        (this.settings.bake.textureAO.enabled ||
         this.settings.lights.include)) {
      return {label: 'sampling surface', step: -1};
    }
    if (this.settings.bake.textureAO.enabled && !this.aoReady) {
      const step = this.aoProgress();
      return {label: `texture AO ${Math.round(step * 100)}%`, step};
    }
    if (this.settings.lights.include && !this.lightsReady) {
      const step = this.lightProgress();
      return {label: `light layers ${Math.round(step * 100)}%`, step};
    }
    return {label: 'bake', step: 1};
  }

  private uvSlice(job: UvJob): {label: string; step: number;} {
    const tri = Math.max(1, job.triCount);
    const pct = (cursor: number) => {
      const step = Math.min(1, cursor / tri);
      return {label: `${Math.round(step * 100)}%`, step};
    };
    if (job.phase === 'copy') {
      const step = Math.min(1, job.copyCursor / Math.max(1, job.vertexCount));
      return {label: `${Math.round(step * 100)}%`, step};
    }
    if (job.phase === 'normals') {
      return pct(job.normalCursor);
    }
    if (job.phase === 'edges') {
      return pct(job.edgeCursor);
    }
    if (job.phase === 'charts') {
      const slice = pct(job.chartCursor);
      return {
        label: `${slice.label} · ${job.chartCount} charts`,
        step: slice.step,
      };
    }
    if (job.phase === 'pack') {
      const stage = job.pack?.stage ?? 'pack';
      const slice = pct(job.pack?.cursor ?? 0);
      return {label: `${stage} ${slice.label}`, step: slice.step};
    }
    return {label: job.done ? 'done' : job.phase, step: job.done ? 1 : 0};
  }

  private contactProgress(): number {
    if (!this.settings.bake.contactShadow.enabled) {
      return 1;
    }
    if (this.contact == null) {
      return this.phase === 'collect' || this.phase === 'bvh' ? 0.05 : 0;
    }
    const total = this.contact.resolution * this.contact.resolution;
    return total === 0 ? 0 : this.contact.cursor / total;
  }

  private aoProgress(): number {
    if (!this.settings.bake.textureAO.enabled) {
      return 1;
    }
    if (!this.uvReady) {
      return this.uvTasks.length === 0 ?
          0.1 :
          this.uvCursor / this.uvTasks.length * 0.4;
    }
    if (this.surfaceCount === 0) {
      return 0.45;
    }
    const samples = ProgressivePipeline.SHADOW_SAMPLES;
    return 0.45 + 0.55 * (this.aoCursor / samples);
  }

  private lightProgress(): number {
    if (!this.settings.lights.include) {
      return 1;
    }
    if (this.lights.length === 0) {
      return this.lightsReady ? 1 : 0.2;
    }
    const done = this.lights.filter((light) => light.done).length;
    return done / this.lights.length;
  }

  private probeProgress(): number {
    if (!this.settings.probes.enabled) {
      return 1;
    }
    if (this.probes.length === 0) {
      return 0;
    }
    const done = this.probes.filter((probe) => probe.done).length;
    return done / this.probes.length;
  }

  private needsFrame(): boolean {
    const fading = !fadeSettled(this.contactFade) ||
        !fadeSettled(this.aoFade) || !fadeSettled(this.lightFade) ||
        !fadeSettled(this.probeFade) || !fadeSettled(this.traceFade);
    if (this.settings.view === 'beauty' && this.settings.shadowPass.enabled &&
        !this.host.shadowLayerReady()) {
      return true;
    }
    if (this.settings.view === 'occlusion') {
      return this.phase !== 'done' || fading ||
          this.host.occlusionSamples() < this.host.maxSamples();
    }
    if (this.settings.view === 'bake' || this.settings.view === 'realtime') {
      return this.phase !== 'done' || fading;
    }
    return this.phase !== 'done' || fading ||
        (this.phase === 'done' && this.idleMs >= this.settings.idleDelayMs &&
         this.host.traceSamples() < this.host.maxSamples());
  }

  private geometryFingerprint(scene: ModelScene): string {
    const parts: string[] = [];
    scene.traverseVisible((object) => {
      if (!isBakeMesh(object)) {
        return;
      }
      const source =
          (object.userData.progressiveSourceGeometry as BufferGeometry |
           undefined) ??
          object.geometry;
      const count = source.getAttribute('position')?.count ?? 0;
      parts.push(object.uuid, source.uuid, String(count));
    });
    return parts.join('|');
  }

  private materialFingerprint(scene: ModelScene): string {
    const parts: string[] = [];
    scene.traverseVisible((object) => {
      if (!isBakeMesh(object)) {
        return;
      }
      const materials =
          Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const standard = material as MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial) {
          parts.push(material.uuid);
          continue;
        }
        parts.push(
            standard.uuid,
            String(standard.color?.getHex?.() ?? 0),
            String(standard.roughness ?? 1),
            String(standard.metalness ?? 0),
            String(standard.opacity ?? 1),
            String(standard.emissive?.getHex?.() ?? 0),
            standard.map?.uuid ?? '',
            standard.normalMap?.uuid ?? '');
      }
    });
    return parts.join('|');
  }

  private lightFingerprint(scene: ModelScene): string {
    const parts: string[] = [];
    scene.traverse((object) => {
      const light = object as Object3D & {
        isLight?: boolean;
        intensity?: number;
        visible: boolean;
        color?: {getHex?: () => number};
      };
      if (light.isLight) {
        parts.push(
            light.uuid,
            String(light.intensity),
            String(light.visible),
            String(light.color?.getHex?.() ?? 0));
      }
      const mesh = object as Mesh;
      const material = mesh.material as MeshStandardMaterial;
      if (material?.emissiveIntensity != null && material.emissive != null &&
          material.emissive.getHex() !== 0) {
        parts.push(
            material.uuid,
            String(material.emissiveIntensity),
            String(material.emissive.getHex()));
      }
    });
    return parts.join('|');
  }

  private ensureCaptureSky(scene: ModelScene) {
    if (this.captureSky != null || this.captureSkyRequested) {
      return;
    }
    const sky = scene.skyboxTexture;
    if (sky != null && sky.mapping === EquirectangularReflectionMapping) {
      this.captureSky = sky;
      return;
    }
    const url = scene.element.getAttribute('environment-image');
    if (url == null || url === '') {
      return;
    }
    this.captureSkyRequested = true;
    const loader = new RGBELoader();
    loader.load(url, (texture) => {
      if (this.disposed) {
        texture.dispose();
        return;
      }
      texture.mapping = EquirectangularReflectionMapping;
      texture.colorSpace = LinearSRGBColorSpace;
      this.captureSky = texture;
    });
  }

  private loadEnvironment(url: string) {
    this.customEnvUrl = url;
    const loader = new RGBELoader();
    loader.load(url, (texture) => {
      if (this.disposed || this.customEnvUrl !== url) {
        texture.dispose();
        return;
      }
      texture.mapping = EquirectangularReflectionMapping;
      this.customEnv?.dispose();
      this.customEnv = texture;
      this.noteChange('environment');
    });
  }

  private restoreMaterials() {
    this.savedMaterials.forEach((saved, material) => {
      material.aoMap = saved.aoMap;
      material.aoMapIntensity = saved.aoMapIntensity;
      material.lightMap = saved.lightMap;
      material.lightMapIntensity = saved.lightMapIntensity;
      material.envMap = saved.envMap;
      material.envMapIntensity = saved.envMapIntensity;
      material.onBeforeCompile = saved.onBeforeCompile;
      material.customProgramCacheKey = saved.customProgramCacheKey;
      material.needsUpdate = true;
    });
    this.savedMaterials.clear();
  }

  private restoreGeometry() {
    this.replaced.forEach((geometry, mesh) => {
      const clone = mesh.geometry;
      mesh.geometry = geometry;
      delete mesh.userData.progressiveSourceGeometry;
      if (clone !== geometry) {
        clone.dispose();
      }
    });
    this.replaced.clear();
  }

  private resetResources() {
    this.generation++;
    try {
      this.worker?.dispose();
    } catch {
      // The worker may already have stopped.
    }
    this.worker = null;
    this.workerFailed = false;
    this.bvh = null;
    this.bvhPending = false;
    this.positions = null;
    this.indices = null;
    this.contact = null;
    this.contactReady = false;
    this.uvTasks = [];
    this.uvCursor = 0;
    this.uvReady = false;
    this.tileOf.clear();
    this.tilesReady = false;
    this.areaMesh = 0;
    this.areaTri = 0;
    this.areaPartial = 0;
    this.meshAreas = [];
    this.factorBake?.dispose();
    this.factorBake = null;
    this.uvPlaced.clear();
    this.geometryOwner.clear();
    this.overlapSkips = 0;
    this.surfacePass = 0;
    this.surface = null;
    this.surfaceDone = false;
    this.surfaceCount = 0;
    this.aoCursor = 0;
    this.aoReady = false;
    this.lights = [];
    this.lightCursor = 0;
    this.lightsReady = false;
    this.probesReady = false;
    for (const probe of this.probes) {
      probe.dispose();
    }
    this.probes = [];
    this.probeIndex = 0;
    this.contactMesh?.removeFromParent();
    this.contactTexture?.dispose();
    this.contactTexture = null;
    this.aoTexture?.dispose();
    this.aoTexture = null;
    this.lightTarget?.dispose();
    this.lightTarget = null;
    this.lightQuad?.dispose();
    this.lightQuad = null;
    this.lightMaterial?.dispose();
    this.lightMaterial = null;
    this.restoreMaterials();
  }
}

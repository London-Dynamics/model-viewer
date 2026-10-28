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

import {AdditiveBlending, BufferAttribute, BufferGeometry, Camera, ClampToEdgeWrapping, Color, DataTexture, EquirectangularReflectionMapping, FloatType, FrontSide, LinearFilter, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, RGBAFormat, ShaderMaterial, Texture, Vector3, WebGLRenderer, WebGLRenderTarget} from 'three';
import {SAH} from 'three-mesh-bvh';
import {RGBELoader} from 'three/examples/jsm/loaders/RGBELoader.js';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {ModelScene} from '../../../ModelScene.js';
import {PathTracerBVHWorker} from '../PathTracerBVHWorker.js';

import {blurOcclusion, ContactJob, stepContactRays} from './contact-shadow.js';
import {createFade, fadeSettled, FadeState, stepFade} from './fade.js';
import {ChangeKind, planInvalidation} from './invalidation.js';
import {directAtPoint, emissiveAtPoint, EmissiveSample, occlusionAtPoint, PunctualSample} from './lighting.js';
import {cloneProgressiveSettings, progressiveBakeKey, ProgressiveSettings} from './options.js';
import {placeProbe, ProbeBaker} from './probe-baker.js';
import {applyUvJob, createUvJob, stepUvJob, uv1IsValid, UvJob} from './uv2.js';

export interface ProgressiveHost {
  renderer(): WebGLRenderer|null;
  scene(): ModelScene|null;
  camera(): Camera|null;
  requestRender(): void;
  dispatch(name: string, detail: Record<string, unknown>): void;
  buildTrace(): void;
  traceReady(): boolean;
  resetTrace(): void;
  sampleTrace(): number;
  traceSamples(): number;
  maxSamples(): number;
  invalidateTrace(): void;
}

export interface LayerReadout {
  ready: boolean;
  fade: number;
  progress: number;
}

export interface ProgressiveReadout {
  contactShadow: LayerReadout;
  textureAO: LayerReadout;
  lightLayers: LayerReadout;
  probes: LayerReadout;
  fullTrace:
      {samples: number; fade: number; revealed: boolean; idleMs: number;};
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
  private replaced = new Map<Mesh, BufferGeometry>();
  private surface: Float32Array|null = null;
  private surfaceGrid: Int32Array|null = null;
  private surfaceDone = false;
  private surfaceCount = 0;
  private surfaceMesh = 0;
  private surfaceTri = 0;
  private aoData: Float32Array|null = null;
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
  }
  > ();
  private probes: ProbeBaker[] = [];
  private probeIndex = 0;
  private probeFade = createFade();
  private probesReady = false;
  private blendMaterial: ShaderMaterial|null = null;
  private blendQuad: FullScreenQuad|null = null;
  private blendTarget: WebGLRenderTarget|null = null;
  private traceFade = createFade();
  private traceHold = false;
  private traceBuildRequested = false;
  private customEnv: Texture|null = null;
  private customEnvUrl = '';
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
  }

  get traceFadeValue(): number {
    return this.traceFade.value;
  }

  get traceHoldImage(): boolean {
    return this.traceHold;
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
    return {
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
      const sliceStart = performance.now();
      this.stepWork(this.settings.budgetMs);
      this.cpuLast = performance.now() - sliceStart;
      this.cpuMax = Math.max(this.cpuMax, this.cpuLast);
      if (this.cpuLast < this.settings.budgetMs * 0.85) {
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
      this.traceFade = {...this.traceFade, target: 0};
      this.host.resetTrace();
      if (kind !== 'camera') {
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

  private requestRestart() {
    this.contactFade = {...this.contactFade, target: 0};
    this.aoFade = {...this.aoFade, target: 0};
    this.lightFade = {...this.lightFade, target: 0};
    this.probeFade = {...this.probeFade, target: 0};
    this.traceFade = {...this.traceFade, target: 0};
    this.host.resetTrace();
    this.host.invalidateTrace();
    this.traceBuildRequested = false;
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
      for (let i = 0; i < count; i++) {
        const vertex = index != null ? index.getX(i) : i;
        this.indices![this.write++] = this.vertexBase + vertex;
      }
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
    geometry.setIndex(new BufferAttribute(this.indices, 1));
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
    if (scene == null || this.bvh == null) {
      return;
    }
    const size = scene.size;
    const box = scene.boundingBox;
    const center = box.getCenter(tmp);
    if (this.settings.bake.contactShadow.enabled) {
      const resolution = this.settings.bake.contactShadow.resolution;
      const width = Math.max(size.x, 0.05) * 1.45;
      const depth = Math.max(size.z, 0.05) * 1.45;
      this.contact = {
        resolution,
        centerX: center.x,
        centerZ: center.z,
        width,
        depth,
        y: box.min.y,
        softnessRadius: this.settings.bake.contactShadow.softness *
            Math.max(size.x, size.z),
        samples: this.settings.bake.contactShadow.softness > 0 ? 8 : 1,
        maxDistance: Math.max(size.y * 1.25, 0.05),
        grid: new Float32Array(resolution * resolution),
        cursor: 0,
      };
      this.contactStamp = performance.now();
    } else {
      this.contactReady = true;
    }
    const wantUv = this.settings.bake.textureAO.enabled ||
        (this.settings.lights.include && this.sceneHasLights());
    this.uvTasks = [];
    if (wantUv) {
      const resolution = this.settings.bake.textureAO.resolution;
      for (const mesh of this.meshes) {
        const source =
            (mesh.userData.progressiveSourceGeometry as BufferGeometry |
             undefined) ??
            mesh.geometry;
        if (uv1IsValid(source)) {
          continue;
        }
        const job = createUvJob(source, resolution);
        if (job != null) {
          this.uvTasks.push({mesh, job});
        }
      }
    }
    this.uvReady = this.uvTasks.length === 0;
    if (!this.settings.bake.textureAO.enabled) {
      this.aoReady = true;
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
        !this.aoReady && this.bvh != null) {
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
    this.uvReady = true;
  }

  private applyUv(mesh: Mesh, job: UvJob) {
    const source = (mesh.userData.progressiveSourceGeometry as BufferGeometry |
                    undefined) ??
        mesh.geometry;
    const next = applyUvJob(source, job);
    if (next == null) {
      return;
    }
    if (next !== source) {
      if (mesh.userData.progressiveSourceGeometry == null) {
        mesh.userData.progressiveSourceGeometry = source;
        this.replaced.set(mesh, source);
      }
      mesh.geometry = next;
    }
  }

  private stepSurface(budgetMs: number) {
    const resolution = this.settings.bake.textureAO.resolution;
    if (this.surface == null || this.surfaceGrid == null) {
      this.surface = new Float32Array(resolution * resolution * 8);
      this.surfaceGrid = new Int32Array(resolution * resolution);
      this.surfaceGrid.fill(-1);
      this.surfaceCount = 0;
      this.surfaceMesh = 0;
      this.surfaceTri = 0;
    }
    const grid = this.surfaceGrid;
    const start = performance.now();
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
      while (this.surfaceTri < triCount) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        const tri = this.surfaceTri++;
        const i0 = index != null ? index.getX(tri * 3) : tri * 3;
        const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
        this.rasterTriangle(
            mesh, uv, position, normal, i0, i1, i2, resolution, grid);
      }
      this.surfaceMesh++;
      this.surfaceTri = 0;
    }
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
      grid: Int32Array) {
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
    if (maxX - minX > 48 || maxY - minY > 48) {
      return;
    }
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const slot = y * resolution + x;
        if (grid[slot] !== -1) {
          continue;
        }
        const px = (x + 0.5) / resolution;
        const py = (y + 0.5) / resolution;
        const denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denom) < 1e-8) {
          continue;
        }
        const w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
        const w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-3 || w1 < -1e-3 || w2 < -1e-3) {
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
          return;
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

  private compactSurface(resolution: number) {
    const packed = new Float32Array(Math.max(8, this.surfaceCount * 8));
    packed.set(this.surface!.subarray(0, this.surfaceCount * 8));
    this.surface = packed;
    this.surfaceGrid = null;
    if (!this.settings.bake.textureAO.enabled) {
      this.aoReady = true;
    } else {
      this.aoData = new Float32Array(resolution * resolution * 4);
      this.aoData.fill(1);
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

  private stepAo(budgetMs: number) {
    if (this.aoData == null || this.surface == null || this.bvh == null) {
      this.aoReady = true;
      return;
    }
    const distance = this.settings.bake.textureAO.distance > 0 ?
        this.settings.bake.textureAO.distance :
        Math.max(this.host.scene()?.size.length() ?? 1, 0.1) * 0.35;
    const samples = this.settings.bake.textureAO.samples;
    const resolution = this.settings.bake.textureAO.resolution;
    const start = performance.now();
    while (this.aoCursor < this.surfaceCount) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      const o = this.aoCursor * 8;
      const ao = occlusionAtPoint(
          this.bvh,
          this.surface[o],
          this.surface[o + 1],
          this.surface[o + 2],
          this.surface[o + 3],
          this.surface[o + 4],
          this.surface[o + 5],
          samples,
          distance);
      const x = Math.min(
          resolution - 1, Math.floor(this.surface[o + 6] * resolution));
      const y = Math.min(
          resolution - 1, Math.floor(this.surface[o + 7] * resolution));
      const texel = (y * resolution + x) * 4;
      this.aoData[texel] = ao;
      this.aoData[texel + 1] = ao;
      this.aoData[texel + 2] = ao;
      this.aoData[texel + 3] = 1;
      this.aoCursor++;
    }
    this.publishAo(resolution);
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
        const bake: LightBake = {
          id: `punctual:${light.uuid}`,
          fade: createFade(0, 0),
          weight: () => light.visible ? light.intensity : 0,
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
          r: color.r,
          g: color.g,
          b: color.b,
          area,
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
      return;
    }
    if (this.phase === 'done') {
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
    const background = this.customEnv ?? scene.environment ?? null;
    probe.step(renderer, scene, background, (hide) => this.hideProduct(hide));
    if (probe.done) {
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
    if (this.idleMs < this.settings.idleDelayMs) {
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
    if (this.host.traceSamples() >= this.settings.traceRevealSamples) {
      this.traceHold = true;
      this.traceFade = {...this.traceFade, target: 1};
    }
  }

  private publishContact() {
    if (this.contact == null) {
      return;
    }
    const radius = this.contact.softnessRadius > 0 ?
        Math.min(6, Math.max(1, Math.round(this.contact.resolution * 0.02))) :
        0;
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
          this.contact.centerX, this.contact.y - 0.002, this.contact.centerZ);
      this.contactMesh.rotation.set(-Math.PI / 2, 0, 0);
      this.contactMesh.scale.set(this.contact.width, this.contact.depth, 1);
    }
    this.contactReady = true;
    this.contactFade = {...this.contactFade, target: 1};
    this.bakeMs.contactShadow = performance.now() - this.contactStamp;
  }

  private publishAo(resolution: number) {
    if (this.aoData == null) {
      this.aoReady = true;
      return;
    }
    const data = new Uint8Array(this.aoData.length);
    for (let i = 0; i < this.aoData.length; i++) {
      data[i] = Math.round(Math.min(1, Math.max(0, this.aoData[i])) * 255);
    }
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
    this.forStandardMaterials((material) => {
      this.remember(material);
      material.aoMap = this.aoTexture;
      material.needsUpdate = true;
    });
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
    const probe = this.probes[0];
    const renderer = this.host.renderer();
    if (probe == null || !probe.done || renderer == null ||
        probe.environmentMap == null || probe.productMapTarget == null) {
      return;
    }
    if (this.blendMaterial == null) {
      this.blendMaterial = new ShaderMaterial({
        uniforms: {
          mapA: {value: probe.environmentMap.texture},
          mapB: {value: probe.productMapTarget.texture},
          mixAmount: {value: 0},
        },
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D mapA;
          uniform sampler2D mapB;
          uniform float mixAmount;
          varying vec2 vUv;
          void main() {
            gl_FragColor = mix(texture2D(mapA, vUv), texture2D(mapB, vUv), mixAmount);
          }
        `,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.blendQuad = new FullScreenQuad(this.blendMaterial);
      const image = probe.productMapTarget.texture.image;
      const width = image?.width ?? 256;
      const height = image?.height ?? 256;
      this.blendTarget = new WebGLRenderTarget(width, height, {
        type: FloatType,
        format: RGBAFormat,
        depthBuffer: false,
        colorSpace: LinearSRGBColorSpace,
      });
      this.blendTarget.texture.mapping = probe.productMapTarget.texture.mapping;
      this.blendTarget.texture.colorSpace = LinearSRGBColorSpace;
    }
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
    if (nearest.environmentMap == null || nearest.productMapTarget == null) {
      return;
    }
    this.blendMaterial.uniforms.mapA.value = nearest.environmentMap.texture;
    this.blendMaterial.uniforms.mapB.value = nearest.productMapTarget.texture;
    this.blendMaterial.uniforms.mixAmount.value = this.probeFade.value;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.blendTarget);
    this.blendQuad!.render(renderer);
    renderer.setRenderTarget(previous);
    this.forStandardMaterials((material) => {
      this.remember(material);
      if (material.envMap !== this.blendTarget!.texture) {
        material.envMap = this.blendTarget!.texture;
        material.needsUpdate = true;
      }
    });
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
    if (this.aoTexture != null) {
      this.forStandardMaterials((standard) => {
        standard.aoMapIntensity = this.aoFade.value;
      });
    }
    if (this.lights.some((light) => light.texture != null)) {
      this.compositeLights();
    }
    if (this.probesReady) {
      this.applyProbeEnv();
    }
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
    return 0.45 + 0.55 * (this.aoCursor / this.surfaceCount);
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
    return this.phase !== 'done' || !fadeSettled(this.contactFade) ||
        !fadeSettled(this.aoFade) || !fadeSettled(this.lightFade) ||
        !fadeSettled(this.probeFade) || !fadeSettled(this.traceFade) ||
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
    this.surface = null;
    this.surfaceDone = false;
    this.surfaceCount = 0;
    this.aoData = null;
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
    this.blendTarget?.dispose();
    this.blendTarget = null;
    this.restoreMaterials();
  }
}

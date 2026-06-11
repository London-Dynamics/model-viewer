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

import {
  Camera,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoBlending,
  NeutralToneMapping,
  NormalBlending,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {
  DenoiseMaterial,
  PhysicalCamera,
  WebGLPathTracer,
} from 'three-gpu-pathtracer';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {
  AmbientOcclusionOptions,
  LDAmbientOcclusionComposer,
} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

const PATH_TRACER_FADE_DURATION_MS = 600;
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
  private pathTracer: WebGLPathTracer|null = null;
  private ambientOcclusionPreviewComposer: LDAmbientOcclusionComposer|null =
      null;
  private currentAmbientOcclusionPreviewOptions:
      AmbientOcclusionOptions|null = null;
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
  private needsSceneUpdate = true;

  constructor(initialOptions?: Partial<PathTracerOptions>) {
    if (initialOptions) {
      this.updateOptions(initialOptions);
    }
  }

  setRenderer(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.syncAmbientOcclusionPreview();
    this.rebuildPathTracer();
    this.requestRender();
  }

  setMainScene(scene: ModelScene) {
    this.scene = scene;
    this.needsSceneUpdate = true;
    this.syncAmbientOcclusionPreview();
    this.syncScene();
    this.requestRender();
  }

  setMainCamera(camera: Camera) {
    this.camera = camera;
    this.needsSceneUpdate = true;
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
    if (this.pathTracer == null || this.renderer == null || this.scene == null) {
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
        (exposureIsNumber ? exposure : 1.0) *
        (compensateExposure ? 1.3 : 1.0);

    this.pathTracer.renderSample();
    if (this.shouldRenderAmbientOcclusionPreview()) {
      this.ambientOcclusionPreviewComposer?.render(_deltaTime);
    }
    this.renderSoftShadowOverlay();

    if (this.pathTracer.samples < this.options.samples) {
      this.queueNextProgressiveRender();
    }
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

  get ambientOcclusionPreviewOptions() {
    return this.currentAmbientOcclusionPreviewOptions;
  }

  markSceneDirty() {
    this.needsSceneUpdate = true;
    this.meshWorldMatrices.clear();
    this.pathTracer?.reset();
    this.requestRender();
  }

  dispose() {
    try {
      this.pathTracer?.dispose();
    } catch {
      // three-gpu-pathtracer 0.0.23 references a private dispose member that
      // is not present. The renderer-owned WebGL context is still released by
      // model-viewer; swallow that package bug during feature teardown.
    }
    this.pathTracer = null;
    this.ambientOcclusionPreviewComposer?.dispose();
    this.ambientOcclusionPreviewComposer = null;
    this.currentAmbientOcclusionPreviewOptions = null;
    this.denoiseQuad.dispose();
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
  }

  private rebuildPathTracer() {
    if (this.renderer == null) {
      return;
    }

    this.pathTracer = new WebGLPathTracer(this.renderer);
    this.pathTracer.renderDelay = 0;
    this.pathTracer.fadeDuration = PATH_TRACER_FADE_DURATION_MS;
    this.pathTracer.rasterizeScene = true;
    this.pathTracer.renderToCanvas = true;
    this.pathTracer.renderToCanvasCallback =
        (target, renderer, quad) => this.renderPathTracerOutput(
            target, renderer, quad);
    this.applyOptions();
    this.needsSceneUpdate = true;
    this.syncScene();
  }

  private applyOptions(reset: boolean = true) {
    if (this.pathTracer == null) {
      return;
    }

    this.pathTracer.bounces = Math.max(1, Math.floor(this.options.bounces));
    this.pathTracer.minSamples = Math.max(
        1, Math.floor(this.options.samplesThreshold));
    this.pathTracer.renderScale = Math.min(
        1, Math.max(0.1, this.options.renderScale));
    this.pathTracer.tiles.copy(this.options.tiles);
    this.denoiseMaterial.sigma = Math.max(0.001, this.options.denoiseSigma);
    this.denoiseMaterial.threshold =
        Math.max(0.0001, this.options.denoiseThreshold);
    this.denoiseMaterial.kSigma =
        Math.max(0, this.options.denoiseKSigma);
    if (reset && this.camera != null) {
      this.pathTracer.setCamera(this.getPathTracerCamera());
    }
    if (reset) {
      this.cameraStateInitialized = false;
      this.pathTracer.reset();
    }
  }

  private syncScene() {
    this.syncShadowCatcher();

    if (this.pathTracer == null || this.scene == null || this.camera == null ||
        !this.needsSceneUpdate) {
      return;
    }

    const pathTracerCamera = this.getPathTracerCamera();
    this.pathTracer.setScene(this.scene, pathTracerCamera);
    this.rememberGeometryState();
    this.rememberCameraState(pathTracerCamera);
    this.needsSceneUpdate = false;
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
      target: WebGLRenderTarget,
      renderer: WebGLRenderer,
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

    this.shadowCatcher =
        new Mesh(new PlaneGeometry(1, 1), material);
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
    this.physicalCamera.setFocalLength(
        Math.max(1, this.options.focalLength));
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

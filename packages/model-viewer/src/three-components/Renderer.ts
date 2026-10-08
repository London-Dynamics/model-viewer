/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
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

import {Event, EventDispatcher, NeutralToneMapping, Vector2, Vector4, WebGLRenderer} from 'three';
import {WebGPURenderer} from 'three/webgpu';

import {$updateEnvironment} from '../features/environment.js';
import {ModelViewerGlobalConfig} from '../features/loading.js';
import ModelViewerElementBase, {$canvas, $tick, $updateSize} from '../model-viewer-base.js';
import {clamp, isDebugMode} from '../utilities.js';

import {ARRenderer} from './ARRenderer.js';
import {CachingGLTFLoader} from './CachingGLTFLoader.js';
import {ModelViewerGLTFInstance} from './gltf-instance/ModelViewerGLTFInstance.js';
import {ModelScene} from './ModelScene.js';
import TextureUtils from './TextureUtils.js';

export interface RendererOptions {
  powerPreference: string;
  debug?: boolean;
}

export interface ContextLostEvent extends Event {
  type: 'contextlost';
  sourceEvent: WebGLContextEvent;
}

export type RendererBackend = 'webgl'|'webgpu';

// Between 0 and 1: larger means the average responds faster and is less smooth.
const DURATION_DECAY = 0.2;
const LOW_FRAME_DURATION_MS = 40;
const HIGH_FRAME_DURATION_MS = 60;
const MAX_AVG_CHANGE_MS = 5;
const SCALE_STEPS = [1, 0.79, 0.62, 0.5, 0.4, 0.31, 0.25];
const DEFAULT_LAST_STEP = 3;

export const DEFAULT_POWER_PREFERENCE: string = 'high-performance';
const COMMERCE_EXPOSURE = 1.3;

/**
 * Registers canvases with Canvas2DRenderingContexts and renders them
 * all in the same WebGLRenderingContext, spitting out textures to apply
 * to the canvases. Creates a fullscreen WebGL canvas that is not added
 * to the DOM, and on each frame, renders each registered canvas on a portion
 * of the WebGL canvas, and applies the texture on the registered canvas.
 *
 * In the future, can use ImageBitmapRenderingContext instead of
 * Canvas2DRenderingContext if supported for cheaper transferring of
 * the texture.
 */
export class Renderer extends
    EventDispatcher<{
      contextlost: {sourceEvent: WebGLContextEvent},
      'renderer-backend-change': {backend: RendererBackend}
    }> {
  private static _singleton: Renderer;

  static get singleton() {
    if (!this._singleton) {
      this._singleton = new Renderer({
        powerPreference: (((self as any).ModelViewerElement || {}) as
                          ModelViewerGlobalConfig)
                             .powerPreference ||
            DEFAULT_POWER_PREFERENCE,
        debug: isDebugMode()
      });
    }
    return this._singleton;
  }

  static resetSingleton() {
    const elements = this._singleton.dispose();
    for (const element of elements) {
      element.disconnectedCallback();
    }

    this._singleton = new Renderer({
      powerPreference:
          (((self as any).ModelViewerElement || {}) as ModelViewerGlobalConfig)
              .powerPreference ||
          DEFAULT_POWER_PREFERENCE,
      debug: isDebugMode()
    });

    for (const element of elements) {
      element.connectedCallback();
    }
  }

  public threeRenderer!: WebGLRenderer;
  public backend: RendererBackend = 'webgl';
  public canvas3D: HTMLCanvasElement;
  public textureUtils: TextureUtils|null;
  public arRenderer: ARRenderer;
  public loader = new CachingGLTFLoader(ModelViewerGLTFInstance);
  public width = 0;
  public height = 0;
  public dpr = 1;

  private scenes: Set<ModelScene> = new Set();
  private multipleScenesVisible = false;
  private lastTick = performance.now();
  private renderedLastFrame = false;
  private scaleStep = 0;
  private lastStep = DEFAULT_LAST_STEP;
  private avgFrameDuration =
      (HIGH_FRAME_DURATION_MS + LOW_FRAME_DURATION_MS) / 2;
  private backendChange: Promise<void>|null = null;
  private options: RendererOptions;

  get canRender() {
    return this.threeRenderer != null;
  }

  get scaleFactor() {
    return SCALE_STEPS[this.scaleStep];
  }

  set minScale(scale: number) {
    let i = 1;
    while (i < SCALE_STEPS.length) {
      if (SCALE_STEPS[i] < scale) {
        break;
      }
      ++i;
    }
    this.lastStep = i - 1;
  }

  constructor(options: RendererOptions) {
    super();

    this.options = options;
    this.backend = 'webgl';
    this.dpr = window.devicePixelRatio;

    this.canvas3D = document.createElement('canvas');
    this.canvas3D.id = 'webgl-canvas';
    this.canvas3D.classList.add('show');

    try {
      this.threeRenderer = new WebGLRenderer({
        canvas: this.canvas3D,
        alpha: true,
        antialias: true,
        powerPreference: options.powerPreference as WebGLPowerPreference,
        preserveDrawingBuffer: true,
      });
      this.threeRenderer.autoClear = true;
      this.threeRenderer.setPixelRatio(1);  // handle pixel ratio externally

      this.threeRenderer.debug = {
        checkShaderErrors: !!options.debug,
        onShaderError: null
      };

      // ACESFilmicToneMapping appears to be the most "saturated",
      // and similar to Filament's gltf-viewer.
      this.threeRenderer.toneMapping = NeutralToneMapping;
    } catch (error) {
      console.warn(error);
    }

    this.arRenderer = new ARRenderer(this);
    this.textureUtils =
        this.canRender ? new TextureUtils(this.threeRenderer) : null;
    CachingGLTFLoader.initializeKTX2Loader(this.threeRenderer);

    this.canvas3D.addEventListener('webglcontextlost', this.onWebGLContextLost);
    this.canvas3D.addEventListener(
        'webglcontextrestored', this.onWebGLContextRestored);

    this.updateRendererSize();
  }

  async requestBackend(backend: RendererBackend): Promise<void> {
    if (this.backend === backend) {
      if (backend === 'webgpu' &&
          (this.threeRenderer as any)?.isWebGPURenderer !== true) {
        this.backend = 'webgl';
      } else {
        return;
      }
    }

    if (this.backend === backend) {
      return;
    }

    if (backend !== 'webgpu') {
      throw new Error(`Unsupported renderer backend: ${backend}`);
    }

    if (this.backendChange != null) {
      await this.backendChange;
      if (this.backend === backend) {
        return;
      }
    }

    this.backendChange = this.enableWebGPU(this.options);
    try {
      await this.backendChange;
      if ((this.threeRenderer as any)?.isWebGPURenderer !== true) {
        throw new Error(
            'WebGPU is not available in this browser. LD Water requires a ' +
            'WebGPU-capable browser and renderer.');
      }
    } finally {
      this.backendChange = null;
    }
  }

  /**
   * Where the visible canvas lives. The WebGL canvas may not be mounted yet
   * when water asks for WebGPU before the first frame.
   */
  private canvasHost(): HTMLElement|null {
    if (this.canvas3D.parentElement != null) {
      return this.canvas3D.parentElement;
    }
    for (const scene of this.scenes) {
      if (scene.canvas.parentElement != null) {
        return scene.canvas.parentElement;
      }
    }
    return null;
  }

  private async enableWebGPU(options: RendererOptions): Promise<void> {
    if ((navigator as any).gpu == null) {
      throw new Error(
          'WebGPU is not available in this browser. LD Water requires a ' +
          'WebGPU-capable browser and renderer.');
    }

    const oldRenderer = this.threeRenderer;
    const oldCanvas = this.canvas3D;
    const parent = this.canvasHost();
    const nextCanvas = document.createElement('canvas');
    nextCanvas.id = oldCanvas.id;
    nextCanvas.className = oldCanvas.className;
    // Dynamic resolution enlarges this canvas so the beauty slice fills the
    // element. A fresh canvas would otherwise show the slice at 1:1.
    nextCanvas.style.width = oldCanvas.style.width;
    nextCanvas.style.height = oldCanvas.style.height;

    // Chrome destroys a WebGPU device if the canvas is reparented after
    // getContext('webgpu'). Mount the canvas, then create the context.
    oldRenderer?.setAnimationLoop(null);
    if (parent != null) {
      parent.appendChild(nextCanvas);
    }
    this.canvas3D = nextCanvas;

    oldCanvas.removeEventListener('webglcontextlost', this.onWebGLContextLost);
    oldCanvas.removeEventListener(
        'webglcontextrestored', this.onWebGLContextRestored);
    if (oldRenderer != null) {
      oldRenderer.dispose();
    }
    if (oldCanvas.isConnected) {
      oldCanvas.remove();
    }
    for (const scene of this.scenes) {
      scene.effectRenderer = null;
    }

    const nextRenderer = new WebGPURenderer({
      canvas: nextCanvas,
      alpha: true,
      antialias: true,
      powerPreference: options.powerPreference as GPUPowerPreference,
    } as any);
    await (nextRenderer as any).init();
    (nextRenderer as any).autoClear = true;
    nextRenderer.setPixelRatio(1);
    (nextRenderer as any).debug = {
      checkShaderErrors: !!options.debug,
      onShaderError: null,
    };
    nextRenderer.toneMapping = NeutralToneMapping;

    this.threeRenderer = nextRenderer as unknown as WebGLRenderer;
    this.backend = 'webgpu';

    this.canvas3D.addEventListener(
        'webglcontextlost', this.onWebGLContextLost);
    this.canvas3D.addEventListener(
        'webglcontextrestored', this.onWebGLContextRestored);

    this.arRenderer = new ARRenderer(this);
    this.textureUtils?.dispose();
    this.textureUtils =
        this.canRender ? new TextureUtils(this.threeRenderer) : null;
    try {
      CachingGLTFLoader.initializeKTX2Loader(this.threeRenderer);
    } catch (error) {
      console.warn(error);
    }

    this.updateRendererSize();
    for (const scene of this.scenes) {
      scene.forceRescale();
      // A WebGL composer must not bind this canvas. getContext('webgl')
      // would replace the WebGPU context and destroy the device.
      scene.effectRenderer = null;
      (scene.element as any)[$updateEnvironment]();
      scene.queueRender();
    }
    if (this.canRender && this.scenes.size > 0) {
      this.threeRenderer.setAnimationLoop(
          (time: number, frame?: any) => this.render(time, frame));
    }
    this.dispatchEvent({type: 'renderer-backend-change', backend: this.backend});
  }

  registerScene(scene: ModelScene) {
    this.scenes.add(scene);

    scene.forceRescale();

    const size = new Vector2();
    this.threeRenderer.getSize(size);
    scene.canvas.width = size.x;
    scene.canvas.height = size.y;

    if (this.canRender && this.scenes.size > 0) {
      this.threeRenderer.setAnimationLoop(
          (time: number, frame?: any) => this.render(time, frame));
    }
  }

  unregisterScene(scene: ModelScene) {
    this.scenes.delete(scene);

    if (this.canvas3D.parentElement === scene.canvas.parentElement) {
      scene.canvas.parentElement!.removeChild(this.canvas3D);
    }

    if (this.canRender && this.scenes.size === 0) {
      this.threeRenderer.setAnimationLoop(null);
    }
  }

  displayCanvas(scene: ModelScene): HTMLCanvasElement {
    return scene.element.modelIsVisible && !this.multipleScenesVisible ?
        this.canvas3D :
        scene.element[$canvas];
  }

  /**
   * The function enables an optimization, where when there is only a single
   * <model-viewer> element, we can use the renderer's 3D canvas directly for
   * display. Otherwise we need to use the element's 2D canvas and copy the
   * renderer's result into it.
   */
  private countVisibleScenes() {
    const {canvas3D} = this;
    let visibleScenes = 0;
    let canvas3DScene = null;
    for (const scene of this.scenes) {
      const {element} = scene;
      if (element.modelIsVisible && scene.externalRenderer == null) {
        ++visibleScenes;
      }
      if (canvas3D.parentElement === scene.canvas.parentElement) {
        canvas3DScene = scene;
      }
    }
    const multipleScenesVisible = visibleScenes > 1;

    if (canvas3DScene != null) {
      const newlyMultiple =
          multipleScenesVisible && !this.multipleScenesVisible;
      const disappearing = !canvas3DScene.element.modelIsVisible;
      if ((newlyMultiple || disappearing) &&
          (this.threeRenderer as any).isWebGPURenderer !== true) {
        const {width, height} = this.sceneSize(canvas3DScene);
        this.copyPixels(canvas3DScene, width, height);
        canvas3D.parentElement!.removeChild(canvas3D);
      }
    }
    this.multipleScenesVisible = multipleScenesVisible;
  }

  /**
   * Updates the renderer's size based on the largest scene and any changes to
   * device pixel ratio.
   */
  private updateRendererSize() {
    const dpr = window.devicePixelRatio;
    if (dpr !== this.dpr) {
      // If the device pixel ratio has changed due to page zoom, elements
      // specified by % width do not fire a resize event even though their CSS
      // pixel dimensions change, so we force them to update their size here.
      for (const scene of this.scenes) {
        const {element} = scene;
        element[$updateSize](element.getBoundingClientRect());
      }
    }

    // Make the renderer the size of the largest scene
    let width = 0;
    let height = 0;
    for (const scene of this.scenes) {
      width = Math.max(width, scene.width);
      height = Math.max(height, scene.height);
    }

    const pixelWidth = Math.ceil(width * dpr);
    const pixelHeight = Math.ceil(height * dpr);
    const canvasMatchesSize =
        this.canvas3D.width === pixelWidth &&
        this.canvas3D.height === pixelHeight;

    if (width === this.width && height === this.height && dpr === this.dpr &&
        canvasMatchesSize) {
      return;
    }
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    width = pixelWidth;
    height = pixelHeight;

    if (this.canRender) {
      this.threeRenderer.setSize(width, height, false);
    }

    // Each scene's canvas must match the renderer size. In general they can be
    // larger than the element that contains them, but the overflow is hidden
    // and only the portion that is shown is copied over.
    for (const scene of this.scenes) {
      const {canvas} = scene;
      canvas.width = width;
      canvas.height = height;
      scene.forceRescale();
      if ((this.threeRenderer as any).isWebGPURenderer !== true) {
        scene.effectRenderer?.setSize(width, height);
      }
    }
  }

  private updateRendererScale(delta: number) {
    const scaleStep = this.scaleStep;

    this.avgFrameDuration += clamp(
        DURATION_DECAY * (delta - this.avgFrameDuration),
        -MAX_AVG_CHANGE_MS,
        MAX_AVG_CHANGE_MS);

    if (this.avgFrameDuration > HIGH_FRAME_DURATION_MS) {
      ++this.scaleStep;
    } else if (
        this.avgFrameDuration < LOW_FRAME_DURATION_MS && this.scaleStep > 0) {
      --this.scaleStep;
    }
    this.scaleStep = Math.min(this.scaleStep, this.lastStep);

    if (scaleStep !== this.scaleStep) {
      this.avgFrameDuration =
          (HIGH_FRAME_DURATION_MS + LOW_FRAME_DURATION_MS) / 2;
    }
  }

  private shouldRender(scene: ModelScene): boolean {
    if (!scene.shouldRender()) {
      // The first frame we stop rendering the scene (because it stops moving),
      // trigger one extra render at full scale.
      if (scene.scaleStep != 0) {
        scene.scaleStep = 0;
        this.rescaleCanvas(scene);
      } else {
        return false;
      }
    } else if (scene.scaleStep != this.scaleStep) {
      // Update render scale
      scene.scaleStep = this.scaleStep;
      this.rescaleCanvas(scene);
    }
    return true;
  }

  private rescaleCanvas(scene: ModelScene) {
    const scale = SCALE_STEPS[scene.scaleStep];
    const width = Math.ceil(this.width / scale);
    const height = Math.ceil(this.height / scale);

    const {style} = scene.canvas;
    style.width = `${width}px`;
    style.height = `${height}px`;
    this.canvas3D.style.width = `${width}px`;
    this.canvas3D.style.height = `${height}px`;

    const renderedDpr = this.dpr * scale;
    const reason = scale < 1                 ? 'GPU throttling' :
        this.dpr !== window.devicePixelRatio ? 'No meta viewport tag' :
                                               '';
    scene.element.dispatchEvent(new CustomEvent('render-scale', {
      detail: {
        reportedDpr: window.devicePixelRatio,
        renderedDpr: renderedDpr,
        minimumDpr: this.dpr * SCALE_STEPS[this.lastStep],
        pixelWidth: Math.ceil(scene.width * renderedDpr),
        pixelHeight: Math.ceil(scene.height * renderedDpr),
        reason: reason
      }
    }));
  }

  private sceneSize(scene: ModelScene) {
    const {dpr} = this;
    const scaleFactor = SCALE_STEPS[scene.scaleStep];
    // We avoid using the Three.js PixelRatio and handle it ourselves here so
    // that we can do proper rounding and avoid white boundary pixels.
    const width = Math.min(
        Math.ceil(scene.width * scaleFactor * dpr), this.canvas3D.width);
    const height = Math.min(
        Math.ceil(scene.height * scaleFactor * dpr), this.canvas3D.height);
    return {width, height};
  }

  /**
   * Dynamic resolution draws into a top-left slice of the drawing buffer.
   * Water captures run inside preRender, before the beauty setViewport, and
   * a PMREM setSize during those captures resets the canvas viewport to the
   * full buffer. getViewport() is that canvas viewport, so the capture hook
   * reads ldBeautyViewport instead. Published again immediately before the
   * beauty draw so a clobber during the tick cannot zoom the real boat.
   */
  private publishBeautyViewport(scene: ModelScene) {
    const {width, height} = this.sceneSize(scene);
    const viewportY = (this.threeRenderer as any).isWebGPURenderer === true ?
      0 :
      Math.ceil(this.height * this.dpr) - height;
    const renderer = this.threeRenderer as any;
    const box: Vector4 = renderer.ldBeautyViewport instanceof Vector4 ?
      renderer.ldBeautyViewport :
      new Vector4();
    box.set(0, viewportY, width, height);
    renderer.ldBeautyViewport = box;
    this.threeRenderer.setViewport(0, viewportY, width, height);
  }

  private copyPixels(scene: ModelScene, width: number, height: number) {
    const context2D = scene.context;
    if (context2D == null) {
      console.log('could not acquire 2d context');
      return;
    }
    context2D.clearRect(0, 0, width, height);
    context2D.drawImage(
        this.canvas3D, 0, 0, width, height, 0, 0, width, height);
    scene.canvas.classList.add('show');
  }

  /**
   * Returns an array version of this.scenes where the non-visible ones are
   * first. This allows eager scenes to be rendered before they are visible,
   * without needing the multi-canvas render path.
   */
  private orderedScenes(): Array<ModelScene> {
    const scenes = [];
    for (const visible of [false, true]) {
      for (const scene of this.scenes) {
        if (scene.element.modelIsVisible === visible) {
          scenes.push(scene);
        }
      }
    }
    return scenes;
  }

  get isPresenting(): boolean {
    return this.arRenderer.isPresenting;
  }

  /**
   * This method takes care of updating the element and renderer state based on
   * the time that has passed since the last rendered frame.
   */
  preRender(scene: ModelScene, t: number, delta: number) {
    const {element, exposure, toneMapping} = scene;

    element[$tick](t, delta);

    const exposureIsNumber =
        typeof exposure === 'number' && !Number.isNaN(exposure);
    const env = element.environmentImage;
    const sky = element.skyboxImage;
    const compensateExposure = toneMapping === NeutralToneMapping &&
        (env === 'neutral' || env === 'legacy' || (!env && !sky));
    this.threeRenderer.toneMappingExposure =
        (exposureIsNumber ? exposure : 1.0) *
        (compensateExposure ? COMMERCE_EXPOSURE : 1.0);
  }

  render(t: number, frame?: XRFrame) {
    if (frame != null) {
      this.arRenderer.onWebXRFrame(t, frame);
      return;
    }

    const delta = t - this.lastTick;
    this.lastTick = t;

    if (!this.canRender || this.isPresenting) {
      return;
    }

    this.countVisibleScenes();
    this.updateRendererSize();
    if (this.renderedLastFrame) {
      this.updateRendererScale(delta);
      this.renderedLastFrame = false;
    }

    const {canvas3D} = this;

    for (const scene of this.orderedScenes()) {
      const {element} = scene;
      if (!element.loaded ||
          (!element.modelIsVisible && scene.renderCount > 0)) {
        continue;
      }

      // Water captures sample this rect during preRender. Scale changes
      // inside shouldRender() are published again before the beauty draw.
      this.publishBeautyViewport(scene);
      this.preRender(scene, t, delta);

      if (!this.shouldRender(scene)) {
        continue;
      }

      if (scene.externalRenderer != null) {
        const camera = scene.getCamera();
        camera.updateMatrix();
        const {matrix, projectionMatrix} = camera;
        const viewMatrix = matrix.elements.slice();
        const target = scene.getTarget();
        viewMatrix[12] += target.x;
        viewMatrix[13] += target.y;
        viewMatrix[14] += target.z;

        scene.externalRenderer.render({
          viewMatrix: viewMatrix,
          projectionMatrix: projectionMatrix.elements
        });
        continue;
      }

      if (!element.modelIsVisible && !this.multipleScenesVisible) {
        // Here we are pre-rendering on the visible canvas, so we must mark the
        // visible scene dirty to ensure it overwrites us.
        for (const visibleScene of this.scenes) {
          if (visibleScene.element.modelIsVisible) {
            visibleScene.queueRender();
          }
        }
      }

      const {width, height} = this.sceneSize(scene);

      scene.renderShadow(this.threeRenderer);

      // Need to set the render target in order to prevent
      // clearing the depth from a different buffer
      this.threeRenderer.setRenderTarget(null);
      // Republish after the tick. Shadow and PMREM passes reset the canvas
      // viewport to the drawing buffer; the beauty boat has to stay in the slice.
      this.publishBeautyViewport(scene);
      // SSAO and the other post composers are WebGL. A WebGPU frame (LD Water)
      // has to go through the WebGPU renderer or the canvas stays blank.
      if (scene.effectRenderer != null &&
          (this.threeRenderer as any).isWebGPURenderer !== true) {
        scene.effectRenderer.render(delta);
      } else {
        this.threeRenderer.autoClear =
            true;  // this might get reset by the effectRenderer
        this.threeRenderer.toneMapping = scene.toneMapping;
        this.threeRenderer.render(scene, scene.camera);
      }
      if (this.multipleScenesVisible ||
          (!scene.element.modelIsVisible && scene.renderCount === 0)) {
        this.copyPixels(scene, width, height);
      } else if (canvas3D.parentElement !== scene.canvas.parentElement) {
        scene.canvas.parentElement!.appendChild(canvas3D);
        scene.canvas.classList.remove('show');
      }

      scene.hasRendered();
      ++scene.renderCount;
      this.renderedLastFrame = true;
    }
  }

  dispose(): Array<ModelViewerElementBase> {
    if (this.textureUtils != null) {
      this.textureUtils.dispose();
    }

    if (this.threeRenderer != null) {
      this.threeRenderer.dispose();
    }

    this.textureUtils = null;
    (this as any).threeRenderer = null;

    const elements = [];
    for (const scene of this.scenes) {
      elements.push(scene.element);
    }

    this.canvas3D.removeEventListener(
        'webglcontextlost', this.onWebGLContextLost);
    this.canvas3D.removeEventListener(
        'webglcontextrestored', this.onWebGLContextRestored);

    return elements;
  }

  onWebGLContextLost = (event: Event) => {
    this.dispatchEvent(
        {type: 'contextlost', sourceEvent: event} as ContextLostEvent);
  };

  onWebGLContextRestored = () => {
    this.textureUtils?.dispose();
    this.textureUtils = new TextureUtils(this.threeRenderer);
    for (const scene of this.scenes) {
      (scene.element as any)[$updateEnvironment]();
    }
  };
}

/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

// @ts-nocheck
import {
  Camera,
  DepthTexture,
  HalfFloatType,
  LinearSRGBColorSpace,
  NoToneMapping,
  NeutralToneMapping,
  PerspectiveCamera,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';

import type {ModelScene} from '../../three-components/ModelScene.js';
import {
  AmbientOcclusionOptions,
} from '../../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import {AOPass} from '../../three-components/postprocessing/ld-ambient-occlusion/AOPass.js';
import {AOShader} from '../../three-components/postprocessing/ld-ambient-occlusion/AOShader.js';

const DEFAULT_OPTIONS: AmbientOcclusionOptions = {
  algorithm: AOShader.ALGORITHM.GTAO,
  radius: 4,
  distanceExponent: 2,
  thickness: 10,
  distanceFallOff: 1,
  bias: 0.001,
  scale: 1,
  samples: 24,
  nvAlignedSamples: false,
  screenSpaceRadius: false,
  aoNoiseType: 'magic-square',
  intensity: 1,
  output: AOPass.OUTPUT.Default,
  pdLumaPhi: 10,
  pdDepthPhi: 2,
  pdNormalPhi: 3,
  pdRadius: 4,
  pdRadiusExponent: 1,
  pdRings: 2,
  pdSamples: 16,
};

export class AOModule {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  composer: EffectComposer|null = null;
  renderPass: RenderPass|null = null;
  aoPass: AOPass|null = null;
  outputPass: OutputPass|null = null;
  renderTarget: WebGLRenderTarget|null = null;
  private depthTexture: DepthTexture|null = null;
  private options: AmbientOcclusionOptions = {...DEFAULT_OPTIONS};
  private width = 1;
  private height = 1;
  private lastSceneRadius = NaN;
  private deferTerminalOutput = false;

  constructor(initialOptions?: Partial<AmbientOcclusionOptions>) {
    if (initialOptions) {
      this.options = {...this.options, ...initialOptions};
    }
  }

  setDeferTerminalOutput(defer: boolean): void {
    if (this.deferTerminalOutput === defer) {
      return;
    }
    this.deferTerminalOutput = defer;
    this.rebuildComposer();
  }

  getColorTexture(): Texture|null {
    return this.renderTarget?.texture ?? null;
  }

  setRenderer(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.rebuildComposer();
  }

  setMainScene(scene: ModelScene) {
    this.scene = scene;
    this.width = scene.canvas.width || 1;
    this.height = scene.canvas.height || 1;
    this.rebuildComposer();
  }

  setMainCamera(camera: Camera) {
    this.camera = camera;
    if (this.renderPass) {
      this.renderPass.camera = camera as PerspectiveCamera;
    }
    if (this.aoPass) {
      this.aoPass.camera = camera;
    }
    this.rebuildComposer();
  }

  beforeRender() {
    if (!this.scene || !this.renderer) {
      return;
    }

    const latestCamera = this.scene.getCamera();
    if (latestCamera !== this.camera) {
      this.setMainCamera(latestCamera);
    }

    if (this.renderPass) {
      this.renderPass.scene = this.scene;
    }

    const sceneRadius = this.scene.boundingSphere?.radius ?? 1.0;
    if (this.aoPass && Math.abs(sceneRadius - this.lastSceneRadius) > 1e-4) {
      this.lastSceneRadius = sceneRadius;
      this.updateOptions(this.options);
    }

    if (this.renderer) {
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
    }
  }

  render(deltaTime?: DOMHighResTimeStamp) {
    if (!this.composer || !this.renderer || !this.scene) {
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

    if (this.aoPass?.output === AOPass.OUTPUT.Diffuse && this.camera) {
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera as PerspectiveCamera);
      return;
    }

    if (this.aoPass?.output === AOPass.OUTPUT.Default && this.camera &&
        this.aoPass.intensity === 0) {
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera as PerspectiveCamera);
      return;
    }

    const deltaSeconds =
        typeof deltaTime === 'number' ? deltaTime / 1000 : undefined;
    this.composer.render(deltaSeconds);
  }

  setSize(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      return;
    }

    this.width = width;
    this.height = height;
    this.renderTarget?.setSize(width, height);
    this.aoPass?.setSize(width, height);
    this.composer?.setSize(width, height);
  }

  updateOptions(partial: Partial<AmbientOcclusionOptions>) {
    this.options = {...this.options, ...partial};
    if (!this.aoPass) {
      return;
    }

    const sceneRadius = this.scene?.boundingSphere?.radius ?? 1.0;
    const radiusScale = 1.0 / Math.max(sceneRadius, 0.5);
    const fineTuneFactor = 0.1;
    const scaledRadius = this.options.radius * radiusScale * fineTuneFactor;
    const scaledThickness = this.options.thickness * radiusScale * fineTuneFactor;

    this.aoPass.intensity = this.options.intensity;
    this.aoPass.output = this.options.output;
    this.aoPass.updateAoMaterial({
      algorithm: this.options.algorithm,
      radius: scaledRadius,
      distanceExponent: this.options.distanceExponent,
      thickness: scaledThickness,
      distanceFallOff: this.options.distanceFallOff,
      bias: this.options.bias,
      scale: this.options.scale,
      samples: this.options.samples,
      nvAlignedSamples: this.options.nvAlignedSamples ? 1 : 0,
      screenSpaceRadius: this.options.screenSpaceRadius ? 1 : 0,
      aoNoiseType: this.options.aoNoiseType,
    });
    this.aoPass.updatePdMaterial({
      lumaPhi: this.options.pdLumaPhi,
      depthPhi: this.options.pdDepthPhi,
      normalPhi: this.options.pdNormalPhi,
      radius: this.options.pdRadius,
      radiusExponent: this.options.pdRadiusExponent,
      rings: this.options.pdRings,
      samples: this.options.pdSamples,
    });
  }

  dispose() {
    this.composer?.dispose?.();
    this.renderTarget?.dispose();
    this.aoPass?.dispose();
    this.outputPass?.dispose();
    this.depthTexture?.dispose?.();
    this.composer = null;
    this.renderPass = null;
    this.aoPass = null;
    this.outputPass = null;
    this.renderTarget = null;
    this.depthTexture = null;
    this.lastSceneRadius = NaN;
  }

  private rebuildComposer() {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    this.dispose();

    const depthTexture = new DepthTexture(this.width, this.height);
    const renderTarget = new WebGLRenderTarget(this.width, this.height, {
      depthTexture,
      type: HalfFloatType,
      samples: this.renderer.capabilities.isWebGL2 ?
          this.renderer.capabilities.maxSamples :
          0,
    });
    renderTarget.texture.name = 'ld-ao-target';
    renderTarget.texture.colorSpace = LinearSRGBColorSpace;

    const composer = new EffectComposer(this.renderer, renderTarget);
    const renderPass =
        new RenderPass(this.scene, this.camera as PerspectiveCamera);
    composer.addPass(renderPass);

    const aoPass =
        new AOPass(this.scene, this.camera, this.width, this.height);
    aoPass.setGBuffer(depthTexture, undefined);
    composer.addPass(aoPass);

    let outputPass: OutputPass|null = null;
    if (!this.deferTerminalOutput) {
      outputPass = new OutputPass();
      composer.addPass(outputPass);

      const originalOutputRender = outputPass.render.bind(outputPass);
      outputPass.render = (renderer, writeBuffer, readBuffer, deltaTime,
          maskActive) => {
        const originalToneMapping = renderer.toneMapping;
        const originalOutputColorSpace = renderer.outputColorSpace;

        renderer.toneMapping = this.scene?.toneMapping ?? originalToneMapping;
        renderer.outputColorSpace = SRGBColorSpace;
        originalOutputRender(renderer, writeBuffer, readBuffer, deltaTime,
            maskActive);
        renderer.toneMapping = originalToneMapping;
        renderer.outputColorSpace = originalOutputColorSpace;
      };
    }

    const originalRender = composer.render.bind(composer);
    composer.render = (deltaTime?: number) => {
      if (this.renderer && this.scene) {
        const originalAutoClear = this.renderer.autoClear;
        const originalToneMapping = this.renderer.toneMapping;
        const originalOutputColorSpace = this.renderer.outputColorSpace;
        const useOutputPass = !this.deferTerminalOutput &&
            this.aoPass?.output === AOPass.OUTPUT.Default;

        if (outputPass != null) {
          outputPass.enabled = useOutputPass;
        }
        this.renderer.autoClear = false;
        this.renderer.toneMapping = NoToneMapping;
        this.renderer.outputColorSpace =
            useOutputPass ? LinearSRGBColorSpace : SRGBColorSpace;

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

        originalRender(deltaTime);

        this.renderer.autoClear = originalAutoClear;
        this.renderer.toneMapping = originalToneMapping;
        this.renderer.outputColorSpace = originalOutputColorSpace;
      } else {
        originalRender(deltaTime);
      }
    };

    this.depthTexture = depthTexture;
    this.renderTarget = renderTarget;
    this.composer = composer;
    this.renderPass = renderPass;
    this.aoPass = aoPass;
    this.outputPass = outputPass;
    this.lastSceneRadius = this.scene.boundingSphere?.radius ?? 1.0;

    this.updateOptions(this.options);
  }
}

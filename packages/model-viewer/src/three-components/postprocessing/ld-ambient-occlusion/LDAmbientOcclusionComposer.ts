// @ts-nocheck
import {
  Camera,
  DepthTexture,
  HalfFloatType,
  LinearSRGBColorSpace,
  NoToneMapping,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutlinePass} from 'three/examples/jsm/postprocessing/OutlinePass.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {ModelScene} from '../../ModelScene.js';
import {
  applySelectionOutlineStyle,
  createSelectionOutlinePass,
  DEFAULT_SELECTION_OUTLINE_STYLE,
  SelectionOutlineCapable,
  SelectionOutlineStyle,
  setSelectionOutlineObjects,
} from '../ld-selection/selection-outline-pass.js';

import {AOPass} from './AOPass.js';
import {AOShader} from './AOShader.js';

export type AONoiseType = 'magic-square'|'random';

export interface AmbientOcclusionOptions {
  algorithm: number;
  radius: number;
  distanceExponent: number;
  thickness: number;
  distanceFallOff: number;
  bias: number;
  scale: number;
  samples: number;
  nvAlignedSamples: boolean;
  screenSpaceRadius: boolean;
  aoNoiseType: AONoiseType;
  intensity: number;
  output: number;
  pdLumaPhi: number;
  pdDepthPhi: number;
  pdNormalPhi: number;
  pdRadius: number;
  pdRadiusExponent: number;
  pdRings: number;
  pdSamples: number;
}

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

export class LDAmbientOcclusionComposer implements EffectComposerInterface,
                                                   SelectionOutlineCapable {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  private composer: EffectComposer|null = null;
  private renderPass: RenderPass|null = null;
  private aoPass: AOPass|null = null;
  private outlinePass: OutlinePass|null = null;
  private outputPass: OutputPass|null = null;
  private renderTarget: WebGLRenderTarget|null = null;
  private depthTexture: DepthTexture|null = null;
  private options: AmbientOcclusionOptions = {...DEFAULT_OPTIONS};
  private width = 1;
  private height = 1;
  private lastSceneRadius = NaN;
  private outlineEnabled = false;
  private outlineSelection: Object3D[] = [];
  private outlineStyle: SelectionOutlineStyle = {
    ...DEFAULT_SELECTION_OUTLINE_STYLE,
  };

  constructor(initialOptions?: Partial<AmbientOcclusionOptions>) {
    if (initialOptions) {
      this.options = {...this.options, ...initialOptions};
    }
  }

  setRenderer(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.rebuildComposer();
  }

  setMainScene(scene: ModelScene) {
    this.scene = scene;
    // scene canvas already sized in physical pixels
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
    if (this.outlinePass) {
      this.outlinePass.renderCamera = camera;
    }
    this.rebuildComposer();
  }

  setSelectionOutlineEnabled(enabled: boolean) {
    this.outlineEnabled = enabled;
    this.syncOutlinePass();
  }

  setSelectionOutlineSelection(objects: Object3D[]) {
    this.outlineSelection = objects;
    this.syncOutlinePass();
  }

  setSelectionOutlineStyle(style: SelectionOutlineStyle) {
    this.outlineStyle = {
      color: style.color || DEFAULT_SELECTION_OUTLINE_STYLE.color,
      thickness: style.thickness,
    };
    if (this.outlinePass) {
      applySelectionOutlineStyle(this.outlinePass, this.outlineStyle);
    }
    this.syncOutlinePass();
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp) {
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

    // Apply model-viewer's renderer settings in beforeRender() so they're
    // available when RenderPass renders. This ensures "diffuse" output matches
    // the normal render.
    if (this.renderer) {
      this.renderer.toneMapping = this.scene.toneMapping;
      // Ensure outputColorSpace is SRGBColorSpace (default) for correct tone mapping
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
          (compensateExposure ? 1.3 : 1.0); // COMMERCE_EXPOSURE = 1.3
    }
  }

  render(deltaTime?: DOMHighResTimeStamp) {
    if (!this.composer || !this.renderer || !this.scene) {
      return;
    }

    // Keep the normal render settings for direct renderer fallbacks.
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
        (compensateExposure ? 1.3 : 1.0); // COMMERCE_EXPOSURE = 1.3

    if (this.aoPass?.output === AOPass.OUTPUT.Diffuse && this.camera) {
      // Diffuse should match the AO-off render exactly, so use the normal
      // model-viewer render path instead of presenting from the composer.
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera as PerspectiveCamera);
      return;
    }

    if (this.aoPass?.output === AOPass.OUTPUT.Default && this.camera &&
        this.aoPass.intensity === 0) {
      // With zero intensity, the composite should collapse to the same result
      // as the normal model-viewer render path.
      this.renderer.autoClear = true;
      this.renderer.render(this.scene, this.camera as PerspectiveCamera);
      return;
    }

    const deltaSeconds =
        typeof deltaTime === 'number' ? deltaTime / 1000 : undefined;
    this.composer.render(deltaSeconds);
    
    // Don't restore renderer state - let it persist like the normal render path does
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
    if (this.outlinePass) {
      this.outlinePass.resolution.set(width, height);
      this.outlinePass.setSize(width, height);
    }
  }

  updateOptions(partial: Partial<AmbientOcclusionOptions>) {
    this.options = {...this.options, ...partial};
    if (!this.aoPass) {
      return;
    }

    // Scale radius based on scene bounding sphere to account for model-viewer's
    // auto-framing. Model-viewer auto-frames scenes which makes the same radius
    // value appear much larger relative to the model. We scale down proportionally
    // to the bounding sphere radius to normalize the effect.
    // A typical car model might have a bounding sphere radius of ~1-2 units in
    // the original example, but model-viewer's auto-framing changes this.
    const sceneRadius = this.scene?.boundingSphere?.radius ?? 1.0;
    // Scale factor: divide by scene radius to normalize. Use a reference of 1.0
    // so that radius=4 produces similar results as in the original example.
    // Clamp to prevent division by very small values.
    const radiusScale = 1.0 / Math.max(sceneRadius, 0.5);
    // Apply additional fine-tuning factor (0.1) since auto-framing tends to make
    // scenes appear smaller in view space, requiring more aggressive scaling.
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
    this.outlinePass?.dispose();
    this.outputPass?.dispose();
    this.depthTexture?.dispose?.();
    this.composer = null;
    this.renderPass = null;
    this.aoPass = null;
    this.outlinePass = null;
    this.outputPass = null;
    this.renderTarget = null;
    this.depthTexture = null;
    this.lastSceneRadius = NaN;
  }

  private syncOutlinePass() {
    if (!this.outlinePass) {
      return;
    }
    if (!this.outlineEnabled) {
      this.outlinePass.selectedObjects = [];
      this.outlinePass.enabled = false;
      return;
    }
    setSelectionOutlineObjects(this.outlinePass, this.outlineSelection);
  }

  private rebuildComposer() {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    this.dispose();

    const depthTexture = new DepthTexture(this.width, this.height);
    // Preserve linear HDR values through the AO pipeline. Tone mapping and final
    // color-space conversion happen only in the final output pass.
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

    const outlinePass = createSelectionOutlinePass(
        new Vector2(this.width, this.height),
        this.scene,
        this.camera,
        this.outlineStyle);
    composer.addPass(outlinePass);

    const outputPass = new OutputPass();
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

    // Render the scene and AO passes in linear space, then let OutputPass apply
    // tone mapping and output transfer exactly once at the end.
    const originalRender = composer.render.bind(composer);
    composer.render = (deltaTime?: number) => {
      if (this.renderer && this.scene) {
        const originalAutoClear = this.renderer.autoClear;
        const originalToneMapping = this.renderer.toneMapping;
        const originalOutputColorSpace = this.renderer.outputColorSpace;
        const useOutputPass = this.aoPass?.output === AOPass.OUTPUT.Default;

        outputPass.enabled = useOutputPass;
        this.renderer.autoClear = false; // EffectComposer expects this
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
    this.outlinePass = outlinePass;
    this.outputPass = outputPass;
    this.lastSceneRadius = this.scene.boundingSphere?.radius ?? 1.0;

    this.updateOptions(this.options);
    this.syncOutlinePass();
  }
}


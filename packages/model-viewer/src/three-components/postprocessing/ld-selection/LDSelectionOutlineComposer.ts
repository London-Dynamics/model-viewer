import {
  Camera,
  LinearSRGBColorSpace,
  NeutralToneMapping,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
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
  SelectionOutlineStyle,
  setSelectionOutlineObjects,
} from './selection-outline-pass.js';

/**
 * Standalone outline composer used when highlight-selected is on but AO/Bloom
 * are not. Implements EffectComposerInterface for registerEffectComposer.
 */
export class LDSelectionOutlineComposer implements EffectComposerInterface {
  private renderer: WebGLRenderer|null = null;
  private scene: ModelScene|null = null;
  private camera: Camera|null = null;
  private composer: EffectComposer|null = null;
  private renderPass: RenderPass|null = null;
  private outlinePass: OutlinePass|null = null;
  private outputPass: OutputPass|null = null;
  private width = 1;
  private height = 1;
  private enabled = true;
  private selection: Object3D[] = [];
  private style: SelectionOutlineStyle = {...DEFAULT_SELECTION_OUTLINE_STYLE};

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
    if (this.outlinePass) {
      this.outlinePass.renderCamera = camera;
    }
  }

  setSize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer?.setSize(this.width, this.height);
    if (this.outlinePass) {
      this.outlinePass.resolution.set(this.width, this.height);
      this.outlinePass.setSize(this.width, this.height);
    }
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp) {}

  render(deltaTime?: DOMHighResTimeStamp) {
    if (!this.composer || !this.renderer || !this.scene) {
      return;
    }
    if (!this.enabled || this.selection.length === 0) {
      // Still render the scene via composer when the outline is idle so the
      // pipeline-owned effectRenderer keeps painting the model.
      const previousAutoClear = this.renderer.autoClear;
      const previousToneMapping = this.renderer.toneMapping;
      const previousOutputColorSpace = this.renderer.outputColorSpace;
      this.renderer.autoClear = false;
      this.renderer.toneMapping = NoToneMapping;
      this.renderer.outputColorSpace = LinearSRGBColorSpace;
      this.composer.render(deltaTime);
      this.renderer.autoClear = previousAutoClear;
      this.renderer.toneMapping = previousToneMapping;
      this.renderer.outputColorSpace = previousOutputColorSpace;
      return;
    }

    const previousAutoClear = this.renderer.autoClear;
    const previousToneMapping = this.renderer.toneMapping;
    const previousOutputColorSpace = this.renderer.outputColorSpace;
    this.renderer.autoClear = false;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.outputColorSpace = LinearSRGBColorSpace;

    const {element, exposure} = this.scene;
    const exposureIsNumber =
        typeof exposure === 'number' && !Number.isNaN(exposure);
    const env = element.environmentImage;
    const sky = element.skyboxImage;
    const compensateExposure = this.scene.toneMapping === NeutralToneMapping &&
        (env === 'neutral' || env === 'legacy' || (!env && !sky));
    this.renderer.toneMappingExposure =
        (exposureIsNumber ? exposure : 1.0) * (compensateExposure ? 1.3 : 1.0);

    this.composer.render(deltaTime);

    this.renderer.autoClear = previousAutoClear;
    this.renderer.toneMapping = previousToneMapping;
    this.renderer.outputColorSpace = previousOutputColorSpace;
  }

  setSelectionOutlineEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.syncOutlinePass();
  }

  setSelectionOutlineSelection(objects: Object3D[]) {
    this.selection = objects;
    this.syncOutlinePass();
  }

  setSelectionOutlineStyle(style: SelectionOutlineStyle) {
    this.style = {
      color: style.color || DEFAULT_SELECTION_OUTLINE_STYLE.color,
      thickness: style.thickness,
    };
    if (this.outlinePass) {
      applySelectionOutlineStyle(this.outlinePass, this.style);
    }
    this.syncOutlinePass();
  }

  dispose() {
    this.outlinePass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.outlinePass = null;
    this.outputPass = null;
  }

  private syncOutlinePass() {
    if (!this.outlinePass) {
      return;
    }
    if (!this.enabled) {
      this.outlinePass.selectedObjects = [];
      this.outlinePass.enabled = false;
      return;
    }
    setSelectionOutlineObjects(this.outlinePass, this.selection);
  }

  private rebuildComposer() {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    this.dispose();

    const composer = new EffectComposer(this.renderer);
    const renderPass =
        new RenderPass(this.scene, this.camera as PerspectiveCamera);
    const outlinePass = createSelectionOutlinePass(
        new Vector2(this.width, this.height),
        this.scene,
        this.camera,
        this.style);
    const outputPass = new OutputPass();

    const originalOutputRender = outputPass.render.bind(outputPass);
    outputPass.render = (renderer, writeBuffer, readBuffer, deltaTime,
        maskActive) => {
      const originalToneMapping = renderer.toneMapping;
      const originalOutputColorSpace = renderer.outputColorSpace;
      renderer.toneMapping = this.scene?.toneMapping ?? originalToneMapping;
      renderer.outputColorSpace = SRGBColorSpace;
      originalOutputRender(
          renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      renderer.toneMapping = originalToneMapping;
      renderer.outputColorSpace = originalOutputColorSpace;
    };

    composer.addPass(renderPass);
    composer.addPass(outlinePass);
    composer.addPass(outputPass);
    composer.setSize(this.width, this.height);

    this.composer = composer;
    this.renderPass = renderPass;
    this.outlinePass = outlinePass;
    this.outputPass = outputPass;
    this.syncOutlinePass();
  }
}

/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {
  Camera,
  PerspectiveCamera,
  Vector2,
  WebGLRenderer,
} from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {OutlinePass} from 'three/examples/jsm/postprocessing/OutlinePass.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';

import {
  EffectComposerInterface,
} from '../../model-viewer-base.js';
import type {ModelScene} from '../../three-components/ModelScene.js';
import type {AmbientOcclusionOptions} from '../../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import type {LDBloomTarget} from '../ld-bloom.js';

import {AOModule} from './ao-module.js';
import {BloomModule} from './bloom-module.js';
import {
  collectSelectionMeshes,
  SelectionOutlineModule,
} from './selection-outline-module.js';
import type {LDEffectsHost, LDSelectionOutlineState} from './types.js';

export class LDEffectsComposer implements EffectComposerInterface {
  bloomModule: BloomModule|null = null;
  aoModule: AOModule|null = null;
  readonly outlineModule = new SelectionOutlineModule();
  private outlineOnlyComposer: EffectComposer|null = null;
  private outlineOnlyOutput: OutputPass|null = null;
  private renderer?: WebGLRenderer;
  private scene?: ModelScene;
  private camera?: Camera;
  private width = 1;
  private height = 1;

  private bloomEnabled = false;
  private aoEnabled = false;
  private outlineEnabled = false;

  constructor(private readonly host: LDEffectsHost) {}

  configure(
      flags: {bloom: boolean, ambientOcclusion: boolean, highlightSelected: boolean},
      aoOptions: Partial<AmbientOcclusionOptions>|null,
      bloomTargets: LDBloomTarget[],
      outlineState: LDSelectionOutlineState,
      ): void {
    this.bloomEnabled = flags.bloom;
    this.aoEnabled = flags.ambientOcclusion;
    this.outlineEnabled = flags.highlightSelected;

    this.outlineModule.setState(outlineState);

    const needsBloom = this.bloomEnabled;
    const needsAo = this.aoEnabled;
    const needsOutline = this.outlineEnabled;
    const aoAndBloom = needsAo && needsBloom;

    this.disposeModules();

    if (needsAo) {
      this.aoModule = new AOModule(aoOptions ?? undefined);
      this.aoModule.setDeferTerminalOutput(aoAndBloom);
      if (this.renderer) {
        this.aoModule.setRenderer(this.renderer);
      }
      if (this.scene) {
        this.aoModule.setMainScene(this.scene);
      }
      if (this.camera) {
        this.aoModule.setMainCamera(this.camera);
      }
    }

    if (needsBloom) {
      this.bloomModule = new BloomModule(this.host);
      this.bloomModule.setTargets(bloomTargets);
      const deferBloomOutput =
          needsOutline && (needsBloom && !needsAo || aoAndBloom);
      this.bloomModule.setDeferTerminalOutput(deferBloomOutput);
      this.bloomModule.setExternalBase(null);
      if (this.renderer) {
        this.bloomModule.setRenderer(this.renderer);
      }
      if (this.scene) {
        this.bloomModule.setMainScene(this.scene);
      }
      if (this.camera) {
        this.bloomModule.setMainCamera(this.camera);
      }
      this.bloomModule.setActiveMsaa(
          this.host.bloomQuality === 'performance' ? 0 : this.host.bloomMsaa,
      );
    }

    if (needsOutline && this.scene && this.camera) {
      const resolution = new Vector2(this.width, this.height);
      const outlinePass = this.outlineModule.attach(
          this.scene,
          this.camera as PerspectiveCamera,
          resolution,
      );

      if (this.bloomModule?.finalComposer != null) {
        this.insertOutlineBeforeOutput(
            this.bloomModule.finalComposer,
            outlinePass,
            this.bloomModule.outputPass == null,
        );
      } else if (needsAo && this.aoModule?.composer != null) {
        this.insertOutlineBeforeOutput(
            this.aoModule.composer,
            outlinePass,
            this.aoModule.outputPass == null,
        );
      } else if (!needsBloom && !needsAo) {
        this.buildOutlineOnlyPipeline(outlinePass);
      }
    }

    this.setSize(this.width, this.height);
  }

  private insertOutlineBeforeOutput(
      composer: EffectComposer,
      outlinePass: OutlinePass,
      addOutput: boolean,
      ): void {
    const passes = composer.passes;
    const outputIndex = passes.findIndex((p) => p instanceof OutputPass);
    if (outputIndex >= 0) {
      composer.removePass(passes[outputIndex]);
    }
    if (!passes.includes(outlinePass)) {
      composer.addPass(outlinePass);
    }
    if (addOutput) {
      const outputPass = new OutputPass();
      composer.addPass(outputPass);
      if (this.bloomModule != null) {
        this.bloomModule.outputPass = outputPass;
      }
    }
  }

  private buildOutlineOnlyPipeline(outlinePass: OutlinePass): void {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }
    this.outlineOnlyComposer?.dispose();
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(outlinePass);
    this.outlineOnlyOutput = new OutputPass();
    composer.addPass(this.outlineOnlyOutput);
    this.outlineOnlyComposer = composer;
  }

  setSelectionOutline(state: Partial<LDSelectionOutlineState>): void {
    this.outlineModule.setState(state);
  }

  setRenderer(renderer: WebGLRenderer): void {
    this.renderer = renderer;
    this.aoModule?.setRenderer(renderer);
    this.bloomModule?.setRenderer(renderer);
    if (this.outlineOnlyComposer != null) {
      this.outlineOnlyComposer = null;
    }
  }

  setMainScene(scene: ModelScene): void {
    this.scene = scene;
    this.width = scene.canvas.width || 1;
    this.height = scene.canvas.height || 1;
    this.aoModule?.setMainScene(scene);
    this.bloomModule?.setMainScene(scene);
  }

  setMainCamera(camera: Camera): void {
    this.camera = camera;
    this.aoModule?.setMainCamera(camera);
    this.bloomModule?.setMainCamera(camera);
  }

  setSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    this.width = width;
    this.height = height;
    this.aoModule?.setSize(width, height);
    this.bloomModule?.setSize(width, height);
    this.outlineModule.setSize(width, height);
    this.outlineOnlyComposer?.setSize(width, height);
  }

  updateAoOptions(partial: Partial<AmbientOcclusionOptions>): void {
    this.aoModule?.updateOptions(partial);
  }

  updateBloomPass(): void {
    this.bloomModule?.updatePass();
  }

  setBloomTargets(targets: LDBloomTarget[]): void {
    this.bloomModule?.setTargets(targets);
  }

  setActiveBloomMsaa(msaa: number): void {
    this.bloomModule?.setActiveMsaa(msaa);
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp): void {
    this.aoModule?.beforeRender();
  }

  render(deltaTime?: DOMHighResTimeStamp): void {
    if (this.aoEnabled && this.bloomEnabled) {
      this.aoModule?.render(deltaTime);
      const base = this.aoModule?.getColorTexture() ?? null;
      this.bloomModule?.setExternalBase(base);
      this.bloomModule?.render(deltaTime);
      return;
    }

    if (this.aoEnabled) {
      this.aoModule?.render(deltaTime);
      return;
    }

    if (this.bloomEnabled) {
      this.bloomModule?.render(deltaTime);
      return;
    }

    if (this.outlineEnabled && this.outlineOnlyComposer != null) {
      const deltaSeconds =
          typeof deltaTime === 'number' ? deltaTime / 1000 : undefined;
      this.outlineOnlyComposer.render(deltaSeconds);
    }
  }

  dispose(): void {
    this.disposeModules();
  }

  private disposeModules(): void {
    this.bloomModule?.dispose();
    this.aoModule?.dispose();
    this.outlineModule.dispose();
    this.outlineOnlyComposer?.dispose();
    this.outlineOnlyComposer = null;
    this.outlineOnlyOutput = null;
    this.bloomModule = null;
    this.aoModule = null;
  }

  // Bloom-spec compatibility: delegate to bloom module when present.
  get targets(): LDBloomTarget[] {
    return this.bloomModule?.targets ?? [];
  }

  get activeMsaa(): number {
    return this.bloomModule?.activeMsaa ?? 0;
  }

  get hasDarkenedState(): boolean {
    return this.bloomModule?.hasDarkenedState ?? false;
  }

  get savedBackground() {
    return this.bloomModule?.savedBackground ?? null;
  }

  get bloomComposer() {
    return this.bloomModule?.bloomComposer;
  }

  get finalComposer() {
    return this.bloomModule?.finalComposer;
  }

  darkenNonTargeted(): void {
    this.bloomModule?.darkenNonTargeted();
  }

  restoreNonTargeted(): void {
    this.bloomModule?.restoreNonTargeted();
  }

  runWithShadowBloomState(callback: () => void): void {
    this.bloomModule?.runWithShadowBloomState(callback);
  }
}

export {collectSelectionMeshes};

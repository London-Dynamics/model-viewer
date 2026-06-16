import {Camera, WebGLRenderer} from 'three';

import {EffectComposerInterface} from '../../../model-viewer-base.js';
import {LDBloomComposer, LDBloomOptions} from '../../../features/ld-bloom.js';
import {ModelScene} from '../../ModelScene.js';
import {
  AmbientOcclusionOptions,
  LDAmbientOcclusionComposer,
} from '../ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import {LDPathTracerComposer} from '../ld-path-tracer/LDPathTracerComposer.js';

export interface LDRenderPipelineOptions {
  ambientOcclusion: AmbientOcclusionOptions|null;
  bloom: LDBloomOptions;
  pathTracer: {
    enabled: boolean;
    samplesThreshold: number;
    composer: LDPathTracerComposer|null;
  };
}

type BloomPipelineHost = ConstructorParameters<typeof LDBloomComposer>[0];

export class LDRenderPipelineComposer implements EffectComposerInterface {
  private threeRenderer?: WebGLRenderer;
  private scene?: ModelScene;
  private camera?: Camera;
  private rasterDelegate: EffectComposerInterface|null = null;
  private options: LDRenderPipelineOptions;

  constructor(
    private readonly host: BloomPipelineHost,
    options: LDRenderPipelineOptions
  ) {
    this.options = cloneOptions(options);
    this.rebuildRasterDelegate();
  }

  hasAmbientOcclusion(): boolean {
    return this.options.ambientOcclusion != null;
  }

  hasBloom(): boolean {
    return this.options.bloom.enabled;
  }

  hasPathTracer(): boolean {
    return this.options.pathTracer.enabled &&
        this.options.pathTracer.composer != null;
  }

  getBloomTargetCount(): number {
    return this.options.bloom.targets.length;
  }

  get targets(): LDBloomOptions['targets'] {
    return this.options.bloom.targets.map((target) => ({...target}));
  }

  updateOptions(options: LDRenderPipelineOptions): void {
    const nextOptions = cloneOptions(options);
    if (this.canUpdateRasterDelegate(nextOptions)) {
      this.options = nextOptions;
      this.syncPathTracerBackend();
      if (this.rasterDelegate instanceof LDBloomComposer) {
        this.rasterDelegate.setTargets(this.options.bloom.targets);
        this.rasterDelegate.setActiveMsaa(this.effectiveBloomMsaa());
        this.rasterDelegate.updatePass();
      } else if (this.rasterDelegate instanceof LDAmbientOcclusionComposer &&
          this.options.ambientOcclusion != null) {
        this.rasterDelegate.updateOptions(this.options.ambientOcclusion);
      }
      return;
    }

    this.options = nextOptions;
    this.rebuildRasterDelegate();
  }

  setRenderer(renderer: WebGLRenderer): void {
    this.threeRenderer = renderer;
    this.rasterDelegate?.setRenderer(renderer);
    this.options.pathTracer.composer?.setRenderer(renderer);
  }

  setMainScene(scene: ModelScene): void {
    this.scene = scene;
    this.rasterDelegate?.setMainScene(scene);
    this.options.pathTracer.composer?.setMainScene(scene);
  }

  setMainCamera(camera: Camera): void {
    this.camera = camera;
    this.rasterDelegate?.setMainCamera(camera);
    this.options.pathTracer.composer?.setMainCamera(camera);
  }

  setSize(width: number, height: number): void {
    this.rasterDelegate?.setSize(width, height);
    this.options.pathTracer.composer?.setSize(width, height);
  }

  beforeRender(time: DOMHighResTimeStamp, delta: DOMHighResTimeStamp): void {
    this.options.pathTracer.composer?.beforeRender(time, delta);
    this.rasterDelegate?.beforeRender(time, delta);
  }

  render(deltaTime?: DOMHighResTimeStamp): void {
    if (this.shouldShowPathTracer()) {
      this.options.pathTracer.composer?.render(deltaTime);
      return;
    }

    this.options.pathTracer.composer?.render(deltaTime);
    this.rasterDelegate?.render(deltaTime);
  }

  dispose(): void {
    disposeDelegate(this.rasterDelegate);
    this.rasterDelegate = null;
    this.threeRenderer = undefined;
    this.scene = undefined;
    this.camera = undefined;
  }

  setActiveMsaa(msaa: number): void {
    (this.rasterDelegate as unknown as {setActiveMsaa?: (msaa: number) => void})
        ?.setActiveMsaa?.(msaa);
  }

  runWithShadowBloomState(callback: () => void): void {
    const delegate = this.rasterDelegate as unknown as {
      runWithShadowBloomState?: (callback: () => void) => void
    };
    if (typeof delegate.runWithShadowBloomState === 'function') {
      delegate.runWithShadowBloomState(callback);
      return;
    }
    callback();
  }

  darkenNonTargeted(): void {
    (this.rasterDelegate as unknown as {darkenNonTargeted?: () => void})
        ?.darkenNonTargeted?.();
  }

  restoreNonTargeted(): void {
    (this.rasterDelegate as unknown as {restoreNonTargeted?: () => void})
        ?.restoreNonTargeted?.();
  }

  get activeMsaa(): number|undefined {
    return (this.rasterDelegate as unknown as {activeMsaa?: number})
        ?.activeMsaa;
  }

  get hasDarkenedState(): boolean|undefined {
    return (this.rasterDelegate as unknown as {hasDarkenedState?: boolean})
        ?.hasDarkenedState;
  }

  get savedBackground(): unknown {
    return (this.rasterDelegate as unknown as {savedBackground?: unknown})
        ?.savedBackground;
  }

  get finalRenderTarget(): unknown {
    return (this.rasterDelegate as unknown as {finalRenderTarget?: unknown})
        ?.finalRenderTarget;
  }

  get renderer(): WebGLRenderer|undefined {
    return this.threeRenderer;
  }

  get bloomComposer(): unknown {
    return (this.rasterDelegate as unknown as {bloomComposer?: unknown})
        ?.bloomComposer;
  }

  get finalComposer(): unknown {
    return (this.rasterDelegate as unknown as {finalComposer?: unknown})
        ?.finalComposer;
  }

  get outputPass(): unknown {
    return (this.rasterDelegate as unknown as {outputPass?: unknown})
        ?.outputPass;
  }

  private rebuildRasterDelegate(): void {
    const previousRenderer = this.threeRenderer;
    const previousScene = this.scene;
    const previousCamera = this.camera;
    disposeDelegate(this.rasterDelegate);

    if (this.shouldUseBloomDelegate()) {
      const bloomDelegate = new LDBloomComposer(this.host);
      bloomDelegate.setTargets(this.options.bloom.targets);
      bloomDelegate.setActiveMsaa(this.effectiveBloomMsaa());
      this.rasterDelegate = bloomDelegate;
    } else if (this.options.ambientOcclusion != null) {
      this.rasterDelegate =
          new LDAmbientOcclusionComposer(this.options.ambientOcclusion);
    } else {
      this.rasterDelegate = null;
    }

    if (previousRenderer != null) {
      this.rasterDelegate?.setRenderer(previousRenderer);
      this.options.pathTracer.composer?.setRenderer(previousRenderer);
    }
    if (previousScene != null) {
      this.rasterDelegate?.setMainScene(previousScene);
      this.options.pathTracer.composer?.setMainScene(previousScene);
    }
    if (previousCamera != null) {
      this.rasterDelegate?.setMainCamera(previousCamera);
      this.options.pathTracer.composer?.setMainCamera(previousCamera);
    }
  }

  private effectiveBloomMsaa(): number {
    if (this.options.bloom.quality === 'performance' ||
        this.options.ambientOcclusion != null) {
      return 0;
    }
    return this.options.bloom.msaa;
  }

  private canUpdateRasterDelegate(nextOptions: LDRenderPipelineOptions): boolean {
    if (this.rasterDelegate instanceof LDBloomComposer) {
      return shouldUseBloomDelegate(nextOptions);
    }
    if (this.rasterDelegate instanceof LDAmbientOcclusionComposer) {
      return !shouldUseBloomDelegate(nextOptions) &&
          nextOptions.ambientOcclusion != null;
    }
    return this.rasterDelegate == null && !shouldUseBloomDelegate(nextOptions) &&
        nextOptions.ambientOcclusion == null;
  }

  private shouldUseBloomDelegate(): boolean {
    return shouldUseBloomDelegate(this.options);
  }

  private syncPathTracerBackend(): void {
    if (this.threeRenderer != null) {
      this.options.pathTracer.composer?.setRenderer(this.threeRenderer);
    }
    if (this.scene != null) {
      this.options.pathTracer.composer?.setMainScene(this.scene);
    }
    if (this.camera != null) {
      this.options.pathTracer.composer?.setMainCamera(this.camera);
    }
  }

  private shouldShowPathTracer(): boolean {
    const composer = this.options.pathTracer.composer;
    if (!this.options.pathTracer.enabled || composer == null) {
      return false;
    }
    if (this.rasterDelegate == null) {
      return true;
    }
    return composer.getSamples() >= this.options.pathTracer.samplesThreshold;
  }
}

const cloneOptions = (
  options: LDRenderPipelineOptions
): LDRenderPipelineOptions => ({
  ambientOcclusion: options.ambientOcclusion == null ?
    null :
    {...options.ambientOcclusion},
  bloom: {
    ...options.bloom,
    targets: options.bloom.targets.map((target) => ({...target})),
  },
  pathTracer: {...options.pathTracer},
});

const disposeDelegate = (delegate: EffectComposerInterface|null): void => {
  (delegate as unknown as {dispose?: () => void}|null)?.dispose?.();
};

const shouldUseBloomDelegate = (options: LDRenderPipelineOptions): boolean =>
  options.bloom.enabled && options.bloom.strength > 0;

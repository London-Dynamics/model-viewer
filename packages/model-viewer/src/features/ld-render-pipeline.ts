import {Object3D} from 'three';

import {
  $needsRender,
  $onModelLoad,
  $scene,
} from '../model-viewer-base.js';
import ModelViewerElementBase from '../model-viewer-base.js';
import {
  AmbientOcclusionOptions,
} from '../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import {
  DEFAULT_SELECTION_OUTLINE_STYLE,
} from '../three-components/postprocessing/ld-selection/selection-outline-pass.js';
import {
  LDRenderPipelineComposer,
  LDRenderPipelineOptions,
  SelectionOutlineOptions,
} from '../three-components/postprocessing/ld-render-pipeline/LDRenderPipelineComposer.js';
import {Constructor} from '../utilities.js';
import {LDBloomOptions} from './ld-bloom.js';
import {LDPathTracerComposer} from '../three-components/postprocessing/ld-path-tracer/LDPathTracerComposer.js';

const $renderPipelineComposer = Symbol('renderPipelineComposer');
const $syncRenderPipeline = Symbol('syncRenderPipeline');
const $pipelineOptions = Symbol('pipelineOptions');
const $qualityTimer = Symbol('qualityTimer');
const $handleCameraChange = Symbol('handleCameraChange');
const PATH_TRACER_BACKEND_CHANGE_EVENT = 'ld-path-tracer-backend-change';

export declare interface LDRenderPipelineInterface {
  readonly ldRenderPipelineActive: boolean;
  updateSelectionOutlineSelection(objects: Object3D[]): void;
}

type PipelineHost = ModelViewerElementBase&{
  ambientOcclusion?: boolean;
  getAmbientOcclusionOptions?: () => AmbientOcclusionOptions;
  bloom?: boolean;
  bloomMode?: LDBloomOptions['mode'];
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  bloomQuality?: LDBloomOptions['quality'];
  bloomMsaa?: number;
  bloomSoftShadow?: boolean;
  getBloomTargets?: () => LDBloomOptions['targets'];
  pathTracer?: boolean;
  pathTracerSamplesThreshold?: number;
  getPathTracerComposer?: () => LDPathTracerComposer|null;
  highlightSelected?: boolean;
  selectionHighlightColor?: string;
  selectionHighlightThickness?: number;
  getSelectionHighlightMeshes?: () => Object3D[];
};

const EMPTY_BLOOM: LDBloomOptions = {
  enabled: false,
  targets: [],
  mode: 'unreal',
  strength: 0.6,
  radius: 0.2,
  threshold: 0.05,
  quality: 'quality',
  msaa: 4,
  softShadow: false,
};

const SMART_IDLE_MS = 250;

const PIPELINE_OPTION_PROPERTIES = [
  'ambientOcclusion',
  'aoAlgorithm',
  'aoRadius',
  'aoIntensity',
  'aoBias',
  'aoThickness',
  'aoDistanceExponent',
  'aoDistanceFalloff',
  'aoSamples',
  'aoScreenSpaceRadius',
  'aoNoise',
  'aoOutput',
  'aoDenoiseRadius',
  'aoDenoiseRadiusExponent',
  'aoDenoiseRings',
  'aoDenoiseSamples',
  'aoDenoiseLumaPhi',
  'aoDenoiseDepthPhi',
  'aoDenoiseNormalPhi',
  'bloom',
  'bloomTargets',
  'bloomMode',
  'bloomStrength',
  'bloomRadius',
  'bloomThreshold',
  'bloomQuality',
  'bloomMsaa',
  'bloomSoftShadow',
  'pathTracer',
  'pathTracerSamplesThreshold',
  'highlightSelected',
  'selectionHighlightColor',
  'selectionHighlightThickness',
] as const;

export const LDRenderPipelineMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
) => {
  class LDRenderPipelineModelViewerElement extends ModelViewerElement {
    protected[$renderPipelineComposer]: LDRenderPipelineComposer|null = null;
    private[$qualityTimer]: number|null = null;

    get ldRenderPipelineActive() {
      return this[$renderPipelineComposer] != null;
    }

    updateSelectionOutlineSelection(objects: Object3D[]): void {
      this[$renderPipelineComposer]?.updateSelectionOutlineSelection(objects);
    }

    override connectedCallback() {
      super.connectedCallback();
      this.addEventListener('camera-change', this[$handleCameraChange]);
      this.addEventListener(
          PATH_TRACER_BACKEND_CHANGE_EVENT, this[$syncRenderPipeline]);
      this[$syncRenderPipeline]();
      this.updateComplete.then(() => this[$syncRenderPipeline]());
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('camera-change', this[$handleCameraChange]);
      this.removeEventListener(
          PATH_TRACER_BACKEND_CHANGE_EVENT, this[$syncRenderPipeline]);
      if (this[$qualityTimer] != null) {
        window.clearTimeout(this[$qualityTimer]);
        this[$qualityTimer] = null;
      }
      this.teardownRenderPipeline();
    }

    override updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (PIPELINE_OPTION_PROPERTIES.some((prop) =>
            changedProperties.has(prop))) {
        this[$syncRenderPipeline]();
      }
    }

    override[$onModelLoad]() {
      super[$onModelLoad]();
      this[$syncRenderPipeline]();
    }

    private[$syncRenderPipeline]() {
      const options = this[$pipelineOptions]();
      const shouldEnable =
          options.ambientOcclusion != null ||
          (options.bloom.enabled && options.bloom.strength > 0) ||
          options.pathTracer.enabled ||
          options.selectionOutline?.enabled === true;

      if (!shouldEnable) {
        this.teardownRenderPipeline();
        return;
      }

      if (this[$renderPipelineComposer] == null) {
        this[$renderPipelineComposer] =
            new LDRenderPipelineComposer(this as any, options);
        this.registerEffectComposer(this[$renderPipelineComposer]);
      } else {
        this[$renderPipelineComposer].updateOptions(options);
        if ((this as any)[$scene].effectRenderer !==
            this[$renderPipelineComposer]) {
          this.registerEffectComposer(this[$renderPipelineComposer]);
        }
      }

      const host = this as unknown as PipelineHost;
      if (typeof host.getSelectionHighlightMeshes === 'function') {
        this[$renderPipelineComposer]!.updateSelectionOutlineSelection(
            host.getSelectionHighlightMeshes());
      }

      (this as any)[$needsRender]();
    }

    private[$pipelineOptions](): LDRenderPipelineOptions {
      const host = this as unknown as PipelineHost;
      const ambientOcclusion =
          host.ambientOcclusion &&
          typeof host.getAmbientOcclusionOptions === 'function' ?
          host.getAmbientOcclusionOptions() :
          null;
      const bloom: LDBloomOptions = {
        ...EMPTY_BLOOM,
        enabled: Boolean(host.bloom),
        targets: typeof host.getBloomTargets === 'function' ?
          host.getBloomTargets().filter((target) =>
            target.material != null || target.mesh != null) :
          [],
        mode: host.bloomMode ?? EMPTY_BLOOM.mode,
        strength: host.bloomStrength ?? EMPTY_BLOOM.strength,
        radius: host.bloomRadius ?? EMPTY_BLOOM.radius,
        threshold: host.bloomThreshold ?? EMPTY_BLOOM.threshold,
        quality: host.bloomQuality ?? EMPTY_BLOOM.quality,
        msaa: host.bloomMsaa ?? EMPTY_BLOOM.msaa,
        softShadow: host.bloomSoftShadow ?? EMPTY_BLOOM.softShadow,
      };

      const selectionOutline: SelectionOutlineOptions|null =
          host.highlightSelected ?
          {
            enabled: true,
            color: host.selectionHighlightColor ||
                DEFAULT_SELECTION_OUTLINE_STYLE.color,
            thickness: host.selectionHighlightThickness ??
                DEFAULT_SELECTION_OUTLINE_STYLE.thickness,
          } :
          null;

      return {
        ambientOcclusion,
        bloom,
        pathTracer: {
          enabled: Boolean(host.pathTracer),
          samplesThreshold: Math.max(
              1, Math.floor(host.pathTracerSamplesThreshold ?? 1)),
          composer: typeof host.getPathTracerComposer === 'function' ?
            host.getPathTracerComposer() :
            null,
        },
        selectionOutline,
      };
    }

    private teardownRenderPipeline() {
      if (this[$renderPipelineComposer] == null) {
        return;
      }

      if ((this as any)[$scene].effectRenderer ===
          this[$renderPipelineComposer]) {
        this.unregisterEffectComposer();
      }
      this[$renderPipelineComposer].dispose();
      this[$renderPipelineComposer] = null;
      (this as any)[$needsRender]();
    }

    private[$handleCameraChange] = () => {
      const options = this[$pipelineOptions]();
      if (!options.bloom.enabled || options.bloom.quality !== 'smart') {
        return;
      }

      this[$renderPipelineComposer]?.setActiveMsaa(0);
      if (this[$qualityTimer] != null) {
        window.clearTimeout(this[$qualityTimer]);
      }
      this[$qualityTimer] = window.setTimeout(() => {
        this[$qualityTimer] = null;
        const nextOptions = this[$pipelineOptions]();
        this[$renderPipelineComposer]?.setActiveMsaa(
            nextOptions.ambientOcclusion == null ? nextOptions.bloom.msaa : 0);
        (this as any)[$scene].queueRender();
      }, SMART_IDLE_MS);
      (this as any)[$scene].queueRender();
    };
  }

  return LDRenderPipelineModelViewerElement as Constructor<
      LDRenderPipelineInterface> &
      T;
};

import {property} from 'lit/decorators.js';

import {
  EffectComposerInterface,
  $needsRender,
  $scene,
} from '../model-viewer-base.js';
import ModelViewerElementBase from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {
  AmbientOcclusionOptions,
  LDAmbientOcclusionComposer,
} from '../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import {AOShader} from '../three-components/postprocessing/ld-ambient-occlusion/AOShader.js';
import {AOPass} from '../three-components/postprocessing/ld-ambient-occlusion/AOPass.js';

const AO_OUTPUT =
    ((AOPass as unknown) as {OUTPUT: Record<string, number>}).OUTPUT ?? {
      Default: 0,
      Diffuse: 1,
      Depth: 2,
      Normal: 3,
      AO: 4,
      Denoise: 5,
    };

export type AoAlgorithmName = 'ssao'|'sao'|'n8ao'|'hbao'|'gtao';
export type AoOutputName =
    'default'|'diffuse'|'depth'|'normal'|'ao'|'denoise';

const algorithmMap: Record<AoAlgorithmName, number> = {
  ssao: AOShader.ALGORITHM.SSAO,
  sao: AOShader.ALGORITHM.SAO,
  n8ao: AOShader.ALGORITHM.N8AO,
  hbao: AOShader.ALGORITHM.HBAO,
  gtao: AOShader.ALGORITHM.GTAO,
};

const outputMap: Record<AoOutputName, number> = {
  'default': AO_OUTPUT.Default,
  'diffuse': AO_OUTPUT.Diffuse,
  'depth': AO_OUTPUT.Depth,
  'normal': AO_OUTPUT.Normal,
  'ao': AO_OUTPUT.AO,
  'denoise': AO_OUTPUT.Denoise,
};

const $aoComposer = Symbol('aoComposer');

export declare interface LDAmbientOcclusionInterface {
  ambientOcclusion: boolean;
  aoAlgorithm: AoAlgorithmName;
  aoRadius: number;
  aoIntensity: number;
  aoBias: number;
  aoThickness: number;
  aoDistanceExponent: number;
  aoDistanceFalloff: number;
  aoSamples: number;
  aoScreenSpaceRadius: boolean;
  aoNoise: 'magic-square'|'random';
  aoOutput: AoOutputName;
  aoDenoiseRadius: number;
  aoDenoiseRadiusExponent: number;
  aoDenoiseRings: number;
  aoDenoiseSamples: number;
  aoDenoiseLumaPhi: number;
  aoDenoiseDepthPhi: number;
  aoDenoiseNormalPhi: number;
}

export const LDAmbientOcclusionMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
) => {
  class LDAmbientOcclusionModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'ambient-occlusion'})
    ambientOcclusion = false;

    @property({type: String, attribute: 'ao-algorithm'})
    aoAlgorithm: AoAlgorithmName = 'gtao';

    @property({type: Number, attribute: 'ao-radius'})
    aoRadius = 4;

    @property({type: Number, attribute: 'ao-intensity'})
    aoIntensity = 1;

    @property({type: Number, attribute: 'ao-bias'})
    aoBias = 0.001;

    @property({type: Number, attribute: 'ao-thickness'})
    aoThickness = 10;

    @property({type: Number, attribute: 'ao-distance-exponent'})
    aoDistanceExponent = 2;

    @property({type: Number, attribute: 'ao-distance-falloff'})
    aoDistanceFalloff = 1;

    @property({type: Number, attribute: 'ao-samples'})
    aoSamples = 24;

    @property({type: Boolean, attribute: 'ao-screen-space-radius'})
    aoScreenSpaceRadius = false;

    @property({type: String, attribute: 'ao-noise'})
    aoNoise: 'magic-square'|'random' = 'magic-square';

    @property({type: String, attribute: 'ao-output'})
    aoOutput: AoOutputName = 'default';

    @property({type: Number, attribute: 'ao-denoise-radius'})
    aoDenoiseRadius = 4;

    @property({type: Number, attribute: 'ao-denoise-radius-exponent'})
    aoDenoiseRadiusExponent = 1;

    @property({type: Number, attribute: 'ao-denoise-rings'})
    aoDenoiseRings = 2;

    @property({type: Number, attribute: 'ao-denoise-samples'})
    aoDenoiseSamples = 16;

    @property({type: Number, attribute: 'ao-denoise-luma-phi'})
    aoDenoiseLumaPhi = 10;

    @property({type: Number, attribute: 'ao-denoise-depth-phi'})
    aoDenoiseDepthPhi = 2;

    @property({type: Number, attribute: 'ao-denoise-normal-phi'})
    aoDenoiseNormalPhi = 3;

    protected[$aoComposer]: EffectComposerInterface|null = null;

    override disconnectedCallback() {
      super.disconnectedCallback();
      this.teardownAmbientOcclusion();
    }

    override updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('ambientOcclusion')) {
        if (this.ambientOcclusion) {
          this.setupAmbientOcclusion();
        } else {
          this.teardownAmbientOcclusion();
        }
      }

      const knobs = [
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
      ];

      if (knobs.some((prop) => changedProperties.has(prop))) {
        const options = this.getComposerOptions();
        if (this[$aoComposer] instanceof LDAmbientOcclusionComposer) {
          this[$aoComposer].updateOptions(options);
          (this as any)[$needsRender]();
        }
      }
    }

    private setupAmbientOcclusion() {
      const currentEffect = (this as any)[$scene].effectRenderer;
      if (currentEffect != null && currentEffect !== this[$aoComposer]) {
        console.warn(
            '[model-viewer] ambient-occlusion requires control over the effect composer. Please remove other custom composers before enabling.');
        this.ambientOcclusion = false;
        return;
      }

      if (!this[$aoComposer]) {
        this[$aoComposer] =
            new LDAmbientOcclusionComposer(this.getComposerOptions());
      }
      this.registerEffectComposer(this[$aoComposer]!);
      (this as any)[$needsRender]();
    }

    private teardownAmbientOcclusion() {
      if (this[$aoComposer]) {
        if ((this as any)[$scene].effectRenderer === this[$aoComposer]) {
          this.unregisterEffectComposer();
        }
        (this[$aoComposer] as LDAmbientOcclusionComposer).dispose();
        this[$aoComposer] = null;
        (this as any)[$needsRender]();
      }
    }

    private getComposerOptions(): AmbientOcclusionOptions {
      const algorithm =
          algorithmMap[this.aoAlgorithm] ?? AOShader.ALGORITHM.GTAO;
      const output = outputMap[this.aoOutput] ?? AO_OUTPUT.Default;
      const nvAligned = !(algorithm === AOShader.ALGORITHM.GTAO ||
                          algorithm === AOShader.ALGORITHM.HBAO);

      return {
        algorithm,
        radius: this.aoRadius,
        distanceExponent: this.aoDistanceExponent,
        thickness: this.aoThickness,
        distanceFallOff: this.aoDistanceFalloff,
        bias: this.aoBias,
        scale: 1,
        samples: Math.max(2, Math.floor(this.aoSamples)),
        nvAlignedSamples: nvAligned,
        screenSpaceRadius: this.aoScreenSpaceRadius,
        aoNoiseType: this.aoNoise,
        intensity: this.aoIntensity,
        output,
        pdLumaPhi: this.aoDenoiseLumaPhi,
        pdDepthPhi: this.aoDenoiseDepthPhi,
        pdNormalPhi: this.aoDenoiseNormalPhi,
        pdRadius: this.aoDenoiseRadius,
        pdRadiusExponent: this.aoDenoiseRadiusExponent,
        pdRings: this.aoDenoiseRings,
        pdSamples: Math.max(2, Math.floor(this.aoDenoiseSamples)),
      };
    }
  }

  return LDAmbientOcclusionModelViewerElement as Constructor<
      LDAmbientOcclusionInterface> &
      T;
};


import {property} from 'lit/decorators.js';

import {$needsRender} from '../model-viewer-base.js';
import ModelViewerElementBase from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {
  getAoOptionsFromHost,
  syncLDEffectsComposer,
} from './ld-effects-composer/index.js';
import {$ldEffectsComposer} from './ld-effects-composer/index.js';
import type {LDEffectsComposer} from './ld-effects-composer/index.js';
import type {LDEffectsHost} from './ld-effects-composer/types.js';

export type AoAlgorithmName = 'ssao'|'sao'|'n8ao'|'hbao'|'gtao';
export type AoOutputName =
    'default'|'diffuse'|'depth'|'normal'|'ao'|'denoise';

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

const AO_KNOBS = [
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
] as const;

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

    override updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (
          changedProperties.has('ambientOcclusion') ||
          AO_KNOBS.some((prop) => changedProperties.has(prop))
      ) {
        const composer =
            (this as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
                [$ldEffectsComposer];
        if (composer != null && this.ambientOcclusion) {
          composer.updateAoOptions(getAoOptionsFromHost(this as unknown as LDEffectsHost));
        }
        syncLDEffectsComposer(this);
        (this as any)[$needsRender]();
      }
    }
  }

  return LDAmbientOcclusionModelViewerElement as Constructor<
      LDAmbientOcclusionInterface> &
      T;
};

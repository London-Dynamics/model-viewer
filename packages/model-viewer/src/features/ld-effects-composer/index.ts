/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import type {Object3D} from 'three';

import ModelViewerElementBase, {$needsRender, $scene} from '../../model-viewer-base.js';
import type {AmbientOcclusionOptions} from '../../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import {AOShader} from '../../three-components/postprocessing/ld-ambient-occlusion/AOShader.js';
import {AOPass} from '../../three-components/postprocessing/ld-ambient-occlusion/AOPass.js';
import type {LDBloomTarget} from '../ld-bloom.js';
import type {AoAlgorithmName, AoOutputName} from '../ld-ambient-occlusion.js';

import {LDEffectsComposer} from './ld-effects-composer.js';
import {
  collectSelectionMeshes,
  DEFAULT_SELECTION_HIGHLIGHT_COLOR,
  DEFAULT_SELECTION_OUTLINE_EDGE_STRENGTH,
  DEFAULT_SELECTION_OUTLINE_WIDTH,
} from './selection-outline-module.js';
import type {LDEffectsHost, LDSelectionOutlineState} from './types.js';

export const $ldEffectsComposer = Symbol('ldEffectsComposer');
export const $ldEffectsSelectionMeshes = Symbol('ldEffectsSelectionMeshes');

let warnedLegacyEffectComposer = false;

const AO_OUTPUT =
    ((AOPass as unknown) as {OUTPUT: Record<string, number>}).OUTPUT ?? {
      Default: 0,
      Diffuse: 1,
      Depth: 2,
      Normal: 3,
      AO: 4,
      Denoise: 5,
    };

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

export {
  DEFAULT_SELECTION_HIGHLIGHT_COLOR,
  DEFAULT_SELECTION_OUTLINE_EDGE_STRENGTH,
  DEFAULT_SELECTION_OUTLINE_WIDTH,
  LDEffectsComposer,
  collectSelectionMeshes,
};

export function getAoOptionsFromHost(
    host: LDEffectsHost,
    ): AmbientOcclusionOptions {
  const algorithm =
      algorithmMap[host.aoAlgorithm] ?? AOShader.ALGORITHM.GTAO;
  const output = outputMap[host.aoOutput] ?? AO_OUTPUT.Default;
  const nvAligned = !(algorithm === AOShader.ALGORITHM.GTAO ||
                      algorithm === AOShader.ALGORITHM.HBAO);

  return {
    algorithm,
    radius: host.aoRadius,
    distanceExponent: host.aoDistanceExponent,
    thickness: host.aoThickness,
    distanceFallOff: host.aoDistanceFalloff,
    bias: host.aoBias,
    scale: 1,
    samples: Math.max(2, Math.floor(host.aoSamples)),
    nvAlignedSamples: nvAligned,
    screenSpaceRadius: host.aoScreenSpaceRadius,
    aoNoiseType: host.aoNoise,
    intensity: host.aoIntensity,
    output,
    pdLumaPhi: host.aoDenoiseLumaPhi,
    pdDepthPhi: host.aoDenoiseDepthPhi,
    pdNormalPhi: host.aoDenoiseNormalPhi,
    pdRadius: host.aoDenoiseRadius,
    pdRadiusExponent: host.aoDenoiseRadiusExponent,
    pdRings: host.aoDenoiseRings,
    pdSamples: Math.max(2, Math.floor(host.aoDenoiseSamples)),
  };
}

function getSelectionOutlineState(host: LDEffectsHost): LDSelectionOutlineState {
  const meshes =
      (host as unknown as {[$ldEffectsSelectionMeshes]?: () => Object3D[]})
          [$ldEffectsSelectionMeshes]?.() ?? [];
  return {
    enabled: host.highlightSelected,
    color: host.selectionHighlightColor ?? DEFAULT_SELECTION_HIGHLIGHT_COLOR,
    width: DEFAULT_SELECTION_OUTLINE_WIDTH,
    edgeStrength: DEFAULT_SELECTION_OUTLINE_EDGE_STRENGTH,
    selectedMeshes: collectSelectionMeshes(meshes),
  };
}

function hasActiveLdEffects(host: LDEffectsHost): boolean {
  return host.bloom || host.ambientOcclusion || host.highlightSelected;
}

function warnLegacyEffectComposer(host: ModelViewerElementBase): void {
  if (warnedLegacyEffectComposer) {
    return;
  }
  const legacy = (host as HTMLElement).querySelector('effect-composer');
  if (legacy != null) {
    warnedLegacyEffectComposer = true;
    console.warn(
        '[model-viewer] <effect-composer> in light DOM is ignored when LD ' +
        'postprocessing (bloom, ambient-occlusion, highlight-selected) is ' +
        'enabled. Use attributes on <model-viewer> instead.');
  }
}

export function syncLDEffectsComposer(host: ModelViewerElementBase): void {
  const effectsHost = host as unknown as LDEffectsHost;

  if (!hasActiveLdEffects(effectsHost)) {
    const composer =
        (host as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
            [$ldEffectsComposer];
    if (composer != null) {
      if ((host as any)[$scene].effectRenderer === composer) {
        host.unregisterEffectComposer();
      }
      composer.dispose();
      (host as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
          [$ldEffectsComposer] = undefined;
    }
    (host as any)[$needsRender]();
    return;
  }

  warnLegacyEffectComposer(host);

  let composer =
      (host as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
          [$ldEffectsComposer];
  if (composer == null) {
    composer = new LDEffectsComposer(effectsHost);
    (host as unknown as {[$ldEffectsComposer]: LDEffectsComposer})
        [$ldEffectsComposer] = composer;
    host.registerEffectComposer(composer);
  }

  const bloomTargets =
      typeof (effectsHost as {getBloomTargets?: () => LDBloomTarget[]})
              .getBloomTargets === 'function' ?
      (effectsHost as {getBloomTargets: () => LDBloomTarget[]})
          .getBloomTargets()
          .filter((t) => !!(t.material || t.mesh)) :
      [];

  composer.configure(
      {
        bloom: effectsHost.bloom,
        ambientOcclusion: effectsHost.ambientOcclusion,
        highlightSelected: effectsHost.highlightSelected,
      },
      effectsHost.ambientOcclusion ? getAoOptionsFromHost(effectsHost) : null,
      bloomTargets,
      getSelectionOutlineState(effectsHost),
  );

  (host as any)[$scene].queueRender();
  (host as any)[$needsRender]();
}

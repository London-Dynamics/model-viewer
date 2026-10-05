// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type * as THREE from "three/webgpu";
import type { IWaveSimulation } from "../waves";
import type { WaveUniforms } from "../../uniforms";
import { FoamAccumulation } from "./FoamAccumulation";
import type { FoamAccumulationConfig } from "./FoamAccumulation";

export type { FoamAccumulationConfig };

/**
 * Construct the world-fixed wave-crest foam accumulator, or `null` when the wave
 * sim exposes no cascade-0 normal texture to inject from. The accumulator is a
 * registered {@link WaterSubsystem}: it persists across quality switches and
 * rebinds to a new wave sim via {@link FoamAccumulation.setOceanSim}, so this
 * runs once at construction.
 *
 * One render-target implementation serves both backends — foam has no spatial
 * coupling, so the camera-anchored decay+inject runs as a fragment pass over a
 * half-float target on WebGPU and WebGL alike.
 *
 * @param renderer - Active renderer.
 * @param oceanSim - The wave simulation whose cascade normals drive injection.
 * @param waveUniforms - Shared wave uniforms (the wind-direction node is bound in).
 * @param config - Shared persistence + enable nodes (owned by `WaveFoam`) plus the field resolution and world extent.
 */
export function createFoamAccumulation(
  renderer: THREE.WebGPURenderer,
  oceanSim: IWaveSimulation,
  waveUniforms: WaveUniforms,
  config: FoamAccumulationConfig,
): FoamAccumulation | null {
  // Cascade 0's normal texture is an inject signal source; required on both backends.
  if (!oceanSim.getNormalTexture(0) || !oceanSim.getScaleNode(0)) return null;

  return new FoamAccumulation(renderer, oceanSim, waveUniforms, config);
}

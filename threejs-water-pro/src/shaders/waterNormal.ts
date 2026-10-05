// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Water surface normal computation, shared between the main water fragment
 * shader and the SSR reflection G-buffer pass.
 *
 * Combines (in order):
 *   1. Cascade-sampled FFT normal (WebGPU) or noise-based normal (WebGL).
 *   2. Optional rain ripple normal blended via RNM.
 *
 * Waterline meniscus tilt is *not* included here — it depends on clip-plane
 * uniforms that only exist in the main material and is intentionally left
 * to callers.
 */
import { float, normalize, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type * as THREE from "three/webgpu";
import type { IWaveSimulation } from "../simulation/waves";
import type { RainRipples } from "../simulation/ripples";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
import type { CascadeSampler } from "./cascadeSampler";

export interface BuildWaterSurfaceNormalParams {
  oceanSim: IWaveSimulation;
  /** CascadeSampler instance for WebGPU path. Null for WebGL. */
  cascadeSampler: CascadeSampler | null;
  /** Grid-reference world X coordinate at the fragment (FFT is grid-anchored). */
  fragWorldX: Node;
  /** Grid-reference world Z coordinate at the fragment (FFT is grid-anchored). */
  fragWorldZ: Node;
  /** True (choppy-displaced) world X for sampling the world-anchored wake field. */
  wakeWorldX: Node;
  /** True (choppy-displaced) world Z for sampling the world-anchored wake field. */
  wakeWorldZ: Node;
  /** Hierarchical cascade sample coordinates from the vertex stage, one per cascade after the first. */
  vHierarchicalCoords: Node[];
  /** Rain ripple simulation, or null if disabled. */
  rainRipples: RainRipples | null;
  /** Wake field sampler for wake normal perturbation, or null if disabled. */
  wakeFieldSampler: IWakeFieldSampler | null;
  /** Camera world position, used by rain ripple distance fade. */
  cameraPosition: Node;
  /**
   * Multiplier applied to ripple splash output. 1.0 for front face, 0.0 for
   * back face. Pass 1.0 from passes that don't distinguish (e.g. G-buffer).
   */
  frontFaceMultiplier: Node;
}

export interface BuildWaterSurfaceNormalResult {
  /** Final surface normal in world space. */
  interpolatedNormal: Node;
  /** Per-drop rain ripple splash factor. Null if rain ripples are disabled. */
  rippleSplash: Node | null;
  /**
   * Sub-footprint slope variance (0-1) from the cascade normal mips, driving
   * the filtered-BRDF reflection roughness. Zero on the WebGL noise path.
   */
  slopeVariance: Node;
}

/**
 * Builds the wave-displaced surface normal.
 *
 * Identical to the inline computation previously in `waterFragment.ts` so
 * the SSR G-buffer pass produces a `reflectDir` that matches the main pass.
 */
export function buildWaterSurfaceNormal(
  params: BuildWaterSurfaceNormalParams,
): BuildWaterSurfaceNormalResult {
  const {
    oceanSim,
    cascadeSampler,
    fragWorldX,
    fragWorldZ,
    wakeWorldX,
    wakeWorldZ,
    vHierarchicalCoords,
    rainRipples,
    wakeFieldSampler,
    cameraPosition,
    frontFaceMultiplier,
  } = params;

  let interpolatedNormal: Node;
  let slopeVariance: Node = float(0.0);

  if (cascadeSampler) {
    // WebGPU path: hierarchical cascade sampling on storage textures
    // (HW bilinear). The storage textures are written every frame by
    // `computeNormals` alongside the storage buffers.
    const normalTextures = Array.from(
      { length: cascadeSampler.cascadeCount },
      (_, i) => oceanSim.getNormalTexture(i) as THREE.Texture,
    );
    const hierarchicalCoords = vHierarchicalCoords.map((coords) => ({
      x: coords.x,
      z: coords.y,
    }));

    const result = cascadeSampler.sampleNormals(
      fragWorldX,
      fragWorldZ,
      hierarchicalCoords,
      normalTextures,
    );

    interpolatedNormal = result.normal;
    slopeVariance = result.slopeVariance;
  } else {
    // WebGL path: noise-based normal nodes.
    const normalNodes = oceanSim.getNormalNodes();
    interpolatedNormal = normalNodes.sampleNormal(fragWorldX, fragWorldZ);
  }

  // Wake field normal: perturb by the wake's height gradient (RNM blend) so the
  // wake catches light. Reads as (0,1,0) where the field is calm. Sampled at the
  // displaced world position so the lit wake stays aligned with its geometry.
  if (wakeFieldSampler) {
    const wn = wakeFieldSampler.sampleNormal(wakeWorldX, wakeWorldZ);
    interpolatedNormal = normalize(
      vec3(
        interpolatedNormal.x.add(wn.x),
        interpolatedNormal.y.add(wn.y.sub(1.0)),
        interpolatedNormal.z.add(wn.z),
      ),
    );
  }

  let rippleSplash: Node | null = null;
  if (rainRipples) {
    const rippleResult = rainRipples.build(fragWorldX, fragWorldZ, cameraPosition);
    interpolatedNormal = normalize(
      vec3(
        interpolatedNormal.x.add(rippleResult.normal.x),
        interpolatedNormal.y.add(rippleResult.normal.y.sub(1.0)),
        interpolatedNormal.z.add(rippleResult.normal.z),
      ),
    );
    rippleSplash = rippleResult.splash.mul(frontFaceMultiplier);
  }

  return { interpolatedNormal, rippleSplash, slopeVariance };
}

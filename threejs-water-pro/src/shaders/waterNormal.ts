/**
 * Water surface normal computation, shared between the main water fragment
 * shader and the SSR reflection G-buffer pass.
 *
 * Combines (in order):
 *   1. Cascade-sampled FFT normal (WebGPU) or noise-based normal (WebGL).
 *   2. Gerstner analytical normal blended via Reoriented Normal Mapping.
 *   3. Optional rain ripple normal blended via RNM.
 *
 * Returns the surface normal plus eigenvalues used by foam shaders. Waterline
 * meniscus tilt is *not* included here — it depends on clip-plane uniforms
 * that only exist in the main material and is intentionally left to callers.
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
  /** Grid-reference world X coordinate at the fragment (FFT/Gerstner are grid-anchored). */
  fragWorldX: Node;
  /** Grid-reference world Z coordinate at the fragment (FFT/Gerstner are grid-anchored). */
  fragWorldZ: Node;
  /** True (choppy-displaced) world X for sampling the world-anchored wake field. */
  wakeWorldX: Node;
  /** True (choppy-displaced) world Z for sampling the world-anchored wake field. */
  wakeWorldZ: Node;
  /** Hierarchical cascade sample coordinates from the vertex stage. */
  vSampleCoords0: Node;
  /** Vertex-interpolated Gerstner normal. */
  vGerstnerNormal: Node;
  /** Vertex-interpolated Gerstner folding factor. */
  vGerstnerFolding: Node;
  /** Compile-time max number of Gerstner waves (0 disables). */
  gerstnerMaxWaves: number;
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
  /** Cascade-0 eigenvalue (folding factor) for crest foam. */
  eigen0: Node;
  /** Cascade-1 eigenvalue (folding factor) for crest foam. */
  eigen1: Node;
  /** Per-drop rain ripple splash factor. Null if rain ripples are disabled. */
  rippleSplash: Node | null;
}

/**
 * Builds the wave-displaced surface normal and supporting eigenvalues.
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
    vSampleCoords0,
    vGerstnerNormal,
    vGerstnerFolding,
    gerstnerMaxWaves,
    rainRipples,
    wakeFieldSampler,
    cameraPosition,
    frontFaceMultiplier,
  } = params;

  let interpolatedNormal: Node;
  let eigen0: Node;
  let eigen1: Node;

  if (cascadeSampler) {
    // WebGPU path: hierarchical cascade sampling on storage textures
    // (HW bilinear). The storage textures are written every frame by
    // `computeNormals` alongside the storage buffers.
    const normalTexture0 = oceanSim.getNormalTexture(0) as THREE.Texture;
    const normalTexture1 =
      cascadeSampler.cascadeCount >= 2
        ? (oceanSim.getNormalTexture(1) as THREE.Texture)
        : undefined;

    const result = cascadeSampler.sampleNormals(
      fragWorldX,
      fragWorldZ,
      vSampleCoords0.x,
      vSampleCoords0.y,
      normalTexture0,
      normalTexture1,
    );

    if (gerstnerMaxWaves > 0) {
      const gn = vGerstnerNormal;
      // Reoriented Normal Mapping blend.
      interpolatedNormal = normalize(
        vec3(
          result.normal.x.add(gn.x),
          result.normal.y.add(gn.y.sub(1.0)),
          result.normal.z.add(gn.z),
        ),
      );
      eigen0 = result.eigen0.sub(vGerstnerFolding);
    } else {
      interpolatedNormal = result.normal;
      eigen0 = result.eigen0;
    }
    eigen1 = result.eigen1;
  } else {
    // WebGL path: noise-based normal nodes.
    const normalNodes = oceanSim.getNormalNodes();

    if (normalNodes.sampleNormalAndEigenvalue) {
      const result = normalNodes.sampleNormalAndEigenvalue(
        fragWorldX,
        fragWorldZ,
      );
      interpolatedNormal = result.normal;
      eigen0 = result.eigen0;
      eigen1 = result.eigen1;
    } else {
      interpolatedNormal = normalNodes.sampleNormal(fragWorldX, fragWorldZ);
      eigen0 = float(1.0);
      eigen1 = float(1.0);
    }

    // Gerstner waves are large-scale, so their folding adds to the wave cascade.
    if (gerstnerMaxWaves > 0) {
      const gn = vGerstnerNormal;
      interpolatedNormal = normalize(
        vec3(
          interpolatedNormal.x.add(gn.x),
          interpolatedNormal.y.add(gn.y.sub(1.0)),
          interpolatedNormal.z.add(gn.z),
        ),
      );
      eigen0 = eigen0.sub(vGerstnerFolding);
    }
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

  return { interpolatedNormal, eigen0, eigen1, rippleSplash };
}

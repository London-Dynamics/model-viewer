// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Foam accumulation — the decay+inject energy update for one texel.
 *
 * `foamAccumulate` computes the next persistent-foam energy for a single texel
 * from its previous energy and the surface folding/normal there; there is no
 * spatial coupling. `accumulateCombinedFoam` first sums the FFT cascade fold
 * sources, then calls it. Both run inside the field's single fragment pass
 * over its half-float render target, on WebGPU and WebGL alike.
 *
 * The energy is the exact exponential approach toward an equilibrium `rate`:
 * `E_next = prev·exp(−dt/τ) + rate·(1 − exp(−dt/τ))` — equivalently
 * `mix(rate, prev, exp(−dt/τ))` — so the equilibrium energy is exactly `rate`,
 * independent of frame rate and of the persistence length `τ`:
 *
 *   - **Decay** — the `exp(−dt / τ)` e-folding (War Thunder's `decay·E`
 *     turbulent-energy term; Monahan & Woolf 1989 whitecap decay).
 *   - **Inject** — the `rate` equilibrium, the sum of two sources:
 *       - **Crest** — `crestStrength · smoothstep(0.15, 0.5, 1 − eigen)`, fired by
 *         Jacobian folding at the apex of breaking crests (Dupuy & Bruneton 2012).
 *       - **Windward** — `windwardStrength · sqrt(max(0, n_xz · wind))`, fired by
 *         any surface tilting into the wind, filling foam onto the rising face.
 */

import {
  cos,
  dot,
  float,
  normalize,
  sin,
  smoothstep,
  sqrt,
  vec2,
  vec3,
} from "three/tsl";
import type { FloatNode, Node, UniformFloatNode } from "../../../shaders/types";

/** One surface fold source at a texel: its folding amount and normal. */
export interface FoamFoldSource {
  /** Folding (`1 − eigen` for an FFT cascade). */
  folding: Node;
  /** Surface normal in `[-1, 1]` (its `.xz` tilt feeds the windward term). */
  normal: Node;
}

/**
 * Crest-foam energy from a surface-folding amount: `crestStrength · smoothstep(
 * 0.15, 0.5, max(0, folding))`. The fold-driven term of the foam injection.
 *
 * @param folding - Surface folding (`1 − eigen`-style; clamped to `≥ 0`).
 * @param crestStrength - Equilibrium energy at a sustained sharp fold.
 */
export function crestFoamEnergy(
  folding: Node,
  crestStrength: UniformFloatNode,
): Node {
  const fold = (folding as FloatNode).max(float(0.0));
  return crestStrength.mul(smoothstep(float(0.15), float(0.5), fold));
}

/** Inputs to {@link foamInjectionEnergy}. */
export interface FoamInjectionEnergyParams {
  /** Surface folding (`1 − eigen`-style). Drives the crest term. */
  folding: Node;
  /** Surface normal in `[-1, 1]`. Its `.xz` tilt drives the windward term. */
  normal: Node;
  /** Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. */
  crestStrength: UniformFloatNode;
  /** Windward-driven foam strength. Equilibrium energy on a fully wind-facing pixel. */
  windwardStrength: UniformFloatNode;
  /** Global wind direction (radians). */
  windDirection: UniformFloatNode;
}

/**
 * Foam injection energy from a surface fold + normal — the sum of the crest term
 * ({@link crestFoamEnergy}) and the windward term (`windwardStrength · sqrt(max(
 * 0, n_xz · wind))`). The normal is expected to be a unit vector, so the windward
 * alignment is bounded by 1 and `windwardStrength` is the equilibrium energy on a
 * fully wind-facing pixel.
 */
export function foamInjectionEnergy(params: FoamInjectionEnergyParams): Node {
  const { folding, normal, crestStrength, windwardStrength, windDirection } = params;

  // Crest term: fold-driven injection at the apex of breaking waves.
  const crest = crestFoamEnergy(folding, crestStrength);

  // Windward term: surface tilt into the wind, no folding required.
  const windDirX = cos(windDirection);
  const windDirZ = sin(windDirection);
  const alignment = dot(
    vec2(normal.x, normal.z),
    vec2(windDirX, windDirZ),
  ).max(float(0.0));
  const windward = windwardStrength.mul(sqrt(alignment));

  return crest.add(windward);
}

/** Inputs to {@link foamAccumulate} for a single texel. */
export interface FoamAccumulateParams {
  /** This texel's previous-frame foam energy (read at the camera-shifted texel; `≥ 0`). */
  prevEnergy: Node;
  /**
   * Combined surface folding at this texel's world position — the sum of the
   * FFT cascade foldings (`1 − eigen`). Summed *before* the threshold so the
   * components interact (a sub-breaking ripple on a steepening swell face
   * crosses the threshold together).
   */
  folding: Node;
  /** Combined surface normal in `[-1, 1]` (its `.xz` tilt drives the windward term). */
  normal: Node;
  /** Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. */
  crestStrength: UniformFloatNode;
  /** Windward-driven foam strength. Equilibrium energy on a fully wind-facing pixel. */
  windwardStrength: UniformFloatNode;
  /** Global wind direction (radians). Bound by reference to `WaveUniforms`. */
  windDirection: UniformFloatNode;
  /** Exponential e-folding time (seconds); sets how fast energy approaches equilibrium. */
  decayTime: UniformFloatNode;
  /** Per-frame delta-time (seconds). */
  deltaTime: UniformFloatNode;
}

/**
 * Next persistent-foam energy for one texel of the world-fixed field:
 * `E_prev·exp(−dt/τ) + rate·(1 − exp(−dt/τ))`. Pure — the caller supplies the
 * camera-shifted previous energy and the combined folding/normal sampled at
 * the texel's world position.
 *
 * @param params - Previous energy, combined folding/normal, and the shared foam uniforms.
 * @returns Next-frame energy (FloatNode, `≥ 0`).
 */
export function foamAccumulate(params: FoamAccumulateParams): Node {
  const {
    prevEnergy,
    folding,
    normal,
    crestStrength,
    windwardStrength,
    windDirection,
    decayTime,
    deltaTime,
  } = params;

  // `.max(0.0001)` is a divide-by-zero backstop. The CPU setter clamps
  // `decayTime` at 0.05, so this guard is unreachable in practice.
  const safeDecayTime = decayTime.max(float(0.0001));
  const decayFactor = deltaTime.div(safeDecayTime).negate().exp();

  const rate = foamInjectionEnergy({
    folding,
    normal,
    crestStrength,
    windwardStrength,
    windDirection,
  });
  // Exact exponential approach toward `rate`: the injection coefficient is
  // (1 − exp(−dt/τ)), the consistent partner of the exp(−dt/τ) decay, so the
  // equilibrium energy is exactly `rate` regardless of frame rate.
  const injection = rate.mul(float(1.0).sub(decayFactor));

  return (prevEnergy as FloatNode).mul(decayFactor).add(injection);
}

/** Inputs to {@link accumulateCombinedFoam}. */
export interface CombinedFoamParams {
  /** Previous energy read at the camera-shifted texel. */
  prevEnergy: Node;
  /** FFT cascade fold sources at this texel's world position, coarsest first. */
  cascades: FoamFoldSource[];
  /** Crest-driven foam strength. */
  crestStrength: UniformFloatNode;
  /** Windward-driven foam strength. */
  windwardStrength: UniformFloatNode;
  /** Global wind direction (radians). */
  windDirection: UniformFloatNode;
  /** Exponential decay e-folding time (seconds). */
  decayTime: UniformFloatNode;
  /** Per-frame delta-time (seconds). */
  deltaTime: UniformFloatNode;
}

/**
 * Combine the FFT cascade fold sources into one surface, then accumulate.
 * Foldings sum *before* the breaking threshold (so the components interact),
 * and the normal tilts add (the total surface tilt drives the windward
 * term). This is the single place both backends combine sources, so the
 * interaction physics stays identical across them.
 */
export function accumulateCombinedFoam(params: CombinedFoamParams): Node {
  const {
    prevEnergy,
    cascades,
    crestStrength,
    windwardStrength,
    windDirection,
    decayTime,
    deltaTime,
  } = params;

  let folding: Node = float(0.0);
  let tiltX: Node = float(0.0);
  let tiltZ: Node = float(0.0);
  for (const cascade of cascades) {
    folding = folding.add(cascade.folding);
    tiltX = tiltX.add(cascade.normal.x);
    tiltZ = tiltZ.add(cascade.normal.z);
  }

  // Slope-sum the source tilts and reconstruct a unit normal. Normalizing keeps
  // the windward term's `dot(n.xz, wind)` bounded by 1, so `windwardStrength`
  // stays the equilibrium energy on a fully wind-facing pixel.
  const combinedNormal = normalize(vec3(tiltX, float(1.0), tiltZ));

  return foamAccumulate({
    prevEnergy,
    folding,
    normal: combinedNormal,
    crestStrength,
    windwardStrength,
    windDirection,
    decayTime,
    deltaTime,
  });
}

import type { Node, UniformFloatNode } from "../../../shaders/types";
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
export declare function crestFoamEnergy(folding: Node, crestStrength: UniformFloatNode): Node;
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
export declare function foamInjectionEnergy(params: FoamInjectionEnergyParams): Node;
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
export declare function foamAccumulate(params: FoamAccumulateParams): Node;
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
export declare function accumulateCombinedFoam(params: CombinedFoamParams): Node;
//# sourceMappingURL=accumulation.d.ts.map
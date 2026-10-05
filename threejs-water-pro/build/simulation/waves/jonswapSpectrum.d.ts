import type { Node } from "three/webgpu";
/**
 * Coefficient `1/(2√π)` of the Hasselmann directional-spread normalization
 * {@link directionalSpreadNormalization}. Exported separately so the TSL
 * shaders can apply `√(s + 1/4) · SPREAD_NORMALIZATION_COEFF` without a
 * gamma function.
 */
export declare const SPREAD_NORMALIZATION_COEFF: number;
/**
 * Normalization `N(s)` of the directional spreading function
 * `D(θ) = N(s)·|cos(θ/2)|^(2s)` so that `∫₀^{2π} D dθ = 1`
 * (Longuet-Higgins et al. 1963).
 *
 * Exact: `N(s) = Γ(s+1) / (2√π·Γ(s+½))`. WGSL/GLSL lack Γ, so both the
 * shaders and this function use the asymptotic form
 * `N(s) ≈ √(s + 1/4) / (2√π)`, which follows from
 * `(Γ(s+1)/Γ(s+½))² → s + 1/4`. The error is ≤ 2.5% at the shader's clamp
 * floor `s = 0.5` and < 1% for `s ≥ 1`.
 */
export declare function directionalSpreadNormalization(s: number): number;
/** JONSWAP peak angular frequency `ωp`, inverted from deep-water dispersion. */
export declare function peakAngularFrequency(peakWavelength: Node, gravity: Node): Node;
/** JONSWAP energy scale `α` (eq. 28), re-derived in terms of `ωp` instead of fetch. */
export declare function jonswapAlpha(windSpeed: Node, omegaPeak: Node, gravity: Node): Node;
export interface JonswapRadialParams {
    /** `|k|`, already floored away from zero by the caller. */
    k: Node;
    /** Deep-water angular frequency `ω = √(g·k)`. */
    omega: Node;
    omegaPeak: Node;
    alpha: Node;
    gravity: Node;
    jonswapGamma: Node;
}
/**
 * Fetch-limited JONSWAP spectrum (eq. 28), converted to the 1D radial
 * (omnidirectional) wavenumber density via the deep-water Jacobian
 * (eq. 60–61). Multiply by {@link hasselmannDirectionalSpread} for the
 * full 2D areal density.
 */
export declare function jonswapRadialSpectrum(params: JonswapRadialParams): Node;
export interface HasselmannDirectionalSpreadParams {
    omega: Node;
    omegaPeak: Node;
    /** `cos(φ)`: normalized `k` dotted with the normalized wind direction. */
    kDotWind: Node;
    spectralSharpness: Node;
}
/**
 * Hasselmann 1980 frequency-dependent directional spread:
 * `D(θ) = N(s)·cos^(2s)(θ/2)`, `s_p = 9.77`; `s(ω/ωp) ≈ s_p·(ω/ωp)^5` below
 * the peak (narrow), `s_p·(ω/ωp)^-2.5` above (broad). Energy is narrowly
 * concentrated near the wind direction at the peak frequency and broadens
 * at higher k, so ripples read as near-omnidirectional while the dominant
 * sea tracks the wind. `spectralSharpness` multiplies `s` uniformly: `1.0`
 * is physically calibrated, above 1 narrows, below 1 broadens. Clamped
 * ≥ 0.5 to keep `cos^(2s)` numerically well-behaved as `s` grows sharply
 * below the peak.
 */
export declare function hasselmannDirectionalSpread(params: HasselmannDirectionalSpreadParams): Node;
//# sourceMappingURL=jonswapSpectrum.d.ts.map
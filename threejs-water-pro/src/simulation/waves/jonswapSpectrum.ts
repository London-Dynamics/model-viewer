// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * JONSWAP wave spectrum (Hasselmann et al. 1973), converted from frequency
 * to wavenumber domain via the deep-water change-of-variables described in
 * Horváth, C. J., "Empirical directional wave spectra for computer
 * graphics," DigiPro '15 (the "TMA" paper's non-directional component,
 * specialized to infinite depth — this project's FFT cascades are always
 * deep water, so the Kitaigorodskii depth-attenuation factor the full TMA
 * spectrum applies on top reduces to 1 and is omitted). Equation numbers
 * below refer to Horváth 2015 unless noted.
 *
 * Frequency-domain JONSWAP (eq. 28):
 *
 *   S(ω) = (α·g²/ω⁵)·exp(−5/4·(ωp/ω)⁴)·γ^r,   r = exp(−(ω−ωp)²/(2σ²ωp²))
 *   α  = 0.076·(U₁₀²/(F·g))^0.22
 *   ωp = 22·(g²/(U₁₀·F))^(1/3)
 *   σ  = 0.07 (ω ≤ ωp), 0.09 (ω > ωp)
 *
 * `ωp` is exposed directly as `peakWavelength` (the artist-facing control)
 * instead of being derived from fetch `F`: deep-water dispersion inverts to
 * `ωp = √(2πg/λp)`, a function of `λp` and `g` alone. Substituting the
 * `ωp`-to-`F` relation above into `α`'s formula eliminates `F` from `α` too:
 * `U²/(Fg) = [U·ωp/(22g)]³`, so `α = 0.076·[U·ωp/(22g)]^0.66`. `ωp` no
 * longer depends on wind speed at all — wind speed now only scales `α`
 * (energy), so `peakWavelength` sets wave size and `windSpeed` sets wave
 * energy/steepness at that size, independently.
 *
 * Wavenumber conversion (deep water, eq. 60–61): `S(k) = S(ω)·(dω/dk)/k`,
 * `ω = √(gk)`, `dω/dk = ½√(g/k)`. `S(k)` is the omnidirectional wavenumber
 * density; multiply by a normalized directional spread `D(θ)` for the full
 * 2D areal density `Ψ(kx,ky) = S(k)·D(θ)`, ready for `Δk²` discretization.
 *
 * `γ` and `spectralSharpness` remain artist-facing multipliers on top of
 * the physical values above (`γ` scales peak enhancement, `spectralSharpness`
 * scales the Hasselmann directional-spread exponent); both default to their
 * physically calibrated values.
 */

import { float, exp, sqrt, pow, mix, step } from "three/tsl";
import type { Node } from "three/webgpu";

/**
 * Coefficient `1/(2√π)` of the Hasselmann directional-spread normalization
 * {@link directionalSpreadNormalization}. Exported separately so the TSL
 * shaders can apply `√(s + 1/4) · SPREAD_NORMALIZATION_COEFF` without a
 * gamma function.
 */
export const SPREAD_NORMALIZATION_COEFF = 1 / (2 * Math.sqrt(Math.PI));

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
export function directionalSpreadNormalization(s: number): number {
  return Math.sqrt(s + 0.25) * SPREAD_NORMALIZATION_COEFF;
}

/** JONSWAP peak angular frequency `ωp`, inverted from deep-water dispersion. */
export function peakAngularFrequency(
  peakWavelength: Node,
  gravity: Node,
): Node {
  return sqrt(float(2 * Math.PI).mul(gravity).div(peakWavelength));
}

/** JONSWAP energy scale `α` (eq. 28), re-derived in terms of `ωp` instead of fetch. */
export function jonswapAlpha(
  windSpeed: Node,
  omegaPeak: Node,
  gravity: Node,
): Node {
  const windSpeedSafe = windSpeed.max(0.1);
  const x = windSpeedSafe.mul(omegaPeak).div(float(22).mul(gravity));
  return float(0.076).mul(pow(x, float(0.66)));
}

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
export function jonswapRadialSpectrum(params: JonswapRadialParams): Node {
  const { k, omega, omegaPeak, alpha, gravity, jonswapGamma } = params;

  const sigma = mix(float(0.07), float(0.09), step(omegaPeak, omega));
  const omegaDiff = omega.sub(omegaPeak);
  const r = exp(
    omegaDiff
      .mul(omegaDiff)
      .negate()
      .div(
        float(2.0).mul(sigma).mul(sigma).mul(omegaPeak).mul(omegaPeak).add(0.0001),
      ),
  );
  const peakEnhancement = pow(jonswapGamma, r);

  const omega2 = omega.mul(omega);
  const omega5 = omega2.mul(omega2).mul(omega);
  const sJonswap = alpha
    .mul(gravity)
    .mul(gravity)
    .div(omega5)
    .mul(exp(float(-1.25).mul(pow(omegaPeak.div(omega), float(4.0)))))
    .mul(peakEnhancement);

  // Deep-water Jacobian (dω/dk)/k, ω = √(g·k).
  const domegaDk = sqrt(gravity.div(k)).mul(0.5);
  const jacobian = domegaDk.div(k);

  return sJonswap.mul(jacobian);
}

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
export function hasselmannDirectionalSpread(
  params: HasselmannDirectionalSpreadParams,
): Node {
  const { omega, omegaPeak, kDotWind, spectralSharpness } = params;
  const omegaRatio = omega.div(omegaPeak.max(0.0001));
  const sBelow = float(9.77).mul(pow(omegaRatio, float(5.0)));
  const sAbove = float(9.77).mul(pow(omegaRatio, float(-2.5)));
  const sRaw = mix(sBelow, sAbove, step(float(1.0), omegaRatio));
  const s = sRaw.mul(spectralSharpness).max(float(0.5));

  const halfAngleCos = sqrt(kDotWind.add(1.0).mul(0.5).max(0.0001));
  const spreadNormalization = sqrt(s.add(0.25)).mul(SPREAD_NORMALIZATION_COEFF);
  return pow(halfAngleCos, s.mul(2.0)).mul(spreadNormalization);
}

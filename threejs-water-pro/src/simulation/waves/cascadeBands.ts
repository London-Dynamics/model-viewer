/**
 * Per-cascade spectral band assignment.
 *
 * The FFT ocean uses multiple cascades, each evaluating the Phillips·JONSWAP
 * spectrum over its own grid resolution and tile scale. Without partitioning,
 * every cascade carries the full radial frequency range, so mid-range waves
 * are duplicated across cascades with independent random phases and the
 * handoff scales look mushy.
 *
 * This module assigns each cascade a non-overlapping wavenumber band with
 * geometric-mean crossovers, then renormalizes amplitudes so each cascade's
 * total radial energy is preserved despite the narrower band.
 */

import type { WaveUniforms, CascadeSimulationUniforms } from "../../uniforms";

/**
 * Resolution scaling reference used across the spectrum shader: see
 * `effectiveScale = scale · (resolution / baseRes)` in spectrum.ts.
 */
const BASE_RESOLUTION = 256.0;

/** Sample count for the radial Phillips·JONSWAP trapezoid integral. */
const INTEGRAL_SAMPLES = 64;

/** Sample count for the directional spread integral at each radial sample. */
const ANGULAR_SAMPLES = 64;

/**
 * Numerical integral of the shader's directional spread factor over θ ∈ [0, 2π):
 * `|cos(θ/2)|^(2s) · mix(backwardWaveScale, 1, (1+cos θ)/2)`. Periodic midpoint
 * rule — spectrally accurate for smooth periodic integrands, so 64 samples
 * resolve even the narrow-cone regime near the spectral peak.
 *
 * This factor depends on k through `s(ω(k)/ωp)` (Hasselmann), so it cannot be
 * pulled out of the radial integral as a constant prefactor.
 */
function angularEnergyIntegral(s: number, backwardWaveScale: number): number {
  let sum = 0;
  for (let i = 0; i < ANGULAR_SAMPLES; i++) {
    const theta = ((i + 0.5) / ANGULAR_SAMPLES) * 2 * Math.PI;
    const halfCos2 = 0.5 * (1 + Math.cos(theta)); // cos²(θ/2)
    const directional = Math.pow(halfCos2, s); // |cos(θ/2)|^(2s)
    const upwind = backwardWaveScale + (1 - backwardWaveScale) * halfCos2;
    sum += directional * upwind;
  }
  return (sum * 2 * Math.PI) / ANGULAR_SAMPLES;
}

/**
 * 2D energy integral of the Phillips·JONSWAP spectrum over k ∈ [kLo, kHi] and
 * all directions, matching the per-cell amplitude the shader produces.
 *
 * S_2D(k, θ) = exp(-1/(kL)²)/k⁴ · γ^r(ω) · D(s(ω), θ), and the polar 2D integral
 * ∫∫ S_2D · k dk dθ collapses in log-k space to `exp(-1/(kL)²) · γ^r · D̄(s) / k²`
 * where D̄ is the angular integral of D over [0, 2π]. The effectiveScale² prefactor
 * is omitted because it cancels in the per-cascade `eNative/eBanded` ratio.
 */
function radialEnergyIntegral(
  kLo: number,
  kHi: number,
  L: number,
  gravity: number,
  windSpeed: number,
  jonswapGamma: number,
  spectralSharpness: number,
  backwardWaveScale: number,
): number {
  if (kHi <= kLo) return 0;

  const logLo = Math.log(kLo);
  const logHi = Math.log(kHi);
  const dLog = (logHi - logLo) / INTEGRAL_SAMPLES;
  const omegaPeak = (0.877 * gravity) / Math.max(windSpeed, 0.1);

  let sum = 0;
  for (let i = 0; i <= INTEGRAL_SAMPLES; i++) {
    const k = Math.exp(logLo + i * dLog);
    const omega = Math.sqrt(gravity * k);
    const omegaRatio = omega / Math.max(omegaPeak, 1e-4);
    // Hasselmann s(ω/ωp), mirroring the shader's piecewise form and clamp.
    const sRaw =
      omegaRatio <= 1
        ? 9.77 * Math.pow(omegaRatio, 5)
        : 9.77 * Math.pow(omegaRatio, -2.5);
    const s = Math.max(0.5, sRaw * spectralSharpness);
    const angular = angularEnergyIntegral(s, backwardWaveScale);
    const sigma = omega < omegaPeak ? 0.07 : 0.09;
    const omegaDiff = omega - omegaPeak;
    const r = Math.exp(
      -(omegaDiff * omegaDiff) /
        (2 * sigma * sigma * omegaPeak * omegaPeak + 1e-4),
    );
    const gammaR = Math.pow(jonswapGamma, r);
    const phillips = Math.exp(-1 / Math.pow(k * L, 2));
    const integrand = (phillips * gammaR * angular) / (k * k);
    const weight = i === 0 || i === INTEGRAL_SAMPLES ? 0.5 : 1.0;
    sum += integrand * weight * dLog;
  }
  return sum;
}

/**
 * Assigns each cascade a wavenumber band and an amplitude compensation factor.
 *
 * Bands partition the union of cascade k-ranges using geometric-mean crossovers
 * between adjacent cascades. Per-cascade `bandAmplitudeCompensation` is set so
 * that the cascade's banded radial energy matches its un-banded
 * `[kFundamental, kNyquist]` integral, preserving preset amplitude character.
 *
 * Cascades are processed in **input order** — cascade 0 owns the lowest-k
 * (largest-scale) band, cascade 1 the next, and so on. The caller is
 * responsible for ordering cascades so the scale strictly decreases with
 * index; the demo UI enforces this via non-overlapping slider ranges. If the
 * invariant is broken, the affected cascade's band degenerates and produces
 * no energy — there's no fallback re-sort.
 *
 * Reads `wave.windSpeed`, `wave.gravity`, `wave.jonswapGamma`,
 * `wave.spectralSharpness`, `wave.standingWaveRatio` — call this whenever any
 * of those change (or whenever cascade scale/resolution changes).
 */
export function assignCascadeBands(
  cascadeUniforms: CascadeSimulationUniforms[],
  wave: WaveUniforms,
): void {
  if (cascadeUniforms.length === 0) return;

  const windSpeed = wave.windSpeed.value;
  const gravity = wave.gravity.value;
  const gamma = wave.jonswapGamma.value;
  const spectralSharpness = wave.spectralSharpness.value;
  const standingWaveRatio = wave.standingWaveRatio.value;
  const L = (windSpeed * windSpeed) / gravity;
  // Matches the shader: mix(0.07, 1.0, standingWaveRatio).
  const backwardWaveScale = 0.07 + 0.93 * standingWaveRatio;

  const native = cascadeUniforms.map((u) => {
    const effScale = (u.scale.value * u.resolution.value) / BASE_RESOLUTION;
    return {
      kFund: (2 * Math.PI) / effScale,
      kNyq: (Math.PI * u.resolution.value) / effScale,
    };
  });

  for (let i = 0; i < cascadeUniforms.length; i++) {
    const u = cascadeUniforms[i];
    const { kFund, kNyq } = native[i];

    // Low edge: geometric mean of previous cascade's Nyquist and this fundamental.
    const kBandLow = i > 0 ? Math.sqrt(native[i - 1].kNyq * kFund) : kFund;

    // High edge: geometric mean of this Nyquist and next fundamental.
    const kBandHigh =
      i < cascadeUniforms.length - 1
        ? Math.sqrt(kNyq * native[i + 1].kFund)
        : kNyq;

    const eOriginal = radialEnergyIntegral(
      kFund,
      kNyq,
      L,
      gravity,
      windSpeed,
      gamma,
      spectralSharpness,
      backwardWaveScale,
    );
    const eBanded = radialEnergyIntegral(
      kBandLow,
      kBandHigh,
      L,
      gravity,
      windSpeed,
      gamma,
      spectralSharpness,
      backwardWaveScale,
    );
    const compensation =
      eBanded > 1e-30 ? Math.sqrt(eOriginal / eBanded) : 1.0;

    u.kBandLow.value = kBandLow;
    u.kBandHigh.value = kBandHigh;
    u.bandAmplitudeCompensation.value = compensation;
  }
}

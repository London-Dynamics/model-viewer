// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import {
  instanceIndex,
  vec2,
  vec4,
  float,
  Fn,
  sin,
  cos,
  sqrt,
  log2,
  mix,
  round,
  smoothstep,
} from "three/tsl";
import { hash, createBitReverseFn } from "../../../../shaders/common";
import type { TSLBuffer } from "../../../../types/tsl";
import type { WaveUniforms } from "../../../../uniforms";
import type { CascadeSimulationUniforms } from "../../../../uniforms";
import {
  peakAngularFrequency,
  jonswapAlpha,
  jonswapRadialSpectrum,
  hasselmannDirectionalSpread,
} from "../../jonswapSpectrum";
import { WAVE_TIME_OMEGA_STEP } from "../../timing";

/** Group of component buffers (Dx, Dy, Dz) */
export interface ComponentBuffers {
  dx: TSLBuffer;
  dy: TSLBuffer;
  dz: TSLBuffer;
}

export interface InitSpectrumShaderParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
  h0Buffer: TSLBuffer;
  resolution: number;
}

export interface TimeEvolutionShaderParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
  h0Buffer: TSLBuffer;
  pingBuffers: ComponentBuffers;
  resolution: number;
  numBits: number;
}

/**
 * Creates the initial spectrum generation shader.
 *
 * Generates the initial Fourier coefficients h̃₀(k) for ocean waves using a
 * JONSWAP spectrum (see `../../jonswapSpectrum.ts`) with Hasselmann
 * directional spreading. This shader runs once at initialization
 * (and whenever wave parameters change) to set up the frequency domain
 * representation.
 */
export const createInitSpectrumShader = ({
  wave,
  cascade,
  h0Buffer,
  resolution,
}: InitSpectrumShaderParams) => {
  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;
    const windSpeed = wave.windSpeed;
    const windDirection = wave.windDirection;
    const gravity = wave.gravity;
    const peakWavelength = wave.peakWavelength;
    const scale = cascade.scale;

    // Convert linear index to 2D coordinates
    const x = idx.mod(res);
    const y = idx.div(res); // Integer division already truncates

    // Calculate wave vector k (convert to float for math operations).
    // The cascade's tile size is its world-space `scale`, independent of FFT
    // resolution. This fixes the fundamental wavenumber kFund = 2π/scale — the
    // longest representable wave, which carries most of the height energy — so
    // total wave height does not change with resolution. Raising resolution
    // raises the Nyquist limit kNyq = π·res/scale, adding smaller waves (finer
    // detail) on top of the same large-wave band.
    const nx = x.toFloat().sub(res.toFloat().div(2.0));
    const ny = y.toFloat().sub(res.toFloat().div(2.0));
    const kx = nx.mul(2.0).mul(Math.PI).div(scale);
    const ky = ny.mul(2.0).mul(Math.PI).div(scale);
    const kLength = sqrt(kx.mul(kx).add(ky.mul(ky)));

    // Suppress DC component only (k=0 causes division by zero)
    const kMin = float(0.0001);
    const kSafe = kLength.max(kMin); // Clamp k to minimum value to avoid division by zero

    // Wind direction vector
    const windDirX = cos(windDirection);
    const windDirY = sin(windDirection);

    // Normalized wave vector (use kSafe to avoid division by zero)
    const kNormX = kx.div(kSafe);
    const kNormY = ky.div(kSafe);
    const kDotW = kNormX.mul(windDirX).add(kNormY.mul(windDirY));

    // Deep-water dispersion. omegaPeak comes directly from peakWavelength
    // (the artist-facing size control); alpha (energy) still depends on
    // wind speed at that fixed peak (see jonswapSpectrum.ts).
    const omega = sqrt(gravity.mul(kSafe));
    const omegaPeak = peakAngularFrequency(peakWavelength, gravity);
    const alpha = jonswapAlpha(windSpeed, omegaPeak, gravity);

    const radialSpectrum = jonswapRadialSpectrum({
      k: kSafe,
      omega,
      omegaPeak,
      alpha,
      gravity,
      jonswapGamma: wave.jonswapGamma,
    });

    // Hasselmann directional spread, normalized so ∫D dθ = 1 — the spread
    // redistributes energy by direction without changing the total.
    const directionalSpread = hasselmannDirectionalSpread({
      omega,
      omegaPeak,
      kDotWind: kDotW,
      spectralSharpness: wave.spectralSharpness,
    });

    // Smooth upwind attenuation. Maps kDotW ∈ [-1,+1] → factor ∈ [backwardWaveScale, 1].
    // Replaces the discontinuous step() at θ = ±90° which produced faint banding at
    // low wind speeds. Standing waves are omnidirectional, so suppression fades
    // toward 1 as standingWaveRatio increases.
    const backwardWaveScale = mix(float(0.07), float(1.0), wave.standingWaveRatio);
    const alignment = kDotW.add(1.0).mul(0.5);
    const directionalFactor = directionalSpread.mul(
      mix(backwardWaveScale, float(1.0), alignment),
    );

    // Per-mode variance is Ψ(k,θ)·Δk²/2, Δk = 2π/scale. The radial JONSWAP
    // density carries no free gain constant beyond its own alpha, so Δk² is
    // applied explicitly here; the 1/2 one-sided realization factor is
    // folded into the 0.707107 amplitude multiplier below.
    const deltaK = float(2.0 * Math.PI).div(scale);
    const deltaK2 = deltaK.mul(deltaK);
    const jonswap = radialSpectrum.mul(directionalFactor).mul(deltaK2);

    // Per-cascade k-band window. Adjacent cascades share each seam's
    // cross-fade interval [kEdge/1.5, kEdge·1.5]: this cascade's high-edge
    // weight (1 − t) and the next cascade's low-edge weight (t) sum to one,
    // so the banded cascades together carry exactly the continuum spectrum —
    // no notch or double-counting at the seam (see cascadeBands.ts). The
    // first cascade's kBandLow sentinel (≈0) disables its low edge; the last
    // cascade's kBandHigh sits at kNyquist/1.5 so the fade reaches zero at
    // the Nyquist limit (anti-alias roll-off).
    const kLo = cascade.kBandLow;
    const kHi = cascade.kBandHigh;
    const lowEdge = smoothstep(kLo.div(1.5), kLo.mul(1.5), kSafe);
    const highEdge = float(1.0).sub(
      smoothstep(kHi.div(1.5), kHi.mul(1.5), kSafe),
    );
    const bandWindow = lowEdge.mul(highEdge);
    const bandedJonswap = jonswap.mul(bandWindow);

    // Generate Gaussian random using hash
    // Combine pixel index with random seed for unique pattern each session
    const randomSeed = cascade.randomSeed;
    const seed = idx.toFloat().add(randomSeed.mul(100000.0));
    const xi1 = hash(seed);
    const xi2 = hash(seed.add(1000.0));

    const gaussianR = sqrt(
      float(-2.0).mul(log2(xi1.max(0.0001)).mul(0.693147)),
    );
    const theta = float(2.0).mul(Math.PI).mul(xi2);

    // Initial spectrum amplitude: h̃₀(k) = ξ · √(S(k)/2)
    // Factor of 1/√2 ≈ 0.707107 normalizes the Gaussian random variable.
    const h0Magnitude = gaussianR.mul(sqrt(bandedJonswap)).mul(float(0.707107));

    const h0Real = h0Magnitude.mul(cos(theta));
    const h0Imag = h0Magnitude.mul(sin(theta));

    // Store H0 (real, imag, kx, ky)
    h0Buffer.element(idx).assign(vec4(h0Real, h0Imag, kx, ky));
  })().compute(resolution * resolution);
};

/**
 * Creates the time evolution shader
 *
 * Evolves the initial spectrum h̃₀(k) forward in time to get h̃(k,t) using the
 * dispersion relation ω(k) = √(g|k|). Computes separate spectra for each
 * displacement component (Dx, Dy, Dz).
 *
 * This shader also performs bit-reversal permutation, writing directly to the
 * FFT ping buffers at bit-reversed indices. This eliminates the need for a
 * separate bit-reversal pass, reducing memory bandwidth and dispatch overhead.
 */
export const createTimeEvolutionShader = ({
  wave,
  cascade,
  h0Buffer,
  pingBuffers,
  resolution,
  numBits,
}: TimeEvolutionShaderParams) => {
  const bitReverse = createBitReverseFn(numBits);

  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;
    const gravity = wave.gravity;
    const time = cascade.time;

    const h0 = h0Buffer.element(idx);
    const h0Real = h0.x;
    const h0Imag = h0.y;
    const kx = h0.z;
    const ky = h0.w;

    const kLength = sqrt(kx.mul(kx).add(ky.mul(ky))).add(0.0001); // Avoid division by zero

    // Dispersion relation, snapped to the wave-sim loop period so the wave
    // field at `time = WAVE_TIME_PERIOD_SECONDS` matches `time = 0` exactly.
    // Perturbation per cell is at most π/period (<0.2% for typical omegas).
    const omegaNatural = sqrt(gravity.mul(kLength));
    const omega = round(omegaNatural.div(WAVE_TIME_OMEGA_STEP)).mul(
      WAVE_TIME_OMEGA_STEP,
    );
    const phase = omega.mul(time);

    const cosPhase = cos(phase);
    // Dampen the sin component to blend between traveling and standing waves.
    // At standingWaveRatio=0 waves travel normally; at 1 they oscillate in place.
    const sinPhase = sin(phase).mul(float(1.0).sub(wave.standingWaveRatio));

    // Get conjugate H0(-k)
    const x = idx.mod(res);
    const y = idx.div(res); // Integer division already truncates
    const conjX = res.sub(x).mod(res);
    const conjY = res.sub(y).mod(res);
    const conjIdx = conjY.mul(res).add(conjX);
    const h0Conj = h0Buffer.element(conjIdx);
    const h0ConjReal = h0Conj.x;
    const h0ConjImag = h0Conj.y.negate();

    // Compute H(k,t) - base spectrum
    // H(k,t) = H₀(k)·e^{-iωt} + H₀*(-k)·e^{+iωt}
    //
    // Using e^{-iωt} for the first term (not e^{+iωt}) ensures waves travel
    // in the +k direction. Combined with the JONSWAP spectrum favoring k
    // aligned with wind, this makes waves propagate WITH the wind direction.
    //
    // e^{-iωt} = cos(ωt) - i·sin(ωt)
    // e^{+iωt} = cos(ωt) + i·sin(ωt)
    const htReal = h0Real
      .mul(cosPhase)
      .add(h0Imag.mul(sinPhase))
      .add(h0ConjReal.mul(cosPhase).sub(h0ConjImag.mul(sinPhase)));

    const htImag = h0Real
      .mul(sinPhase)
      .negate()
      .add(h0Imag.mul(cosPhase))
      .add(h0ConjReal.mul(sinPhase).add(h0ConjImag.mul(cosPhase)));

    // Compute bit-reversed destination index for FFT
    // @ts-expect-error - TSL Fn parameter type inference issue
    const xRev = bitReverse(x);
    // @ts-expect-error - TSL Fn parameter type inference issue
    const yRev = bitReverse(y);
    const dstIdx = yRev.mul(res).add(xRev);

    // Vertical displacement: Dy = H(k,t)
    // Store as vec2(real, imag) at bit-reversed position
    pingBuffers.dy.element(dstIdx).assign(vec2(htReal, htImag));

    // Horizontal X displacement: Dx = -i * (kx/k) * H(k,t)
    // Multiply by -i: (a + bi) * (-i) = b - ai
    // NOTE: Choppiness is applied in spatial domain (after IFFT)
    const slopeX = kx.div(kLength);
    const dxReal = htImag.mul(slopeX);
    const dxImag = htReal.mul(slopeX).negate();
    pingBuffers.dx.element(dstIdx).assign(vec2(dxReal, dxImag));

    // Horizontal Z displacement: Dz = -i * (ky/k) * H(k,t)
    // NOTE: Choppiness is applied in spatial domain (after IFFT)
    const slopeZ = ky.div(kLength);
    const dzReal = htImag.mul(slopeZ);
    const dzImag = htReal.mul(slopeZ).negate();
    pingBuffers.dz.element(dstIdx).assign(vec2(dzReal, dzImag));
  })().compute(resolution * resolution);
};

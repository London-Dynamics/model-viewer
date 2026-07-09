import {
  instanceIndex,
  vec2,
  vec4,
  float,
  Fn,
  sin,
  cos,
  sqrt,
  exp,
  log2,
  step,
  pow,
  mix,
  round,
  smoothstep,
} from "three/tsl";
import { hash, createBitReverseFn } from "../../../../shaders/common";
import type { TSLBuffer } from "../../../../types/tsl";
import type { WaveUniforms } from "../../../../uniforms";
import type { CascadeSimulationUniforms } from "../../../../uniforms";
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
 * Creates the initial spectrum generation shader (Phillips spectrum)
 *
 * Generates the initial Fourier coefficients h̃₀(k) for ocean waves using the Phillips spectrum.
 * This shader runs once at initialization to set up the frequency domain representation.
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
    const scale = cascade.scale;

    // Convert linear index to 2D coordinates
    const x = idx.mod(res);
    const y = idx.div(res); // Integer division already truncates

    // Calculate wave vector k (convert to float for math operations)
    // The effective domain size is normalized by resolution so that 'scale' represents
    // world-space wavelength independent of FFT resolution. A base resolution of 256 is
    // used as reference - this ensures scale=100 produces the same wavelengths regardless
    // of which cascade resolution is used.
    //
    // effectiveScale = scale * (resolution / 256)
    // This means: 256-res with scale=100 → effectiveScale=100
    //             64-res with scale=100 → effectiveScale=25
    //
    // The FFT produces wavelengths λ = effectiveScale / n, so normalizing by resolution
    // ensures the same scale value produces the same world-space wavelengths.
    const baseRes = float(256.0);
    const effectiveScale = scale.mul(res.toFloat()).div(baseRes);
    const nx = x.toFloat().sub(res.toFloat().div(2.0));
    const ny = y.toFloat().sub(res.toFloat().div(2.0));
    const kx = nx.mul(2.0).mul(Math.PI).div(effectiveScale);
    const ky = ny.mul(2.0).mul(Math.PI).div(effectiveScale);
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

    // Pierson-Moskowitz peak frequency: ωp = 0.877·g/U for fully developed seas.
    const omegaPeak = float(0.877).mul(gravity).div(windSpeed.max(0.1));
    // Deep-water dispersion: ω = √(g·k).
    const omega = sqrt(gravity.mul(kSafe));

    // Hasselmann 1980 frequency-dependent directional spread exponent.
    // s_p = 9.77; s(ω/ωp) ≈ s_p·(ω/ωp)^+5 below peak (narrow), (ω/ωp)^-2.5 above
    // peak (broad). The piecewise μ exponents come from Hasselmann's JPO 10 fits.
    // Energy is narrowly concentrated near the wind direction at the peak
    // frequency and broadens at higher k — which is why ripples should look
    // near-omnidirectional rather than carrying the same narrow cone as the swell.
    const omegaRatio = omega.div(omegaPeak.max(0.0001));
    const sBelow = float(9.77).mul(pow(omegaRatio, float(5.0)));
    const sAbove = float(9.77).mul(pow(omegaRatio, float(-2.5)));
    const sRaw = mix(sBelow, sAbove, step(float(1.0), omegaRatio));
    // spectralSharpness multiplies s uniformly: >1 narrows, <1 broadens.
    // Clamp ≥ 0.5 caps the narrow-cone regime — sBelow blows up like
    // ratio^5 near and just below the peak — so cos^(2s) underneath stays
    // numerically well-behaved.
    const s = sRaw.mul(wave.spectralSharpness).max(float(0.5));

    // D(θ) = cos^(2s)(θ/2); cos(half) = √((1 + kDotW)/2).
    const halfAngleCos = sqrt(kDotW.add(1.0).mul(0.5).max(0.0001));
    const directionalSpread = pow(halfAngleCos, s.mul(2.0));

    // Smooth upwind attenuation. Maps kDotW ∈ [-1,+1] → factor ∈ [backwardWaveScale, 1].
    // Replaces the discontinuous step() at θ = ±90° which produced faint banding at
    // low wind speeds. Standing waves are omnidirectional, so suppression fades
    // toward 1 as standingWaveRatio increases.
    const backwardWaveScale = mix(float(0.07), float(1.0), wave.standingWaveRatio);
    const alignment = kDotW.add(1.0).mul(0.5);
    const directionalFactor = directionalSpread.mul(
      mix(backwardWaveScale, float(1.0), alignment),
    );

    // Phillips spectrum
    const L = windSpeed.mul(windSpeed).div(gravity);
    const kLength2 = kSafe.mul(kSafe);
    const kLength4 = kLength2.mul(kLength2);

    // Phillips spectrum formula with scale normalization
    // The 1/k^4 term causes amplitude to scale with domain size^4
    // Dividing by effectiveScale^2 keeps wave amplitude consistent when changing scale
    // We use effectiveScale (not scale) since that's the actual FFT domain size
    const effectiveScale2 = effectiveScale.mul(effectiveScale);
    const phillips = exp(float(-1.0).div(kLength2.mul(L).mul(L)))
      .div(kLength4)
      .mul(directionalFactor)
      .div(effectiveScale2);

    // JONSWAP peak enhancement - concentrates energy around peak frequency
    // This creates wave grouping through interference of nearby frequencies
    // gamma = 1.0 reduces to Phillips, gamma = 3.3 is typical JONSWAP, higher = more peaked
    const jonswapGamma = wave.jonswapGamma;

    // Sigma parameter: 0.07 below peak, 0.09 above peak
    // Use smooth transition with mix + step
    const sigmaLow = float(0.07);
    const sigmaHigh = float(0.09);
    const sigma = mix(sigmaLow, sigmaHigh, step(omegaPeak, omega));

    // Peak enhancement exponent: r = exp(-(omega - omega_p)^2 / (2 * sigma^2 * omega_p^2))
    const omegaDiff = omega.sub(omegaPeak);
    const sigmaOmegaPeak = sigma.mul(omegaPeak);
    const r = exp(
      omegaDiff
        .mul(omegaDiff)
        .negate()
        .div(float(2.0).mul(sigmaOmegaPeak).mul(sigmaOmegaPeak).add(0.0001)),
    );

    // Apply JONSWAP: S_JONSWAP = S_Phillips * gamma^r
    const peakEnhancement = pow(jonswapGamma, r);
    const jonswap = phillips.mul(peakEnhancement);

    // Per-cascade k-band window. Each cascade owns a non-overlapping range
    // [kBandLow, kBandHigh] (set by assignCascadeBands). The smooth crossover
    // at ×1.5 either side prevents abrupt energy steps and also serves as the
    // anti-alias roll-off near the smallest cascade's Nyquist limit.
    const kLo = cascade.kBandLow;
    const kHi = cascade.kBandHigh;
    const lowEdge = smoothstep(kLo, kLo.mul(1.5), kSafe);
    const highEdge = float(1.0).sub(smoothstep(kHi.div(1.5), kHi, kSafe));
    const bandWindow = lowEdge.mul(highEdge);
    const bandedJonswap = jonswap.mul(bandWindow);

    // Generate Gaussian random using hash
    // Combine pixel index with random seed for unique pattern each session
    const randomSeed = cascade.randomSeed;
    const seed = idx.toFloat().add(randomSeed.mul(100000.0));
    // @ts-expect-error - TSL Fn parameter type inference issue
    const xi1 = hash(seed);
    // @ts-expect-error - TSL Fn parameter type inference issue
    const xi2 = hash(seed.add(1000.0));

    const gaussianR = sqrt(
      float(-2.0).mul(log2(xi1.max(0.0001)).mul(0.693147)),
    );
    const theta = float(2.0).mul(Math.PI).mul(xi2);

    // Initial spectrum amplitude: h̃₀(k) = ξ · √(S(k)/2)
    // Factor of 1/√2 ≈ 0.707107 normalizes the Gaussian random variable.
    // bandAmplitudeCompensation = √(E_full / E_band) preserves each cascade's
    // total energy after the band window removes off-band frequencies.
    const h0Magnitude = gaussianR
      .mul(sqrt(bandedJonswap))
      .mul(float(0.707107))
      .mul(cascade.bandAmplitudeCompensation);

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
    // in the +k direction. Combined with Phillips spectrum favoring k aligned
    // with wind, this makes waves propagate WITH the wind direction.
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

/**
 * TSL-based spectrum generation and time evolution for WebGL FFT.
 * Uses MeshBasicNodeMaterial with outputNode for render-to-texture passes.
 *
 * These shaders use the same WaveUniforms and CascadeSimulationUniforms as
 * the WebGPU compute shaders, eliminating duplicate state and per-frame syncing.
 */

import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  mix,
  vec2,
  vec4,
  uv,
  floor,
  sqrt,
  cos,
  sin,
  exp,
  pow,
  step,
  max,
  log2,
  round,
  smoothstep,
  texture,
} from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";
import { hash } from "../../../../shaders/common";
import { WAVE_TIME_OMEGA_STEP } from "../../timing";

/** Creates a placeholder 1x1 texture for initialization */
function createPlaceholderTexture(): THREE.DataTexture {
  const data = new Float32Array([0, 0, 0, 1]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

export interface InitSpectrumMaterialParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
}

/**
 * Creates a material for initial spectrum generation (Phillips/JONSWAP).
 * Output: vec4(h0Real, h0Imag, kx, ky)
 */
export function createInitSpectrumMaterial(
  params: InitSpectrumMaterialParams,
): THREE.MeshBasicNodeMaterial {
  const { wave, cascade } = params;

  const outputNode = Fn(() => {
    const res = cascade.resolution;
    const pixelCoord = floor(uv().mul(res));
    const x = pixelCoord.x;
    const y = pixelCoord.y;

    // Resolution-normalized scale (base resolution = 256)
    const baseRes = float(256.0);
    const effectiveScale = cascade.scale.mul(res).div(baseRes);

    // Wave vector k
    const nx = x.sub(res.mul(0.5));
    const ny = y.sub(res.mul(0.5));
    const kx = nx.mul(2.0).mul(Math.PI).div(effectiveScale);
    const ky = ny.mul(2.0).mul(Math.PI).div(effectiveScale);
    const kLength = sqrt(kx.mul(kx).add(ky.mul(ky)));

    // Suppress DC component
    const kMin = float(0.0001);
    const kSafe = max(kLength, kMin);

    // Wind direction vector
    const windDirX = cos(wave.windDirection);
    const windDirY = sin(wave.windDirection);

    // Normalized wave vector
    const kNormX = kx.div(kSafe);
    const kNormY = ky.div(kSafe);
    const kDotW = kNormX.mul(windDirX).add(kNormY.mul(windDirY));

    // Pierson-Moskowitz peak frequency and deep-water dispersion.
    const omegaPeak = float(0.877).mul(wave.gravity).div(wave.windSpeed.max(0.1));
    const omega = sqrt(wave.gravity.mul(kSafe));

    // Hasselmann 1980 frequency-dependent directional spread.
    const omegaRatio = omega.div(omegaPeak.max(0.0001));
    const sBelow = float(9.77).mul(pow(omegaRatio, float(5.0)));
    const sAbove = float(9.77).mul(pow(omegaRatio, float(-2.5)));
    const sRaw = mix(sBelow, sAbove, step(float(1.0), omegaRatio));
    // Clamp ≥ 0.5 caps the narrow-cone regime — sBelow blows up like ratio^5
    // near and just below the peak — so cos^(2s) underneath stays numerically
    // well-behaved.
    const s = sRaw.mul(wave.spectralSharpness).max(float(0.5));

    const halfAngleCos = sqrt(max(float(0.0001), kDotW.add(1.0).mul(0.5)));
    const directionalSpread = pow(halfAngleCos, s.mul(2.0));

    // Smooth upwind attenuation; replaces discontinuous step() at θ = ±90°.
    const backwardWaveScale = mix(float(0.07), float(1.0), wave.standingWaveRatio);
    const alignment = kDotW.add(1.0).mul(0.5);
    const directionalFactor = directionalSpread.mul(
      mix(backwardWaveScale, float(1.0), alignment),
    );

    // Phillips spectrum
    const L = wave.windSpeed.mul(wave.windSpeed).div(wave.gravity);
    const kLength2 = kSafe.mul(kSafe);
    const kLength4 = kLength2.mul(kLength2);
    const effectiveScale2 = effectiveScale.mul(effectiveScale);
    const phillips = exp(float(-1.0).div(kLength2.mul(L).mul(L)))
      .div(kLength4)
      .mul(directionalFactor)
      .div(effectiveScale2);

    // JONSWAP peak enhancement
    const sigmaLow = float(0.07);
    const sigmaHigh = float(0.09);
    const sigma = mix(sigmaLow, sigmaHigh, step(omegaPeak, omega));
    const omegaDiff = omega.sub(omegaPeak);
    const sigmaOmegaPeak = sigma.mul(omegaPeak);
    const r = exp(
      omegaDiff.mul(omegaDiff).negate().div(float(2.0).mul(sigmaOmegaPeak).mul(sigmaOmegaPeak).add(0.0001)),
    );
    const peakEnhancement = pow(wave.jonswapGamma, r);
    const jonswap = phillips.mul(peakEnhancement);

    // Per-cascade k-band window. See WebGPU spectrum.ts for full explanation.
    const kLo = cascade.kBandLow;
    const kHi = cascade.kBandHigh;
    const lowEdge = smoothstep(kLo, kLo.mul(1.5), kSafe);
    const highEdge = float(1.0).sub(smoothstep(kHi.div(1.5), kHi, kSafe));
    const bandWindow = lowEdge.mul(highEdge);
    const bandedJonswap = jonswap.mul(bandWindow);

    // Gaussian random using hash
    const idx = y.mul(res).add(x);
    const seed = idx.add(cascade.randomSeed.mul(100000.0));
    // @ts-expect-error - TSL Fn parameter type inference issue
    const xi1 = hash(seed);
    // @ts-expect-error - TSL Fn parameter type inference issue
    const xi2 = hash(seed.add(1000.0));

    // Box-Muller transform
    const gaussianR = sqrt(float(-2.0).mul(log2(max(float(0.0001), xi1)).mul(0.693147)));
    const theta = float(2.0).mul(Math.PI).mul(xi2);

    // Initial spectrum amplitude; bandAmplitudeCompensation restores per-cascade
    // total energy after the band window removes off-band frequencies.
    const h0Magnitude = gaussianR
      .mul(sqrt(bandedJonswap))
      .mul(float(0.707107))
      .mul(cascade.bandAmplitudeCompensation);
    const h0Real = h0Magnitude.mul(cos(theta));
    const h0Imag = h0Magnitude.mul(sin(theta));

    return vec4(h0Real, h0Imag, kx, ky);
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return material;
}

export interface TimeEvolutionMaterialParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
  numBits: number;
  component: number; // 0 = Dy, 1 = Dx, 2 = Dz
}

export interface TimeEvolutionMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  h0TextureNode: TextureNode;
}

/**
 * Creates a material for time evolution of a specific component.
 */
export function createTimeEvolutionMaterial(
  params: TimeEvolutionMaterialParams,
): TimeEvolutionMaterialResult {
  const { wave, cascade, numBits, component } = params;
  const h0TextureNode = texture(createPlaceholderTexture());

  // Local float-based bit reversal to avoid uint issues in WebGL
  const bitReverseFloat = (n: Node): Node => {
    let result: Node = float(0.0);
    for (let i = 0; i < numBits; i++) {
      const divisor = Math.pow(2, i);
      const multiplier = Math.pow(2, numBits - 1 - i);
      // Extract bit i: floor(n / 2^i) % 2
      const bit = floor(n.div(divisor)).mod(2.0);
      result = result.add(bit.mul(multiplier));
    }
    return result;
  };

  const outputNode = Fn(() => {
    const uvCoord = uv();
    const res = cascade.resolution;
    const px = floor(uvCoord.x.mul(res));
    const py = floor(uvCoord.y.mul(res));

    // Match WebGPU: for output pixel (px, py), read from frequency (bitrev(px), bitrev(py))
    const freqX = bitReverseFloat(px);
    const freqY = bitReverseFloat(py);

    // Read H0 from LINEAR position (freqX, freqY)
    const h0Uv = vec2(freqX, freqY).add(0.5).div(res);
    const h0Sample = h0TextureNode.sample(h0Uv);

    const h0Real = h0Sample.x;
    const h0Imag = h0Sample.y;
    const kx = h0Sample.z;
    const ky = h0Sample.w;

    const kLength = sqrt(kx.mul(kx).add(ky.mul(ky))).add(0.0001);

    // Dispersion relation: omega = sqrt(g * |k|), snapped to the wave-sim
    // loop period so the wave field at `time = WAVE_TIME_PERIOD_SECONDS`
    // matches `time = 0` exactly. Per-cell perturbation is at most
    // π/period (<0.2% for typical omegas).
    const omegaNatural = sqrt(wave.gravity.mul(kLength));
    const omega = round(omegaNatural.div(WAVE_TIME_OMEGA_STEP)).mul(
      WAVE_TIME_OMEGA_STEP,
    );
    const phase = omega.mul(cascade.time);
    const cosPhase = cos(phase);
    const sinPhase = sin(phase).mul(float(1.0).sub(wave.standingWaveRatio));

    // Conjugate H0(-k) at LINEAR position (N - freqX, N - freqY)
    const conjX = res.sub(freqX).mod(res);
    const conjY = res.sub(freqY).mod(res);
    const conjUv = vec2(conjX, conjY).add(0.5).div(res);
    const h0Conj = h0TextureNode.sample(conjUv);
    const h0ConjReal = h0Conj.x;
    const h0ConjImag = h0Conj.y.negate();

    // H(k,t) = H0(k)*e^(-iωt) + conj(H0(-k))*e^(+iωt)
    const htReal = h0Real.mul(cosPhase).add(h0Imag.mul(sinPhase))
      .add(h0ConjReal.mul(cosPhase).sub(h0ConjImag.mul(sinPhase)));
    const htImag = h0Real.mul(sinPhase).negate().add(h0Imag.mul(cosPhase))
      .add(h0ConjReal.mul(sinPhase).add(h0ConjImag.mul(cosPhase)));

    // Component selection
    let resultReal: Node;
    let resultImag: Node;

    if (component === 0) {
      resultReal = htReal;
      resultImag = htImag;
    } else if (component === 1) {
      const slopeX = kx.div(kLength);
      resultReal = htImag.mul(slopeX);
      resultImag = htReal.mul(slopeX).negate();
    } else {
      const slopeZ = ky.div(kLength);
      resultReal = htImag.mul(slopeZ);
      resultImag = htReal.mul(slopeZ).negate();
    }

    return vec4(resultReal, resultImag, float(0.0), float(1.0));
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return { material, h0TextureNode };
}

// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * TSL-based FFT butterfly shaders for WebGL.
 * Uses MeshBasicNodeMaterial with outputNode for render-to-texture passes.
 *
 * These shaders use CascadeSimulationUniforms directly, sharing the same
 * uniform nodes as the WebGPU compute shaders.
 */

import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  vec2,
  vec4,
  uv,
  floor,
  cos,
  sin,
  pow,
  mod,
  mix,
  texture,
} from "three/tsl";
import type { TextureNode } from "three/webgpu";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";

/** Creates a placeholder 1x1 texture for initialization */
function createPlaceholderTexture(): THREE.DataTexture {
  const data = new Float32Array([0, 0, 0, 1]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

export interface FFTMaterialParams {
  cascade: CascadeSimulationUniforms;
}

export interface FFTButterflyMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  srcTextureNode: TextureNode;
}

/**
 * Creates a material for horizontal FFT butterfly pass.
 */
export function createFFTHorizontalMaterial(params: FFTMaterialParams): FFTButterflyMaterialResult {
  const { cascade } = params;
  const srcTextureNode = texture(createPlaceholderTexture());

  const outputNode = Fn(() => {
    const res = cascade.resolution;
    const pixelCoord = floor(uv().mul(res));
    const x = pixelCoord.x;
    const y = pixelCoord.y;

    // Butterfly parameters for this stage
    const butterflyHalf = pow(float(2.0), cascade.fftStage);
    const butterflySize = butterflyHalf.mul(2.0);

    // Determine position within butterfly group
    const groupIdx = floor(x.div(butterflyHalf));
    const isUpper = float(1.0).sub(mod(groupIdx, 2.0));

    // Twiddle factor index: k = (x % butterflyHalf) * (N / butterflySize)
    const posInHalf = mod(x, butterflyHalf);
    const k = posInHalf.mul(res.div(butterflySize));

    // Twiddle factor: W = e^(i * 2pi * k / N)
    const angle = float(2.0).mul(Math.PI).mul(k).div(res);
    const twiddleReal = cos(angle);
    const twiddleImag = sin(angle);

    // Calculate indices for butterfly pair
    const groupBase = floor(x.div(butterflySize)).mul(butterflySize);
    const upperX = groupBase.add(posInHalf);
    const lowerX = upperX.add(butterflyHalf);

    // Read upper and lower values
    const upperUv = vec2(upperX, y).add(0.5).div(res);
    const lowerUv = vec2(lowerX, y).add(0.5).div(res);
    const upperData = srcTextureNode.sample(upperUv);
    const lowerData = srcTextureNode.sample(lowerUv);

    const upper = upperData.xy;
    const lower = lowerData.xy;

    // Butterfly operation: temp = twiddle * lower
    const tempReal = twiddleReal.mul(lower.x).sub(twiddleImag.mul(lower.y));
    const tempImag = twiddleReal.mul(lower.y).add(twiddleImag.mul(lower.x));

    // Select result based on upper/lower position
    const upperResult = vec2(upper.x.add(tempReal), upper.y.add(tempImag));
    const lowerResult = vec2(upper.x.sub(tempReal), upper.y.sub(tempImag));

    const result = mix(lowerResult, upperResult, isUpper);

    return vec4(result.x, result.y, float(0.0), float(1.0));
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return { material, srcTextureNode };
}

/**
 * Creates a material for vertical FFT butterfly pass.
 */
export function createFFTVerticalMaterial(params: FFTMaterialParams): FFTButterflyMaterialResult {
  const { cascade } = params;
  const srcTextureNode = texture(createPlaceholderTexture());

  const outputNode = Fn(() => {
    const res = cascade.resolution;
    const pixelCoord = floor(uv().mul(res));
    const x = pixelCoord.x;
    const y = pixelCoord.y;

    // Butterfly parameters for this stage
    const butterflyHalf = pow(float(2.0), cascade.fftStage);
    const butterflySize = butterflyHalf.mul(2.0);

    // Determine position within butterfly group
    const groupIdx = floor(y.div(butterflyHalf));
    const isUpper = float(1.0).sub(mod(groupIdx, 2.0));

    // Twiddle factor index: k = (y % butterflyHalf) * (N / butterflySize)
    const posInHalf = mod(y, butterflyHalf);
    const k = posInHalf.mul(res.div(butterflySize));

    // Twiddle factor: W = e^(i * 2pi * k / N)
    const angle = float(2.0).mul(Math.PI).mul(k).div(res);
    const twiddleReal = cos(angle);
    const twiddleImag = sin(angle);

    // Calculate indices for butterfly pair (vertical)
    const groupBase = floor(y.div(butterflySize)).mul(butterflySize);
    const upperY = groupBase.add(posInHalf);
    const lowerY = upperY.add(butterflyHalf);

    // Read upper and lower values
    const upperUv = vec2(x, upperY).add(0.5).div(res);
    const lowerUv = vec2(x, lowerY).add(0.5).div(res);
    const upperData = srcTextureNode.sample(upperUv);
    const lowerData = srcTextureNode.sample(lowerUv);

    const upper = upperData.xy;
    const lower = lowerData.xy;

    // Butterfly operation
    const tempReal = twiddleReal.mul(lower.x).sub(twiddleImag.mul(lower.y));
    const tempImag = twiddleReal.mul(lower.y).add(twiddleImag.mul(lower.x));

    const upperResult = vec2(upper.x.add(tempReal), upper.y.add(tempImag));
    const lowerResult = vec2(upper.x.sub(tempReal), upper.y.sub(tempImag));

    const result = mix(lowerResult, upperResult, isUpper);

    return vec4(result.x, result.y, float(0.0), float(1.0));
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return { material, srcTextureNode };
}

export interface FFTNormalizeMaterialParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
}

export interface FFTNormalizeMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  fftDxTextureNode: TextureNode;
  fftDyTextureNode: TextureNode;
  fftDzTextureNode: TextureNode;
}

/**
 * Creates a material for FFT normalization and assembly.
 */
export function createFFTNormalizeMaterial(params: FFTNormalizeMaterialParams): FFTNormalizeMaterialResult {
  const { wave, cascade } = params;
  const fftDxTextureNode = texture(createPlaceholderTexture());
  const fftDyTextureNode = texture(createPlaceholderTexture());
  const fftDzTextureNode = texture(createPlaceholderTexture());

  const outputNode = Fn(() => {
    const res = cascade.resolution;
    const currentUv = uv();
    const pixelCoord = floor(currentUv.mul(res));
    const x = pixelCoord.x;
    const y = pixelCoord.y;

    // Read FFT results (real component is in .x)
    const dxVal = fftDxTextureNode.sample(currentUv).x;
    const dyVal = fftDyTextureNode.sample(currentUv).x;
    const dzVal = fftDzTextureNode.sample(currentUv).x;

    // Checkerboard sign correction for FFT origin shift
    const sign = float(1.0).sub(mod(x.add(y), 2.0).mul(2.0));

    const correctedDx = dxVal.mul(sign);
    const correctedDy = dyVal.mul(sign);
    const correctedDz = dzVal.mul(sign);

    // Apply global amplitude scaling
    const scaledDx = correctedDx.mul(wave.amplitude);
    const scaledDy = correctedDy.mul(wave.amplitude);
    const scaledDz = correctedDz.mul(wave.amplitude);

    // Apply choppiness to horizontal components
    const finalDx = scaledDx.mul(wave.choppiness);
    const finalDz = scaledDz.mul(wave.choppiness);

    // Negate Y for correct wave orientation
    const finalDy = scaledDy.mul(-1.0);

    return vec4(finalDx, finalDy, finalDz, float(1.0));
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return { material, fftDxTextureNode, fftDyTextureNode, fftDzTextureNode };
}

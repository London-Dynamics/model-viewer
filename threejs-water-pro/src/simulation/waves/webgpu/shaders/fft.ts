import {
  instanceIndex,
  vec2,
  vec4,
  float,
  Fn,
  cos,
  sin,
  pow,
  mix,
} from "three/tsl";
import type { TSLBuffer } from "../../../../types/tsl";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";

/**
 * Combined FFT shaders that process all 3 displacement components (Dx, Dy, Dz) simultaneously.
 * This reduces compute dispatches by 3x compared to processing each component separately.
 *
 * Note: Bit-reversal is integrated into the time evolution shader (spectrum.ts),
 * which writes directly to ping buffers at bit-reversed indices.
 */

/** Group of component buffers (Dx, Dy, Dz) */
export interface ComponentBuffers {
  dx: TSLBuffer;
  dy: TSLBuffer;
  dz: TSLBuffer;
}

export interface CombinedFFTShaderParams {
  cascade: CascadeSimulationUniforms;
  srcBuffers: ComponentBuffers;
  dstBuffers: ComponentBuffers;
  resolution: number;
}

export interface CombinedFFTNormalizeShaderParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
  fftBuffers: ComponentBuffers;
  displacementBuffer: TSLBuffer;
  resolution: number;
}

/**
 * Creates the combined horizontal FFT butterfly pass shader for all 3 components.
 */
export const createCombinedFFTHorizontalShader = ({
  cascade,
  srcBuffers,
  dstBuffers,
  resolution,
}: CombinedFFTShaderParams) => {
  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;
    const stage = cascade.fftStage;

    const x = idx.mod(res);
    const y = idx.div(res);

    // Calculate butterfly parameters for this stage
    const stageFloat = stage.toFloat();
    const butterflyHalf = pow(float(2.0), stageFloat).toUint();
    const butterflySize = butterflyHalf.mul(2);

    // Determine if this thread processes upper or lower butterfly
    const groupIdx = x.div(butterflyHalf).mod(2);
    const isUpper = groupIdx.equal(0);

    // Calculate twiddle factor index
    const k = x.mod(butterflyHalf).mul(res.div(butterflySize));
    const N = res;

    // Twiddle factor: W = e^(i·2π·k/N)
    const angle = float(2.0).mul(Math.PI).mul(k.toFloat()).div(N.toFloat());
    const twiddleReal = cos(angle);
    const twiddleImag = sin(angle);

    // Calculate indices for butterfly pair
    const groupBase = x.sub(x.mod(butterflySize));
    const posInGroup = x.mod(butterflyHalf);
    const upperIdx = y.mul(res).add(groupBase.add(posInGroup));
    const lowerIdx = y
      .mul(res)
      .add(groupBase.add(posInGroup).add(butterflyHalf));

    // Read upper and lower values for all 3 components
    const upperDx = srcBuffers.dx.element(upperIdx);
    const lowerDx = srcBuffers.dx.element(lowerIdx);
    const upperDy = srcBuffers.dy.element(upperIdx);
    const lowerDy = srcBuffers.dy.element(lowerIdx);
    const upperDz = srcBuffers.dz.element(upperIdx);
    const lowerDz = srcBuffers.dz.element(lowerIdx);

    // Butterfly for Dx (using vec2 for complex numbers)
    const tempDxReal = twiddleReal
      .mul(lowerDx.x)
      .sub(twiddleImag.mul(lowerDx.y));
    const tempDxImag = twiddleReal
      .mul(lowerDx.y)
      .add(twiddleImag.mul(lowerDx.x));
    const upperDxResult = vec2(
      upperDx.x.add(tempDxReal),
      upperDx.y.add(tempDxImag),
    );
    const lowerDxResult = vec2(
      upperDx.x.sub(tempDxReal),
      upperDx.y.sub(tempDxImag),
    );

    // Butterfly for Dy
    const tempDyReal = twiddleReal
      .mul(lowerDy.x)
      .sub(twiddleImag.mul(lowerDy.y));
    const tempDyImag = twiddleReal
      .mul(lowerDy.y)
      .add(twiddleImag.mul(lowerDy.x));
    const upperDyResult = vec2(
      upperDy.x.add(tempDyReal),
      upperDy.y.add(tempDyImag),
    );
    const lowerDyResult = vec2(
      upperDy.x.sub(tempDyReal),
      upperDy.y.sub(tempDyImag),
    );

    // Butterfly for Dz
    const tempDzReal = twiddleReal
      .mul(lowerDz.x)
      .sub(twiddleImag.mul(lowerDz.y));
    const tempDzImag = twiddleReal
      .mul(lowerDz.y)
      .add(twiddleImag.mul(lowerDz.x));
    const upperDzResult = vec2(
      upperDz.x.add(tempDzReal),
      upperDz.y.add(tempDzImag),
    );
    const lowerDzResult = vec2(
      upperDz.x.sub(tempDzReal),
      upperDz.y.sub(tempDzImag),
    );

    // Write results for all 3 components
    const selfIdx = y.mul(res).add(x);
    dstBuffers.dx
      .element(selfIdx)
      .assign(mix(lowerDxResult, upperDxResult, float(isUpper)));
    dstBuffers.dy
      .element(selfIdx)
      .assign(mix(lowerDyResult, upperDyResult, float(isUpper)));
    dstBuffers.dz
      .element(selfIdx)
      .assign(mix(lowerDzResult, upperDzResult, float(isUpper)));
  })().compute(resolution * resolution);
};

/**
 * Creates the combined vertical FFT butterfly pass shader for all 3 components.
 */
export const createCombinedFFTVerticalShader = ({
  cascade,
  srcBuffers,
  dstBuffers,
  resolution,
}: CombinedFFTShaderParams) => {
  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;
    const stage = cascade.fftStage;

    const x = idx.mod(res);
    const y = idx.div(res);

    // Calculate butterfly parameters for this stage
    const stageFloat = stage.toFloat();
    const butterflyHalf = pow(float(2.0), stageFloat).toUint();
    const butterflySize = butterflyHalf.mul(2);

    // Determine if this thread processes upper or lower butterfly
    const groupIdx = y.div(butterflyHalf).mod(2);
    const isUpper = groupIdx.equal(0);

    // Calculate twiddle factor index
    const k = y.mod(butterflyHalf).mul(res.div(butterflySize));
    const N = res;

    // Twiddle factor: W = e^(i·2π·k/N)
    const angle = float(2.0).mul(Math.PI).mul(k.toFloat()).div(N.toFloat());
    const twiddleReal = cos(angle);
    const twiddleImag = sin(angle);

    // Calculate indices for butterfly pair (vertical)
    const groupBase = y.sub(y.mod(butterflySize));
    const posInGroup = y.mod(butterflyHalf);
    const upperIdx = groupBase.add(posInGroup).mul(res).add(x);
    const lowerIdx = groupBase
      .add(posInGroup)
      .add(butterflyHalf)
      .mul(res)
      .add(x);

    // Read upper and lower values for all 3 components
    const upperDx = srcBuffers.dx.element(upperIdx);
    const lowerDx = srcBuffers.dx.element(lowerIdx);
    const upperDy = srcBuffers.dy.element(upperIdx);
    const lowerDy = srcBuffers.dy.element(lowerIdx);
    const upperDz = srcBuffers.dz.element(upperIdx);
    const lowerDz = srcBuffers.dz.element(lowerIdx);

    // Butterfly for Dx (using vec2 for complex numbers)
    const tempDxReal = twiddleReal
      .mul(lowerDx.x)
      .sub(twiddleImag.mul(lowerDx.y));
    const tempDxImag = twiddleReal
      .mul(lowerDx.y)
      .add(twiddleImag.mul(lowerDx.x));
    const upperDxResult = vec2(
      upperDx.x.add(tempDxReal),
      upperDx.y.add(tempDxImag),
    );
    const lowerDxResult = vec2(
      upperDx.x.sub(tempDxReal),
      upperDx.y.sub(tempDxImag),
    );

    // Butterfly for Dy
    const tempDyReal = twiddleReal
      .mul(lowerDy.x)
      .sub(twiddleImag.mul(lowerDy.y));
    const tempDyImag = twiddleReal
      .mul(lowerDy.y)
      .add(twiddleImag.mul(lowerDy.x));
    const upperDyResult = vec2(
      upperDy.x.add(tempDyReal),
      upperDy.y.add(tempDyImag),
    );
    const lowerDyResult = vec2(
      upperDy.x.sub(tempDyReal),
      upperDy.y.sub(tempDyImag),
    );

    // Butterfly for Dz
    const tempDzReal = twiddleReal
      .mul(lowerDz.x)
      .sub(twiddleImag.mul(lowerDz.y));
    const tempDzImag = twiddleReal
      .mul(lowerDz.y)
      .add(twiddleImag.mul(lowerDz.x));
    const upperDzResult = vec2(
      upperDz.x.add(tempDzReal),
      upperDz.y.add(tempDzImag),
    );
    const lowerDzResult = vec2(
      upperDz.x.sub(tempDzReal),
      upperDz.y.sub(tempDzImag),
    );

    // Write results for all 3 components
    const selfIdx = y.mul(res).add(x);
    dstBuffers.dx
      .element(selfIdx)
      .assign(mix(lowerDxResult, upperDxResult, float(isUpper)));
    dstBuffers.dy
      .element(selfIdx)
      .assign(mix(lowerDyResult, upperDyResult, float(isUpper)));
    dstBuffers.dz
      .element(selfIdx)
      .assign(mix(lowerDzResult, upperDzResult, float(isUpper)));
  })().compute(resolution * resolution);
};

/**
 * Creates the combined FFT normalization shader for all 3 components.
 * Extracts real components, applies corrections, and writes to displacement buffer.
 */
export const createCombinedFFTNormalizeShader = ({
  wave,
  cascade,
  fftBuffers,
  displacementBuffer,
  resolution,
}: CombinedFFTNormalizeShaderParams) => {
  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;

    // Read final FFT results from all 3 buffers
    const dataDx = fftBuffers.dx.element(idx);
    const dataDy = fftBuffers.dy.element(idx);
    const dataDz = fftBuffers.dz.element(idx);

    // Extract real components
    const realDx = dataDx.x;
    const realDy = dataDy.x;
    const realDz = dataDz.x;

    // Apply checkerboard sign correction for FFT origin shift
    const x = idx.mod(res);
    const y = idx.div(res);
    const sign = float(1.0).sub(x.add(y).mod(2).mul(2.0));

    const correctedDx = realDx.mul(sign);
    const correctedDy = realDy.mul(sign);
    const correctedDz = realDz.mul(sign);

    // Apply amplitude scaling
    const ampScale = cascade.amplitudeScale;
    const scaledDx = correctedDx.mul(ampScale);
    const scaledDy = correctedDy.mul(ampScale);
    const scaledDz = correctedDz.mul(ampScale);

    // Apply choppiness to horizontal components (Dx, Dz)
    const choppiness = wave.choppiness;
    const finalDx = scaledDx.mul(choppiness);
    const finalDz = scaledDz.mul(choppiness);

    // Negate Y for correct wave orientation (sharp peaks, rounded troughs)
    const finalDy = scaledDy.mul(-1.0);

    // Write combined displacement to buffer
    displacementBuffer
      .element(idx)
      .assign(vec4(finalDx, finalDy, finalDz, 1.0));
  })().compute(resolution * resolution);
};

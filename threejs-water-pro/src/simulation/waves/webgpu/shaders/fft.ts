// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import {
  instanceIndex,
  invocationLocalIndex,
  vec2,
  vec4,
  float,
  Fn,
  cos,
  sin,
  uint,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
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
  /** Zero-based FFT stage, specialized into the shader as a literal. */
  stage: number;
}

export interface CombinedFFTNormalizeShaderParams {
  wave: WaveUniforms;
  cascade: CascadeSimulationUniforms;
  fftBuffers: ComponentBuffers;
  displacementBuffer: TSLBuffer;
  resolution: number;
}

export interface CombinedFFTSharedShaderParams {
  srcBuffers: ComponentBuffers;
  dstBuffers: ComponentBuffers;
  resolution: number;
}

/**
 * Apply one in-place complex radix-2 butterfly in workgroup memory.
 *
 * Each invocation owns both destinations, and the caller inserts a workgroup
 * barrier between stages. Materializing both inputs before either write keeps
 * the reads independent of TSL's generated assignment order.
 */
function applySharedButterfly(
  buffer: ReturnType<typeof workgroupArray>,
  upperIndex: ReturnType<typeof uint>,
  lowerIndex: ReturnType<typeof uint>,
  twiddleReal: ReturnType<typeof float>,
  twiddleImag: ReturnType<typeof float>,
): void {
  const upper = buffer.element(upperIndex).toVar();
  const lower = buffer.element(lowerIndex).toVar();
  const tempReal = twiddleReal.mul(lower.x).sub(twiddleImag.mul(lower.y));
  const tempImag = twiddleReal.mul(lower.y).add(twiddleImag.mul(lower.x));

  buffer
    .element(upperIndex)
    .assign(vec2(upper.x.add(tempReal), upper.y.add(tempImag)));
  buffer
    .element(lowerIndex)
    .assign(vec2(upper.x.sub(tempReal), upper.y.sub(tempImag)));
}

/**
 * Create one complete 1D FFT pass per row or column. A workgroup loads all
 * three complex displacement fields, executes every radix-2 stage in place,
 * then writes the completed line back to global memory.
 */
function createCombinedFFTSharedShader(
  { srcBuffers, dstBuffers, resolution }: CombinedFFTSharedShaderParams,
  direction: "horizontal" | "vertical",
) {
  const workgroupSize = resolution / 2;
  const sharedDx = workgroupArray("vec2", resolution);
  const sharedDy = workgroupArray("vec2", resolution);
  const sharedDz = workgroupArray("vec2", resolution);

  return Fn(() => {
    const line = workgroupId.x;
    const localIndex0 = invocationLocalIndex.mul(2);
    const localIndex1 = localIndex0.add(1);
    const globalIndex0 =
      direction === "horizontal"
        ? line.mul(resolution).add(localIndex0)
        : localIndex0.mul(resolution).add(line);
    const globalIndex1 =
      direction === "horizontal"
        ? line.mul(resolution).add(localIndex1)
        : localIndex1.mul(resolution).add(line);

    sharedDx.element(localIndex0).assign(srcBuffers.dx.element(globalIndex0));
    sharedDx.element(localIndex1).assign(srcBuffers.dx.element(globalIndex1));
    sharedDy.element(localIndex0).assign(srcBuffers.dy.element(globalIndex0));
    sharedDy.element(localIndex1).assign(srcBuffers.dy.element(globalIndex1));
    sharedDz.element(localIndex0).assign(srcBuffers.dz.element(globalIndex0));
    sharedDz.element(localIndex1).assign(srcBuffers.dz.element(globalIndex1));
    workgroupBarrier();

    for (let stage = 0; stage < Math.log2(resolution); stage++) {
      const butterflyHalfValue = 1 << stage;
      const butterflySizeValue = butterflyHalfValue * 2;
      const butterflyHalf = uint(butterflyHalfValue);
      const butterflySize = uint(butterflySizeValue);
      const pairGroup = invocationLocalIndex.div(butterflyHalf);
      const posInGroup = invocationLocalIndex.mod(butterflyHalf);
      const upperIndex = pairGroup.mul(butterflySize).add(posInGroup);
      const lowerIndex = upperIndex.add(butterflyHalf);
      const k = posInGroup.mul(resolution / butterflySizeValue);
      const angle = float(2.0)
        .mul(Math.PI)
        .mul(k.toFloat())
        .div(resolution);
      const twiddleReal = cos(angle);
      const twiddleImag = sin(angle);

      applySharedButterfly(
        sharedDx,
        upperIndex,
        lowerIndex,
        twiddleReal,
        twiddleImag,
      );
      applySharedButterfly(
        sharedDy,
        upperIndex,
        lowerIndex,
        twiddleReal,
        twiddleImag,
      );
      applySharedButterfly(
        sharedDz,
        upperIndex,
        lowerIndex,
        twiddleReal,
        twiddleImag,
      );
      workgroupBarrier();
    }

    dstBuffers.dx.element(globalIndex0).assign(sharedDx.element(localIndex0));
    dstBuffers.dx.element(globalIndex1).assign(sharedDx.element(localIndex1));
    dstBuffers.dy.element(globalIndex0).assign(sharedDy.element(localIndex0));
    dstBuffers.dy.element(globalIndex1).assign(sharedDy.element(localIndex1));
    dstBuffers.dz.element(globalIndex0).assign(sharedDz.element(localIndex0));
    dstBuffers.dz.element(globalIndex1).assign(sharedDz.element(localIndex1));
  })().compute((resolution * resolution) / 2, [workgroupSize]);
}

/** Complete every horizontal FFT stage in two global-memory touches. */
export const createCombinedFFTSharedHorizontalShader = (
  params: CombinedFFTSharedShaderParams,
) => createCombinedFFTSharedShader(params, "horizontal");

/** Complete every vertical FFT stage in two global-memory touches. */
export const createCombinedFFTSharedVerticalShader = (
  params: CombinedFFTSharedShaderParams,
) => createCombinedFFTSharedShader(params, "vertical");

/**
 * Creates the combined horizontal FFT butterfly pass shader for all 3 components.
 */
export const createCombinedFFTHorizontalShader = ({
  cascade,
  srcBuffers,
  dstBuffers,
  resolution,
  stage,
}: CombinedFFTShaderParams) => {
  const butterflyHalfValue = 1 << stage;
  const butterflySizeValue = butterflyHalfValue * 2;

  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;

    // One invocation owns one complete butterfly pair. There are R / 2
    // independent pairs per row, so dispatching R² / 2 invocations covers
    // every output exactly once without duplicating reads or arithmetic.
    const pairsPerRow = res.div(2);
    const pairInRow = idx.mod(pairsPerRow);
    const y = idx.div(pairsPerRow);

    // Stage constants are baked into this node so batched dispatches do not
    // share mutable FFT state or evaluate pow(2, stage) per invocation.
    const butterflyHalf = uint(butterflyHalfValue);
    const butterflySize = uint(butterflySizeValue);

    // Map the compact pair index back into this stage's butterfly group.
    const pairGroup = pairInRow.div(butterflyHalf);
    const posInGroup = pairInRow.mod(butterflyHalf);

    // Calculate twiddle factor index
    const k = posInGroup.mul(res.div(butterflySize));
    const N = res;

    // Twiddle factor: W = e^(i·2π·k/N)
    const angle = float(2.0).mul(Math.PI).mul(k.toFloat()).div(N.toFloat());
    const twiddleReal = cos(angle);
    const twiddleImag = sin(angle);

    // Calculate indices for butterfly pair
    const groupBase = pairGroup.mul(butterflySize);
    const upperIdx = y.mul(res).add(groupBase).add(posInGroup);
    const lowerIdx = y
      .mul(res)
      .add(groupBase)
      .add(posInGroup)
      .add(butterflyHalf);

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

    // This invocation exclusively owns both destinations for the pair.
    dstBuffers.dx.element(upperIdx).assign(upperDxResult);
    dstBuffers.dx.element(lowerIdx).assign(lowerDxResult);
    dstBuffers.dy.element(upperIdx).assign(upperDyResult);
    dstBuffers.dy.element(lowerIdx).assign(lowerDyResult);
    dstBuffers.dz.element(upperIdx).assign(upperDzResult);
    dstBuffers.dz.element(lowerIdx).assign(lowerDzResult);
  })().compute((resolution * resolution) / 2);
};

/**
 * Creates the combined vertical FFT butterfly pass shader for all 3 components.
 */
export const createCombinedFFTVerticalShader = ({
  cascade,
  srcBuffers,
  dstBuffers,
  resolution,
  stage,
}: CombinedFFTShaderParams) => {
  const butterflyHalfValue = 1 << stage;
  const butterflySizeValue = butterflyHalfValue * 2;

  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;

    // Keep adjacent invocations on adjacent columns for coalesced buffer
    // access. Each invocation owns one complete vertical butterfly pair.
    const x = idx.mod(res);
    const pairInColumn = idx.div(res);

    // Stage constants are baked into this node so batched dispatches do not
    // share mutable FFT state or evaluate pow(2, stage) per invocation.
    const butterflyHalf = uint(butterflyHalfValue);
    const butterflySize = uint(butterflySizeValue);

    // Map the compact pair index back into this stage's butterfly group.
    const pairGroup = pairInColumn.div(butterflyHalf);
    const posInGroup = pairInColumn.mod(butterflyHalf);

    // Calculate twiddle factor index
    const k = posInGroup.mul(res.div(butterflySize));
    const N = res;

    // Twiddle factor: W = e^(i·2π·k/N)
    const angle = float(2.0).mul(Math.PI).mul(k.toFloat()).div(N.toFloat());
    const twiddleReal = cos(angle);
    const twiddleImag = sin(angle);

    // Calculate indices for butterfly pair (vertical)
    const groupBase = pairGroup.mul(butterflySize);
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

    // This invocation exclusively owns both destinations for the pair.
    dstBuffers.dx.element(upperIdx).assign(upperDxResult);
    dstBuffers.dx.element(lowerIdx).assign(lowerDxResult);
    dstBuffers.dy.element(upperIdx).assign(upperDyResult);
    dstBuffers.dy.element(lowerIdx).assign(lowerDyResult);
    dstBuffers.dz.element(upperIdx).assign(upperDzResult);
    dstBuffers.dz.element(lowerIdx).assign(lowerDzResult);
  })().compute((resolution * resolution) / 2);
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

    // Apply global amplitude scaling
    const ampScale = wave.amplitude;
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

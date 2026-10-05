// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import {
  instanceIndex,
  ivec2,
  textureStore,
  vec3,
  vec4,
  float,
  Fn,
  normalize,
  sqrt,
  clamp,
  smoothstep,
  mix,
  cos,
  sin,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import type { TSLBuffer, TSLUniformNode } from "../../../../types/tsl";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";

export interface NormalsShaderParams {
  wave: WaveUniforms;
  /** TSL uniform node for wind bias (from WaveFoam._windBiasNode). */
  foamWindBias: TSLUniformNode;
  cascade: CascadeSimulationUniforms;
  displacementBuffer: TSLBuffer;
  /**
   * Authoritative RGBA16F normal/folding texture. All compute and fragment
   * consumers sample it through the filterable texture path.
   */
  normalTexture: THREE.StorageTexture;
  resolution: number;
}

/**
 * Creates the normal and Jacobian computation shader
 *
 * Computes surface normals from displacement gradients using finite differences.
 * Also calculates the Jacobian determinant for foam generation (surface compression).
 */
export const createNormalsShader = ({
  wave,
  foamWindBias,
  cascade,
  displacementBuffer,
  normalTexture,
  resolution,
}: NormalsShaderParams) => {
  return Fn(() => {
    const idx = instanceIndex;
    const res = cascade.resolution;

    const x = idx.mod(res);
    const y = idx.div(res); // Integer division already truncates

    // Get neighboring pixels (with wrapping)
    const xPrev = x.sub(1).add(res).mod(res);
    const xNext = x.add(1).mod(res);
    const yPrev = y.sub(1).add(res).mod(res);
    const yNext = y.add(1).mod(res);

    const idxLeft = y.mul(res).add(xPrev);
    const idxRight = y.mul(res).add(xNext);
    const idxUp = yPrev.mul(res).add(x);
    const idxDown = yNext.mul(res).add(x);

    // Get displacement vectors from neighboring pixels (x=Dx, y=Dy, z=Dz)
    const dispLeft = displacementBuffer.element(idxLeft);
    const dispRight = displacementBuffer.element(idxRight);
    const dispUp = displacementBuffer.element(idxUp);
    const dispDown = displacementBuffer.element(idxDown);

    // Calculate gradients for all displacement components using central finite differences.
    // Physical grid spacing dx = scale / resolution: the tile size is the
    // cascade's world-space scale (matches spectrum.ts), so higher resolution
    // shrinks the spacing and resolves finer wave slopes. Central difference uses
    // 2 pixels: (f[i+1] - f[i-1]) / (2·dx).
    const gridSpacing = cascade.scale.div(res.toFloat());

    // Gradients in X direction (horizontal)
    const dDx_dx = dispRight.x.sub(dispLeft.x).div(gridSpacing.mul(2.0));
    const dDy_dx = dispRight.y.sub(dispLeft.y).div(gridSpacing.mul(2.0));
    const dDz_dx = dispRight.z.sub(dispLeft.z).div(gridSpacing.mul(2.0));

    // Gradients in Z direction (vertical)
    const dDx_dz = dispDown.x.sub(dispUp.x).div(gridSpacing.mul(2.0));
    const dDy_dz = dispDown.y.sub(dispUp.y).div(gridSpacing.mul(2.0));
    const dDz_dz = dispDown.z.sub(dispUp.z).div(gridSpacing.mul(2.0));

    // Compute tangent vectors accounting for full 3D displacement
    // Tangent in X direction: (1 + dDx/dx, dDy/dx, dDz/dx)
    const tangentX = vec3(float(1.0).add(dDx_dx), dDy_dx, dDz_dx);

    // Tangent in Z direction: (dDx/dz, dDy/dz, 1 + dDz/dz)
    const tangentZ = vec3(dDx_dz, dDy_dz, float(1.0).add(dDz_dz));

    // Normal is cross product of tangents (gives surface normal)
    // Cross product: tangentZ × tangentX (order matters for correct direction!)
    // For Y-up coordinate system, this ensures normals point upward
    const normalX = tangentZ.y.mul(tangentX.z).sub(tangentZ.z.mul(tangentX.y));
    const normalY = tangentZ.z.mul(tangentX.x).sub(tangentZ.x.mul(tangentX.z));
    const normalZ = tangentZ.x.mul(tangentX.y).sub(tangentZ.y.mul(tangentX.x));

    const normal = normalize(vec3(normalX, normalY, normalZ));

    // Calculate smaller eigenvalue of 2x2 Jacobian matrix for foam detection
    // The Jacobian matrix for horizontal displacement is:
    // J = [ 1 + dDx/dx,   dDx/dz  ]
    //     [ dDz/dx,     1 + dDz/dz ]
    //
    // For 2x2 matrix [[a,b],[c,d]], eigenvalues are: (a+d)/2 ± sqrt(((a-d)/2)² + bc)
    // Negative eigenvalue indicates surface folding/compression in that direction
    const jxx = float(1.0).add(dDx_dx);
    const jyy = float(1.0).add(dDz_dz);
    const jxy = dDx_dz;
    const jyx = dDz_dx;

    // Compute smaller eigenvalue: (trace/2) - sqrt((trace_diff/2)² + off_diagonal_product)
    const trace = jxx.add(jyy);
    const traceDiff = jxx.sub(jyy);
    const discriminant = traceDiff.mul(traceDiff).mul(0.25).add(jxy.mul(jyx));
    // Clamp discriminant to avoid sqrt of negative (numerical precision)
    const sqrtDisc = sqrt(discriminant.max(0.0));
    const smallerEigenvalue = trace.mul(0.5).sub(sqrtDisc);

    // Leading edge detection using wind direction
    // For wind-driven waves, the leading edge (front face) faces INTO the wind.
    // We compute how much the surface normal points against the wind direction.
    //
    // Wind direction is the direction wind is blowing FROM (angle in radians).
    // Waves travel in the wind direction, so leading edges face opposite to it.
    const windDirX = cos(wave.windDirection);
    const windDirZ = sin(wave.windDirection);

    // Dot product of surface normal (xz only) with wind direction
    // Positive = surface faces with wind (trailing edge)
    // Negative = surface faces against wind (leading edge)
    // We negate to get positive values for leading edge
    const windAlignment = normal.x.mul(windDirX).add(normal.z.mul(windDirZ));

    // Use smoothstep to create a soft transition:
    // - Leading edge (windAlignment > 0): factor approaches 1
    // - Trailing edge (windAlignment < 0): factor approaches 0
    // The scale uniform controls the sharpness of the transition
    const leadingEdgeFactor = smoothstep(
      float(0.0),
      cascade.foamLeadingEdgeScale.mul(0.1),
      windAlignment,
    );

    // Apply bias to control distribution between leading and trailing edges
    // bias=0: equal foam on both sides (factor stays at 1.0)
    // bias=1: leading edge only (factor follows leadingEdgeFactor)
    const windBias = foamWindBias;
    const biasedLeading = mix(
      float(1.0),
      leadingEdgeFactor,
      windBias,
    );

    // Apply falloff on trailing side to allow some foam to bleed through
    // Higher falloff = more foam on trailing edges
    // Trailing falloff is derived as 1 - windBias (same source uniform)
    const trailingFactor = float(1.0).sub(leadingEdgeFactor);
    const trailingBleed = trailingFactor.mul(float(1.0).sub(windBias));

    // Combine biased leading edge with trailing bleed
    const finalEdgeFactor = clamp(biasedLeading.add(trailingBleed), 0.0, 1.0);

    // Combine eigenvalue with edge factor:
    // - When edge factor is low, report neutral eigenvalue (1.0)
    // - When edge factor is high, report actual compression level
    //
    // Note: smallerEigenvalue can be > 1 for expanding surfaces, so we clamp
    // folding to [0, 1] to prevent negative values from causing NaN in pow()
    const folding = clamp(float(1.0).sub(smallerEigenvalue), 0.0, 1.0);
    const directionalFolding = folding.mul(finalEdgeFactor);
    const directionalEigenvalue = float(1.0).sub(directionalFolding);

    // Store normal (convert from [-1,1] to [0,1]) + directional eigenvalue
    // in alpha for foam calculation. The filterable RGBA16F storage texture is
    // the single normal source for compute and fragment consumers.
    const packed = vec4(
      normal.x.mul(0.5).add(0.5),
      normal.y.mul(0.5).add(0.5),
      normal.z.mul(0.5).add(0.5),
      directionalEigenvalue,
    );
    textureStore(normalTexture, ivec2(x, y), packed).toWriteOnly();
  })().compute(resolution * resolution);
};

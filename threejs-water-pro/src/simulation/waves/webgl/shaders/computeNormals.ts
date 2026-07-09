/**
 * TSL-based normal computation shader for WebGL FFT.
 * Uses MeshBasicNodeMaterial with outputNode for render-to-texture passes.
 *
 * Uses the same WaveUniforms and CascadeSimulationUniforms as the WebGPU
 * compute shader, eliminating duplicate state.
 */

import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uv,
  floor,
  sqrt,
  cos,
  sin,
  max,
  smoothstep,
  clamp,
  mod,
  normalize,
  texture,
} from "three/tsl";
import type { TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../../../types/tsl";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";

/** Creates a placeholder 1x1 texture for initialization */
function createPlaceholderTexture(): THREE.DataTexture {
  const data = new Float32Array([0, 0, 0, 1]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

export interface NormalsMaterialParams {
  wave: WaveUniforms;
  foamWindBias: TSLUniformNode;
  cascade: CascadeSimulationUniforms;
}

export interface NormalsMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  displacementTextureNode: TextureNode;
}

/**
 * Creates a material for computing normals and Jacobian from displacement.
 */
export function createNormalsMaterial(params: NormalsMaterialParams): NormalsMaterialResult {
  const { wave, foamWindBias, cascade } = params;
  const displacementTextureNode = texture(createPlaceholderTexture());

  const outputNode = Fn(() => {
    const res = cascade.resolution;
    const pixelCoord = floor(uv().mul(res));
    const x = pixelCoord.x;
    const y = pixelCoord.y;

    // Neighboring pixel coordinates with wrapping
    const xPrev = mod(x.sub(1.0).add(res), res);
    const xNext = mod(x.add(1.0), res);
    const yPrev = mod(y.sub(1.0).add(res), res);
    const yNext = mod(y.add(1.0), res);

    // Sample neighboring displacements
    const uvLeft = vec2(xPrev, y).add(0.5).div(res);
    const uvRight = vec2(xNext, y).add(0.5).div(res);
    const uvUp = vec2(x, yPrev).add(0.5).div(res);
    const uvDown = vec2(x, yNext).add(0.5).div(res);

    const dispLeft = displacementTextureNode.sample(uvLeft).xyz;
    const dispRight = displacementTextureNode.sample(uvRight).xyz;
    const dispUp = displacementTextureNode.sample(uvUp).xyz;
    const dispDown = displacementTextureNode.sample(uvDown).xyz;

    // Grid spacing (resolution-normalized scale)
    const baseRes = float(256.0);
    const effectiveScale = cascade.scale.mul(res).div(baseRes);
    const gridSpacing = effectiveScale.div(res);

    // Gradients using central finite differences
    const dDx_dx = dispRight.x.sub(dispLeft.x).div(gridSpacing.mul(2.0));
    const dDy_dx = dispRight.y.sub(dispLeft.y).div(gridSpacing.mul(2.0));
    const dDz_dx = dispRight.z.sub(dispLeft.z).div(gridSpacing.mul(2.0));

    const dDx_dz = dispDown.x.sub(dispUp.x).div(gridSpacing.mul(2.0));
    const dDy_dz = dispDown.y.sub(dispUp.y).div(gridSpacing.mul(2.0));
    const dDz_dz = dispDown.z.sub(dispUp.z).div(gridSpacing.mul(2.0));

    // Compute tangent vectors
    const tangentX = vec3(float(1.0).add(dDx_dx), dDy_dx, dDz_dx);
    const tangentZ = vec3(dDx_dz, dDy_dz, float(1.0).add(dDz_dz));

    // Normal is cross product of tangents
    const normalX = tangentZ.y.mul(tangentX.z).sub(tangentZ.z.mul(tangentX.y));
    const normalY = tangentZ.z.mul(tangentX.x).sub(tangentZ.x.mul(tangentX.z));
    const normalZ = tangentZ.x.mul(tangentX.y).sub(tangentZ.y.mul(tangentX.x));

    const normal = normalize(vec3(normalX, normalY, normalZ));

    // Jacobian matrix for foam detection
    const jxx = float(1.0).add(dDx_dx);
    const jyy = float(1.0).add(dDz_dz);
    const jxy = dDx_dz;
    const jyx = dDz_dx;

    // Smaller eigenvalue
    const trace = jxx.add(jyy);
    const traceDiff = jxx.sub(jyy);
    const discriminant = traceDiff.mul(traceDiff).mul(0.25).add(jxy.mul(jyx));
    const sqrtDisc = sqrt(max(float(0.0), discriminant));
    const smallerEigenvalue = trace.mul(0.5).sub(sqrtDisc);

    // Leading edge detection
    const windDirX = cos(wave.windDirection);
    const windDirZ = sin(wave.windDirection);
    const windAlignment = normal.x.mul(windDirX).add(normal.z.mul(windDirZ));

    const leadingEdgeFactor = smoothstep(
      float(0.0),
      cascade.foamLeadingEdgeScale.mul(0.1),
      windAlignment,
    );

    // Apply wind bias
    const biasedLeading = float(1.0).sub(leadingEdgeFactor).mul(foamWindBias).add(
      leadingEdgeFactor.mul(float(1.0).sub(foamWindBias)).add(foamWindBias),
    );
    const trailingFactor = float(1.0).sub(leadingEdgeFactor);
    const trailingBleed = trailingFactor.mul(float(1.0).sub(foamWindBias));
    const finalEdgeFactor = clamp(biasedLeading.add(trailingBleed), 0.0, 1.0);

    // Combine eigenvalue with edge factor
    const folding = clamp(float(1.0).sub(smallerEigenvalue), 0.0, 1.0);
    const directionalFolding = folding.mul(finalEdgeFactor);
    const directionalEigenvalue = float(1.0).sub(directionalFolding);

    // Output: normal in [0,1] range, eigenvalue in alpha
    return vec4(
      normal.x.mul(0.5).add(0.5),
      normal.y.mul(0.5).add(0.5),
      normal.z.mul(0.5).add(0.5),
      directionalEigenvalue,
    );
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return { material, displacementTextureNode };
}

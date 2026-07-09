import type * as THREE from "three/webgpu";
import type { TSLBuffer, TSLUniformNode } from "../../../../types/tsl";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";
export interface NormalsShaderParams {
    wave: WaveUniforms;
    /** TSL uniform node for wind bias (from WaveFoam._windBiasNode). */
    foamWindBias: TSLUniformNode;
    cascade: CascadeSimulationUniforms;
    displacementBuffer: TSLBuffer;
    normalBuffer: TSLBuffer;
    /**
     * StorageTexture mirror of `normalBuffer`. Each thread writes the same
     * packed vec4 to both — compute consumers read from the buffer, fragment
     * consumers sample the texture via hardware bilinear. The mirror is
     * cheap: one extra texture write per texel per frame.
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
export declare const createNormalsShader: ({ wave, foamWindBias, cascade, displacementBuffer, normalBuffer, normalTexture, resolution, }: NormalsShaderParams) => THREE.ComputeNode;
//# sourceMappingURL=computeNormals.d.ts.map
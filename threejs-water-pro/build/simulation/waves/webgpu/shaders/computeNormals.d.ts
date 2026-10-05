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
export declare const createNormalsShader: ({ wave, foamWindBias, cascade, displacementBuffer, normalTexture, resolution, }: NormalsShaderParams) => THREE.ComputeNode;
//# sourceMappingURL=computeNormals.d.ts.map
/**
 * TSL-based normal computation shader for WebGL FFT.
 * Uses MeshBasicNodeMaterial with outputNode for render-to-texture passes.
 *
 * Uses the same WaveUniforms and CascadeSimulationUniforms as the WebGPU
 * compute shader, eliminating duplicate state.
 */
import * as THREE from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../../../types/tsl";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";
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
export declare function createNormalsMaterial(params: NormalsMaterialParams): NormalsMaterialResult;
//# sourceMappingURL=computeNormals.d.ts.map
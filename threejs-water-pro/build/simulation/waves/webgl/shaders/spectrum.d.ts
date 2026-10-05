/**
 * TSL-based spectrum generation and time evolution for WebGL FFT.
 * Uses MeshBasicNodeMaterial with outputNode for render-to-texture passes.
 *
 * These shaders use the same WaveUniforms and CascadeSimulationUniforms as
 * the WebGPU compute shaders, eliminating duplicate state and per-frame syncing.
 */
import * as THREE from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";
export interface InitSpectrumMaterialParams {
    wave: WaveUniforms;
    cascade: CascadeSimulationUniforms;
}
/**
 * Creates a material for initial spectrum generation using a JONSWAP
 * spectrum with Hasselmann directional spreading (see
 * `../../jonswapSpectrum.ts`).
 * Output: vec4(h0Real, h0Imag, kx, ky)
 */
export declare function createInitSpectrumMaterial(params: InitSpectrumMaterialParams): THREE.MeshBasicNodeMaterial;
export interface TimeEvolutionMaterialParams {
    wave: WaveUniforms;
    cascade: CascadeSimulationUniforms;
    numBits: number;
    component: number;
}
export interface TimeEvolutionMaterialResult {
    material: THREE.MeshBasicNodeMaterial;
    h0TextureNode: TextureNode;
}
/**
 * Creates a material for time evolution of a specific component.
 */
export declare function createTimeEvolutionMaterial(params: TimeEvolutionMaterialParams): TimeEvolutionMaterialResult;
//# sourceMappingURL=spectrum.d.ts.map
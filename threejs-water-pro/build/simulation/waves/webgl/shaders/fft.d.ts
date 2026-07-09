/**
 * TSL-based FFT butterfly shaders for WebGL.
 * Uses MeshBasicNodeMaterial with outputNode for render-to-texture passes.
 *
 * These shaders use CascadeSimulationUniforms directly, sharing the same
 * uniform nodes as the WebGPU compute shaders.
 */
import * as THREE from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import type { WaveUniforms, CascadeSimulationUniforms } from "../../../../uniforms";
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
export declare function createFFTHorizontalMaterial(params: FFTMaterialParams): FFTButterflyMaterialResult;
/**
 * Creates a material for vertical FFT butterfly pass.
 */
export declare function createFFTVerticalMaterial(params: FFTMaterialParams): FFTButterflyMaterialResult;
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
export declare function createFFTNormalizeMaterial(params: FFTNormalizeMaterialParams): FFTNormalizeMaterialResult;
//# sourceMappingURL=fft.d.ts.map
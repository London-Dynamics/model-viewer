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
export declare const createCombinedFFTHorizontalShader: ({ cascade, srcBuffers, dstBuffers, resolution, }: CombinedFFTShaderParams) => import("three/webgpu").ComputeNode;
/**
 * Creates the combined vertical FFT butterfly pass shader for all 3 components.
 */
export declare const createCombinedFFTVerticalShader: ({ cascade, srcBuffers, dstBuffers, resolution, }: CombinedFFTShaderParams) => import("three/webgpu").ComputeNode;
/**
 * Creates the combined FFT normalization shader for all 3 components.
 * Extracts real components, applies corrections, and writes to displacement buffer.
 */
export declare const createCombinedFFTNormalizeShader: ({ wave, cascade, fftBuffers, displacementBuffer, resolution, }: CombinedFFTNormalizeShaderParams) => import("three/webgpu").ComputeNode;
//# sourceMappingURL=fft.d.ts.map
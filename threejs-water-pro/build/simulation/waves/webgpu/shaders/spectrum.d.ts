import type { TSLBuffer } from "../../../../types/tsl";
import type { WaveUniforms } from "../../../../uniforms";
import type { CascadeSimulationUniforms } from "../../../../uniforms";
/** Group of component buffers (Dx, Dy, Dz) */
export interface ComponentBuffers {
    dx: TSLBuffer;
    dy: TSLBuffer;
    dz: TSLBuffer;
}
export interface InitSpectrumShaderParams {
    wave: WaveUniforms;
    cascade: CascadeSimulationUniforms;
    h0Buffer: TSLBuffer;
    resolution: number;
}
export interface TimeEvolutionShaderParams {
    wave: WaveUniforms;
    cascade: CascadeSimulationUniforms;
    h0Buffer: TSLBuffer;
    pingBuffers: ComponentBuffers;
    resolution: number;
    numBits: number;
}
/**
 * Creates the initial spectrum generation shader.
 *
 * Generates the initial Fourier coefficients h̃₀(k) for ocean waves using a
 * JONSWAP spectrum (see `../../jonswapSpectrum.ts`) with Hasselmann
 * directional spreading. This shader runs once at initialization
 * (and whenever wave parameters change) to set up the frequency domain
 * representation.
 */
export declare const createInitSpectrumShader: ({ wave, cascade, h0Buffer, resolution, }: InitSpectrumShaderParams) => import("three/webgpu").ComputeNode;
/**
 * Creates the time evolution shader
 *
 * Evolves the initial spectrum h̃₀(k) forward in time to get h̃(k,t) using the
 * dispersion relation ω(k) = √(g|k|). Computes separate spectra for each
 * displacement component (Dx, Dy, Dz).
 *
 * This shader also performs bit-reversal permutation, writing directly to the
 * FFT ping buffers at bit-reversed indices. This eliminates the need for a
 * separate bit-reversal pass, reducing memory bandwidth and dispatch overhead.
 */
export declare const createTimeEvolutionShader: ({ wave, cascade, h0Buffer, pingBuffers, resolution, numBits, }: TimeEvolutionShaderParams) => import("three/webgpu").ComputeNode;
//# sourceMappingURL=spectrum.d.ts.map
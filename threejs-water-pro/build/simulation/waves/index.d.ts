/**
 * Wave simulation module.
 * Provides FFT-based implementations for both WebGPU (compute shaders) and WebGL (render-to-texture).
 */
export type { IWaveSimulation, InternalGerstnerParams, WaveCapabilities, WaveDisplacementNodes, WaveNormalNodes, } from "./IWaveSimulation";
export type { IWaveSampler, WaveSample } from "./IWaveSampler";
export { MAX_SAMPLE_POINTS } from "./IWaveSampler";
export type { CascadeConfig, CascadesConfig, CascadeSimulationParams, WavesConfig, } from "./types";
export { getCascadeConfigsArray } from "./types";
export { WAVE_TIME_PERIOD_SECONDS, WAVE_TIME_OMEGA_STEP } from "./timing";
export { createWaveSimulation, createWaveSampler, type CreateWaveSimulationOptions, } from "./createWaveSimulation";
export { WebGPUWaveSimulation, WebGPUWaveSampler } from "./webgpu";
export { WebGLWaveSimulation, WebGLWaveSampler } from "./webgl";
export { WebGPUWaveSimulation as WaveSimulation } from "./webgpu";
export { WebGPUWaveSampler as WaveSampler } from "./webgpu";
//# sourceMappingURL=index.d.ts.map
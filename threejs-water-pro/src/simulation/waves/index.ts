// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Wave simulation module.
 * Provides FFT-based implementations for both WebGPU (compute shaders) and WebGL (render-to-texture).
 */

// Interfaces
export type {
  IWaveSimulation,
  WaveCapabilities,
  WaveDisplacementNodes,
  WaveNormalNodes,
} from "./IWaveSimulation";

export type { IWaveSampler, WaveSample } from "./IWaveSampler";
export { MAX_SAMPLE_POINTS } from "./IWaveSampler";

// Types
export type {
  CascadesConfig,
  CascadeSimulationParams,
  WavesConfig,
} from "./types";
export { deriveCascadeScale } from "./types";

// Timing / loop-period constants shared between WaterSystem and wave shaders.
export { WAVE_TIME_PERIOD_SECONDS, WAVE_TIME_OMEGA_STEP } from "./timing";

// Factory functions
export {
  createWaveSimulation,
  createWaveSampler,
  type CreateWaveSimulationOptions,
} from "./createWaveSimulation";

// WebGPU implementation
export { WebGPUWaveSimulation, WebGPUWaveSampler } from "./webgpu";

// WebGL implementation
export { WebGLWaveSimulation, WebGLWaveSampler } from "./webgl";

// Legacy exports for backward compatibility
export { WebGPUWaveSimulation as WaveSimulation } from "./webgpu";
export { WebGPUWaveSampler as WaveSampler } from "./webgpu";

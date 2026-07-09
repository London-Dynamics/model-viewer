/**
 * Factory functions for creating wave simulation and sampler instances.
 * Automatically detects the rendering backend and creates the appropriate implementation.
 */
import type * as THREE from "three/webgpu";
import type { IWaveSimulation } from "./IWaveSimulation";
import type { IWaveSampler } from "./IWaveSampler";
import type { CascadesConfig } from "./types";
import type { QualityLevelConfig } from "../../config/QualityLevels";
import type { WaveUniforms } from "../../uniforms";
import type { TSLUniformNode } from "../../types/tsl";
export interface CreateWaveSimulationOptions {
    cascades: CascadesConfig;
    /** TSL uniform node for wind bias (from WaveFoam._windBiasNode). */
    foamWindBias: TSLUniformNode;
    forceBackend?: "webgpu" | "webgl";
    qualityConfig: QualityLevelConfig;
    /** Phillips spectrum seed. Defaults to 1; clients should set this for multiplayer sync. */
    seed: number;
    waveUniforms: WaveUniforms;
}
/**
 * Create a wave simulation instance based on renderer capabilities.
 *
 * @param renderer - The Three.js WebGPU renderer
 * @param options - Wave simulation options
 * @returns An IWaveSimulation instance (either WebGPU or WebGL implementation)
 */
export declare function createWaveSimulation(renderer: THREE.WebGPURenderer, options: CreateWaveSimulationOptions): IWaveSimulation;
/**
 * Create a wave sampler instance for the given simulation.
 *
 * @param simulation - The wave simulation to sample from
 * @param renderer - The Three.js WebGPU renderer
 * @returns An IWaveSampler instance matching the simulation backend
 */
export declare function createWaveSampler(simulation: IWaveSimulation, renderer: THREE.WebGPURenderer): IWaveSampler;
//# sourceMappingURL=createWaveSimulation.d.ts.map
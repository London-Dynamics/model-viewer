import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { TSLBuffer } from "../../../types/tsl";
import type { IWaveSimulation, InternalGerstnerParams, WaveCapabilities, WaveDisplacementNodes, WaveNormalNodes } from "../IWaveSimulation";
import type { CascadeConfig, CascadesConfig } from "../types";
import type { QualityLevelConfig } from "../../../config/QualityLevels";
import { type WaveUniforms } from "../../../uniforms";
import type { TSLUniformNode } from "../../../types/tsl";
export interface WebGPUWaveSimulationOptions {
    cascades: CascadesConfig;
    /** TSL uniform node for wind bias (from WaveFoam._windBiasNode). */
    foamWindBias: TSLUniformNode;
    qualityConfig: QualityLevelConfig;
    /** Phillips spectrum seed. Cascade `i` uses `seed + i` for decorrelation. */
    seed: number;
    waveUniforms: WaveUniforms;
}
/**
 * WebGPU wave simulation using FFT-based ocean modeling.
 * Provides high-quality, physically-based wave simulation with multiple cascades.
 */
export declare class WebGPUWaveSimulation implements IWaveSimulation {
    private cascades;
    private renderer;
    private time;
    private _explicitTimeThisFrame;
    private _seed;
    private _gerstnerMaxWaves;
    private _animationSpeed;
    private _waveUniforms;
    private _foamWindBias;
    private _gerstnerWaveBuffer;
    private _gerstnerWaveCount;
    constructor(renderer: THREE.WebGPURenderer, options: WebGPUWaveSimulationOptions);
    /**
     * Override the simulation's time accumulator with an absolute time.
     * Used by `WaterSystem.syncToTick` for multiplayer sync. The next
     * `update()` call drives the GPU using the new time without further
     * internal accumulation.
     */
    setTime(t: number): void;
    get animationSpeed(): number;
    set animationSpeed(value: number);
    /**
     * Update Gerstner wave parameters using auto-distribution.
     * Generates N wave descriptors from center wavelength, spread, direction, etc.
     * Arbitrary wavelengths and directions are supported since Gerstner waves are
     * evaluated analytically in the vertex shader (not on the FFT grid).
     */
    updateGerstnerParams(params: InternalGerstnerParams): void;
    getCapabilities(): WaveCapabilities;
    getDisplacementNodes(): WaveDisplacementNodes;
    getNormalNodes(): WaveNormalNodes;
    /**
     * Helper function for bilinear buffer sampling in TSL.
     */
    private sampleBufferBilinear;
    private initCascades;
    private createCascade;
    private createComputeShadersForCascade;
    init(): void;
    update(deltaTime?: number): Promise<void>;
    private queueCascadeUpdate;
    private getIFFT2DShaders;
    private queueIFFT2DForCascadeAsync;
    updateCascadeConfig(index: number, config: CascadeConfig): void;
    getCascadeCount(): number;
    getDisplacementBuffer(cascadeIndex?: number): TSLBuffer | null;
    getNormalBuffer(cascadeIndex?: number): TSLBuffer | null;
    /**
     * Per-texel surface velocity (m/s) for a cascade, computed as
     * `(currentDisplacement - previousDisplacement) / deltaTime`. Same layout
     * as the displacement buffer; `.xyz` is the velocity vector, `.w` unused.
     */
    getVelocityBuffer(cascadeIndex?: number): TSLBuffer | null;
    getNormalTexture(cascadeIndex?: number): THREE.Texture | null;
    getResolution(cascadeIndex?: number): number;
    getScale(cascadeIndex?: number): number;
    getCascadeScales(): number[];
    getCascadeResolutions(): number[];
    getGerstnerWaveBuffer(): Node | null;
    getGerstnerMaxWaves(): number;
    getGerstnerWaveCountUniform(): Node | null;
    getTimeUniform(): Node | null;
    /**
     * Get Gerstner wave state for CPU-side evaluation.
     * Returns the wave buffer array, active wave count, blend factor, and current time.
     */
    getGerstnerCPUState(): {
        waveData: THREE.Vector4[] | null;
        waveCount: number;
        time: number;
    };
    initializeBuffers(renderer: THREE.WebGPURenderer): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=WebGPUWaveSimulation.d.ts.map
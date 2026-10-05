import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { TSLBuffer } from "../../../types/tsl";
import type { IWaveSimulation, WaveCapabilities, WaveDisplacementNodes, WaveNormalNodes } from "../IWaveSimulation";
import type { CascadesConfig } from "../types";
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
    /** Persistent array identities let Three reuse both A/B compute-group states. */
    private computeGlobalUpdateGroup;
    private computeGlobalInitializeAndUpdateGroup;
    private computeSharedUpdateGroup;
    private computeSharedInitializeAndUpdateGroup;
    private renderer;
    private time;
    private _explicitTimeThisFrame;
    private _seed;
    private _animationSpeed;
    private sharedMemoryFFTEnabled;
    private _waveUniforms;
    private _foamWindBias;
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
    /** Whether at least one active cascade fits the device's workgroup limits. */
    private get sharedMemoryFFTSupported();
    getCapabilities(): WaveCapabilities;
    getDisplacementNodes(): WaveDisplacementNodes;
    getNormalNodes(): WaveNormalNodes;
    /**
     * Helper function for bilinear buffer sampling in TSL.
     */
    private sampleBufferBilinear;
    private initCascades;
    private createCascade;
    /**
     * Read the initialized WebGPU device limits exposed by Three's backend.
     * Missing/non-WebGPU backend state conservatively selects the global FFT.
     */
    private getComputeLimits;
    /**
     * A complete line uses R/2 pair owners and R × 24 bytes of shared storage.
     * The current global-memory implementation remains the correctness fallback.
     */
    private canUseSharedMemoryFFT;
    private createComputeShadersForCascade;
    init(): void;
    update(deltaTime?: number): Promise<void>;
    /**
     * Encode every cascade's ordered update in one WebGPU compute pass and queue
     * submission. Dispatch boundaries still order all storage-buffer hazards:
     * init → time evolution → horizontal FFT → vertical FFT → normalize →
     * normals.
     */
    private dispatchCascadeUpdates;
    setMaxScale(maxScale: number): void;
    getCascadeCount(): number;
    getDisplacementBuffer(cascadeIndex?: number): TSLBuffer | null;
    getNormalTexture(cascadeIndex?: number): THREE.Texture | null;
    getResolution(cascadeIndex?: number): number;
    getScale(cascadeIndex?: number): number;
    /**
     * Get a cascade's world-space scale uniform node (the single source of truth
     * synced on cascade-config changes). The world-fixed foam field binds to it so
     * its world→texel sampling of the cascade normal texture tracks the live scale.
     */
    getScaleNode(cascadeIndex?: number): Node | null;
    getCascadeScales(): number[];
    getCascadeResolutions(): number[];
    initializeBuffers(renderer: THREE.WebGPURenderer): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=WebGPUWaveSimulation.d.ts.map
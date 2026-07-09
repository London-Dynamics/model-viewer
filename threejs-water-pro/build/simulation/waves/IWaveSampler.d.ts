/**
 * Interface for wave sampling implementations.
 * Supports both WebGPU (GPU compute) and WebGL (CPU) backends.
 */
import type * as THREE from "three/webgpu";
/**
 * Maximum number of positions that can be sampled simultaneously.
 * This determines the size of GPU buffers and CPU arrays.
 */
export declare const MAX_SAMPLE_POINTS = 128;
/**
 * Result of sampling the water surface at a given position.
 */
export interface WaveSample {
    /** Water height (Y displacement) at the sampled position */
    height: number;
    /** Surface normal at the sampled position (normalized) */
    normal: THREE.Vector3;
}
/**
 * Interface for wave sampling implementations.
 * Both WebGPU (GPU compute) and WebGL (CPU) must implement this.
 */
export interface IWaveSampler {
    /**
     * Set the positions to sample.
     * @param positions Array of world positions (Vector2 for XZ, or Vector3 where Y is ignored)
     */
    setPositions(positions: THREE.Vector2[] | THREE.Vector3[]): void;
    /**
     * Execute sampling and wait for results.
     * WebGPU: Dispatches compute shader and reads back results.
     * WebGL: Evaluates noise on CPU.
     *
     * Use for one-off queries where the caller needs fresh data immediately
     * (e.g. `WaterSystem.getHeightAt`). Per-frame consumers should prefer
     * {@link updateLowLatency} to avoid the GPU sync stall.
     */
    update(): Promise<void>;
    /**
     * Per-frame sampling with one frame of latency on WebGPU. The previous
     * call's readback is drained at the start of this call (no stall — by
     * then the GPU has finished the queued work), then a new dispatch is
     * issued and its readback kicked off without awaiting.
     *
     * `getSample()` after this call returns the result of the *previous*
     * call's positions. Imperceptible at 60 fps, and removes the GPU sync
     * stall that `update()` incurs.
     *
     * On WebGL this is identical to {@link update}.
     */
    updateLowLatency(): Promise<void>;
    /**
     * Get the sampled water data at a specific index.
     * @param index The index of the sample (corresponds to position array order)
     * @returns The water sample (height and normal)
     */
    getSample(index: number): WaveSample;
    /**
     * Get all cached samples.
     * @returns Array of water samples (only includes active samples)
     */
    getSamples(): WaveSample[];
    /**
     * Get the current number of sample positions.
     */
    getSampleCount(): number;
    /**
     * Update cascade uniforms from ocean simulation.
     * Call this when ocean simulation cascades change.
     */
    updateCascadeUniforms(): void;
    /**
     * Dispose of resources.
     */
    dispose(): void;
}
//# sourceMappingURL=IWaveSampler.d.ts.map
/**
 * WebGPU-based wave sampler using GPU compute shaders.
 */
import * as THREE from "three/webgpu";
import type { IWaveSampler, WaveSample } from "../IWaveSampler";
import type { WebGPUWaveSimulation } from "./WebGPUWaveSimulation";
export { MAX_SAMPLE_POINTS } from "../IWaveSampler";
/**
 * WebGPU wave sampler using GPU compute shaders.
 * Samples water height and surface normals at arbitrary world positions.
 *
 * FFT cascade displacement/normals are evaluated on the GPU in the compute
 * shader, including the inverse position solve for horizontal displacement
 * correction.
 */
export declare class WebGPUWaveSampler implements IWaveSampler {
    private renderer;
    private oceanSim;
    private positionBuffer;
    private positionBufferNode;
    private outputBuffer;
    private outputBufferNode;
    private sampleCountUniform;
    private cascadeUniforms;
    private computeNode;
    private cachedResults;
    private currentSampleCount;
    private pendingReadback;
    private pendingSampleCount;
    private static readonly MAX_POINTS;
    constructor(oceanSim: WebGPUWaveSimulation, renderer: THREE.WebGPURenderer);
    updateCascadeUniforms(): void;
    private createComputeShader;
    setPositions(positions: THREE.Vector2[] | THREE.Vector3[]): void;
    /**
     * Synchronous sample: dispatches compute and waits for GPU→CPU readback
     * before resolving. Use for one-off queries (e.g. `WaterSystem.getHeightAt`)
     * where the caller needs the result immediately. Per-frame consumers
     * should prefer {@link updateLowLatency}.
     */
    update(): Promise<void>;
    /**
     * Frame-late sample: at the start of each call, drain the readback
     * dispatched by the *previous* call (typically resolves instantly), then
     * dispatch this frame's compute and kick off a new readback without
     * awaiting it. `getSample()` therefore returns frame N-1's data when
     * called after frame N's `updateLowLatency()`.
     *
     * Use from per-frame consumers like the buoyancy system. The one-frame
     * lag is imperceptible at 60 fps and removes the per-frame GPU sync
     * stall (~2 ms on Apple Silicon WebGPU) that the synchronous path
     * incurs.
     */
    updateLowLatency(): Promise<void>;
    private applyReadback;
    getSample(index: number): WaveSample;
    getSamples(): WaveSample[];
    getSampleCount(): number;
    dispose(): void;
}
//# sourceMappingURL=WebGPUWaveSampler.d.ts.map
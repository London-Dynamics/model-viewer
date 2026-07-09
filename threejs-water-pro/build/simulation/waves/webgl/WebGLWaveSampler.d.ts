/**
 * WebGL wave sampler using CPU readback from FFT displacement textures.
 */
import * as THREE from "three/webgpu";
import type { IWaveSampler, WaveSample } from "../IWaveSampler";
import { MAX_SAMPLE_POINTS } from "../IWaveSampler";
import type { WebGLWaveSimulation } from "./WebGLWaveSimulation";
export { MAX_SAMPLE_POINTS };
/**
 * WebGL wave sampler using CPU readback from displacement textures.
 * For WebGL FFT simulation, we read displacement values from the render targets.
 */
export declare class WebGLWaveSampler implements IWaveSampler {
    private simulation;
    private renderer;
    private positions;
    private currentSampleCount;
    private cachedResults;
    private displacementReadBuffer;
    private normalReadBuffer;
    private lastReadResolution;
    private _disposed;
    private readonly _t00;
    private readonly _t10;
    private readonly _t01;
    private readonly _t11;
    private readonly _tRow0;
    private readonly _tRow1;
    constructor(simulation: WebGLWaveSimulation, renderer: THREE.WebGPURenderer);
    setPositions(positions: THREE.Vector2[] | THREE.Vector3[]): void;
    /**
     * Evaluate Gerstner wave displacement and analytical normal on CPU.
     */
    private evaluateGerstnerCPU;
    /**
     * Sample displacement from the texture at the given world position.
     */
    private sampleDisplacement;
    /**
     * Sample normal from the texture at the given world position.
     */
    private sampleNormal;
    updateLowLatency(): Promise<void>;
    update(): Promise<void>;
    getSample(index: number): WaveSample;
    getSamples(): WaveSample[];
    getSampleCount(): number;
    updateCascadeUniforms(): void;
    dispose(): void;
}
//# sourceMappingURL=WebGLWaveSampler.d.ts.map
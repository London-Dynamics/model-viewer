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
    private cascadeReads;
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
     * Compute bilinear texel indices and weights for a world position, matching
     * the hardware linear-filtered texture sampling the surface uses.
     *
     * Texel `i` is centered at `(i + 0.5)`, so the lookup is shifted half a texel
     * before flooring. Without that shift the CPU samples half a texel — `scale /
     * (2 * resolution)` world units — off from the rendered surface, which reads as
     * a height offset that grows with wave steepness.
     */
    private texelLerp;
    /**
     * Sample a cascade's displacement at a world position. Returns a reused temp
     * vector — read its components before the next sample call.
     */
    private sampleCascadeDisplacement;
    /**
     * Sample a cascade's surface normal at a world position. Decodes `[0,1]` to
     * `[-1,1]` but does not normalize — cascades are RNM-blended then normalized
     * once by the caller, matching the surface shader. Returns a reused temp.
     */
    private sampleCascadeNormal;
    /**
     * Read back each cascade's displacement and normal textures into CPU buffers,
     * (re)allocating per-cascade buffers when a cascade's resolution changes.
     */
    private readCascades;
    /**
     * Store a readback result into a cascade buffer. The renderer normally hands
     * back a `Float32Array` we can keep directly; otherwise copy into the existing
     * buffer.
     */
    private storeReadback;
    updateLowLatency(): Promise<void>;
    update(): Promise<void>;
    getSample(index: number): WaveSample;
    getSamples(): WaveSample[];
    getSampleCount(): number;
    updateCascadeUniforms(): void;
    dispose(): void;
}
//# sourceMappingURL=WebGLWaveSampler.d.ts.map
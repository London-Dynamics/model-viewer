/**
 * Persistent wave-crest foam accumulation system.
 *
 * Maintains per-cascade ping-pong storage buffers of turbulent-energy
 * values. Each frame runs two compute passes per cascade:
 *
 *   1. **Decay** — `E_next = E_prev * exp(-dt / τ)`
 *   2. **Inject** — `E_next += injectionRate * max(0, threshold - eigen) * dt`
 *
 * The surface material shader samples the current read buffers via
 * {@link CascadeSampler.sampleFoamAccumulation}. This is the War Thunder /
 * Sea of Thieves persistent-foam pattern: foam lingers for seconds after a
 * breaking event, producing visible streaks and decay tails instead of a
 * flat stateless mask.
 */
import * as THREE from "three/webgpu";
import { WebGPUWaveSimulation } from "../waves/webgpu/WebGPUWaveSimulation";
import type { IWaveSimulation } from "../waves";
import type { StorageBufferNode } from "../../shaders/types";
import type { WaveUniforms } from "../../uniforms";
/** Preset-facing parameters for {@link FoamAccumulation}. */
export interface FoamAccumulationParams {
    /**
     * Crest-driven foam strength. Equilibrium energy at a sustained sharp
     * fold; gentle folding is suppressed by the built-in smoothstep gate.
     */
    crestStrength: number;
    /** Exponential decay e-folding time (seconds). */
    decayTime: number;
    /**
     * Windward-face foam strength. Equilibrium energy on a fully wind-facing
     * pixel, regardless of folding. Drives foam onto the rising face of
     * waves; the persistent buffer carries it through the crest and beyond.
     */
    windwardStrength: number;
}
/**
 * Per-cascade persistent foam energy buffers.
 *
 * Owns its storage buffers and uniform nodes. External code reads/writes
 * parameters through getters/setters; the compute passes bind to the
 * private uniform nodes at construction time.
 */
export declare class FoamAccumulation {
    private _renderer;
    private _oceanSim;
    private _waveUniforms;
    private _uniforms;
    private _cascades;
    constructor(renderer: THREE.WebGPURenderer, oceanSim: WebGPUWaveSimulation, waveUniforms: WaveUniforms);
    /**
     * Construct only when the backend supports persistent storage buffers
     * AND the active quality level opts in. Returns `null` on WebGL or on
     * quality tiers where the buffer is disabled. Centralises the
     * three-fold guard so callers do not duplicate the instanceof /
     * capability / quality-feature triplet.
     */
    static tryCreate(renderer: THREE.WebGPURenderer, oceanSim: IWaveSimulation, waveUniforms: WaveUniforms, persistentFoamFeatureEnabled: boolean): FoamAccumulation | null;
    private _buildCascade;
    /**
     * Get the storage node of the cascade's current read buffer — the buffer
     * holding the latest (post-update) foam energy. Returns null if the
     * cascade index is out of range.
     */
    getFoamBuffer(cascadeIndex: number): StorageBufferNode | null;
    /**
     * Whether persistent foam is enabled. Disabling zeros the accumulation
     * buffers so previously-deposited energy does not reappear on re-enable,
     * and skips all compute dispatches while off.
     */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Exponential decay e-folding time (seconds). */
    get decayTime(): number;
    set decayTime(value: number);
    /**
     * Crest-driven foam strength. Equilibrium energy at a sustained sharp
     * fold equals this value; gentle surface folding is suppressed by the
     * breaking-rate curve baked into the inject pass.
     */
    get crestStrength(): number;
    set crestStrength(value: number);
    /**
     * Windward-face foam strength. Equilibrium energy on a fully wind-facing
     * pixel, regardless of folding.
     */
    get windwardStrength(): number;
    set windwardStrength(value: number);
    /**
     * @internal Bulk-set parameters from a preset or params object.
     * `enabled` is owned by {@link WaterSystem} (driven by the quality-level
     * `persistentFoamBuffer` flag) — it's intentionally not in the params.
     */
    update(params: FoamAccumulationParams): void;
    /**
     * Dispatch decay + inject for every cascade. No-op when disabled.
     *
     * @param deltaTime - Seconds since the previous frame.
     */
    tick(deltaTime: number): Promise<void>;
    /**
     * Zero both ping-pong buffers for every cascade and mark them dirty so
     * the GPU picks up the cleared data on the next compute or sample.
     * Called when persistence is toggled off to avoid leaving frozen energy
     * in the accumulation buffers.
     */
    private _clearBuffers;
    /** Dispose GPU resources. */
    dispose(): void;
}
//# sourceMappingURL=FoamAccumulation.d.ts.map
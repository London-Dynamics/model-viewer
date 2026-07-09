/**
 * Gerstner wave system for large-scale swells.
 *
 * This class owns the Gerstner wave parameters. External code reads/writes
 * parameters through getters and setters. The TSL shader function
 * {@link computeGerstner} reads from a wave buffer populated by the simulation.
 *
 * The class also provides {@link getInternalParams} which computes derived
 * values (steepness, direction, scaled amplitude) from WaveUniforms for
 * populating the simulation's wave buffer.
 */
import type { Node } from "three/webgpu";
import type { TSLUniformNode } from "../types/tsl";
import type { WaveUniforms } from "../uniforms";
/** Preset-facing parameters for Gerstner waves. */
export interface GerstnerParams {
    /** Base amplitude in world units. */
    amplitude: number;
    /** Angular spread of wave directions in radians. */
    directionalSpread: number;
    /** Base wavelength in world units. Waves distribute geometrically around this. */
    wavelength: number;
    /** Geometric ratio between consecutive wave wavelengths (1 = identical, 2 = doubling). */
    wavelengthSpread: number;
}
/** Internal parameters including derived values (used by simulation buffer population). */
export interface InternalGerstnerParams extends GerstnerParams {
    /** Wave steepness (derived from choppiness). */
    steepness: number;
    /** Wave direction in radians (derived from wind direction). */
    direction: number;
}
/** Parameters for {@link computeGerstner}. */
export interface ComputeGerstnerParams {
    worldX: Node;
    worldZ: Node;
    time: TSLUniformNode;
    /** Wave buffer: uniformArray or instancedArray — both support .element(i) */
    waveBuffer: Node;
    waveCount: TSLUniformNode;
    maxWaves: number;
}
/** Result from {@link computeGerstner}. */
export interface GerstnerResult {
    displacement: Node;
    normal: Node;
    /** Analytical time derivative of displacement (m/s). */
    velocity: Node;
    /** Approximate Jacobian folding: sum(Q*k*A*cos(phase)). Subtract from FFT eigenvalue. */
    folding: Node;
}
/**
 * Gerstner wave parameter manager.
 *
 * Owns the base Gerstner parameters and computes derived values from WaveUniforms.
 * When parameters change via setters, the onUpdate callback is invoked to trigger
 * simulation buffer population.
 */
export declare class Gerstner {
    private _amplitude;
    private _directionalSpread;
    private _wavelength;
    private _wavelengthSpread;
    private waveUniforms;
    private onUpdate;
    /**
     * Creates a Gerstner parameter manager.
     *
     * @param waveUniforms - Reference to wave uniforms for computing derived values.
     * @param onUpdate - Callback invoked when any parameter changes.
     */
    constructor(waveUniforms: WaveUniforms, onUpdate: () => void);
    /** Base amplitude in world units. */
    get amplitude(): number;
    set amplitude(value: number);
    /** Angular spread of wave directions in radians. */
    get directionalSpread(): number;
    set directionalSpread(value: number);
    /** Base wavelength in world units. */
    get wavelength(): number;
    set wavelength(value: number);
    /** Geometric ratio between consecutive wave wavelengths. */
    get wavelengthSpread(): number;
    set wavelengthSpread(value: number);
    /** Bulk-set parameters from a preset or params object. */
    update(params: GerstnerParams): void;
    /**
     * Computes internal parameters including derived values from WaveUniforms.
     * Used by the simulation to populate the Gerstner wave buffer.
     */
    getInternalParams(): InternalGerstnerParams;
    /**
     * Triggers an update without changing parameters.
     * Call this when WaveUniforms change to recompute derived values.
     */
    triggerUpdate(): void;
}
/**
 * Computes Gerstner wave displacement and analytical normal.
 *
 * Displacement:
 *   dx = -Q * A * dirX * sin(phase)
 *   dy =  A * cos(phase)
 *   dz = -Q * A * dirZ * sin(phase)
 *
 * Normal (analytical derivative, for cos-height convention):
 *   nx =  dirX * k * A * sin(phase)
 *   ny =  1 - Q * k * A * cos(phase)
 *   nz =  dirZ * k * A * sin(phase)
 *
 * Uses a compile-time static loop (GPU requires fixed bounds).
 * Returns {displacement, normal, folding}.
 */
export declare function computeGerstner({ worldX, worldZ, time, waveBuffer, waveCount, maxWaves, }: ComputeGerstnerParams): GerstnerResult;
//# sourceMappingURL=gerstner.d.ts.map
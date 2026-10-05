import type * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { IWakeFieldSampler } from "./IWakeFieldSampler";
/** Construction parameters for {@link IWakeSimulation}. */
export interface WakeSimulationParams {
    /** Height-field resolution in texels per side. */
    resolution: number;
    /** Height-field extent in world units per side. */
    worldSize: number;
    /**
     * Shared gravity uniform node (from `WaveUniforms.gravity`). Bound directly —
     * not copied — so the wake dispersion `ω²=g·k` tracks the ocean's gravity.
     */
    gravity: Node;
    /** Velocity-damping friction `γ` (≥ 0). Required for stability; sets trail length. */
    gamma: number;
    /** Maximum number of simultaneous injection generators. */
    maxGenerators: number;
}
/** Arguments for {@link IWakeSimulation.injectAlongPath}. */
export interface InjectAlongPathParams {
    /** Path start in world space (Y ignored). */
    from: THREE.Vector3;
    /** Path end in world space (Y ignored). */
    to: THREE.Vector3;
    /** Falloff radius of the disturbance around the swept path, in metres. */
    radius: number;
    /** Object's speed in m/s (length(to − from) / dt). Gates injection and sets foam intensity. */
    speed: number;
    /** How deep (metres, positive) the hull sits in the water; sets the wake amplitude. */
    depth: number;
}
/**
 * Backend-agnostic interface for the dispersive wake displacement-field
 * simulator (Tessendorf's iWave).
 *
 * The field is a height grid advanced by a `√(−∇²)` convolution + explicit
 * leapfrog, giving deep-water dispersion (long waves outrun short → Kelvin
 * wake). Generators add a moving source each frame; the operator radiates and
 * fades it.
 *
 * Implementations:
 *   - {@link WebGPUWakeSimulation} — storage buffers; the update runs as a
 *     compute kernel.
 *   - {@link WebGLWakeSimulation} — float render targets; the same update runs
 *     as render-to-texture fragment passes.
 */
export interface IWakeSimulation {
    /** Free GPU and CPU resources owned by the simulator. */
    dispose(): void;
    /** Sampler the surface material reads for height, foam, and normal. */
    getSampler(): IWakeFieldSampler;
    /** Add a moving source along the segment `from → to` this frame. */
    injectAlongPath(params: InjectAlongPathParams): void;
    /** Zero the field, put the solver to sleep, and re-anchor on the next step. */
    reset(): void;
    /** Set the velocity-damping friction `γ`. */
    setFriction(value: number): void;
    /** Set the persistent foam-energy decay per frame (0..1; closer to 1 = longer trail). */
    setFoamPersistence(value: number): void;
    /** Set the foam injection rate (hull track + breaking crests). */
    setFoamStrength(value: number): void;
    /** Set the surface-derivative magnitude at which crest foam begins to break. */
    setFoamBreakThreshold(value: number): void;
    /** Set the field extent in world units per side. Re-derives `Δ` and clears the field. */
    setWorldSize(value: number): void;
    /**
     * Per-frame update. Call once after any injection for this frame. Advances the
     * field one leapfrog step (camera-shift folded in) and writes the displacement
     * buffer the sampler reads. Implementations may skip solver work while a
     * reset field remains asleep with no injection.
     *
     * @param dt - Time since last frame in seconds (clamped internally for stability).
     * @param originX - Camera-anchored buffer centre X in world units.
     * @param originZ - Camera-anchored buffer centre Z in world units.
     */
    step(dt: number, originX: number, originZ: number): Promise<void>;
}
//# sourceMappingURL=IWakeSimulation.d.ts.map
/**
 * Uniform nodes for the persistent foam accumulation system.
 *
 * Owned by {@link FoamAccumulation} — a single source of truth shared
 * between the decay and inject compute passes. The surface material shader
 * binds to the same nodes when sampling the foam energy buffer.
 */
/** Shared uniform nodes for the persistent foam accumulation passes. */
export declare function createFoamAccumulationUniforms(): {
    /**
     * Runtime enable flag. When 0, the accumulation buffers are frozen
     * (and zeroed), so the surface shader reads zero energy and no wave
     * foam is drawn on the WebGPU path.
     */
    enabled: import("three/webgpu").UniformNode<number>;
    /**
     * Exponential decay e-folding time (seconds). CPU setter clamps to a
     * minimum of 0.05 to avoid per-frame spike/collapse flicker; the
     * `.max(0.0001)` guards in the shaders are pure divide-by-zero
     * backstops and can never be reached through the setter.
     */
    decayTime: import("three/webgpu").UniformNode<number>;
    /** Per-frame delta-time (seconds). CPU-updated each tick. */
    deltaTime: import("three/webgpu").UniformNode<number>;
    /**
     * Crest-driven foam strength. Equilibrium energy at a sustained sharp
     * fold equals this value; gentle folding is suppressed by the
     * smoothstep gate baked into the inject pass.
     */
    crestStrength: import("three/webgpu").UniformNode<number>;
    /**
     * Windward-face foam strength. Equilibrium energy on a pixel whose
     * surface normal points fully into the wind, regardless of folding.
     * Lets foam fill in on the rising face before breaking; the persistent
     * buffer carries it past the crest into the leeward trail.
     */
    windwardStrength: import("three/webgpu").UniformNode<number>;
};
/** Concrete uniform-node type for the foam accumulation system. */
export type FoamAccumulationUniforms = ReturnType<typeof createFoamAccumulationUniforms>;
//# sourceMappingURL=uniforms.d.ts.map
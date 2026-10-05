import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type { StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
/** Everything the emission compute needs, bound once at build time. */
export interface EmissionComputeBindings {
    /**
     * Particle pool storage (4 × vec4 per particle):
     *   slot0 = `(posX, posY, posZ, lifeRemaining)`
     *   slot1 = `(sizeScale, heightScale, variantIdx, birthLife)`
     *   slot2 = `(size, stretchX, stretchY, opacity)`           ← baked at spawn
     *   slot3 = `(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)` ← baked at spawn
     */
    particleBuffer: StorageBufferNode;
    /**
     * Per-emitter probe buffer (vec4 × PROBE_VEC4_PER_POINT per probe).
     * Each probe carries its authored position, runtime cooldown state,
     * the pending-burst slot, and the resolved per-probe params block at
     * vec4[3..6] (see `EmitterRegistry` for the full layout).
     */
    probeBuffer: StorageBufferNode;
    /**
     * Per-emitter state buffer (vec4 × 5 per emitter). The emission shader
     * only reads the world matrix (rows 0..2) and the active flag (slot 4
     * `.w`); the linear/angular velocity slots are populated by the registry
     * for the CPU debug visualizer and not read here.
     */
    stateBuffer: StorageBufferNode;
    /** Shared cascade sampler (single source of truth for scale/resolution uniforms). */
    cascadeSampler: CascadeSampler;
    /** Displacement buffers, one per cascade, coarsest first. */
    displacementBuffers: StorageBufferNode[];
    /** Mean water surface Y (world). */
    meanY: UniformFloatNode;
    /** Wall-clock simulation time in seconds (CPU-accumulated). */
    time: UniformFloatNode;
    /** Frame delta time (s), clamped on the CPU side. */
    deltaTime: UniformFloatNode;
    /** Compile-time constants. */
    maxEmitters: number;
    maxProbesPerEmitter: number;
    /** Number of independent atlas variants in the spray array texture. */
    variantCount: number;
}
/**
 * Build the spray emission compute node.
 */
export declare function createEmissionCompute(bindings: EmissionComputeBindings): any;
//# sourceMappingURL=emission.d.ts.map
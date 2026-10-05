import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type { StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
/** Everything the simulation compute needs. */
export interface SimulateComputeBindings {
    /**
     * Particle pool storage (4 × vec4 per particle):
     *   slot0 = `(posX, posY, posZ, lifeRemaining)`
     *   slot1 = `(sizeScale, heightScale, variantIdx, birthLife)`
     *   slot2 = `(size, stretchX, stretchY, opacity)`               ← spawn-baked
     *   slot3 = `(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)` ← spawn-baked
     *
     * Slots 1–3 must persist across re-anchor — only `pos.y` and life change.
     */
    particleBuffer: StorageBufferNode;
    /** Total pool size (compile-time constant). */
    maxCount: number;
    /** Shared cascade sampler (single source of truth for scale/resolution uniforms). */
    cascadeSampler: CascadeSampler;
    /** Displacement buffers, one per cascade, coarsest first. */
    displacementBuffers: StorageBufferNode[];
    /** Per-frame delta time in seconds (CPU-updated uniform). */
    deltaTime: UniformFloatNode;
    /** Mean water surface Y. */
    meanY: UniformFloatNode;
}
/**
 * Build the spray simulation compute node.
 *
 * `lifeRemaining` is stored in absolute seconds. When it drops to `<= 0`
 * the particle is killed by zeroing all four slots.
 */
export declare function createSimulateCompute(bindings: SimulateComputeBindings): any;
//# sourceMappingURL=simulate.d.ts.map
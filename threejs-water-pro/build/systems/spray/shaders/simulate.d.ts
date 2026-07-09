/**
 * Spray simulation compute shader.
 *
 * Runs once per frame across the entire particle pool. For each slot:
 *   - If the particle is dead, do nothing.
 *   - Otherwise: re-anchor `pos.y` to the displaced water surface at the
 *     particle's XZ (offset down by the per-particle `submersionDepth`
 *     baked at spawn), decrement life, and kill the slot the moment life
 *     reaches zero. Bursts always run to completion — there is no
 *     early-out kill path.
 *
 * Re-anchoring keeps the billboard's bottom edge attached to the moving
 * surface — without it, a particle spawned on a wave crest is left floating
 * above the water as the wave passes. The two-pass Newton step is shared
 * with the emission compute via {@link createSurfaceHeightSampler} so the
 * sampled height matches the visible surface at the particle's XZ rather
 * than the height of the surface element that originated there.
 *
 * XZ stays at the spawn point — the plume rides the wave vertically without
 * drifting horizontally.
 */
import { type SprayGerstnerBindings } from "./surfaceSample";
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
    /** Cascade-0 displacement buffer. */
    displacementBuffer0: StorageBufferNode;
    /** Cascade-1 displacement buffer (optional). */
    displacementBuffer1?: StorageBufferNode;
    /** Gerstner wave bindings, or null if Gerstner is disabled. */
    gerstner: SprayGerstnerBindings | null;
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
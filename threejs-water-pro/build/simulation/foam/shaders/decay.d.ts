/**
 * Foam accumulation — decay pass.
 *
 * Per-texel exponential decay: `E_next = E_prev · exp(−dt / τ)`. No neighbour
 * reads, no spatial blur — purely temporal. The inject pass runs immediately
 * after over the same buffer to add the current frame's breaking energy.
 *
 * Buffer layout: `vec2` per texel — `.x` = energy, `.y` = age (reserved).
 */
import type { StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
import type { TSLComputeShader } from "../../../types/tsl";
/** Bindings for the foam decay compute pass. */
export interface FoamDecayBindings {
    /** Previous-frame foam buffer. Read in this pass. */
    bufferIn: StorageBufferNode;
    /** Next-frame foam buffer. Written in this pass. */
    bufferOut: StorageBufferNode;
    /** Exponential decay e-folding time (seconds). */
    decayTime: UniformFloatNode;
    /** Per-frame delta-time (seconds). */
    deltaTime: UniformFloatNode;
    /** Cascade resolution (compile-time constant). Total dispatch = resolution². */
    resolution: number;
}
/**
 * Build the decay compute node for one cascade.
 */
export declare function createFoamDecayCompute(bindings: FoamDecayBindings): TSLComputeShader;
//# sourceMappingURL=decay.d.ts.map
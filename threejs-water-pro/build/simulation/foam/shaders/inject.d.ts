/**
 * Foam accumulation — inject pass.
 *
 * Two injection sources, both feeding the same persistent buffer:
 *
 *   1. **Crest foam** — `crestStrength · smoothstep(0.15, 0.5, 1 − eigen)`.
 *      Fires on Jacobian folding (apex of breaking crests).
 *   2. **Windward foam** — `windwardStrength · sqrt(max(0, dot(n_xz, wind)))`.
 *      Fires on any pixel whose surface normal tilts into the wind, even
 *      without folding. Fills foam onto the rising face before breaking.
 *
 * Both terms are normalized by `decayTime` so equilibrium energies
 * (crestStrength / windwardStrength) are decoupled from how long the
 * foam persists. The resulting buffer is a smooth scalar field; the
 * surface shader runs the dissolve test against the foam texture at
 * shading time, so the visible foam picks up its irregular outline
 * there.
 *
 * Must run AFTER the decay pass over the same `bufferOut`.
 */
import type { StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
import type { TSLComputeShader } from "../../../types/tsl";
/** Bindings for the foam inject compute pass. */
export interface FoamInjectBindings {
    /**
     * Target foam buffer (the same "next" buffer the decay pass wrote to).
     * Read-modify-write per texel.
     */
    bufferOut: StorageBufferNode;
    /**
     * Cascade normal buffer. `.xyz` packs the surface normal in [0, 1] range,
     * `.w` holds the directional eigenvalue.
     */
    normalBuffer: StorageBufferNode;
    /** Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. */
    crestStrength: UniformFloatNode;
    /**
     * Windward-driven foam strength. Equilibrium energy on a pixel whose
     * normal points fully into the wind, irrespective of folding.
     */
    windwardStrength: UniformFloatNode;
    /** Global wind direction (radians). Bound by reference to `WaveUniforms`. */
    windDirection: UniformFloatNode;
    /** Exponential decay e-folding time (seconds). Used to normalize rate. */
    decayTime: UniformFloatNode;
    /** Per-frame delta-time (seconds). */
    deltaTime: UniformFloatNode;
    /** Cascade resolution (compile-time constant). Total dispatch = resolution². */
    resolution: number;
}
/**
 * Build the inject compute node for one cascade.
 */
export declare function createFoamInjectCompute(bindings: FoamInjectBindings): TSLComputeShader;
//# sourceMappingURL=inject.d.ts.map
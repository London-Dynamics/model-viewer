import type { FoamPersistence } from "../../../shaders/foamPersistence";
/** Shared uniform nodes for the persistent foam accumulation inject pass. */
export declare function createFoamAccumulationUniforms(persistence: FoamPersistence): {
    /** Per-frame delta-time (seconds). CPU-updated each step. */
    deltaTime: import("three/webgpu").UniformNode<number>;
    /** Shared from {@link FoamPersistence} — crest-driven foam strength. */
    crestStrength: import("../../../shaders").UniformFloatNode;
    /** Shared from {@link FoamPersistence} — decay e-folding time (seconds). */
    decayTime: import("../../../shaders").UniformFloatNode;
    /** Shared from {@link FoamPersistence} — windward-face foam strength. */
    windwardStrength: import("../../../shaders").UniformFloatNode;
};
/** Concrete uniform-node type for the foam accumulation inject pass. */
export type FoamAccumulationUniforms = ReturnType<typeof createFoamAccumulationUniforms>;
//# sourceMappingURL=uniforms.d.ts.map
import type { UniformFloatNode } from "./types";
/** Preset-facing parameters for the persistent wave-foam energy field. */
export interface FoamPersistenceParams {
    /**
     * Crest-driven foam strength. Equilibrium energy at a sustained sharp fold;
     * gentle folding is suppressed by the breaking-rate gate in the inject pass.
     */
    crestStrength: number;
    /** Exponential decay e-folding time (seconds). */
    decayTime: number;
    /**
     * Windward-face foam strength. Equilibrium energy on a fully wind-facing
     * pixel. Drives foam onto the rising face of waves; the field carries it past
     * the crest and into the leeward trail.
     */
    windwardStrength: number;
}
/**
 * Owns the persistent wave-foam energy uniforms. External code reads/writes
 * through getters and setters; the foam-field inject pass binds the private
 * uniform nodes via the internal node accessors.
 */
export declare class FoamPersistence {
    private _crestStrength;
    private _decayTime;
    private _windwardStrength;
    /** Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. */
    get crestStrength(): number;
    set crestStrength(value: number);
    /** Exponential decay e-folding time (seconds). Floored at 0.05 s. */
    get decayTime(): number;
    set decayTime(value: number);
    /** Windward-face foam strength. Equilibrium energy on a fully wind-facing pixel. */
    get windwardStrength(): number;
    set windwardStrength(value: number);
    /** @internal Uniform node bound by the foam-inject pass. */
    get crestStrengthNode(): UniformFloatNode;
    /** @internal Uniform node bound by the foam-inject pass. */
    get decayTimeNode(): UniformFloatNode;
    /** @internal Uniform node bound by the foam-inject pass. */
    get windwardStrengthNode(): UniformFloatNode;
    /** Bulk-set parameters from a preset or params object. */
    update(params: FoamPersistenceParams): void;
}
//# sourceMappingURL=foamPersistence.d.ts.map
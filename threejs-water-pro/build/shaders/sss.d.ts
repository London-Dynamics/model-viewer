import type { Node } from "./types";
/** Preset-facing parameters for subsurface scattering. */
export interface SSSParams {
    /** Whether SSS is active. */
    enabled: boolean;
    /** SSS intensity multiplier (0–2). */
    intensity: number;
    /** Forward scattering power falloff (0.05–3). */
    power: number;
}
/** Parameters for {@link SSS.build}. */
export interface SSSBuildParams {
    /** Fragment view direction. */
    viewDir: Node;
    /** Normalized sun direction. */
    sunDir: Node;
    /** Interpolated wave normal. */
    waveNormal: Node;
    /** Base water color to apply SSS to. */
    waterColor: Node;
    /** Distance from camera to fragment. */
    distanceToCamera: Node;
    /** Transmission color for scattered light. */
    transmissionColor: Node;
    /** Sun light intensity. */
    sunIntensity: Node;
    /** Distance at which the SSS distance fade ends. */
    fadeEnd: Node;
}
/**
 * Physics-based subsurface scattering for water.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class SSS {
    private _enabled;
    private _intensity;
    private _power;
    /** Whether SSS is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** SSS intensity multiplier (0–2). */
    get intensity(): number;
    set intensity(value: number);
    /** Forward scattering power falloff (0.05–3). */
    get power(): number;
    set power(value: number);
    /** Bulk-set parameters from a preset or params object. */
    update(params: SSSParams): void;
    /**
     * Builds physics-based subsurface scattering for water.
     *
     * @returns Water color with SSS applied.
     */
    build(params: SSSBuildParams): Node;
}
//# sourceMappingURL=sss.d.ts.map
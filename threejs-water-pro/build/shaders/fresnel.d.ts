import type { FloatNode, Node } from "../types/tsl";
/**
 * Full dielectric Fresnel reflectance for unpolarized light.
 *
 * Symmetric in incident direction: pass a negative `cosThetaI` for rays
 * leaving the denser medium and the function inverts `eta` internally.
 * Returns 1.0 when total internal reflection occurs (equivalently, when
 * `sin²θₜ ≥ 1`).
 *
 * `eta` is the IOR ratio `nₜ / nᵢ` for the front-face direction (e.g. 1.33
 * for air → water). The same value is passed for both sides; the function
 * flips when the cosine is negative.
 *
 * Reference: Pharr et al., *Physically Based Rendering* (4th ed.) §9.5.1.
 */
export declare const fresnelDielectric: import("three/src/nodes/TSL.js").ShaderNodeFn<[import("three/tsl").ProxiedObject<{
    cosThetaI: FloatNode;
    eta: FloatNode;
}>]>;
/** Preset-facing parameters for surface fresnel. */
export interface FresnelParams {
    /**
     * Refractive index of water relative to air. 1.33 is physical seawater.
     * Higher values shrink Snell's window and raise grazing reflectance.
     */
    iorRatio: number;
    /**
     * Screen-space refraction UV-offset strength. Scales the wave-normal
     * displacement applied when sampling the scene through the water surface
     * for both above- and below-water observers. Higher values make the
     * seabed (and Snell's window contents) wobble more with the waves.
     */
    refractionStrength: number;
}
/** Output nodes produced by {@link Fresnel.build}. */
export interface FresnelResult {
    /** Distance from the camera to the fragment (world units). */
    distanceToCamera: Node;
    /** Uniform node for the distance-fade range end, consumed by SSS. */
    fadeEnd: Node;
    /** Fresnel reflectance for the front-face viewing direction (0–1). */
    fresnel: Node;
    /** Surface normal blended toward flat based on distance and strength. */
    fresnelNormal: Node;
    /**
     * `fresnelNormal` bent in the view–normal plane so the view ray never
     * sees it back-facing. Use for above-water reflection directions only;
     * underwater paths need the signed cosine of {@link fresnelNormal} for
     * total internal reflection.
     */
    reflectionNormal: Node;
}
/** Parameters for {@link Fresnel.build}. */
export interface FresnelBuildParams {
    /** Interpolated surface normal. */
    interpolatedNormal: Node;
    /**
     * Sub-footprint slope variance (0-1) from the cascade normal mips. Caps the
     * grazing reflectance so a wind-roughened / distant surface is not a mirror.
     */
    slopeVariance: Node;
    /** View direction (from surface toward camera). */
    viewDir: Node;
    /** Undisplaced world X coordinate. */
    worldX: Node;
    /** Undisplaced world Z coordinate. */
    worldZ: Node;
}
/**
 * Full dielectric Fresnel for the air–water interface.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}. Also owns the `fadeEnd` distance-fade
 * range consumed by SSS.
 */
export declare class Fresnel {
    private _fadeEnd;
    private _iorRatio;
    private _refractionStrength;
    /**
     * End of the distance-fade range (world units), consumed by SSS.
     * Auto-synced to the water extent by `WaterSystem`.
     */
    get fadeEnd(): number;
    set fadeEnd(value: number);
    /**
     * Refractive index of water relative to air. 1.33 is physical seawater.
     * Same value is used on both sides of the interface; the underwater
     * branch passes a negated cosine so the Fresnel function flips internally.
     */
    get iorRatio(): number;
    set iorRatio(value: number);
    /**
     * IOR uniform node, for cross-module shader graph access (e.g. the
     * underwater surface branch in `waterFragment.ts`).
     * @internal
     */
    get _iorRatioNode(): Node;
    /**
     * Screen-space refraction UV-offset strength. Drives how far the
     * wave-perturbed surface displaces sampled scene UVs for both the
     * above-water seabed view and the below-water Snell's window.
     */
    get refractionStrength(): number;
    set refractionStrength(value: number);
    /**
     * Refraction-strength uniform node, for cross-module shader graph
     * access (the above- and below-water refraction paths in
     * `waterFragment.ts` share this value).
     * @internal
     */
    get _refractionStrengthNode(): Node;
    /** Bulk-set parameters from a preset or params object. */
    update(params: FresnelParams): void;
    /**
     * Builds the dielectric Fresnel reflectance. The returned `fresnel` node
     * is the reflectance `F` for the front-face view direction; it can be
     * used directly as the mix weight between refraction (weight `1 - F`)
     * and reflection (weight `F`).
     *
     * @param params - View direction, surface normal, and world coordinates.
     * @returns Fresnel value, modified normals, distance metrics, and fade uniform nodes.
     */
    build(params: FresnelBuildParams): FresnelResult;
}
//# sourceMappingURL=fresnel.d.ts.map
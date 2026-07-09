import type { Node } from "./types";
/** Preset-facing parameters for sun sparkle. */
export interface SparkleParams {
    /** Whether sparkle is active. */
    enabled: boolean;
    /** Distance where sparkles fully fade (world units). */
    fadeDistance: number;
    /** Sparkle intensity multiplier. */
    intensity: number;
    /** Distance where sparkles fully appear (world units). */
    minDistance: number;
    /** Specular power (shininess). */
    power: number;
}
/** Parameters for {@link Sparkle.build}. */
export interface SparkleBuildParams {
    /** Distance from camera to fragment. */
    distanceToCamera: Node;
    /** Foam strength at the fragment (sparkles reduced on foam). */
    earlyFoamStrength: Node;
    /** Interpolated surface normal. */
    interpolatedNormal: Node;
    /** Direction toward the sun. */
    sunDir: Node;
    /** Sun light intensity. */
    sunIntensity: Node;
    /** View direction (from surface to camera). */
    viewDir: Node;
}
/**
 * Sun sparkle (specular highlights) on the water surface.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class Sparkle {
    private _enabled;
    private _fadeDistance;
    private _intensity;
    private _minDistance;
    private _power;
    /** Whether sparkle is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Distance where sparkles fully fade (world units). */
    get fadeDistance(): number;
    set fadeDistance(value: number);
    /** Sparkle intensity multiplier. */
    get intensity(): number;
    set intensity(value: number);
    /** Distance where sparkles fully appear (world units). */
    get minDistance(): number;
    set minDistance(value: number);
    /** Specular power (shininess). */
    get power(): number;
    set power(value: number);
    /** Bulk-set parameters from a preset or params object. */
    update(params: SparkleParams): void;
    /**
     * Builds sun sparkle effect shader nodes.
     * Uses Blinn-Phong specular for above-water sparkle.
     *
     * @returns Total sparkle amount to add to final color.
     */
    build(params: SparkleBuildParams): Node;
    /**
     * Blinn-Phong specular for above-water view.
     *
     * @param viewDir - View direction (surface to camera).
     * @param sunDir - Direction toward the sun.
     * @param normal - Surface normal.
     */
    private buildAboveWaterSpecular;
    /**
     * Mid-range fade: sparkles appear at minDistance, fade out at fadeDistance.
     *
     * @param distanceToCamera - Distance from camera to surface point.
     */
    private buildDistanceFade;
}
//# sourceMappingURL=sparkle.d.ts.map
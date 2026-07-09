/** Preset-facing parameters for the waterline meniscus. */
export interface WaterlineParams {
    /** Sharpness/power of the rim highlight falloff (higher = sharper edge). */
    highlightSharpness: number;
    /** Intensity of the rim highlight at the waterline edge. */
    highlightStrength: number;
    /** How much the surface normal tilts toward the camera at the waterline (0-1). */
    normalStrength: number;
    /** Width of the smooth fade on each edge (0 = hard edge, higher = softer). */
    smoothness: number;
    /** Half-width of the waterline in world units (meters). */
    thickness: number;
}
/**
 * Waterline meniscus effect at the clip plane boundary.
 *
 * Controls the visual appearance where the water surface meets partially
 * submerged objects: edge thickness, fade smoothness, normal perturbation,
 * and rim highlight.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via the clip plane uniform object.
 */
export declare class Waterline {
    private _enabled;
    private _highlightSharpness;
    private _highlightStrength;
    private _normalStrength;
    private _smoothness;
    private _thickness;
    /** Whether the waterline meniscus effect is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Sharpness/power of the rim highlight falloff (higher = sharper edge). */
    get highlightSharpness(): number;
    set highlightSharpness(value: number);
    /** Intensity of the rim highlight at the waterline edge. */
    get highlightStrength(): number;
    set highlightStrength(value: number);
    /** How much the surface normal tilts toward the camera at the waterline (0-1). */
    get normalStrength(): number;
    set normalStrength(value: number);
    /** Width of the smooth fade on each edge (0 = hard edge, higher = softer). */
    get smoothness(): number;
    set smoothness(value: number);
    /** Half-width of the waterline in world units (meters). */
    get thickness(): number;
    set thickness(value: number);
    /** Bulk-set parameters from a preset or params object. */
    update(params: WaterlineParams): void;
    /** Returns the uniform nodes for binding into the clip plane uniform object. */
    get uniforms(): {
        waterlineEnabled: import("three/webgpu").UniformNode<number>;
        waterlineHighlightSharpness: import("three/webgpu").UniformNode<number>;
        waterlineHighlightStrength: import("three/webgpu").UniformNode<number>;
        waterlineNormalStrength: import("three/webgpu").UniformNode<number>;
        waterlineSmoothness: import("three/webgpu").UniformNode<number>;
        waterlineThickness: import("three/webgpu").UniformNode<number>;
    };
}
//# sourceMappingURL=waterline.d.ts.map
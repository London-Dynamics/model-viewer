/**
 * Simple texture-based surface foam.
 *
 * No Jacobian dependency — appears everywhere based on texture alpha.
 * Foam advects with waves automatically since UVs use undisplaced grid position.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import type { Node } from "./types";
import type { BuiltInFoamName } from "./builtInFoamTextures";
/** Preset-facing parameters for surface foam. */
export interface SurfaceFoamParams {
    /** Foam tint color (hex string). */
    color: string;
    /** How much foam is visible (0–1). Higher = more foam. */
    coverage: number;
    /** Whether surface foam is active. */
    enabled: boolean;
    /** Master opacity (0–1). */
    opacity: number;
    /** Texture size in world units (larger = bigger foam pattern). */
    size: number;
    /** Name of the bundled foam texture to use. */
    texture: BuiltInFoamName;
}
/** Parameters for {@link SurfaceFoam.build}. */
export interface SurfaceFoamBuildParams {
    /** Undisplaced world X coordinate. */
    worldX: Node;
    /** Undisplaced world Z coordinate. */
    worldZ: Node;
}
/** Output nodes produced by {@link SurfaceFoam.build}. */
export interface SurfaceFoamResult {
    /** Foam strength (0–1). */
    strength: Node;
    /** Foam color. */
    color: Node;
}
/**
 * Simple texture-based surface foam.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class SurfaceFoam {
    private _color;
    private _coverage;
    private _enabled;
    private _opacity;
    private _size;
    private _texture;
    /** Foam tint color. */
    get color(): THREE.Color;
    set color(value: THREE.Color | string);
    /** How much foam is visible (0–1). Higher = more foam. */
    get coverage(): number;
    set coverage(value: number);
    /** Whether surface foam is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Master opacity (0–1). */
    get opacity(): number;
    set opacity(value: number);
    /** Texture size in world units (larger = bigger foam pattern). */
    get size(): number;
    set size(value: number);
    /** Tileable foam texture. */
    get foamTexture(): THREE.Texture;
    set foamTexture(value: THREE.Texture);
    /** Bulk-set parameters from a preset or params object. */
    update(params: SurfaceFoamParams): void;
    /**
     * Switch to a bundled foam texture by name, leaving every other parameter
     * untouched. Use this for an isolated texture change; {@link foamTexture}
     * binds a caller-owned texture instead.
     */
    loadTexture(name: BuiltInFoamName): void;
    /**
     * Builds surface foam strength from texture sampling.
     *
     * @param params - World coordinates and foam texture.
     * @returns Foam strength and color nodes.
     */
    build(params: SurfaceFoamBuildParams): SurfaceFoamResult;
    /**
     * Calculates simple surface foam using texture sampling.
     * No Jacobian dependency — appears everywhere based on texture alpha.
     */
    private calculateSurfaceFoam;
}
//# sourceMappingURL=foamSurface.d.ts.map
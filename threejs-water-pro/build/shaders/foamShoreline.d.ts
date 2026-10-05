/**
 * Shoreline foam — appears in shallow water near objects using depth-based masking.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import type { Node } from "./types";
import type { BuiltInFoamName } from "./builtInFoamTextures";
/** Preset-facing parameters for shoreline foam. */
export interface ShorelineFoamParams {
    /** Foam color (hex string). */
    color: string;
    /** How much foam is visible (0–1). Higher = more foam. */
    coverage: number;
    /** Whether shoreline foam is active. */
    enabled: boolean;
    /** Master opacity (0–1). */
    opacity: number;
    /** How far foam extends from shore (world units). */
    range: number;
    /** Texture size in world units (larger = bigger foam pattern). */
    size: number;
    /** Name of the bundled foam texture to use. */
    texture: BuiltInFoamName;
}
/** Parameters for {@link ShorelineFoam.build}. */
export interface ShorelineFoamBuildParams {
    /** Undisplaced world X coordinate. */
    worldX: Node;
    /** Undisplaced world Z coordinate. */
    worldZ: Node;
    /** Water column depth at the fragment. */
    waterColumnDepth: Node;
}
/** Output nodes produced by {@link ShorelineFoam.build}. */
export interface ShorelineFoamResult {
    /** Foam strength (0–1). */
    strength: Node;
    /** Foam tint color. */
    color: Node;
    /** Depth-based shoreline zone mask (0 = deep water, 1 = at shore). */
    zoneMask: Node;
}
/**
 * Shoreline foam for shallow water near objects.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class ShorelineFoam {
    private _color;
    private _coverage;
    private _enabled;
    private _opacity;
    private _range;
    private _size;
    private _texture;
    /** Foam color. */
    get color(): THREE.Color;
    set color(value: THREE.Color | string);
    /** How much foam is visible (0–1). Higher = more foam. */
    get coverage(): number;
    set coverage(value: number);
    /** Whether shoreline foam is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Master opacity (0–1). */
    get opacity(): number;
    set opacity(value: number);
    /** How far foam extends from shore (world units). */
    get range(): number;
    set range(value: number);
    /** Texture size in world units (larger = bigger foam pattern). */
    get size(): number;
    set size(value: number);
    /** Tileable foam texture. */
    get foamTexture(): THREE.Texture;
    set foamTexture(value: THREE.Texture);
    /**
     * Enabled uniform node (for alpha compositing in waterFragment).
     * @internal
     */
    get _enabledNode(): Node;
    /** Bulk-set parameters from a preset or params object. */
    update(params: ShorelineFoamParams): void;
    /**
     * Switch to a bundled foam texture by name, leaving every other parameter
     * untouched. Use this for an isolated texture change; {@link foamTexture}
     * binds a caller-owned texture instead.
     */
    loadTexture(name: BuiltInFoamName): void;
    /**
     * Builds shoreline foam strength, color, and zone mask.
     *
     * @param params - World coordinates, water depth, and foam texture.
     * @returns Foam strength, color, and zone mask nodes.
     */
    build(params: ShorelineFoamBuildParams): ShorelineFoamResult;
    /**
     * Calculates shoreline foam using a tileable texture and depth-based masking.
     */
    private calculateShorelineFoam;
}
//# sourceMappingURL=foamShoreline.d.ts.map
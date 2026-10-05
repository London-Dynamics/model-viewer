/**
 * Wave crest (turbulent) foam.
 *
 * Shades the persistent foam-energy field through a dissolve-textured mask:
 * lingering whitecaps that streak along the wind and break up into bubble
 * patterns as their energy decays. The energy itself is produced upstream by
 * the foam accumulation (breaking-crest injection + exponential decay); this
 * class only turns that energy into the visible, anisotropically-stretched foam.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import type { Node, UniformFloatNode } from "./types";
import { FoamPersistence, type FoamPersistenceParams } from "./foamPersistence";
import type { BuiltInFoamName } from "./builtInFoamTextures";
/** Preset-facing parameters for wave crest foam. */
export interface WaveFoamParams {
    /** Foam tint color (hex string). */
    color: string;
    /** Whether wave foam is active. */
    enabled: boolean;
    /** Master opacity (0–1). */
    opacity: number;
    /** Persistent foam-energy field tuning (crest/decay/windward). */
    persistence: FoamPersistenceParams;
    /** Texture size in world units (larger = bigger foam pattern). */
    size: number;
    /** Name of the bundled foam texture to use. */
    texture: BuiltInFoamName;
    /** Stretches foam in the wind direction for streaky whitecaps. 0 = round, 1 = fully stretched. */
    windStretch: number;
}
/** Parameters for {@link WaveFoam.build}. */
export interface WaveFoamBuildParams {
    /**
     * Persistent foam energy sampled from the foam-accumulation field. The
     * crest-foam energy source; gated by `enabled`. Omitted on quality tiers
     * where wave foam is off.
     */
    foamEnergy?: Node;
    /**
     * Persistent wake-foam energy sampled from the wake field. When provided, it
     * is shaded through the same dissolve-textured path as crest foam and merged
     * on top, so wake foam appears even when crest foam is off.
     */
    wakeFoamEnergy?: Node;
    /** Global wind direction (radians). */
    windDirection: Node;
    /** Undisplaced world X coordinate. */
    worldX: Node;
    /** Undisplaced world Z coordinate. */
    worldZ: Node;
}
/** Output nodes produced by {@link WaveFoam.build}. */
export interface WaveFoamResult {
    /** Foam strength (0–1). */
    strength: Node;
    /** Foam color. */
    color: Node;
}
/**
 * Wave crest (turbulent) foam shaded from the persistent foam-energy field.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class WaveFoam {
    private _color;
    private _enabled;
    private _opacity;
    private _size;
    private _texture;
    private _windBias;
    private _windStretch;
    private _persistence;
    /** Foam tint color. */
    get color(): THREE.Color;
    set color(value: THREE.Color | string);
    /** Whether wave foam is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Master opacity (0–1). */
    get opacity(): number;
    set opacity(value: number);
    /** Texture size in world units (larger = bigger foam pattern). */
    get size(): number;
    set size(value: number);
    /** Stretches foam in the wind direction for streaky whitecaps. */
    get windStretch(): number;
    set windStretch(value: number);
    /** Tileable foam texture. */
    get foamTexture(): THREE.Texture;
    set foamTexture(value: THREE.Texture);
    /**
     * Persistent foam-energy tuning (crest/decay/windward), surfaced as
     * `water.foam.waves.persistence`. Always present — the energy field that
     * consumes these may be absent on a tier, but the parameters are not.
     */
    get persistence(): FoamPersistence;
    /** @internal TSL uniform node for wind bias — used by simulation Jacobian computation. */
    get _windBiasNode(): Node;
    /** @internal Wave-foam enable node — read by the foam field for its CPU-side gate. */
    get _enabledNode(): UniformFloatNode;
    /** Bulk-set parameters from a preset or params object. */
    update(params: WaveFoamParams): void;
    /**
     * Switch to a bundled foam texture by name, leaving every other parameter
     * untouched — notably the persistence tuning. Use this for an isolated
     * texture change; {@link foamTexture} binds a caller-owned texture instead.
     */
    loadTexture(name: BuiltInFoamName): void;
    /**
     * Builds wave-crest foam from the persistent energy field. Crest energy is
     * gated by `enabled`; wake energy (owned by the wake system) always
     * contributes, so wake foam appears even when crest foam is off.
     *
     * @param params - World coordinates, energies, and wind direction.
     * @returns Foam strength and color nodes.
     */
    build(params: WaveFoamBuildParams): WaveFoamResult;
    /**
     * Dissolve-style mask for the persistent wave foam.
     *
     * The foam texture is the visible value (so the bubble pattern shows
     * through inside the foam patches). The persistent energy drives a
     * smoothstep threshold over the texture: as energy decays the threshold
     * rises through the texture's histogram, clipping out dark pixels first
     * — so patches dissolve into islands of bright bubbles instead of fading
     * uniformly.
     *
     * The mapping from energy to threshold is offset by the band half-width
     * on both ends so that:
     *   - `energy = 0` → the entire smoothstep band sits above texture max
     *     (1.0). No texture pixel passes, so foam goes fully to zero.
     *   - `energy = 1` → the entire band sits below texture min (0.0). Every
     *     texture pixel passes, so foam saturates.
     */
    private calculatePersistentFoam;
    /**
     * Calculates anisotropic UV stretching based on wind direction.
     * Stretches foam perpendicular to wave fronts for realistic streaky whitecaps.
     */
    private calculateAnisotropicUV;
}
//# sourceMappingURL=foamWaves.d.ts.map
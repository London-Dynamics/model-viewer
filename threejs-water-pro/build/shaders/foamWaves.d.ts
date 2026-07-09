/**
 * Wave crest (turbulent) foam with Jacobian-driven wave breaking detection.
 *
 * Combines texture-based foam with anisotropic wind stretching and Jacobian
 * eigenvalue analysis for realistic whitecaps on wave crests.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import type { Node } from "./types";
import { type BuiltInFoamName } from "./builtInFoamTextures";
/** Preset-facing parameters for wave crest foam. */
export interface WaveFoamParams {
    /** Foam tint color (hex string). */
    color: string;
    /** How much foam is visible (0–1). Higher = more foam. */
    coverage: number;
    /** How much foam appears on wave crests (0–1). Higher = more foam. */
    crestCoverage: number;
    /** Whether wave foam is active. */
    enabled: boolean;
    /** Master opacity (0–1). */
    opacity: number;
    /** Caps the maximum foam intensity (0–1). */
    peakIntensity: number;
    /** How much the ripple cascade contributes to foam (0–1). */
    rippleWeight: number;
    /** Texture size in world units (larger = bigger foam pattern). */
    size: number;
    /** Name of the bundled foam texture to use. */
    texture: BuiltInFoamName;
    /** How much the wave cascade contributes to foam (0–1). */
    waveWeight: number;
    /** Stretches foam in the wind direction for streaky whitecaps. 0 = round, 1 = fully stretched. */
    windStretch: number;
}
/** Parameters for {@link WaveFoam.build}. */
export interface WaveFoamBuildParams {
    /** Eigenvalue from wave cascade (1 = flat, <1 = compressed/folding). */
    eigen0: Node;
    /** Eigenvalue from ripple cascade. */
    eigen1: Node;
    /**
     * Persistent foam energy sampled from {@link FoamAccumulation}. When
     * provided (WebGPU + persistentFoamBuffer quality), the build path
     * returns the energy-buffer foam; otherwise it falls back to the
     * stateless smoothstep mask used on WebGL.
     */
    foamEnergy?: Node;
    /** Whether Jacobian data is available (WebGL stateless path only). */
    hasJacobianFoam: boolean;
    /** Displaced surface normal (for WebGL leading edge detection). */
    surfaceNormal: Node;
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
 * Wave crest (turbulent) foam with Jacobian-driven wave breaking.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class WaveFoam {
    private _color;
    private _coverage;
    private _crestCoverage;
    private _enabled;
    private _opacity;
    private _peakIntensity;
    private _rippleWeight;
    private _size;
    private _texture;
    private _waveWeight;
    private _windBias;
    private _windStretch;
    /** Foam tint color. */
    get color(): THREE.Color;
    set color(value: THREE.Color | string);
    /** How much foam is visible (0–1). Higher = more foam. */
    get coverage(): number;
    set coverage(value: number);
    /** How much foam appears on wave crests (0–1). Higher = more foam. */
    get crestCoverage(): number;
    set crestCoverage(value: number);
    /** Whether wave foam is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Master opacity (0–1). */
    get opacity(): number;
    set opacity(value: number);
    /** Caps the maximum foam intensity (0–1). */
    get peakIntensity(): number;
    set peakIntensity(value: number);
    /** How much the ripple cascade contributes to foam (0–1). */
    get rippleWeight(): number;
    set rippleWeight(value: number);
    /** Texture size in world units (larger = bigger foam pattern). */
    get size(): number;
    set size(value: number);
    /** How much the wave cascade contributes to foam (0–1). */
    get waveWeight(): number;
    set waveWeight(value: number);
    /** Stretches foam in the wind direction for streaky whitecaps. */
    get windStretch(): number;
    set windStretch(value: number);
    /** Tileable foam texture. */
    get foamTexture(): THREE.Texture;
    set foamTexture(value: THREE.Texture);
    /** @internal TSL uniform node for wind bias — used by simulation Jacobian computation. */
    get _windBiasNode(): Node;
    /** Bulk-set parameters from a preset or params object. */
    update(params: WaveFoamParams): void;
    /**
     * Builds turbulent foam with Jacobian wave breaking and leading edge detection.
     *
     * @param params - World coordinates, texture, eigenvalues, wind, and surface normal.
     * @returns Foam strength and color nodes.
     */
    build(params: WaveFoamBuildParams): WaveFoamResult;
    /**
     * Stateless wave-crest foam: Jacobian mask + leading-edge smoothstep +
     * anisotropic texture sample. Used on WebGL, below the `persistentFoamBuffer`
     * quality tier, and whenever the user toggles persistence off at runtime.
     *
     * @param worldX - Undisplaced world X.
     * @param worldZ - Undisplaced world Z.
     * @param eigen0 - Wave cascade eigenvalue.
     * @param eigen1 - Ripple cascade eigenvalue.
     * @param windDirection - Global wind direction (radians).
     * @param surfaceNormal - Displaced surface normal for leading-edge detection.
     * @param hasJacobianFoam - Whether Jacobian data is available.
     */
    private buildStatelessFoam;
    /**
     * Computes Jacobian value from eigenvalues for wave breaking detection.
     *
     * @param eigen0 - Eigenvalue from wave cascade.
     * @param eigen1 - Eigenvalue from ripple cascade.
     */
    private buildJacobian;
    /**
     * Calculates turbulent foam with anisotropic stretching along wind direction.
     */
    private calculateTurbulentFoam;
    /**
     * Dissolve-style mask for the persistent wave foam.
     *
     * The foam texture is the visible value (so the bubble pattern shows
     * through inside the foam patches). The persistent buffer drives a
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
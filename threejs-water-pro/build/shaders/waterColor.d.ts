/** Runtime-switchable spectral/Jerlov and artist-authored water color. */
import * as THREE from "three/webgpu";
import type { Node } from "./types";
import { type JerlovWaterType } from "./waterConstituents";
export type WaterColorMode = "physical" | "custom";
/** Full-spectrum physical water color derived from constituent concentrations. */
export interface PhysicalWaterColorParams {
    mode: "physical";
    algae: number;
    silt: number;
    stain: number;
}
/** Artist-authored water color with per-channel Beer-Lambert absorption. */
export interface WaterColorParams {
    absorptionColor: string;
    transmissionColor: string;
    waterColor: string;
}
/** Custom mode; `mode` is optional so existing v3.3 configs remain valid. */
export interface CustomWaterColorParams extends WaterColorParams {
    mode?: "custom";
}
/** Water-color configuration accepted by presets and runtime APIs. */
export type WaterColorConfig = PhysicalWaterColorParams | CustomWaterColorParams;
/**
 * Validate a color configuration and return a fresh object with an explicit
 * mode, suitable for persisted state.
 */
export declare function normalizeWaterColorConfig(params: WaterColorConfig): PhysicalWaterColorParams | (WaterColorParams & {
    mode: "custom";
});
/** Parameters for {@link WaterColor.build}. */
export interface WaterColorBuildParams {
    /** Normalized linear scene depth sample (0 = near plane, 1 = far / sky). */
    depthSample: Node;
    /** View direction Y component for fallback depth. */
    viewDirY: Node;
    /** Whether the depth texture is available (0 or 1). */
    useDepthTexture: Node;
}
/** Output nodes produced by {@link WaterColor.build}. */
export interface WaterColorResult {
    /**
     * Per-channel Beer-Lambert clear-fraction `exp(-absorptionColor * depth)`.
     * `1.0` per channel = perfectly clear (light passes unattenuated),
     * `0.0` = fully absorbed. Used by the fragment composite to weight the
     * refracted seabed sample against the water's intrinsic in-scatter color.
     */
    clearFactor: Node;
    /** 1.0 when scene geometry is in front of water surface, 0.0 otherwise. */
    isObjectInFront: Node;
    /** Active physical in-scatter or artist-authored water color. */
    waterColor: Node;
    /** Water column depth in world units. */
    waterColumnDepth: Node;
}
/** Runtime-switchable physical and custom water-color model. */
export declare class WaterColor {
    private _mode;
    private _algae;
    private _silt;
    private _stain;
    private _customMode;
    private _inScatter;
    private _crestTransmission;
    private _absorptionColor;
    private _waterColor;
    private _transmissionColor;
    private _waterDepth;
    private _transmittanceValues;
    private _transmittanceLUT;
    constructor();
    get mode(): WaterColorMode;
    set mode(value: WaterColorMode);
    get algae(): number;
    set algae(value: number);
    get silt(): number;
    set silt(value: number);
    get stain(): number;
    set stain(value: number);
    /**
     * Per-channel Beer-Lambert absorption coefficient used by custom mode.
     */
    get absorptionColor(): THREE.Color;
    set absorptionColor(value: THREE.Color | string);
    /** Color of light transmitted through the water. */
    get transmissionColor(): THREE.Color;
    set transmissionColor(value: THREE.Color | string);
    /** Intrinsic in-scattered water color used by custom mode. */
    get waterColor(): THREE.Color;
    set waterColor(value: THREE.Color | string);
    /**
     * Water depth for fallback depth calculation (world units).
     * Set from ocean floor depth — not part of {@link WaterColorParams}.
     */
    get waterDepth(): number;
    set waterDepth(value: number);
    /** Normalize and apply a supported preset or params object. */
    update(params: WaterColorConfig): void;
    /** Seed the physical model from a Jerlov water type. */
    setJerlovType(type: JerlovWaterType): void;
    /** Release resources owned by this color model. */
    dispose(): void;
    /** Transmittance through the active water-color model. */
    buildClearFactor(columnDepth: Node): Node;
    /** Physical in-scatter or artist-authored custom water color. */
    buildMediumColor(): Node;
    /**
     * Builds water-column depth, active transmittance, and medium color at the
     * unrefracted screen UV. The refracted composite resamples the same model at
     * its refracted depth.
     *
     * @param params - Depth sample, view direction, and depth texture flag.
     */
    build(params: WaterColorBuildParams): WaterColorResult;
    /**
     * Interpolates the physical transmittance curve from its uniform buffer.
     *
     * @param pathLength - Water-column length in world units.
     */
    private buildPhysicalClearFactor;
    /**
     * Calculates the water column depth from depth texture or fallback.
     *
     * @param viewDirY - Y component of the view direction.
     * @param depthSample - Normalized linear scene depth sample.
     * @param useDepthTexture - Whether the depth texture is available (0 or 1).
     */
    private buildWaterColumnDepth;
    private _derivePhysicalOptics;
    /** Active crest-transmission node consumed by SSS. @internal */
    get _transmissionColorNode(): Node;
}
/**
 * Input parameters for buildReflectionSampling.
 */
export interface ReflectionSamplingParams {
    /** View direction (from surface toward camera). */
    viewDir: Node;
    /**
     * Surface normal for the reflection direction. Pass the bent
     * `reflectionNormal` from {@link FresnelResult} so the reflection
     * vector cannot dip below the local surface at grazing angles.
     */
    reflectionNormal: Node;
    /** Sky reflection sampler (optional): `(dir, extraRoughness) => color`. */
    reflectionSampler?: (dir: Node, roughness: Node) => Node;
    /**
     * Sub-footprint slope variance driving the reflection blur (filtered-BRDF
     * roughness). Higher where the pixel folds away unresolved waves.
     */
    roughness: Node;
}
/**
 * Result from buildReflectionSampling.
 */
export interface ReflectionSamplingResult {
    /** Sampled reflection color. */
    reflectionColor: Node;
    /** World-space reflection direction. */
    reflectDir: Node;
}
/**
 * Samples reflection color from sky or environment map.
 * This is a standalone builder function (not part of WaterColor) because
 * it handles optional JS-level samplers and doesn't depend on color uniforms.
 *
 * @param params - View direction, normal, and optional samplers.
 * @returns Reflection color and direction.
 */
export declare function buildReflectionSampling(params: ReflectionSamplingParams): ReflectionSamplingResult;
//# sourceMappingURL=waterColor.d.ts.map
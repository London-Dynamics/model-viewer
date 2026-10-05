/**
 * Quality level definitions for the water shader.
 *
 * Each level defines:
 * - Visual features (runtime defaults for which effects are enabled)
 * - Cascade configuration (FFT resolution and which cascades are active)
 *
 * All shader effects are always compiled into the shader and gated at runtime
 * via `If()` guards on their `_enabled` uniforms. Quality levels set the
 * initial enabled/disabled state — users can override individual features
 * at runtime without triggering a shader recompile.
 */
export type QualityLevel = "low" | "medium" | "high" | "ultra" | "max";
/**
 * Complete quality level configuration including features and cascades.
 */
export interface QualityLevelConfig {
    segments: number;
    features: {
        readonly displacement: true;
        readonly normals: true;
        readonly fresnel: true;
        readonly reflection: true;
        readonly waterColor: true;
        surfaceFoam: boolean;
        turbulentFoam: boolean;
        shorelineFoam: boolean;
        sss: boolean;
        sparkle: boolean;
        fog: boolean;
        screenSpaceRefraction: boolean;
        domainWarpedFoam: boolean;
        ssr: boolean;
    };
    sunShaftResolutionScale: number;
    ssrMaxDistance: number;
    ssrStepCount: number;
    wakeEnabled: boolean;
    wakeResolution: number;
    wakeWorldSize: number;
    foamFieldResolution: number;
    foamFieldWorldSize: number;
    sprayMaxParticles: number;
    sprayEnabledByDefault: boolean;
    cascades: {
        enabled: boolean;
        resolution: number;
    }[];
}
/**
 * Quality level configurations.
 *
 * LOW: Swell only - core effects
 * MEDIUM: Swell + wind waves - all core effects
 * HIGH: Swell + wind waves + ripples - underwater effects
 * ULTRA: Same three cascades as High, with a sharper ripple cascade
 * MAX: Three 512 grids with sharper swell/waves and a smaller ripple tile
 *
 * Cascade order: [swell, waves, ripples] - largest to smallest scale (swell
 * is the longest-wavelength, longest-period component; wind-driven waves
 * are next; ripples are the finest capillary detail). Quality adds cascades
 * progressively through High rather than lowering their resolution. Ultra
 * doubles ripples to 512. Max doubles swell and waves as well, shrinking the
 * derived wave and ripple tiles to 48 m and 2.25 m. Its 512 ripple grid
 * therefore restores a terminal detail floor of about 1.3 cm.
 *
 * Tile sizes and seams below assume the default `maxScale` of 1024 m (see
 * `deriveCascadeScale`). `maxScale` is a runtime-adjustable wave parameter,
 * not a fixed constant — a larger value shifts every number below
 * proportionally and can push the dominant wavelength out of a lower tier's
 * coverage. See the cascade section of `docs/api/waves.md`.
 */
export declare const QUALITY_LEVELS: Record<QualityLevel, QualityLevelConfig>;
/**
 * Get the feature set for a quality level.
 * Also accepts a custom features object for advanced customization.
 * Returns 'high' level features if an invalid quality string is provided.
 */
export declare function getQualityFeatures(qualityOrFeatures: QualityLevel | QualityLevelConfig["features"]): QualityLevelConfig["features"];
//# sourceMappingURL=QualityLevels.d.ts.map
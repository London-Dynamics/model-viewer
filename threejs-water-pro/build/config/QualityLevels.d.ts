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
export type QualityLevel = "low" | "medium" | "high" | "ultra";
/**
 * Complete quality level configuration including features and cascades.
 */
export interface QualityLevelConfig {
    segments: number;
    gerstnerMaxWaves: number;
    features: {
        readonly displacement: true;
        readonly normals: true;
        readonly fresnel: true;
        readonly reflection: true;
        readonly waterColor: true;
        jacobianFoam: boolean;
        persistentFoamBuffer: boolean;
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
    sceneColorResolutionScale: number;
    sunShaftResolutionScale: number;
    ssrMaxDistance: number;
    ssrStepCount: number;
    wakeEnabled: boolean;
    wakeResolution: number;
    wakeWorldSize: number;
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
 * LOW: Essential ocean rendering - waves only, core effects
 * MEDIUM: Good quality - waves + ripples, all core effects
 * HIGH: Full quality - all cascades, underwater effects
 * ULTRA: Maximum quality - highest resolution FFT
 *
 * Cascade order: [waves, ripples] - largest to smallest scale.
 * Gerstner waves provide large-scale swells analytically (no FFT cascade needed).
 *
 * Cascade resolution by level:
 * - LOW: 128 (waves only)
 * - MEDIUM: 128/256 (waves + ripples)
 * - HIGH: 256/256 (waves + ripples, higher res)
 * - ULTRA: 256/512 (waves + ripples, highest res)
 */
export declare const QUALITY_LEVELS: Record<QualityLevel, QualityLevelConfig>;
/**
 * Get the feature set for a quality level.
 * Also accepts a custom features object for advanced customization.
 * Returns 'high' level features if an invalid quality string is provided.
 */
export declare function getQualityFeatures(qualityOrFeatures: QualityLevel | QualityLevelConfig["features"]): QualityLevelConfig["features"];
//# sourceMappingURL=QualityLevels.d.ts.map
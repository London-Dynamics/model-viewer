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
  // Water surface mesh segments (vertices per side)
  segments: number;

  // Maximum number of Gerstner waves (0 disables Gerstner)
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

  // Scene color pass resolution scale (1 = full, 0.5 = half, 0.25 = quarter).
  // Controls the resolution of the render target used by SSR and underwater refraction.
  sceneColorResolutionScale: number;

  // Sun shaft pass resolution scale (1 = full, 0.5 = half, 0.25 = quarter).
  // Controls the resolution of the render target used for god ray intensity computation.
  sunShaftResolutionScale: number;

  // SSR configuration
  ssrMaxDistance: number;
  ssrStepCount: number;

  // Dispersive iWave wake field (see src/systems/wake). `wakeEnabled` gates the
  // per-frame solve — false leaves the field calm at zero compute cost — while
  // resolution and extent size the camera-anchored height grid.
  wakeEnabled: boolean;
  wakeResolution: number;
  wakeWorldSize: number;

  // Wave-crest spray particle pool size. 0 = disabled at this quality level
  // (no storage buffer allocated). Typical values: 0/0/32k/64k.
  sprayMaxParticles: number;
  // Whether wave-crest spray is enabled by default at this quality level.
  sprayEnabledByDefault: boolean;

  // Cascade configuration (FFT resolution and enablement)
  // [waves, ripples]
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
export const QUALITY_LEVELS: Record<QualityLevel, QualityLevelConfig> = {
  low: {
    segments: 16,
    gerstnerMaxWaves: 0,
    sceneColorResolutionScale: 0.25,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: false,
    wakeResolution: 256,
    wakeWorldSize: 700,
    sprayMaxParticles: 0,
    sprayEnabledByDefault: false,
    ssrMaxDistance: 50,
    ssrStepCount: 8,
    features: {
      displacement: true,
      normals: true,
      fresnel: true,
      reflection: true,
      waterColor: true,
      fog: true,
      sparkle: true,
      jacobianFoam: true,
      persistentFoamBuffer: false,
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sss: true,
      screenSpaceRefraction: false,
      domainWarpedFoam: false,
      ssr: false,
    },
    // [waves, ripples]
    cascades: [
      { enabled: true, resolution: 128 }, // waves
      { enabled: false, resolution: -1 }, // ripples disabled
    ],
  },

  medium: {
    segments: 32,
    gerstnerMaxWaves: 2,
    sceneColorResolutionScale: 0.5,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 256,
    wakeWorldSize: 700,
    sprayMaxParticles: 0,
    sprayEnabledByDefault: false,
    ssrMaxDistance: 100,
    ssrStepCount: 8,
    features: {
      displacement: true,
      normals: true,
      fresnel: true,
      reflection: true,
      waterColor: true,
      fog: true,
      jacobianFoam: true,
      persistentFoamBuffer: false,
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: false,
      domainWarpedFoam: false,
      ssr: false,
    },
    // [waves, ripples]
    cascades: [
      { enabled: true, resolution: 128 }, // waves
      { enabled: true, resolution: 256 }, // ripples
    ],
  },

  high: {
    segments: 64,
    gerstnerMaxWaves: 4,
    sceneColorResolutionScale: 0.5,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 512,
    wakeWorldSize: 700,
    sprayMaxParticles: 32_000,
    sprayEnabledByDefault: true,
    ssrMaxDistance: 150,
    ssrStepCount: 16,
    features: {
      displacement: true,
      normals: true,
      fresnel: true,
      reflection: true,
      waterColor: true,
      fog: true,
      jacobianFoam: true,
      persistentFoamBuffer: true,
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: true,
      domainWarpedFoam: true,
      ssr: true,
    },
    // [waves, ripples]
    cascades: [
      { enabled: true, resolution: 256 }, // waves
      { enabled: true, resolution: 256 }, // ripples
    ],
  },

  ultra: {
    segments: 128,
    gerstnerMaxWaves: 8,
    sceneColorResolutionScale: 1,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 1024,
    wakeWorldSize: 700,
    sprayMaxParticles: 64_000,
    sprayEnabledByDefault: true,
    ssrMaxDistance: 250,
    ssrStepCount: 32,
    features: {
      displacement: true,
      normals: true,
      fresnel: true,
      reflection: true,
      waterColor: true,
      fog: true,
      jacobianFoam: true,
      persistentFoamBuffer: true,
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: true,
      domainWarpedFoam: true,
      ssr: true,
    },
    // [waves, ripples]
    cascades: [
      { enabled: true, resolution: 256 }, // waves
      { enabled: true, resolution: 512 }, // ripples
    ],
  },
};

/**
 * Get the feature set for a quality level.
 * Also accepts a custom features object for advanced customization.
 * Returns 'high' level features if an invalid quality string is provided.
 */
export function getQualityFeatures(
  qualityOrFeatures: QualityLevel | QualityLevelConfig["features"],
): QualityLevelConfig["features"] {
  if (typeof qualityOrFeatures === "string") {
    const level = QUALITY_LEVELS[qualityOrFeatures];
    if (!level) {
      console.warn(
        `Invalid quality level "${qualityOrFeatures}", defaulting to "high"`,
      );
      return QUALITY_LEVELS.high.features;
    }
    return level.features;
  }
  return qualityOrFeatures;
}

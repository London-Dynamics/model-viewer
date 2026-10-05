// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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
  // Water surface mesh segments (vertices per side)
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

  // World-fixed wave-crest foam field. Resolution and extent size the
  // camera-anchored window the persistent foam accumulates in; finer/larger
  // trades cost for sharpness/coverage. Honoured only where `turbulentFoam` is on.
  foamFieldResolution: number;
  foamFieldWorldSize: number;

  // Wave-crest spray particle pool size. 0 disables allocation at this tier.
  sprayMaxParticles: number;
  // Whether wave-crest spray is enabled by default at this quality level.
  sprayEnabledByDefault: boolean;

  // Cascade configuration, ordered from largest to smallest spatial scale.
  // Array length determines the active cascade count; resolution controls
  // each cascade's sampling density and the scale derived for finer cascades.
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
export const QUALITY_LEVELS: Record<QualityLevel, QualityLevelConfig> = {
  low: {
    segments: 16,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: false,
    wakeResolution: 256,
    wakeWorldSize: 100,
    foamFieldResolution: 256,
    foamFieldWorldSize: 400,
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
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sss: true,
      screenSpaceRefraction: false,
      domainWarpedFoam: false,
      ssr: false,
    },
    // Tile 1024 m, detail floor 12 m, ~66k FFT threads. Swell only, at the
    // same resolution as cascade 0 in every other tier.
    cascades: [
      { enabled: true, resolution: 256 }, // swell
    ],
  },

  medium: {
    segments: 32,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 256,
    wakeWorldSize: 100,
    foamFieldResolution: 512,
    foamFieldWorldSize: 400,
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
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: false,
      domainWarpedFoam: false,
      ssr: false,
    },
    // Tiles 1024 / 96 m, seam at 12 m, detail floor 1.1 m, ~131k FFT
    // threads. Adds the wind-wave cascade on top of swell.
    cascades: [
      { enabled: true, resolution: 256 }, // swell
      { enabled: true, resolution: 256 }, // waves
    ],
  },

  high: {
    segments: 64,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 512,
    wakeWorldSize: 100,
    foamFieldResolution: 1024,
    foamFieldWorldSize: 400,
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
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: true,
      domainWarpedFoam: true,
      ssr: true,
    },
    // Tiles 1024 / 96 / 9 m, seams at 12 / 1.125 m, detail floor 10.5 cm,
    // ~197k FFT threads. Adds the ripple cascade on top of swell + waves.
    cascades: [
      { enabled: true, resolution: 256 }, // swell
      { enabled: true, resolution: 256 }, // waves
      { enabled: true, resolution: 256 }, // ripples
    ],
  },

  ultra: {
    segments: 128,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 1024,
    wakeWorldSize: 100,
    foamFieldResolution: 2048,
    foamFieldWorldSize: 400,
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
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: true,
      domainWarpedFoam: true,
      ssr: true,
    },
    // Tiles 1024 / 96 / 9 m, seams at 12 / 1.125 m, detail floor 5.3 cm,
    // ~393k FFT threads. Same three cascades as High; only the ripple
    // cascade's resolution increases, sharpening fine surface detail
    // without changing swell/wave shape.
    cascades: [
      { enabled: true, resolution: 256 }, // swell
      { enabled: true, resolution: 256 }, // waves
      { enabled: true, resolution: 512 }, // ripples
    ],
  },

  // Same features as ultra, with every FFT cascade raised to 512. Denser swell
  // and waves grids shrink the derived wave and ripple tiles, restoring the
  // approximately 1.3 cm terminal detail floor while keeping each complete
  // line within guaranteed WebGPU workgroup limits.
  max: {
    segments: 128,
    sunShaftResolutionScale: 0.25,
    wakeEnabled: true,
    wakeResolution: 1024,
    wakeWorldSize: 100,
    foamFieldResolution: 2048,
    foamFieldWorldSize: 400,
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
      surfaceFoam: true,
      turbulentFoam: true,
      shorelineFoam: true,
      sparkle: true,
      sss: true,
      screenSpaceRefraction: true,
      domainWarpedFoam: true,
      ssr: true,
    },
    // Tiles 1024 / 48 / 2.25 m, seams at 6 / 0.28125 m, detail floor 1.3 cm,
    // 786,432 FFT cells. Every row fits the WebGPU guaranteed 16 KiB shared-
    // memory and 256-invocation workgroup limits with pair-owned butterflies.
    cascades: [
      { enabled: true, resolution: 512 }, // swell
      { enabled: true, resolution: 512 }, // waves
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

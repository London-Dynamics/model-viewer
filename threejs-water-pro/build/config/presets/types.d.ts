import type { BuiltInFoamName } from "../../shaders/builtInFoamTextures";
import type { WaterColorConfig } from "../../shaders/waterColor";
export type PresetName = "arctic" | "blackFlag" | "dusk" | "foggy" | "moonlit" | "seaOfThieves" | "storm" | "sunset";
/**
 * Complete water scene parameters.
 * Each preset must define ALL of these parameters.
 */
export interface WaterSceneParams {
    caustics: {
        enabled: boolean;
        surface: {
            strength: number;
            scale: number;
            speed: number;
        };
    };
    clipmap: {
        baseSize: number;
        levels: number;
    };
    environment: {
        /**
         * Scene IBL intensity — scales `scene.environment` for every lit mesh
         * (floor, ships, water), separately from a sky provider's own
         * `brightness` trim. Default `1.0`.
         */
        intensity: number;
    };
    fog: {
        color: string;
        enabled: boolean;
        fadeEnd: number;
        fadePower: number;
        fadeStart: number;
        skyBlendDistance: number;
    };
    color: WaterColorConfig;
    foam: {
        surface: {
            enabled: boolean;
            /** Master opacity (0-1) */
            opacity: number;
            /** Foam tint color (hex string) */
            color: string;
            /** Texture size in world units (larger = bigger foam pattern) */
            size: number;
            /** How much foam is visible (0-1). Lower = more foam. */
            coverage: number;
            /** Name of the bundled foam texture to use. */
            texture: BuiltInFoamName;
        };
        waves: {
            enabled: boolean;
            /** Master opacity (0-1) */
            opacity: number;
            /** Foam tint color (hex string) */
            color: string;
            /** Texture size in world units (larger = bigger foam pattern) */
            size: number;
            /** Stretches foam in the wind direction for streaky whitecaps. 0 = round, 1 = fully stretched. */
            windStretch: number;
            /** Name of the bundled foam texture to use. */
            texture: BuiltInFoamName;
            /**
             * Persistent foam accumulation. Wave-crest foam is an energy field that
             * injects on breaking events and decays exponentially, producing visible
             * streaks and decay tails. Active on quality tiers with wave foam enabled.
             */
            persistence: {
                /**
                 * Crest-driven foam strength. Equilibrium energy at a sustained
                 * sharp fold; gentle folding is suppressed by the breaking-rate
                 * curve baked into the inject pass.
                 */
                crestStrength: number;
                /** Exponential decay e-folding time (seconds). */
                decayTime: number;
                /**
                 * Windward-face foam strength. Equilibrium energy on a fully
                 * wind-facing pixel, regardless of folding. Drives foam onto the
                 * rising face of waves; persistence carries it past the crest.
                 */
                windwardStrength: number;
            };
        };
        shoreline: {
            enabled: boolean;
            /** Master opacity (0-1) */
            opacity: number;
            /** Texture size in world units (larger = bigger foam pattern) */
            size: number;
            /** How much foam is visible (0-1). Lower = more foam. */
            coverage: number;
            /** How far foam extends from shore. Higher = further reach. */
            range: number;
            /** Foam color (hex string) */
            color: string;
            /** Name of the bundled foam texture to use. */
            texture: BuiltInFoamName;
        };
    };
    fresnel: {
        surface: {
            iorRatio: number;
            /**
             * Screen-space refraction UV-offset strength. Scales how far the
             * wave-perturbed surface displaces the sampled scene UVs for both
             * above-water (seabed warp) and below-water (Snell's window warp)
             * observers. ~0.1 is a subtle ripple; 0.3+ is noticeable wobble.
             */
            refractionStrength: number;
        };
        underwater: {
            waterAbsorption: number;
            refractionIOR: number;
            refractionStrength: number;
            reflectionStrength: number;
            normalStrength: number;
        };
    };
    oceanFloor: {
        blendSoftness: number;
        blendThreshold: number;
        depth: number;
        displacementScale: number;
        displacementStrength: number;
        enabled: boolean;
        lacunarity: number;
        meshResolution: number;
        normalScale: number;
        persistence: number;
        textureDisplacementStrength: number;
        tileSize: number;
        caustics: {
            depthAttenuation: number;
            enabled: boolean;
            intensity: number;
            scale: number;
            waveDistortion: number;
        };
        sunShafts: {
            enabled: boolean;
            intensity: number;
        };
    };
    postProcessing: {
        enabled: boolean;
        bloom: {
            enabled: boolean;
            strength: number;
            radius: number;
            threshold: number;
        };
        filmGrain: {
            enabled: boolean;
            intensity: number;
        };
        vignette: {
            enabled: boolean;
            intensity: number;
            smoothness: number;
        };
        underwater: {
            distortionEnabled: boolean;
            distortionIntensity: number;
            distortionScale: number;
            distortionSpeed: number;
            enabled: boolean;
            tintColor: string;
        };
        rain: {
            /** Rain streak tint color. */
            color: string;
            /** Whether rain (streaks + ripples) is enabled. */
            enabled: boolean;
            /** Distance (m) at which streaks begin fading toward the domain boundary. */
            fadeDistance: number;
            /** Rain streak density (0–1). */
            intensity: number;
            /** How quickly ripples fade (0.5–5). */
            rippleDecay: number;
            /** Ripple spawn density (0–2). */
            rippleDensity: number;
            /** Distance where ripples fully fade out from camera. */
            rippleFadeEnd: number;
            /** Ripple cell size in meters (0.1–1). */
            rippleSize: number;
            /** Ripple normal perturbation strength (0–1). */
            rippleStrength: number;
            /** Visual opacity of rain streaks (0–1). */
            opacity: number;
            /** Speed multiplier for rain fall animation (default 1.0). */
            speed: number;
            /** Streak length multiplier (default 1.0). */
            streakLength: number;
            /** Maximum streak width in world units (default 0.008). */
            streakWidth: number;
        };
        underwaterParticles: {
            color: string;
            count: number;
            enabled: boolean;
            farDistance: number;
            maxSize: number;
            minSize: number;
            nearDistance: number;
            opacity: number;
        };
    };
    sss: {
        enabled: boolean;
        intensity: number;
        power: number;
    };
    sparkle: {
        enabled: boolean;
        fadeDistance: number;
        intensity: number;
        minDistance: number;
        power: number;
    };
    sky: {
        /**
         * Optional sky-image source. The library ignores this — only the demo
         * reads it to pick a default HDRI for the preset. Presets that omit it
         * leave the current sky source untouched.
         */
        source?: {
            type: "hdri" | "cubemap";
            url: string;
        };
        /** Brightness multiplier on the sampled sky colour. Default `1.0`. */
        brightness: number;
        /** Base PMREM roughness for reflections, in `[0, 1]`. Default `0.02`. */
        reflectionRoughness: number;
        sun: {
            azimuth: number;
            diskColor: string;
            /**
             * Whether the in-dome sun disk overlay renders. The disk is purely a
             * visual element; sun direction/intensity/colour drive scene lighting
             * regardless of this flag.
             */
            diskEnabled: boolean;
            diskEmissiveColor: string;
            diskEmissiveIntensity: number;
            diskRadius: number;
            elevation: number;
            intensity: number;
        };
    };
    spray: {
        /** Bottom-fade start (0–1, billboard-vertical). Alpha = 0 below this height. */
        bottomFadeStart: number;
        /** Bottom-fade stop (0–1, billboard-vertical). Alpha = 1 at and above this height. */
        bottomFadeStop: number;
        /** Maximum particle lifetime in seconds. */
        duration: number;
        /** Master toggle. When false, spray compute dispatches are skipped. */
        enabled: boolean;
        /**
         * Length of the alpha fade-out tail (s), measured backwards from
         * death. The flipbook completes over `duration − fadeOutTime`; alpha
         * smoothly ramps to zero over the same trailing window.
         */
        fadeOutTime: number;
        /** Droplet opacity multiplier (0–1). */
        opacity: number;
        /**
         * Extra cooldown (s) added on top of `duration` between consecutive
         * fires from the same probe. Total cooldown is `duration + respawnTime`.
         */
        respawnTime: number;
        /** Base droplet billboard side length (m). */
        size: number;
        /**
         * Maximum random delay (s) between trigger and the moment the burst
         * becomes visible. Each trigger picks an independent jitter in
         * `[0, spawnJitterTime)`; the particle is written at the probe's
         * *current* world position when the dwell expires, so a moving
         * boat keeps its plume attached even when the dwell is non-zero.
         * The cooldown stretches to cover the delay so a re-trigger can't
         * overlap. `0` disables — every trigger spawns visibly on the same
         * frame at the crossing position.
         */
        spawnJitterTime: number;
        /** Width multiplier (perpendicular to up). */
        stretchX: number;
        /** Height multiplier (along up). */
        stretchY: number;
        /**
         * Distance (m) below the displaced water surface to anchor the
         * billboard bottom. Each frame, alive particles are re-anchored at
         * `surfaceY − submersionDepth` so the plume base tracks the moving
         * water rather than floating above wave troughs.
         */
        submersionDepth: number;
        /**
         * Linear coefficient mapping `impactSpeed − velocityThreshold` (m/s) to
         * a per-particle height-only scale increment, frozen at spawn.
         * Composes with `velocityScaleFactor` on the Y axis. Final scale is
         * clamped to `[1, 2]`. `0` disables.
         */
        velocityHeightFactor: number;
        /**
         * Linear coefficient mapping `impactSpeed − velocityThreshold` (m/s) to
         * a per-particle uniform scale increment (both axes), frozen at spawn.
         * Final scale is clamped to `[1, 2]`. `0` disables.
         */
        velocityScaleFactor: number;
        /**
         * Minimum relative impact speed (m/s) at the moment of water-line
         * crossing for a probe to fire. Impact speed is the vertical
         * convergence rate between probe and surface over the last frame, so
         * a wave rising onto a stationary probe and a probe falling onto
         * still water both register the same magnitude.
         */
        velocityThreshold: number;
    };
    ssr: {
        enabled: boolean;
        strength: number;
    };
    wake: {
        /** Surface steepness `|∇h|` at which wake foam begins. */
        foamBreakThreshold: number;
        /** Persistent wake-foam decay per frame (closer to 1 = longer-lasting trail). */
        foamPersistence: number;
        /** Wake-foam injection rate at a breaking crest. */
        foamStrength: number;
        /** Velocity-damping friction `γ` (≥ 0). Higher = shorter, more-damped trail. */
        friction: number;
    };
    waves: {
        fft: {
            amplitude: number;
            animationSpeed: number;
            windSpeed: number;
            windDirection: number;
            choppiness: number;
            /**
             * Dominant wavelength in meters — the JONSWAP spectral peak. Sets
             * wave size directly; `windSpeed` controls energy and steepness at
             * that size, independently.
             */
            peakWavelength: number;
            spectralSharpness: number;
            standingWaveRatio: number;
            cascades: {
                /** World-space tile size of the largest cascade, in meters. */
                maxScale: number;
            };
        };
    };
}
/** Complete water scene parameters. */
export type PresetConfig = WaterSceneParams;
/** Explicit configuration name retained for API clarity. */
export type WaterSceneConfig = WaterSceneParams;
//# sourceMappingURL=types.d.ts.map
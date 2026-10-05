/**
 * Parameter interfaces for uniform classes.
 * These match the structure in defaults.ts and are used by the uniform
 * group classes in uniforms.ts.
 *
 * Shader class parameter interfaces (ColorParams → WaterColorParams,
 * FresnelParams, SurfaceFoamParams, WaveFoamParams, FoamPersistenceParams,
 * ShorelineFoamParams, UnderwaterSurfaceParams, SSRParams, SSSParams,
 * SparkleParams) now live in their respective shader class files under src/shaders/.
 *
 * Properties within each interface are sorted alphabetically.
 */
export type { SunShaftsParams } from "../shaders/sunShafts";
/**
 * Options passed to `WaterSystem.create`. All fields are optional.
 *
 * - `deterministic` — Enable fixed-step simulation. When `true`,
 *   `WaterSystem.update` drains a per-frame accumulator and steps the
 *   simulation in `stepSize`-sized chunks, so two clients with different host
 *   frame rates advance identically. When `false` (default), one host frame =
 *   one simulation step using the caller's `deltaTime`. Multiplayer needs
 *   this; single-player apps typically do not.
 *
 * - `seed` — Seed for the Phillips spectrum. Two clients with the same
 *   `seed` and parameters render the same wave surface. Sampled heights
 *   are *not* guaranteed to agree across GPUs — network gameplay object
 *   state directly (see `docs/guide/multiplayer.md`). Default `1`.
 *
 * - `stepSize` — Fixed simulation substep in seconds. Only meaningful when
 *   `deterministic` is `true`; ignored otherwise. Default `1 / 60`.
 */
export interface WaterSystemOptions {
    deterministic?: boolean;
    seed?: number;
    stepSize?: number;
}
export interface WaveUniformParams {
    amplitude: number;
    animationSpeed?: number;
    choppiness: number;
    gravity?: number;
    jonswapGamma?: number;
    peakWavelength: number;
    spectralSharpness: number;
    standingWaveRatio?: number;
    windDirection: number;
    windSpeed: number;
}
export interface SunUniformParams {
    azimuth: number;
    diskColor: string;
    elevation: number;
    intensity: number;
}
//# sourceMappingURL=params.d.ts.map
/**
 * Cascades configuration authored by presets.
 *
 * A single tile size sizes the whole FFT set. The largest cascade uses
 * `maxScale`; every finer cascade derives from it and the per-cascade
 * resolutions (see `deriveCascadeScale`). Resolution and enablement come from
 * the quality level, and each cascade's resolution can be overridden
 * independently; amplitude is the global `waves.fft.amplitude`.
 */
export interface CascadesConfig {
    /** World-space tile size of the largest cascade, in meters. */
    maxScale: number;
}
/**
 * Tile size of the cascade at `index`, working down from the largest.
 *
 * Cascade 0 is `maxScale`. Each finer cascade multiplies the previous tile by
 * `(3 · SEAM_MODE_DENSITY) / resolution`, where `resolution` is the *previous*
 * (coarser) cascade's own resolution. That ratio places the new cascade's
 * fundamental wavelength `SEAM_MODE_DENSITY` mode-rings below the coarser
 * cascade's seam — see `assignCascadeBands` for why that margin prevents
 * visible tiling. The `3` factor folds in the `1.5²` crossfade half-width on
 * each side of the seam (`BAND_CROSSFADE_RATIO`).
 *
 * Only the resolutions of cascades *before* `index` affect its tile size —
 * changing cascade `i`'s resolution reshapes every cascade after it and
 * never the cascades before it, so lowering any one resolution only ever
 * coarsens the detail floor of the finest cascade, never reintroduces a
 * sparse, tiling-prone band partway through the chain.
 */
export declare function deriveCascadeScale(maxScale: number, resolutions: number[], index: number): number;
/**
 * Parameter interfaces for simulation uniform classes.
 * Only cascade-specific values — shared wave physics params live in WaveUniforms.
 */
export interface CascadeSimulationParams {
    resolution: number;
    scale: number;
}
/**
 * Wave configuration for reactive params API.
 */
export interface WavesConfig {
    amplitude: number;
    animationSpeed: number;
    windSpeed: number;
    windDirection: number;
    choppiness: number;
    peakWavelength: number;
    maxScale: number;
    gravity: number;
    jonswapGamma: number;
    spectralSharpness: number;
}
//# sourceMappingURL=types.d.ts.map
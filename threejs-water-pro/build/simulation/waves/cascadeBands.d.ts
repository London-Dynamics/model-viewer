/**
 * Per-cascade spectral band assignment.
 *
 * The FFT ocean uses multiple cascades, each evaluating the Phillips·JONSWAP
 * spectrum over its own grid resolution and tile scale. Without partitioning,
 * every cascade carries the full radial frequency range, so mid-range waves
 * are duplicated across cascades with independent random phases and the
 * handoff scales look mushy.
 *
 * This module assigns each cascade a non-overlapping wavenumber band with
 * geometric-mean crossovers, then renormalizes amplitudes so each cascade's
 * total radial energy is preserved despite the narrower band.
 */
import type { WaveUniforms, CascadeSimulationUniforms } from "../../uniforms";
/**
 * Assigns each cascade a wavenumber band and an amplitude compensation factor.
 *
 * Bands partition the union of cascade k-ranges using geometric-mean crossovers
 * between adjacent cascades. Per-cascade `bandAmplitudeCompensation` is set so
 * that the cascade's banded radial energy matches its un-banded
 * `[kFundamental, kNyquist]` integral, preserving preset amplitude character.
 *
 * Cascades are processed in **input order** — cascade 0 owns the lowest-k
 * (largest-scale) band, cascade 1 the next, and so on. The caller is
 * responsible for ordering cascades so the scale strictly decreases with
 * index; the demo UI enforces this via non-overlapping slider ranges. If the
 * invariant is broken, the affected cascade's band degenerates and produces
 * no energy — there's no fallback re-sort.
 *
 * Reads `wave.windSpeed`, `wave.gravity`, `wave.jonswapGamma`,
 * `wave.spectralSharpness`, `wave.standingWaveRatio` — call this whenever any
 * of those change (or whenever cascade scale/resolution changes).
 */
export declare function assignCascadeBands(cascadeUniforms: CascadeSimulationUniforms[], wave: WaveUniforms): void;
//# sourceMappingURL=cascadeBands.d.ts.map
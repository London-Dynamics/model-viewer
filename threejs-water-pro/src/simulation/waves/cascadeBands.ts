// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Per-cascade spectral band assignment.
 *
 * The FFT ocean uses multiple cascades, each evaluating the Phillips·JONSWAP
 * spectrum over its own grid resolution and tile scale. Without partitioning,
 * every cascade carries the full radial frequency range, so mid-range waves
 * are synthesized twice with independent random phases and the total energy
 * exceeds the physical spectrum.
 *
 * This module partitions wavenumber space between cascades. Adjacent cascades
 * share a seam at the coarser cascade's own Nyquist limit (backed off by the
 * crossfade half-width); the spectrum shaders cross-fade spectral density
 * over [seam/1.5, seam·1.5] with complementary weights that sum to one, so
 * the banded cascades together carry exactly the continuum spectrum.
 * Per-mode variance stays Ψ(k,θ)·Δk²/2 everywhere (Horvath 2015, eq. 15/46:
 * amplitude is the spectrum integrated over one spectral cell, with no
 * renormalization).
 */

import type { CascadeSimulationUniforms } from "../../uniforms";

/**
 * Ratio defining each band edge's cross-fade interval [edge/1.5, edge·1.5].
 * Must match the smoothstep edges in the spectrum shaders.
 */
export const BAND_CROSSFADE_RATIO = 1.5;

/**
 * Minimum number of mode-rings a cascade's fundamental must sit below the
 * seam it inherits from the next-coarser cascade (see `deriveCascadeScale`).
 * Below this margin, the band nearest the seam is carried by too few plane
 * waves and tiles visibly — a handful of symmetric lattice modes (axis and
 * diagonal directions) dominate a periodic pattern that repeats every tile.
 * At `M = 8` the crossfade's near-zero-weight inner modes (n ≈ 6) still sit
 * inside a ~700-mode annulus by the time full weight is reached, so no
 * single plane wave is visually isolated. This is a tuned safety margin, not
 * a derived constant — raise it if tiling is still visible, lower it only
 * after confirming the annulus stays dense.
 */
export const SEAM_MODE_DENSITY = 8;

/**
 * `kBandLow` value that disables the low-edge window (first cascade). Small
 * enough that `smoothstep(kLo/1.5, kLo·1.5, k)` evaluates to 1 for every
 * representable wavenumber.
 */
export const BAND_NO_LOW_EDGE = 1.0e-9;

/**
 * Assigns each cascade its wavenumber band edges.
 *
 * Cascades are processed in **input order** — cascade 0 owns the lowest-k
 * (largest-scale) band, cascade 1 the next, and so on. The caller is
 * responsible for ordering cascades so the scale decreases with index; the
 * demo UI enforces this via non-overlapping slider ranges. There is no
 * fallback re-sort, and no seam placement can repair a pair whose native
 * ranges don't overlap — the wavenumbers between them are unrepresentable on
 * either grid, so the mismatch is reported rather than hidden.
 *
 * Band edges depend only on cascade scale and resolution — call this at init
 * and whenever either changes.
 */
export function assignCascadeBands(
  cascadeUniforms: CascadeSimulationUniforms[],
): void {
  const native = cascadeUniforms.map((u) => ({
    kFund: (2 * Math.PI) / u.scale.value,
    kNyq: (Math.PI * u.resolution.value) / u.scale.value,
  }));

  for (let i = 0; i < cascadeUniforms.length; i++) {
    const u = cascadeUniforms[i];

    if (i === 0) {
      // The largest cascade has no neighbor below: synthesize down to its
      // fundamental at full amplitude, longest wave included.
      u.kBandLow.value = BAND_NO_LOW_EDGE;
    }

    if (i < cascadeUniforms.length - 1) {
      // Seam with the next cascade: the highest wavenumber this cascade's
      // own grid can represent (its Nyquist, backed off by the crossfade
      // half-width). Pushing the seam this high — rather than a geometric
      // mean with the next cascade's fundamental — maximizes the finer
      // grid's mode index at the handoff, which is what lets
      // `deriveCascadeScale` guarantee `SEAM_MODE_DENSITY` rings of margin
      // with only two seams spanning `maxScale` down to centimeter detail.
      const seam = native[i].kNyq / BAND_CROSSFADE_RATIO;
      u.kBandHigh.value = seam;
      cascadeUniforms[i + 1].kBandLow.value = seam;

      // The finer cascade's low-edge cross-fade reaches full weight only at
      // `seam · BAND_CROSSFADE_RATIO`, so its fundamental must sit at or
      // below that; above it, the band between the two grids is
      // unrepresentable on either. `deriveCascadeScale` guarantees the
      // margin, so this fires only when a caller overrides resolutions.
      const seamReach = native[i + 1].kFund * BAND_CROSSFADE_RATIO;
      if (seamReach > seam) {
        console.warn(
          `assignCascadeBands: cascade ${i + 1} (tile ${cascadeUniforms[i + 1].scale.value} m, ` +
            `resolution ${cascadeUniforms[i + 1].resolution.value}) cannot reach the seam at ` +
            `k=${seam.toFixed(4)} rad/m inherited from cascade ${i}; its band starts at ` +
            `k=${seamReach.toFixed(4)} rad/m, leaving a spectral gap. Lower cascade ${i}'s ` +
            `resolution or raise cascade ${i + 1}'s.`,
        );
      }
    } else {
      // Terminal anti-alias roll-off: place the edge so the cross-fade
      // reaches zero exactly at this cascade's Nyquist limit.
      u.kBandHigh.value = native[i].kNyq / BAND_CROSSFADE_RATIO;
    }
  }
}

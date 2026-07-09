/**
 * Wave-sim time fold period in seconds. `WaterSystem` folds simulation
 * time modulo this constant before pushing to any GPU shader, which keeps
 * float32 phase precision sub-millisecond regardless of the absolute tick
 * magnitude the caller passes: `8192 / 2^23 ≈ 0.977 ms`.
 *
 * The same value also defines the **wave sim's loop period**. Every wave
 * angular frequency `omega` is snapped to the nearest multiple of
 * `2π / WAVE_TIME_PERIOD_SECONDS` at evaluation, so when the folded time
 * wraps from `WAVE_TIME_PERIOD_SECONDS − ε` back to `0`, each component's
 * phase has advanced an integer number of cycles. The wave field at the
 * wrap boundary is identical to the wave field at zero, so the wrap is
 * not visible.
 *
 * The cost is a tiny perturbation in each wave's frequency, at most
 * `π / WAVE_TIME_PERIOD_SECONDS ≈ 3.84e-4` rad/s. For typical wave omegas
 * (0.25–10 rad/s) the relative shift is well under 0.2%, below any
 * perceptual threshold. Wavelengths are exactly unchanged.
 */
export declare const WAVE_TIME_PERIOD_SECONDS = 8192;
/** Precomputed `2π / WAVE_TIME_PERIOD_SECONDS`, the quantization step in rad/s. */
export declare const WAVE_TIME_OMEGA_STEP: number;
//# sourceMappingURL=timing.d.ts.map
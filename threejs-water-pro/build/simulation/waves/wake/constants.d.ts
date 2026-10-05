/**
 * iWave solver constants shared by both backends.
 *
 * The wake must look identical on WebGPU (compute) and WebGL (render-to-texture),
 * so the kernel size, separable rank, source baking, stability clamp, sponge, and
 * height bound all live here as the single source of truth. A drift between
 * backends here would mean the same scene renders a different wake depending on
 * the renderer, which is the bug this module exists to prevent.
 */
/** Kernel half-size — P=10 gives `∝κ` dispersion across the wake band. */
export declare const KERNEL_HALF = 10;
/**
 * Separable rank of the `√(−∇²)` kernel. The kernel is symmetric and radial, so
 * its eigenvalues decay fast; rank 2 reproduces the operator to ~1%. Coupled to
 * the `vec2` scratch buffer/target: one channel per term.
 */
export declare const SEPARABLE_RANK = 2;
/** Sponge band width as a fraction of resolution; absorbs waves before the rim. */
export declare const SPONGE_FRACTION = 0.18;
/**
 * Per-frame amplitude scale at the very edge of the sponge. Strong (→0) so the
 * outer band is a real absorbing layer: the convolution uses clamp-to-border
 * reads (a reflecting boundary), so without a hard sponge — especially at low
 * friction — reflected waves build up at the rim and blow up. `smoothstep` keeps
 * the ramp gradual, so the interior wake is untouched.
 */
export declare const SPONGE_EDGE_DAMP = 0;
/**
 * Safety clamp on the height field — bounds any residual instability into a
 * visible artifact rather than an infinite spike. Far above real wake amplitude.
 */
export declare const MAX_WAKE_HEIGHT = 8;
/** Source gain: scales the baked per-frame source so a hull pass forms a ~`depth` trough. */
export declare const SOURCE_GAIN = 0.5;
/** Hull speed (m/s) at which the turbulent-track foam reaches full intensity. */
export declare const FOAM_SPEED_REF = 6;
/** dt-clamp Courant-like factor for the explicit leapfrog: `dt ≤ FACTOR·√(Δ/g)`. */
export declare const DT_STABILITY = 0.3;
//# sourceMappingURL=constants.d.ts.map
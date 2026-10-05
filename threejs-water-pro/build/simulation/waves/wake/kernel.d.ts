/**
 * iWave convolution kernel — the real-space form of the deep-water "vertical
 * derivative" operator √(−∇²) (Tessendorf, "Interactive Water Surfaces", Game
 * Programming Gems 4, 2004).
 *
 * On a Fourier mode of wavenumber `k`, √(−∇²) returns `|k|`, so the wake PDE
 * `∂²h/∂t² = −g·√(−∇²)·h` has dispersion `ω² = g·k` — different wavelengths
 * propagate at different speeds (`c = √(g/k) = √(gλ/2π)`). This module builds the
 * `(2P+1)²` convolution kernel `G(k,l)` that approximates that operator on a
 * grid, used by both the GPU solver and the CPU reference. The kernel is built
 * once at construction; it depends only on `P`.
 */
/**
 * Bessel function of the first kind, order 0. Polynomial / asymptotic fit from
 * Abramowitz & Stegun, *Handbook of Mathematical Functions* (1972), §9.4.1
 * (|x| ≤ 3) and §9.4.3 (x ≥ 3); accurate to ~1e-7. `J₀` is even, so negative
 * arguments fold to `|x|`.
 */
export declare function besselJ0(x: number): number;
/** Precomputed iWave kernel: a `(2P+1)²` square stored row-major, indexed `[(l+P)*size + (k+P)] = G(k,l)`. */
export interface IWaveKernel {
    /** Kernel half-size; the stencil reaches `±P` in each axis. */
    readonly P: number;
    /** Side length `2P+1`. */
    readonly size: number;
    /** Row-major weights `G(k,l)`, normalised so `G(0,0)=1`. */
    readonly weights: Float32Array;
}
/**
 * Rank-`rank` separable factorisation of an {@link IWaveKernel}: a short list of
 * 1D filters `eᵣ` and weights `λᵣ` with `G(k,l) ≈ Σᵣ λᵣ·eᵣ[k]·eᵣ[l]`. Lets the
 * solver replace the `(2P+1)²` 2D convolution with `rank` pairs of 1D
 * convolutions (see {@link separableKernel}).
 */
export interface SeparableKernel {
    /** Kernel half-size; each filter reaches `±P`. */
    readonly P: number;
    /** Filter length `2P+1`. */
    readonly size: number;
    /** Number of separable terms. */
    readonly rank: number;
    /** Per-term unit 1D filter `eᵣ`, length `size`, indexed `[k+P]`. */
    readonly filters: Float32Array[];
    /** Per-term weight `λᵣ` (the kernel's dominant eigenvalues, |λ| descending). */
    readonly lambdas: Float32Array;
}
/**
 * Build the iWave kernel `G(k,l) = [Σₙ qₙ²·exp(−σ·qₙ²)·J₀(qₙ·r)] / G₀`, with
 * `r=√(k²+l²)`, `qₙ=n·Δq`, and `G₀` the same sum at `r=0` (so `G(0,0)=1`). The
 * `exp(−σ·q²)` window truncates the integrand well before `q=N·Δq`. The numerator
 * is computed once per distinct `r²` (many cells share a radius), then divided by
 * `G₀`.
 *
 * @param P - kernel half-size. Tessendorf recommends 6 as the minimum for
 *   "clearly water-like motion", but P=6 truncates the operator's `1/r³` tail
 *   enough to corrupt the *longest* waves (their phase speed runs ~60% fast) and
 *   leaves a large DC residual. The project defaults to **10**: the symbol is
 *   `∝κ` (true `ω²=g·κ` dispersion) across the wake band within a few percent,
 *   for a `21×21` stencil. Larger P is more accurate but the convolution is
 *   memory-bound, so it trades against field resolution.
 */
export declare function buildIWaveKernel(P?: number): IWaveKernel;
/**
 * Physical scale for the operator: the factor `s` such that `s·(G ⊛ h)` has the
 * discrete Fourier symbol `|k_grid|` for well-resolved modes. The paper
 * normalises `G(0,0)=1`, which fixes the kernel's *shape* but not its
 * *magnitude*; applying `s` makes the leapfrog's dispersion `ω² = g·κ` hold in
 * physical units (with the separate `1/Δ` grid-spacing factor), so the wake
 * speed matches the shared ocean gravity rather than an arbitrary multiple.
 *
 * `s` is measured from the kernel's symbol at an axis wavenumber `θ` *inside the
 * wake band*: the 2D symbol at `(θ,0)` is `Σ G(k,l)·cos(θ·k)` (the imaginary
 * part cancels by reflection symmetry), and for `√(−∇²)` it should equal `θ`;
 * hence `s = θ / Σ G·cos(θ·k)`. `θ` is chosen mid-band (not near 0, where the
 * truncation's DC residual would skew it). Depends only on the kernel, so it is
 * computed once and reused.
 */
export declare function operatorScale(kernel: IWaveKernel): number;
/**
 * Rank-`rank` separable approximation of the iWave kernel. The kernel matrix is
 * symmetric and radial (`G(k,l)=f(k²+l²)`), so although it is not analytically
 * separable it is numerically near-rank-2: its eigenvalues decay fast (at P=10,
 * `|λ₁..₃| ≈ 1.97, 0.34, 0.026`), so `G ≈ Σᵣ λᵣ·eᵣ⊗eᵣ` over the top few
 * eigenpairs reproduces the operator to ~0.1% (rank 3 → max element error
 * ~3×10⁻⁴). That turns the `(2P+1)²` 2D convolution into `rank` pairs of 1D
 * convolutions — at P=10, rank 3 costs ~147 taps/texel instead of 441 — for the
 * same dispersion.
 *
 * The matrix is symmetric, so each term's row and column factors are the *same*
 * vector `eᵣ`: the solver applies it horizontally, then vertically, weighted by
 * `λᵣ`. Depends only on the kernel, so it is built once.
 *
 * @param kernel - the dense kernel from {@link buildIWaveKernel}.
 * @param rank - number of separable terms (default 3 → ~0.1% operator error).
 */
export declare function separableKernel(kernel: IWaveKernel, rank?: number): SeparableKernel;
//# sourceMappingURL=kernel.d.ts.map
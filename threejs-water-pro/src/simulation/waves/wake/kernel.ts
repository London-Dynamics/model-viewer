/**
 * iWave convolution kernel — the real-space form of the deep-water "vertical
 * derivative" operator √(−∇²) (Tessendorf, "Interactive Water Surfaces", Game
 * Programming Gems 4, 2004; `wiki/wake/iwave.md`).
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
export function besselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax < 3.0) {
    // §9.4.1: polynomial in y = (x/3)².
    const y = (x / 3.0) * (x / 3.0);
    return (
      1.0 +
      y *
        (-2.2499997 +
          y *
            (1.2656208 +
              y *
                (-0.3163866 +
                  y * (0.0444479 + y * (-0.0039444 + y * 0.0002100)))))
    );
  }
  // §9.4.3: asymptotic form, z = 3/x.
  const z = 3.0 / ax;
  const f0 =
    0.79788456 +
    z *
      (-0.00000077 +
        z *
          (-0.00552740 +
            z *
              (-0.00009512 +
                z * (0.00137237 + z * (-0.00072805 + z * 0.00014476)))));
  const theta0 =
    ax -
    0.78539816 +
    z *
      (-0.04166397 +
        z *
          (-0.00003954 +
            z *
              (0.00262573 +
                z * (-0.00054125 + z * (-0.00029333 + z * 0.00013558)))));
  return (f0 * Math.cos(theta0)) / Math.sqrt(ax);
}

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

/** Quadrature: integrate over `q ∈ (0, N·Δq]` with these constants (Tessendorf 2004). */
const DELTA_Q = 0.001;
const Q_SAMPLES = 10000;
/** σ in `exp(−σ·q²)`; the high-frequency cutoff that regularises the operator. */
const SIGMA = 1.0;

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
export function buildIWaveKernel(P = 10): IWaveKernel {
  // Precompute qₙ and the window weight qₙ²·exp(−σ·qₙ²).
  const q = new Float64Array(Q_SAMPLES);
  const qWeight = new Float64Array(Q_SAMPLES);
  for (let n = 1; n <= Q_SAMPLES; n++) {
    const qn = DELTA_Q * n;
    q[n - 1] = qn;
    qWeight[n - 1] = qn * qn * Math.exp(-SIGMA * qn * qn);
  }

  const numeratorByR2 = new Map<number, number>();
  const numeratorFor = (r2: number): number => {
    const cached = numeratorByR2.get(r2);
    if (cached !== undefined) return cached;
    const r = Math.sqrt(r2);
    let sum = 0;
    for (let n = 0; n < Q_SAMPLES; n++) {
      sum += qWeight[n] * besselJ0(q[n] * r);
    }
    numeratorByR2.set(r2, sum);
    return sum;
  };

  // J₀(0)=1 ⇒ numeratorFor(0) = Σ qWeight = G₀.
  const g0 = numeratorFor(0);
  const size = 2 * P + 1;
  const weights = new Float32Array(size * size);
  for (let l = -P; l <= P; l++) {
    for (let k = -P; k <= P; k++) {
      weights[(l + P) * size + (k + P)] = numeratorFor(k * k + l * l) / g0;
    }
  }
  return { P, size, weights };
}

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
export function operatorScale(kernel: IWaveKernel): number {
  const { P, size, weights } = kernel;
  const theta = 0.3; // mid wake-band wavenumber (rad/cell)
  let symbol = 0;
  for (let l = -P; l <= P; l++) {
    for (let k = -P; k <= P; k++) {
      symbol += weights[(l + P) * size + (k + P)] * Math.cos(theta * k);
    }
  }
  return theta / symbol;
}

/** One eigenpair of a symmetric matrix: eigenvalue and its unit eigenvector. */
interface Eigenpair {
  value: number;
  vector: Float64Array;
}

/**
 * Eigen-decomposition of a small dense symmetric matrix by the cyclic Jacobi
 * rotation method (Golub & Van Loan, *Matrix Computations*, §8.5). The iWave
 * kernel matrix is real, symmetric, and tiny (`size×size`, `size=2P+1`), so
 * Jacobi converges to machine precision in a handful of sweeps with no external
 * dependency. Returns the eigenpairs sorted by descending `|eigenvalue|`.
 */
function symmetricEigen(matrix: Float32Array, size: number): Eigenpair[] {
  // Working copy of the matrix (rotated toward diagonal) and the accumulated
  // rotation `v` (whose columns converge to the eigenvectors).
  const a: Float64Array[] = [];
  const v: Float64Array[] = [];
  for (let r = 0; r < size; r++) {
    const aRow = new Float64Array(size);
    const vRow = new Float64Array(size);
    for (let c = 0; c < size; c++) aRow[c] = matrix[r * size + c];
    vRow[r] = 1;
    a.push(aRow);
    v.push(vRow);
  }

  const MAX_SWEEPS = 100;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    // Sum of squared off-diagonal entries — the quantity Jacobi drives to zero.
    let offDiagSq = 0;
    for (let p = 0; p < size; p++) {
      for (let q = p + 1; q < size; q++) offDiagSq += a[p][q] * a[p][q];
    }
    if (offDiagSq < 1e-24) break;

    for (let p = 0; p < size; p++) {
      for (let q = p + 1; q < size; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        // Rotation that zeroes a[p][q] (Golub & Van Loan, Eq. 8.5.5).
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cos = 1 / Math.sqrt(t * t + 1);
        const sin = t * cos;
        for (let i = 0; i < size; i++) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = cos * aip - sin * aiq;
          a[i][q] = sin * aip + cos * aiq;
        }
        for (let i = 0; i < size; i++) {
          const api = a[p][i];
          const aqi = a[q][i];
          a[p][i] = cos * api - sin * aqi;
          a[q][i] = sin * api + cos * aqi;
        }
        for (let i = 0; i < size; i++) {
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = cos * vip - sin * viq;
          v[i][q] = sin * vip + cos * viq;
        }
      }
    }
  }

  const pairs: Eigenpair[] = [];
  for (let c = 0; c < size; c++) {
    const vector = new Float64Array(size);
    for (let r = 0; r < size; r++) vector[r] = v[r][c];
    pairs.push({ value: a[c][c], vector });
  }
  pairs.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  return pairs;
}

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
export function separableKernel(kernel: IWaveKernel, rank = 3): SeparableKernel {
  const { P, size, weights } = kernel;
  const eigenpairs = symmetricEigen(weights, size);
  const filters: Float32Array[] = [];
  const lambdas = new Float32Array(rank);
  for (let r = 0; r < rank; r++) {
    filters.push(Float32Array.from(eigenpairs[r].vector));
    lambdas[r] = eigenpairs[r].value;
  }
  return { P, size, rank, filters, lambdas };
}

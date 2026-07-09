import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  float,
  int,
  instanceIndex,
  max,
  mix,
  smoothstep,
  sqrt,
  uniform,
  uniformArray,
  vec2,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { TSLBuffer, TSLComputeShader } from "../../../../types/tsl";
import { buildIWaveKernel, operatorScale, separableKernel } from "../kernel";

/**
 * Separable rank of the `√(−∇²)` kernel. The kernel is symmetric and radial, so
 * its eigenvalues decay fast; rank 2 reproduces the operator to ~1% (see
 * {@link separableKernel}). Coupled to the `vec2` scratch buffer: one channel
 * per term.
 */
const SEPARABLE_RANK = 2;
/** Sponge band width as a fraction of resolution; absorbs waves before the rim. */
const SPONGE_FRACTION = 0.18;
/**
 * Per-frame amplitude scale at the very edge of the sponge. Strong (→0) so the
 * outer band is a real absorbing layer: the convolution uses clamp-to-border
 * reads (a reflecting boundary), so without a hard sponge — especially at low
 * friction — reflected waves build up at the rim and blow up. `smoothstep` keeps
 * the ramp gradual, so the interior wake is untouched.
 */
const SPONGE_EDGE_DAMP = 0.0;
/** Safety clamp on the height field — bounds any residual instability into a
 * visible artifact rather than an infinite spike. Far above real wake amplitude. */
const MAX_WAKE_HEIGHT = 8.0;

/** Height (current + previous) and foam state for one ping-pong side. */
export interface WakeBuffers {
  /** Surface height `h` per texel (`f32`). */
  height: TSLBuffer;
  /** Persistent foam energy per texel (`f32`); world-anchored decay + inject. */
  foam: TSLBuffer;
}

/** Stable displacement output the sampler binds. */
export interface WakeDisplacementOutput {
  /** vec2 per texel: `(height, foamEnergy)`. */
  displacement: TSLBuffer;
}

/**
 * Owns the iWave uniform nodes and builds the explicit leapfrog update
 * (Tessendorf 2004, Eq. 3; see `wiki/wake/iwave.md`).
 *
 * The `√(−∇²)` operator is a non-local convolution; rather than the naive
 * `(2P+1)²` 2D stencil (441 taps at P=10), the kernel is factored into a rank-2
 * separable form (`G ≈ Σᵣ λᵣ·eᵣ⊗eᵣ`; see {@link separableKernel}) and applied as
 * two 1D passes:
 *
 *  - {@link buildHorizontalPass} convolves the current height along x with each
 *    term's 1D filter, packing the rank-2 partial sums into a `vec2` scratch
 *    buffer. One thread per texel, no camera shift (it works in the buffer's own
 *    frame).
 *  - {@link buildLeapfrogPass} convolves the scratch along z (shifted by the
 *    camera-origin delta so the field stays world-anchored), weights the terms
 *    by `λᵣ`, scales by `1/Δ` for physical units, advances the leapfrog with the
 *    shared gravity uniform, adds each generator's moving source, sponge-damps
 *    the rim, and accumulates foam.
 *
 * Both passes clamp reads to the border (the sponge keeps the rim near zero).
 * The scheme requires friction `γ > 0` for stability (the truncated kernel is
 * not positive-definite at the grid scale).
 */
export class WakeIWaveCompute {
  private readonly _resolution: number;
  private readonly _maxGenerators: number;
  private readonly _kernelHalf: number;
  /** Per-term 1D filters `eᵣ` of the separable kernel, indexed `[k+P]`. */
  private readonly _filters: Float32Array[];
  /** Per-term weights `λᵣ` (`G ≈ Σᵣ λᵣ·eᵣ⊗eᵣ`). */
  private readonly _lambdas: Float32Array;

  // Per-frame / model uniforms.
  private _dt = uniform(0.016);
  private _gamma = uniform(0.6);
  private readonly _gravity: Node;
  /** Operator scale `s`: makes `s·(G⊛h)/Δ` reproduce `|κ|` (see {@link operatorScale}). */
  private _scale: ReturnType<typeof uniform>;

  // Foam.
  private _foamPersistence = uniform(0.99);
  private _foamStrength = uniform(0.5);
  private _foamBreakThreshold = uniform(0.05);

  // Buffer geometry.
  private _worldSize = uniform(400.0);
  private _originX = uniform(0.0);
  private _originZ = uniform(0.0);
  // Camera-shift for the CURRENT level (cur, written 1 frame ago).
  private _originShiftX = uniform(0, "int");
  private _originShiftZ = uniform(0, "int");
  // Camera-shift for the PREVIOUS level (h_{t−1}, written 2 frames ago): it must
  // be shifted by the accumulated `shift_n + shift_{n−1}`, not just this frame's,
  // or the leapfrog combines misaligned fields as the camera moves.
  private _prevShiftX = uniform(0, "int");
  private _prevShiftZ = uniform(0, "int");

  // Injection generators.
  private _genCount = uniform(0, "int");
  /** vec4 per slot: (fromX, fromZ, toX, toZ) world-space swept segment. */
  private readonly _genSegments: ReturnType<typeof uniformArray>;
  /** vec4 per slot: (sourceStrength, radius, speedNorm, 0). */
  private readonly _genParams: ReturnType<typeof uniformArray>;

  constructor(
    resolution: number,
    worldSize: number,
    gravity: Node,
    gamma: number,
    maxGenerators: number,
    kernelHalf: number,
  ) {
    this._resolution = resolution;
    this._maxGenerators = maxGenerators;
    this._worldSize.value = worldSize;
    this._gravity = gravity;
    this._gamma.value = gamma;

    const kernel = buildIWaveKernel(kernelHalf);
    this._kernelHalf = kernel.P;
    const separable = separableKernel(kernel, SEPARABLE_RANK);
    this._filters = separable.filters;
    this._lambdas = separable.lambdas;
    // The scale calibrates the dense operator; the separable form matches it to
    // ~0.1%, so the same scale applies.
    this._scale = uniform(operatorScale(kernel));

    this._genSegments = uniformArray(
      Array.from({ length: maxGenerators }, () => new THREE.Vector4()),
      "vec4",
    );
    this._genParams = uniformArray(
      Array.from({ length: maxGenerators }, () => new THREE.Vector4()),
      "vec4",
    );
  }

  // ============= Uniform accessors =============

  set dt(v: number) { this._dt.value = v; }
  set gamma(v: number) { this._gamma.value = v; }
  set foamPersistence(v: number) { this._foamPersistence.value = v; }
  set foamStrength(v: number) { this._foamStrength.value = v; }
  set foamBreakThreshold(v: number) { this._foamBreakThreshold.value = v; }
  set worldSize(v: number) { this._worldSize.value = v; }
  set originX(v: number) { this._originX.value = v; }
  set originZ(v: number) { this._originZ.value = v; }
  set originShiftX(v: number) { this._originShiftX.value = v; }
  set originShiftZ(v: number) { this._originShiftZ.value = v; }
  set prevShiftX(v: number) { this._prevShiftX.value = v; }
  set prevShiftZ(v: number) { this._prevShiftZ.value = v; }
  set genCount(v: number) { this._genCount.value = v; }

  get worldSizeValue(): number { return this._worldSize.value; }

  /** @internal TSL nodes shared with the sampler for the world↔texel mapping. */
  get originXNode(): Node { return this._originX; }
  get originZNode(): Node { return this._originZ; }
  get worldSizeNode(): Node { return this._worldSize; }

  /** Write one generator's swept segment and baked source stamp. */
  writeGenerator(
    index: number,
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    sourceStrength: number,
    radius: number,
    speedNorm: number,
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seg = this._genSegments as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const par = this._genParams as any;
    seg.array[index].set(fromX, fromZ, toX, toZ);
    par.array[index].set(sourceStrength, radius, speedNorm, 0);
    seg.needsUpdate = true;
    par.needsUpdate = true;
  }

  // ============= Shader builders =============

  /**
   * Pass 1 of the separable convolution: convolve `srcHeight` along x with each
   * of the rank-2 1D filters and pack the partial sums into `scratch` (vec2, one
   * channel per term). One thread per texel; reads clamp to the border. Runs in
   * the buffer's own frame — the camera shift is applied by the vertical pass.
   */
  buildHorizontalPass(
    srcHeight: TSLBuffer,
    scratch: TSLBuffer,
  ): TSLComputeShader {
    const res = this._resolution;
    const P = this._kernelHalf;
    const [e0, e1] = this._filters;

    return Fn(() => {
      const i = instanceIndex;
      const txI = int(i.mod(res));
      const tzI = int(i.div(res));

      const read = (ox: Node): Node => {
        const cx = ox.clamp(int(0), int(res - 1));
        return srcHeight.element(tzI.mul(int(res)).add(cx));
      };

      const t0 = float(0.0).toVar();
      const t1 = float(0.0).toVar();
      for (let k = -P; k <= P; k++) {
        const h = read(txI.add(k)).toVar();
        t0.addAssign(h.mul(e0[k + P]));
        t1.addAssign(h.mul(e1[k + P]));
      }
      scratch.element(i).assign(vec2(t0, t1));
    })().compute(res * res);
  }

  /**
   * Pass 2: convolve the horizontal scratch along z (completing `√(−∇²)h`),
   * weight by `λᵣ`, scale by `1/Δ`, and advance one explicit leapfrog step
   * (Tessendorf 2004, Eq. 3) with the moving source, sponge, and foam. Reads
   * `src` and writes `dst`; three variants are built (rotating buffer roles) and
   * dispatched in a 3-cycle. `prevHeight` is the leapfrog's `h_{t−1}`.
   */
  buildLeapfrogPass(
    src: WakeBuffers,
    dst: WakeBuffers,
    prevHeight: TSLBuffer,
    scratch: TSLBuffer,
    out: WakeDisplacementOutput,
  ): TSLComputeShader {
    const res = this._resolution;
    const P = this._kernelHalf;
    const maxGen = this._maxGenerators;
    const [e0, e1] = this._filters;
    const [l0, l1] = this._lambdas;
    const {
      _dt, _gamma, _gravity, _scale, _worldSize, _originX, _originZ,
      _originShiftX, _originShiftZ, _prevShiftX, _prevShiftZ,
      _genCount, _genSegments, _genParams,
      _foamPersistence, _foamStrength, _foamBreakThreshold,
    } = this;

    return Fn(() => {
      const i = instanceIndex;
      const txI = int(i.mod(res));
      const tzI = int(i.div(res));

      const dx = _worldSize.div(float(res));

      // Source coords with the camera shift folded in.
      const sx = txI.add(_originShiftX);
      const sz = tzI.add(_originShiftZ);

      // Clamp-to-border read (the sponge keeps the rim near zero).
      const readH = (buf: TSLBuffer, ox: Node, oz: Node): Node => {
        const cx = ox.clamp(int(0), int(res - 1));
        const cz = oz.clamp(int(0), int(res - 1));
        return buf.element(cz.mul(int(res)).add(cx));
      };

      const hC = readH(src.height, sx, sz);
      // h_{t−1} aligns by the accumulated two-frame shift (see _prevShift*).
      const hPrev = readH(prevHeight, txI.add(_prevShiftX), tzI.add(_prevShiftZ));

      // Vertical 1D convolution of the horizontal scratch, completing the
      // separable `√(−∇²)h` (= Σᵣ λᵣ·eᵣ⊗eᵣ ⊛ h), centred at the shifted (sx,sz);
      // scaled by 1/Δ (physical units → ω²=g·κ).
      const conv = float(0.0).toVar();
      for (let l = -P; l <= P; l++) {
        const cx = sx.clamp(int(0), int(res - 1));
        const cz = sz.add(l).clamp(int(0), int(res - 1));
        const s = scratch.element(cz.mul(int(res)).add(cx)).toVar();
        conv.addAssign(s.x.mul(l0 * e0[l + P]));
        conv.addAssign(s.y.mul(l1 * e1[l + P]));
      }
      const vd = _scale.mul(conv).div(dx);

      // Explicit leapfrog (Tessendorf 2004 Eq. 3); friction γ folds into the
      // coefficients (γ>0 required for stability).
      const denom = float(1.0).add(_gamma.mul(_dt));
      const aCoeff = float(2.0).sub(_gamma.mul(_dt)).div(denom);
      const bCoeff = float(1.0).div(denom);
      const cCoeff = _gravity.mul(_dt).mul(_dt).div(denom);
      const hNew = hC.mul(aCoeff).sub(hPrev.mul(bCoeff)).sub(vd.mul(cCoeff)).toVar();

      // Generator source: a moving displacement added to the height each frame
      // (Tessendorf 2004 "Sources"). par.x is the baked per-frame source rate;
      // par.z is the turbulent-track foam intensity.
      const worldX = _originX
        .sub(_worldSize.mul(0.5))
        .add(float(txI).add(0.5).mul(dx));
      const worldZ = _originZ
        .sub(_worldSize.mul(0.5))
        .add(float(tzI).add(0.5).mul(dx));
      const source = float(0.0).toVar();
      const hullFoam = float(0.0).toVar();
      Loop(maxGen, ({ i: gi }) => {
        If(int(gi).lessThan(_genCount), () => {
          const seg = _genSegments.element(gi);
          const par = _genParams.element(gi);
          const abx = seg.z.sub(seg.x);
          const abz = seg.w.sub(seg.y);
          const apx = worldX.sub(seg.x);
          const apz = worldZ.sub(seg.y);
          const abLenSq = abx.mul(abx).add(abz.mul(abz)).max(1e-6);
          const u = apx.mul(abx).add(apz.mul(abz)).div(abLenSq).clamp(0.0, 1.0);
          const cx = seg.x.add(abx.mul(u));
          const cz = seg.y.add(abz.mul(u));
          const ddx = worldX.sub(cx);
          const ddz = worldZ.sub(cz);
          const dist = sqrt(ddx.mul(ddx).add(ddz.mul(ddz)));
          const core = float(1.0).sub(smoothstep(float(0.0), par.y, dist));
          source.addAssign(par.x.mul(core));
          hullFoam.assign(hullFoam.max(core.mul(par.z)));
        });
      });
      hNew.addAssign(source.mul(_dt));

      // Absorbing sponge near the rim.
      const spongeWidth = Math.max(8, Math.floor(res * SPONGE_FRACTION));
      const txf = float(txI);
      const tzf = float(tzI);
      const edgeDist = txf
        .min(float(res - 1).sub(txf))
        .min(tzf)
        .min(float(res - 1).sub(tzf));
      const sponge = smoothstep(float(0.0), float(spongeWidth), edgeDist);
      const edgeFactor = mix(float(SPONGE_EDGE_DAMP), float(1.0), sponge);
      hNew.assign(hNew.mul(edgeFactor));

      // Safety clamp — bound any residual instability instead of an infinite spike.
      hNew.assign(hNew.clamp(float(-MAX_WAKE_HEIGHT), float(MAX_WAKE_HEIGHT)));

      // Foam: stronger of the hull's turbulent track (∝ speed) and breaking of
      // steep wake crests (|∇h|).
      const invTwoDx = float(0.5).div(dx);
      const hL = readH(src.height, sx.sub(1), sz);
      const hR = readH(src.height, sx.add(1), sz);
      const hD = readH(src.height, sx, sz.sub(1));
      const hU = readH(src.height, sx, sz.add(1));
      const slopeX = hR.sub(hL).mul(invTwoDx);
      const slopeZ = hU.sub(hD).mul(invTwoDx);
      const steepness = sqrt(slopeX.mul(slopeX).add(slopeZ.mul(slopeZ)));
      const breaking = smoothstep(
        _foamBreakThreshold, _foamBreakThreshold.add(0.3), steepness,
      );
      const foamSignal = max(hullFoam, breaking);
      const inject = foamSignal.mul(_foamStrength).mul(float(1.0).sub(_foamPersistence));
      const foamC = readH(src.foam, sx, sz);
      const foamNew = foamC.mul(_foamPersistence).add(inject).min(1.0).mul(edgeFactor);

      dst.height.element(i).assign(hNew);
      dst.foam.element(i).assign(foamNew);
      out.displacement.element(i).assign(vec2(hNew, foamNew));
    })().compute(res * res);
  }
}

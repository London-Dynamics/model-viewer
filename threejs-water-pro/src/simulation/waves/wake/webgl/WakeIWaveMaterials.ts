// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  float,
  int,
  max,
  mix,
  smoothstep,
  sqrt,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import { buildIWaveKernel, operatorScale, separableKernel } from "../kernel";
import {
  KERNEL_HALF,
  MAX_WAKE_HEIGHT,
  SEPARABLE_RANK,
  SPONGE_EDGE_DAMP,
  SPONGE_FRACTION,
} from "../constants";

/** A 1×1 zero texture so a material compiles before its real source is bound. */
function createPlaceholderTexture(): THREE.DataTexture {
  const data = new Float32Array([0, 0, 0, 1]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

/** Horizontal-convolution material plus the source-height texture it reads. */
export interface WakeHorizontalMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  /** Current-level state (R = height); convolved along x into the scratch target. */
  srcStateTextureNode: TextureNode;
}

/** Leapfrog material plus the three textures it reads per step. */
export interface WakeLeapfrogMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  /** Rank-2 horizontal partial sums (RG) from the horizontal pass. */
  scratchTextureNode: TextureNode;
  /** Current level: R = height, G = foam. */
  curStateTextureNode: TextureNode;
  /** Previous level (R = height) — the leapfrog's `h_{t−1}`. */
  prevStateTextureNode: TextureNode;
}

/**
 * Owns the iWave uniform nodes and builds the WebGL render-to-texture form of
 * Tessendorf's leapfrog update (the fragment-shader sibling of
 * {@link WakeIWaveCompute}).
 *
 * State lives in float render targets instead of storage buffers: each texel
 * packs `(height, foam)` into the RG channels, and the rank-2 horizontal partial
 * sums pack into the RG channels of a scratch target. The `√(−∇²)` operator is
 * applied as two passes — a horizontal 1D convolution into scratch, then a
 * vertical 1D convolution folded into the leapfrog. Texel reads use
 * `NearestFilter` sampling at texel centres and clamp to the border, matching
 * the compute kernel's integer `.element()` reads.
 *
 * The materials read their inputs through swappable {@link TextureNode}s, so a
 * single horizontal and a single leapfrog material serve every rotation phase —
 * the simulation just re-points the texture nodes at the current/previous/scratch
 * targets each step.
 */
export class WakeIWaveMaterials {
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
  private _worldSize = uniform(100.0);
  private _originX = uniform(0.0);
  private _originZ = uniform(0.0);
  // Camera-shift (texels) for the CURRENT level, written 1 frame ago. Float here
  // (vs the compute kernel's int) because the fragment path addresses texels in
  // floating-point UV space.
  private _originShiftX = uniform(0.0);
  private _originShiftZ = uniform(0.0);
  // Camera-shift for the PREVIOUS level (h_{t−1}, written 2 frames ago): shifted
  // by the accumulated `shift_n + shift_{n−1}`, or the leapfrog combines
  // misaligned fields as the camera moves.
  private _prevShiftX = uniform(0.0);
  private _prevShiftZ = uniform(0.0);

  // Injection generators.
  private _genCount = uniform(0, "int");
  /** vec4 per slot: (fromX, fromZ, toX, toZ) world-space swept segment. */
  private readonly _genSegments: ReturnType<typeof uniformArray>;
  /** vec4 per slot: (sourceStrength, radius, speedNorm, 0). */
  private readonly _genParams: ReturnType<typeof uniformArray>;

  /** Placeholder textures backing the swappable texture nodes until real targets are bound; freed in {@link dispose}. */
  private readonly _placeholders: THREE.DataTexture[] = [];

  constructor(
    resolution: number,
    worldSize: number,
    gravity: Node,
    gamma: number,
    maxGenerators: number,
  ) {
    this._resolution = resolution;
    this._maxGenerators = maxGenerators;
    this._worldSize.value = worldSize;
    this._gravity = gravity;
    this._gamma.value = gamma;

    const kernel = buildIWaveKernel(KERNEL_HALF);
    this._kernelHalf = kernel.P;
    const separable = separableKernel(kernel, SEPARABLE_RANK);
    this._filters = separable.filters;
    this._lambdas = separable.lambdas;
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

  /** Free the placeholder textures created for the swappable texture nodes. */
  dispose(): void {
    for (const tex of this._placeholders) tex.dispose();
    this._placeholders.length = 0;
  }

  // ============= Shader builders =============

  /** Create a 1×1 placeholder texture and track it so {@link dispose} can free it. */
  private _placeholderTexture(): THREE.DataTexture {
    const tex = createPlaceholderTexture();
    this._placeholders.push(tex);
    return tex;
  }

  /**
   * Clamp-to-border texel read: sample `tex` at integer texel `(x, z)` via its
   * centre UV. `NearestFilter` resolves it to the exact texel; the clamp matches
   * the compute kernel's `.clamp(0, res-1)` reflecting boundary.
   */
  private _readTexel(tex: TextureNode, x: Node, z: Node): Node {
    const res = this._resolution;
    const cx = (x as ReturnType<typeof float>).clamp(0.0, res - 1);
    const cz = (z as ReturnType<typeof float>).clamp(0.0, res - 1);
    return tex.sample(vec2(cx.add(0.5).div(res), cz.add(0.5).div(res)));
  }

  /**
   * Pass 1 of the separable convolution: convolve the current level's height
   * along x with each rank-2 1D filter and pack the partial sums into the
   * scratch target's RG channels. Runs in the buffer's own frame — the camera
   * shift is applied by the leapfrog pass.
   */
  buildHorizontalMaterial(): WakeHorizontalMaterialResult {
    const res = this._resolution;
    const P = this._kernelHalf;
    const [e0, e1] = this._filters;
    const srcStateTextureNode = texture(this._placeholderTexture());

    const outputNode = Fn(() => {
      const pixel = uv().mul(float(res)).floor();
      const txI = pixel.x;
      const tzI = pixel.y;

      const t0 = float(0.0).toVar();
      const t1 = float(0.0).toVar();
      for (let k = -P; k <= P; k++) {
        const h = this._readTexel(srcStateTextureNode, txI.add(k), tzI).x.toVar();
        t0.addAssign(h.mul(e0[k + P]));
        t1.addAssign(h.mul(e1[k + P]));
      }
      return vec4(t0, t1, float(0.0), float(1.0));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.outputNode = outputNode;
    material.depthTest = false;
    material.depthWrite = false;

    return { material, srcStateTextureNode };
  }

  /**
   * Pass 2: convolve the horizontal scratch along z (completing `√(−∇²)h`),
   * weight by `λᵣ`, scale by `1/Δ`, and advance one explicit leapfrog step
   * (Tessendorf 2004, Eq. 3) with the moving source, sponge, and foam. Reads the
   * current and previous levels plus the scratch; writes `(height, foam)` into
   * the destination target's RG channels.
   */
  buildLeapfrogMaterial(): WakeLeapfrogMaterialResult {
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

    const scratchTextureNode = texture(this._placeholderTexture());
    const curStateTextureNode = texture(this._placeholderTexture());
    const prevStateTextureNode = texture(this._placeholderTexture());

    const outputNode = Fn(() => {
      const pixel = uv().mul(float(res)).floor();
      const txI = pixel.x;
      const tzI = pixel.y;

      const dx = _worldSize.div(float(res));

      // Source coords with the camera shift folded in.
      const sx = txI.add(_originShiftX);
      const sz = tzI.add(_originShiftZ);

      const hC = this._readTexel(curStateTextureNode, sx, sz).x;
      // h_{t−1} aligns by the accumulated two-frame shift (see _prevShift*).
      const hPrev = this._readTexel(
        prevStateTextureNode, txI.add(_prevShiftX), tzI.add(_prevShiftZ),
      ).x;

      // Vertical 1D convolution of the horizontal scratch, completing the
      // separable `√(−∇²)h`, centred at the shifted (sx,sz); scaled by 1/Δ.
      const conv = float(0.0).toVar();
      for (let l = -P; l <= P; l++) {
        const s = this._readTexel(scratchTextureNode, sx, sz.add(l)).toVar();
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
        .add(txI.add(0.5).mul(dx));
      const worldZ = _originZ
        .sub(_worldSize.mul(0.5))
        .add(tzI.add(0.5).mul(dx));
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
      const edgeDist = txI
        .min(float(res - 1).sub(txI))
        .min(tzI)
        .min(float(res - 1).sub(tzI));
      const sponge = smoothstep(float(0.0), float(spongeWidth), edgeDist);
      const edgeFactor = mix(float(SPONGE_EDGE_DAMP), float(1.0), sponge);
      hNew.assign(hNew.mul(edgeFactor));

      // Safety clamp — bound any residual instability instead of an infinite spike.
      hNew.assign(hNew.clamp(float(-MAX_WAKE_HEIGHT), float(MAX_WAKE_HEIGHT)));

      // Foam: stronger of the hull's turbulent track (∝ speed) and breaking of
      // steep wake crests (|∇h|).
      const invTwoDx = float(0.5).div(dx);
      const hL = this._readTexel(curStateTextureNode, sx.sub(1), sz).x;
      const hR = this._readTexel(curStateTextureNode, sx.add(1), sz).x;
      const hD = this._readTexel(curStateTextureNode, sx, sz.sub(1)).x;
      const hU = this._readTexel(curStateTextureNode, sx, sz.add(1)).x;
      const slopeX = hR.sub(hL).mul(invTwoDx);
      const slopeZ = hU.sub(hD).mul(invTwoDx);
      const steepness = sqrt(slopeX.mul(slopeX).add(slopeZ.mul(slopeZ)));
      const breaking = smoothstep(
        _foamBreakThreshold, _foamBreakThreshold.add(0.3), steepness,
      );
      const foamSignal = max(hullFoam, breaking);
      const inject = foamSignal.mul(_foamStrength).mul(float(1.0).sub(_foamPersistence));
      const foamC = this._readTexel(curStateTextureNode, sx, sz).y;
      const foamNew = foamC.mul(_foamPersistence).add(inject).min(1.0).mul(edgeFactor);

      return vec4(hNew, foamNew, float(0.0), float(1.0));
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.outputNode = outputNode;
    material.depthTest = false;
    material.depthWrite = false;

    return {
      material,
      scratchTextureNode,
      curStateTextureNode,
      prevStateTextureNode,
    };
  }
}

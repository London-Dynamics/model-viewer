import type { Node } from "three/webgpu";
import type { TSLBuffer, TSLComputeShader } from "../../../../types/tsl";
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
 * (Tessendorf 2004, Eq. 3).
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
export declare class WakeIWaveCompute {
    private readonly _resolution;
    private readonly _maxGenerators;
    private readonly _kernelHalf;
    /** Per-term 1D filters `eᵣ` of the separable kernel, indexed `[k+P]`. */
    private readonly _filters;
    /** Per-term weights `λᵣ` (`G ≈ Σᵣ λᵣ·eᵣ⊗eᵣ`). */
    private readonly _lambdas;
    private _dt;
    private _gamma;
    private readonly _gravity;
    /** Operator scale `s`: makes `s·(G⊛h)/Δ` reproduce `|κ|` (see {@link operatorScale}). */
    private _scale;
    private _foamPersistence;
    private _foamStrength;
    private _foamBreakThreshold;
    private _worldSize;
    private _originX;
    private _originZ;
    private _originShiftX;
    private _originShiftZ;
    private _prevShiftX;
    private _prevShiftZ;
    private _genCount;
    /** vec4 per slot: (fromX, fromZ, toX, toZ) world-space swept segment. */
    private readonly _genSegments;
    /** vec4 per slot: (sourceStrength, radius, speedNorm, 0). */
    private readonly _genParams;
    constructor(resolution: number, worldSize: number, gravity: Node, gamma: number, maxGenerators: number, kernelHalf: number);
    set dt(v: number);
    set gamma(v: number);
    set foamPersistence(v: number);
    set foamStrength(v: number);
    set foamBreakThreshold(v: number);
    set worldSize(v: number);
    set originX(v: number);
    set originZ(v: number);
    set originShiftX(v: number);
    set originShiftZ(v: number);
    set prevShiftX(v: number);
    set prevShiftZ(v: number);
    set genCount(v: number);
    get worldSizeValue(): number;
    /** @internal TSL nodes shared with the sampler for the world↔texel mapping. */
    get originXNode(): Node;
    get originZNode(): Node;
    get worldSizeNode(): Node;
    /** Write one generator's swept segment and baked source stamp. */
    writeGenerator(index: number, fromX: number, fromZ: number, toX: number, toZ: number, sourceStrength: number, radius: number, speedNorm: number): void;
    /**
     * Pass 1 of the separable convolution: convolve `srcHeight` along x with each
     * of the rank-2 1D filters and pack the partial sums into `scratch` (vec2, one
     * channel per term). One thread per texel; reads clamp to the border. Runs in
     * the buffer's own frame — the camera shift is applied by the vertical pass.
     */
    buildHorizontalPass(srcHeight: TSLBuffer, scratch: TSLBuffer): TSLComputeShader;
    /**
     * Pass 2: convolve the horizontal scratch along z (completing `√(−∇²)h`),
     * weight by `λᵣ`, scale by `1/Δ`, and advance one explicit leapfrog step
     * (Tessendorf 2004, Eq. 3) with the moving source, sponge, and foam. Reads
     * `src` and writes `dst`; three variants are built (rotating buffer roles) and
     * dispatched in a 3-cycle. `prevHeight` is the leapfrog's `h_{t−1}`.
     */
    buildLeapfrogPass(src: WakeBuffers, dst: WakeBuffers, prevHeight: TSLBuffer, scratch: TSLBuffer, out: WakeDisplacementOutput): TSLComputeShader;
}
//# sourceMappingURL=WakeIWaveCompute.d.ts.map
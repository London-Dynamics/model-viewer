import * as THREE from "three/webgpu";
import type { Node, TextureNode } from "three/webgpu";
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
export declare class WakeIWaveMaterials {
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
    /** Placeholder textures backing the swappable texture nodes until real targets are bound; freed in {@link dispose}. */
    private readonly _placeholders;
    constructor(resolution: number, worldSize: number, gravity: Node, gamma: number, maxGenerators: number);
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
    /** Free the placeholder textures created for the swappable texture nodes. */
    dispose(): void;
    /** Create a 1×1 placeholder texture and track it so {@link dispose} can free it. */
    private _placeholderTexture;
    /**
     * Clamp-to-border texel read: sample `tex` at integer texel `(x, z)` via its
     * centre UV. `NearestFilter` resolves it to the exact texel; the clamp matches
     * the compute kernel's `.clamp(0, res-1)` reflecting boundary.
     */
    private _readTexel;
    /**
     * Pass 1 of the separable convolution: convolve the current level's height
     * along x with each rank-2 1D filter and pack the partial sums into the
     * scratch target's RG channels. Runs in the buffer's own frame — the camera
     * shift is applied by the leapfrog pass.
     */
    buildHorizontalMaterial(): WakeHorizontalMaterialResult;
    /**
     * Pass 2: convolve the horizontal scratch along z (completing `√(−∇²)h`),
     * weight by `λᵣ`, scale by `1/Δ`, and advance one explicit leapfrog step
     * (Tessendorf 2004, Eq. 3) with the moving source, sponge, and foam. Reads the
     * current and previous levels plus the scratch; writes `(height, foam)` into
     * the destination target's RG channels.
     */
    buildLeapfrogMaterial(): WakeLeapfrogMaterialResult;
}
//# sourceMappingURL=WakeIWaveMaterials.d.ts.map
import type * as THREE from "three/webgpu";
import type { Node, StorageBufferNode, UniformFloatNode } from "./types";
/** Result from {@link CascadeSampler.sampleDisplacement}. */
export interface CascadeDisplacementResult {
    /** Combined displacement from all cascades (vec3). */
    displacement: Node;
    /** X coordinate for sampling cascade 1 (displaced by cascade 0). */
    hierarchicalCoordsX: Node;
    /** Z coordinate for sampling cascade 1 (displaced by cascade 0). */
    hierarchicalCoordsZ: Node;
}
/** Result from {@link CascadeSampler.sampleNormals}. */
export interface CascadeNormalsResult {
    /** Blended normal from all cascades (vec3). */
    normal: Node;
    /** Eigenvalue from cascade 0 (waves). Smaller = more folding. */
    eigen0: Node;
    /** Eigenvalue from cascade 1 (ripples). Smaller = more folding. */
    eigen1: Node;
}
/** Parameters for {@link CascadeSampler.sampleFoamAccumulation}. */
export interface FoamAccumulationSampleParams {
    /** Cascade 0 foam energy buffer. */
    foamBuffer0: StorageBufferNode;
    /** World X coordinate (cascade 0 sampling site). */
    worldX: Node;
    /** World Z coordinate (cascade 0 sampling site). */
    worldZ: Node;
}
/**
 * WebGPU-only sampler for FFT ocean simulation cascade buffers.
 *
 * Owns cascade resolution and scale uniforms. Provides methods for sampling
 * displacement (vertex stage) and normals (fragment stage) with proper
 * hierarchical cascade blending.
 *
 * Hierarchical sampling ensures smaller-scale cascades (ripples) are sampled
 * at positions displaced by larger-scale cascades (waves), so ripples correctly
 * "ride" on the wave structures.
 */
export declare class CascadeSampler {
    private _resolution0;
    private _scale0;
    private _resolution1;
    private _scale1;
    /** Number of active cascades (affects shader compilation). */
    readonly cascadeCount: 1 | 2;
    /**
     * Creates a CascadeSampler for the specified cascade count.
     *
     * @param cascadeCount - Number of cascades (1 or 2).
     */
    constructor(cascadeCount: 1 | 2);
    /** Resolution of cascade 0 (waves) in texels. */
    get resolution0(): number;
    set resolution0(value: number);
    /** World-space scale of cascade 0 (waves) in units. */
    get scale0(): number;
    set scale0(value: number);
    /** Resolution of cascade 1 (ripples) in texels. */
    get resolution1(): number;
    set resolution1(value: number);
    /** World-space scale of cascade 1 (ripples) in units. */
    get scale1(): number;
    set scale1(value: number);
    /** @internal Resolution0 uniform node for shader binding. */
    get _resolution0Node(): UniformFloatNode;
    /** @internal Scale0 uniform node for shader binding. */
    get _scale0Node(): UniformFloatNode;
    /** @internal Resolution1 uniform node for shader binding. */
    get _resolution1Node(): UniformFloatNode;
    /** @internal Scale1 uniform node for shader binding. */
    get _scale1Node(): UniformFloatNode;
    /**
     * Updates a cascade's resolution and scale.
     *
     * @param index - Cascade index (0 or 1).
     * @param resolution - Resolution in texels.
     * @param scale - World-space scale in units.
     */
    updateCascade(index: number, resolution: number, scale: number): void;
    /**
     * Samples displacement from cascade buffers with hierarchical blending.
     *
     * For 2 cascades: cascade 1 is sampled at positions displaced by cascade 0,
     * so ripples "ride" on waves.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     * @param buffer0 - Cascade 0 displacement buffer.
     * @param buffer1 - Cascade 1 displacement buffer (required if cascadeCount is 2).
     */
    sampleDisplacement(worldX: Node, worldZ: Node, buffer0: StorageBufferNode, buffer1?: StorageBufferNode): CascadeDisplacementResult;
    /**
     * Samples normals from cascade textures with hierarchical blending.
     *
     * Uses hardware bilinear via `texture().sample()` on the FFT normal
     * StorageTextures (one HW sample per cascade vs. four storage-buffer
     * fetches). Blends cascade normals with reoriented normal mapping (RNM)
     * and flips normals pointing downward (caused by high choppiness).
     *
     * @param worldX - World X coordinate (for cascade 0).
     * @param worldZ - World Z coordinate (for cascade 0).
     * @param hierarchicalCoordsX - Hierarchical X coordinate (for cascade 1).
     * @param hierarchicalCoordsZ - Hierarchical Z coordinate (for cascade 1).
     * @param normalTexture0 - Cascade 0 normal storage texture.
     * @param normalTexture1 - Cascade 1 normal storage texture (required if cascadeCount is 2).
     */
    sampleNormals(worldX: Node, worldZ: Node, hierarchicalCoordsX: Node, hierarchicalCoordsZ: Node, normalTexture0: THREE.Texture, normalTexture1: THREE.Texture | undefined): CascadeNormalsResult;
    /**
     * Samples the persistent foam accumulation buffer at a world-space
     * coordinate. Only cascade 0 is stored; ripple-scale injection would
     * smear into a uniform haze.
     *
     * @param params - World coordinates and foam buffer bindings.
     * @returns Foam energy at the sampled location (FloatNode, `≥ 0`).
     */
    sampleFoamAccumulation(params: FoamAccumulationSampleParams): Node;
    /**
     * Samples displacement buffer at world coordinates.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     * @param buffer - Displacement storage buffer.
     * @param resolution - Buffer resolution uniform.
     * @param scale - World-space scale uniform.
     */
    private sampleDisplacementBuffer;
    /**
     * Samples a normal storage texture with hardware bilinear filtering and
     * seamless tile wraparound. One HW sample replaces the four manual
     * storage-buffer fetches the old `sampleNormalBuffer` did.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     * @param tex - Normal storage texture (RGBA32F, RepeatWrapping, LinearFilter).
     * @param resolution - Cascade resolution uniform (texels per side).
     * @param scale - Cascade world-space scale uniform.
     */
    private sampleNormalTexture;
    /**
     * Samples a cascade's foam accumulation buffer (vec2 `.x` = energy).
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     * @param buffer - Foam energy storage buffer (vec2 per texel).
     * @param resolution - Buffer resolution uniform.
     * @param scale - World-space scale uniform.
     */
    private sampleFoamBuffer;
}
//# sourceMappingURL=cascadeSampler.d.ts.map
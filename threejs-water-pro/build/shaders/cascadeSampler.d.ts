import type * as THREE from "three/webgpu";
import type { Node, StorageBufferNode } from "./types";
/** World XZ used to sample one cascade, hierarchically displaced by every coarser cascade. */
export interface HierarchicalCoords {
    x: Node;
    z: Node;
}
/** Result from {@link CascadeSampler.sampleDisplacement}. */
export interface CascadeDisplacementResult {
    /** Combined displacement from all cascades (vec3). */
    displacement: Node;
    /**
     * Sample coordinates for cascades 1..cascadeCount-1, in order (empty when
     * cascadeCount is 1). Pass to {@link CascadeSampler.sampleNormals} so the
     * fragment stage samples each cascade's normal at the same hierarchically
     * displaced position used here.
     */
    hierarchicalCoords: HierarchicalCoords[];
}
/** Result from {@link CascadeSampler.sampleNormals}. */
export interface CascadeNormalsResult {
    /** Blended normal from all cascades (vec3). */
    normal: Node;
    /**
     * Sub-footprint slope variance (0-1), the roughness the mip-averaged
     * normals discard. Mip filtering shortens the averaged normal when
     * sub-texel normals disagree, so `1 - |n|` per cascade (summed) measures
     * how much wave detail the pixel footprint folded away — the input to a
     * filtered-BRDF reflection roughness (Toksvig 2005).
     */
    slopeVariance: Node;
}
/**
 * WebGPU-only sampler for FFT ocean simulation cascade buffers.
 *
 * Owns cascade resolution and scale uniforms. Provides methods for sampling
 * displacement (vertex stage) and normals (fragment stage) with proper
 * hierarchical cascade blending.
 *
 * Hierarchical sampling ensures finer cascades are sampled at positions
 * displaced by every coarser cascade before them, so ripples correctly
 * "ride" on swell and waves.
 */
export declare class CascadeSampler {
    private _resolutions;
    private _scales;
    /** Number of active cascades (affects shader compilation). Fixed for the sampler's lifetime. */
    readonly cascadeCount: number;
    /**
     * Creates a CascadeSampler for the specified cascade count.
     *
     * @param cascadeCount - Number of cascades (1-3).
     */
    constructor(cascadeCount: number);
    /**
     * Updates a cascade's resolution and scale.
     *
     * @param index - Cascade index (0..cascadeCount-1).
     * @param resolution - Resolution in texels.
     * @param scale - World-space scale in units.
     */
    updateCascade(index: number, resolution: number, scale: number): void;
    /**
     * Samples displacement from cascade buffers with hierarchical blending.
     *
     * Each cascade after the first is sampled at coordinates displaced by the
     * running sum of every coarser cascade's displacement, so finer cascades
     * "ride" on the ones before them.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     * @param buffers - Displacement buffers, one per cascade, coarsest first.
     */
    sampleDisplacement(worldX: Node, worldZ: Node, buffers: StorageBufferNode[]): CascadeDisplacementResult;
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
     * @param hierarchicalCoords - Sample coordinates for cascades 1..cascadeCount-1
     *   from {@link sampleDisplacement}.
     * @param normalTextures - Cascade normal storage textures, one per cascade, coarsest first.
     */
    sampleNormals(worldX: Node, worldZ: Node, hierarchicalCoords: HierarchicalCoords[], normalTextures: THREE.Texture[]): CascadeNormalsResult;
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
     * @param tex - Normal storage texture (RGBA16F, RepeatWrapping, mipmapped trilinear/anisotropic).
     * @param scale - Cascade world-space scale uniform.
     */
    private sampleNormalTexture;
}
//# sourceMappingURL=cascadeSampler.d.ts.map
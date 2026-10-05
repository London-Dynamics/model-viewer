// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * CascadeSampler - WebGPU-only class for sampling FFT ocean simulation buffers.
 *
 * Handles bilinear interpolation, hierarchical cascade sampling, and normal blending.
 * This class is only instantiated when WebGPU storage buffers are available.
 */
import {
  clamp,
  float,
  int,
  length,
  max,
  normalize,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type * as THREE from "three/webgpu";
import type { FloatNode, Node, StorageBufferNode, UniformFloatNode } from "./types";
import { sampleBufferBilinear, worldToPixelCoords } from "./common";

// ============= Result Types =============

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

// ============= CascadeSampler Class =============

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
export class CascadeSampler {
  private _resolutions: UniformFloatNode[];
  private _scales: UniformFloatNode[];

  /** Number of active cascades (affects shader compilation). Fixed for the sampler's lifetime. */
  readonly cascadeCount: number;

  /**
   * Creates a CascadeSampler for the specified cascade count.
   *
   * @param cascadeCount - Number of cascades (1-3).
   */
  constructor(cascadeCount: number) {
    this.cascadeCount = cascadeCount;
    this._resolutions = [];
    this._scales = [];
    for (let i = 0; i < cascadeCount; i++) {
      this._resolutions.push(uniform(256));
      this._scales.push(uniform(500.0));
    }
  }

  // ============= Bulk Update =============

  /**
   * Updates a cascade's resolution and scale.
   *
   * @param index - Cascade index (0..cascadeCount-1).
   * @param resolution - Resolution in texels.
   * @param scale - World-space scale in units.
   */
  updateCascade(index: number, resolution: number, scale: number): void {
    this._resolutions[index].value = resolution;
    this._scales[index].value = scale;
  }

  // ============= Sampling Methods =============

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
  sampleDisplacement(
    worldX: Node,
    worldZ: Node,
    buffers: StorageBufferNode[],
  ): CascadeDisplacementResult {
    let sampleX = worldX as FloatNode;
    let sampleZ = worldZ as FloatNode;
    let dispX: Node = float(0.0);
    let dispY: Node = float(0.0);
    let dispZ: Node = float(0.0);
    const hierarchicalCoords: HierarchicalCoords[] = [];

    for (let i = 0; i < this.cascadeCount; i++) {
      const d = this.sampleDisplacementBuffer(
        sampleX,
        sampleZ,
        buffers[i],
        this._resolutions[i],
        this._scales[i],
      );
      dispX = i === 0 ? d.x : dispX.add(d.x);
      dispY = i === 0 ? d.y : dispY.add(d.y);
      dispZ = i === 0 ? d.z : dispZ.add(d.z);

      if (i < this.cascadeCount - 1) {
        sampleX = sampleX.add(d.x) as FloatNode;
        sampleZ = sampleZ.add(d.z) as FloatNode;
        hierarchicalCoords.push({ x: sampleX, z: sampleZ });
      }
    }

    return { displacement: vec3(dispX, dispY, dispZ), hierarchicalCoords };
  }

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
  sampleNormals(
    worldX: Node,
    worldZ: Node,
    hierarchicalCoords: HierarchicalCoords[],
    normalTextures: THREE.Texture[],
  ): CascadeNormalsResult {
    const sample0 = this.sampleNormalTexture(
      worldX as FloatNode,
      worldZ as FloatNode,
      normalTextures[0],
      this._scales[0],
    );

    let accX: Node = sample0.normal.x;
    let accY: Node = sample0.normal.y;
    let accZ: Node = sample0.normal.z;
    // Slope variances of independent wavelet bands add (Bruneton et al. 2010,
    // Eq. 4), so accumulate each cascade's length-deficit contribution.
    let slopeVariance: Node = sample0.variance;

    for (let i = 1; i < this.cascadeCount; i++) {
      const coords = hierarchicalCoords[i - 1];
      const sample = this.sampleNormalTexture(
        coords.x as FloatNode,
        coords.z as FloatNode,
        normalTextures[i],
        this._scales[i],
      );
      accX = accX.add(sample.normal.x);
      accY = accY.add(sample.normal.y.sub(1.0));
      accZ = accZ.add(sample.normal.z);
      slopeVariance = slopeVariance.add(sample.variance);
    }

    return {
      normal: normalize(vec3(accX, accY, accZ)),
      slopeVariance: clamp(slopeVariance, 0.0, 1.0),
    };
  }

  // ============= Private Helpers =============

  /**
   * Samples displacement buffer at world coordinates.
   *
   * @param worldX - World X coordinate.
   * @param worldZ - World Z coordinate.
   * @param buffer - Displacement storage buffer.
   * @param resolution - Buffer resolution uniform.
   * @param scale - World-space scale uniform.
   */
  private sampleDisplacementBuffer(
    worldX: FloatNode,
    worldZ: FloatNode,
    buffer: StorageBufferNode,
    resolution: UniformFloatNode,
    scale: UniformFloatNode,
  ): Node {
    const { px, py } = worldToPixelCoords(worldX, worldZ, resolution, scale);
    return sampleBufferBilinear(px, py, buffer, int(resolution));
  }

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
  private sampleNormalTexture(
    worldX: FloatNode,
    worldZ: FloatNode,
    tex: THREE.Texture,
    scale: UniformFloatNode,
  ): { normal: Node; variance: Node } {
    // The cascade tile spans exactly `scale` meters (see worldToPixelCoords).
    const u = worldX.div(scale as FloatNode).add(0.5);
    const v = worldZ.div(scale as FloatNode).add(0.5);
    const sample = texture(tex).sample(vec2(u, v));

    // Convert normal from [0,1] to [-1,1]
    const normal = sample.xyz.mul(2.0).sub(1.0);

    // Length deficit of the mip-averaged normal: 1 at full detail, shrinking
    // as the footprint folds sub-texel normals together. `1 - |n|` is the
    // discarded sub-footprint slope variance (Toksvig 2005).
    const variance = max(float(1.0).sub(length(normal)), 0.0);

    return { normal, variance };
  }
}

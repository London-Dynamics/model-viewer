/**
 * CascadeSampler - WebGPU-only class for sampling FFT ocean simulation buffers.
 *
 * Handles bilinear interpolation, hierarchical cascade sampling, and normal blending.
 * This class is only instantiated when WebGPU storage buffers are available.
 */
import { float, int, normalize, texture, uniform, vec2, vec3 } from "three/tsl";
import type * as THREE from "three/webgpu";
import type { FloatNode, Node, StorageBufferNode, UniformFloatNode } from "./types";
import { sampleBufferBilinear, worldToPixelCoords } from "./common";

// ============= Result Types =============

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

// ============= CascadeSampler Class =============

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
export class CascadeSampler {
  // Cascade uniforms
  private _resolution0 = uniform(256);
  private _scale0 = uniform(118.0);
  private _resolution1 = uniform(256);
  private _scale1 = uniform(397.0);

  /** Number of active cascades (affects shader compilation). */
  readonly cascadeCount: 1 | 2;

  /**
   * Creates a CascadeSampler for the specified cascade count.
   *
   * @param cascadeCount - Number of cascades (1 or 2).
   */
  constructor(cascadeCount: 1 | 2) {
    this.cascadeCount = cascadeCount;
  }

  // ============= Uniform Accessors =============

  /** Resolution of cascade 0 (waves) in texels. */
  get resolution0(): number {
    return this._resolution0.value;
  }
  set resolution0(value: number) {
    this._resolution0.value = value;
  }

  /** World-space scale of cascade 0 (waves) in units. */
  get scale0(): number {
    return this._scale0.value;
  }
  set scale0(value: number) {
    this._scale0.value = value;
  }

  /** Resolution of cascade 1 (ripples) in texels. */
  get resolution1(): number {
    return this._resolution1.value;
  }
  set resolution1(value: number) {
    this._resolution1.value = value;
  }

  /** World-space scale of cascade 1 (ripples) in units. */
  get scale1(): number {
    return this._scale1.value;
  }
  set scale1(value: number) {
    this._scale1.value = value;
  }

  // ============= Internal Uniform Accessors (for shader graph) =============

  /** @internal Resolution0 uniform node for shader binding. */
  get _resolution0Node(): UniformFloatNode {
    return this._resolution0;
  }

  /** @internal Scale0 uniform node for shader binding. */
  get _scale0Node(): UniformFloatNode {
    return this._scale0;
  }

  /** @internal Resolution1 uniform node for shader binding. */
  get _resolution1Node(): UniformFloatNode {
    return this._resolution1;
  }

  /** @internal Scale1 uniform node for shader binding. */
  get _scale1Node(): UniformFloatNode {
    return this._scale1;
  }

  // ============= Bulk Update =============

  /**
   * Updates a cascade's resolution and scale.
   *
   * @param index - Cascade index (0 or 1).
   * @param resolution - Resolution in texels.
   * @param scale - World-space scale in units.
   */
  updateCascade(index: number, resolution: number, scale: number): void {
    if (index === 0) {
      this._resolution0.value = resolution;
      this._scale0.value = scale;
    } else if (index === 1) {
      this._resolution1.value = resolution;
      this._scale1.value = scale;
    }
  }

  // ============= Sampling Methods =============

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
  sampleDisplacement(
    worldX: Node,
    worldZ: Node,
    buffer0: StorageBufferNode,
    buffer1?: StorageBufferNode,
  ): CascadeDisplacementResult {
    const d0 = this.sampleDisplacementBuffer(
      worldX as FloatNode,
      worldZ as FloatNode,
      buffer0,
      this._resolution0,
      this._scale0,
    );

    if (this.cascadeCount === 1) {
      return {
        displacement: vec3(d0.x, d0.y, d0.z),
        hierarchicalCoordsX: worldX,
        hierarchicalCoordsZ: worldZ,
      };
    }

    // 2 cascades: hierarchical sampling
    // Cascade 1 sampled at position displaced by cascade 0
    const hierarchicalCoordsX = (worldX as FloatNode).add(d0.x);
    const hierarchicalCoordsZ = (worldZ as FloatNode).add(d0.z);

    const d1 = this.sampleDisplacementBuffer(
      hierarchicalCoordsX as FloatNode,
      hierarchicalCoordsZ as FloatNode,
      buffer1!,
      this._resolution1,
      this._scale1,
    );

    return {
      displacement: vec3(d0.x.add(d1.x), d0.y.add(d1.y), d0.z.add(d1.z)),
      hierarchicalCoordsX,
      hierarchicalCoordsZ,
    };
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
   * @param hierarchicalCoordsX - Hierarchical X coordinate (for cascade 1).
   * @param hierarchicalCoordsZ - Hierarchical Z coordinate (for cascade 1).
   * @param normalTexture0 - Cascade 0 normal storage texture.
   * @param normalTexture1 - Cascade 1 normal storage texture (required if cascadeCount is 2).
   */
  sampleNormals(
    worldX: Node,
    worldZ: Node,
    hierarchicalCoordsX: Node,
    hierarchicalCoordsZ: Node,
    normalTexture0: THREE.Texture,
    normalTexture1: THREE.Texture | undefined,
  ): CascadeNormalsResult {
    const sample0 = this.sampleNormalTexture(
      worldX as FloatNode,
      worldZ as FloatNode,
      normalTexture0,
      this._resolution0,
      this._scale0,
    );

    let rawNormal: Node;
    let eigen0: Node;
    let eigen1: Node;

    if (this.cascadeCount === 1) {
      rawNormal = normalize(sample0.normal);
      eigen0 = sample0.eigenvalue;
      eigen1 = float(1.0); // Neutral eigenvalue for inactive cascade
    } else {
      // 2 cascades with hierarchical sampling
      const sample1 = this.sampleNormalTexture(
        hierarchicalCoordsX as FloatNode,
        hierarchicalCoordsZ as FloatNode,
        normalTexture1!,
        this._resolution1,
        this._scale1,
      );

      // Blend using reoriented normal mapping
      const n0 = sample0.normal;
      const n1 = sample1.normal;
      rawNormal = normalize(
        vec3(n0.x.add(n1.x), n0.y.add(n1.y.sub(1.0)), n0.z.add(n1.z)),
      );
      eigen0 = sample0.eigenvalue;
      eigen1 = sample1.eigenvalue;
    }

    return { normal: rawNormal, eigen0, eigen1 };
  }

  /**
   * Samples the persistent foam accumulation buffer at a world-space
   * coordinate. Only cascade 0 is stored; ripple-scale injection would
   * smear into a uniform haze.
   *
   * @param params - World coordinates and foam buffer bindings.
   * @returns Foam energy at the sampled location (FloatNode, `≥ 0`).
   */
  sampleFoamAccumulation(params: FoamAccumulationSampleParams): Node {
    const { worldX, worldZ, foamBuffer0 } = params;

    return this.sampleFoamBuffer(
      worldX as FloatNode,
      worldZ as FloatNode,
      foamBuffer0,
      this._resolution0,
      this._scale0,
    );
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
   * @param tex - Normal storage texture (RGBA32F, RepeatWrapping, LinearFilter).
   * @param resolution - Cascade resolution uniform (texels per side).
   * @param scale - Cascade world-space scale uniform.
   */
  private sampleNormalTexture(
    worldX: FloatNode,
    worldZ: FloatNode,
    tex: THREE.Texture,
    resolution: UniformFloatNode,
    scale: UniformFloatNode,
  ): { normal: Node; eigenvalue: Node } {
    const baseRes = float(256.0);
    const effectiveScale = (scale as FloatNode)
      .mul(float(resolution))
      .div(baseRes);
    const u = worldX.div(effectiveScale).add(0.5);
    const v = worldZ.div(effectiveScale).add(0.5);
    const sample = texture(tex).sample(vec2(u, v));

    // Convert normal from [0,1] to [-1,1]
    const normal = sample.xyz.mul(2.0).sub(1.0);
    const eigenvalue = sample.w;

    return { normal, eigenvalue };
  }

  /**
   * Samples a cascade's foam accumulation buffer (vec2 `.x` = energy).
   *
   * @param worldX - World X coordinate.
   * @param worldZ - World Z coordinate.
   * @param buffer - Foam energy storage buffer (vec2 per texel).
   * @param resolution - Buffer resolution uniform.
   * @param scale - World-space scale uniform.
   */
  private sampleFoamBuffer(
    worldX: FloatNode,
    worldZ: FloatNode,
    buffer: StorageBufferNode,
    resolution: UniformFloatNode,
    scale: UniformFloatNode,
  ): Node {
    const { px, py } = worldToPixelCoords(worldX, worldZ, resolution, scale);
    const sample = sampleBufferBilinear(px, py, buffer, int(resolution));
    return sample.x;
  }
}

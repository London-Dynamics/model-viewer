// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Shoreline foam — appears in shallow water near objects using depth-based masking.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import { vec2, vec3, float, If, smoothstep, mix, uniform } from "three/tsl";
import type { Node } from "./types";
import { FoamTextureSlot } from "./foamTextureSlot";
import type { BuiltInFoamName } from "./builtInFoamTextures";

// ============= Params & Result interfaces =============

/** Preset-facing parameters for shoreline foam. */
export interface ShorelineFoamParams {
  /** Foam color (hex string). */
  color: string;
  /** How much foam is visible (0–1). Higher = more foam. */
  coverage: number;
  /** Whether shoreline foam is active. */
  enabled: boolean;
  /** Master opacity (0–1). */
  opacity: number;
  /** How far foam extends from shore (world units). */
  range: number;
  /** Texture size in world units (larger = bigger foam pattern). */
  size: number;
  /** Name of the bundled foam texture to use. */
  texture: BuiltInFoamName;
}

/** Parameters for {@link ShorelineFoam.build}. */
export interface ShorelineFoamBuildParams {
  /** Undisplaced world X coordinate. */
  worldX: Node;
  /** Undisplaced world Z coordinate. */
  worldZ: Node;
  /** Water column depth at the fragment. */
  waterColumnDepth: Node;
}

/** Output nodes produced by {@link ShorelineFoam.build}. */
export interface ShorelineFoamResult {
  /** Foam strength (0–1). */
  strength: Node;
  /** Foam tint color. */
  color: Node;
  /** Depth-based shoreline zone mask (0 = deep water, 1 = at shore). */
  zoneMask: Node;
}

/**
 * Shoreline foam for shallow water near objects.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class ShorelineFoam {
  // ============= Private Uniforms =============
  private _color = uniform(new THREE.Color(0xffffff));
  private _coverage = uniform(0.5);
  private _enabled = uniform(1.0);
  private _opacity = uniform(0.5);
  private _range = uniform(2.0);
  private _size = uniform(10.0);
  private _texture = new FoamTextureSlot();

  // ============= Public Getters/Setters =============

  /** Foam color. */
  get color(): THREE.Color {
    return this._color.value;
  }

  set color(value: THREE.Color | string) {
    this._color.value = new THREE.Color(value);
  }

  /** How much foam is visible (0–1). Higher = more foam. */
  get coverage(): number {
    return this._coverage.value;
  }

  set coverage(value: number) {
    this._coverage.value = value;
  }

  /** Whether shoreline foam is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Master opacity (0–1). */
  get opacity(): number {
    return this._opacity.value;
  }

  set opacity(value: number) {
    this._opacity.value = value;
  }

  /** How far foam extends from shore (world units). */
  get range(): number {
    return this._range.value;
  }

  set range(value: number) {
    this._range.value = value;
  }

  /** Texture size in world units (larger = bigger foam pattern). */
  get size(): number {
    return this._size.value;
  }

  set size(value: number) {
    this._size.value = value;
  }

  /** Tileable foam texture. */
  get foamTexture(): THREE.Texture {
    return this._texture.value;
  }

  set foamTexture(value: THREE.Texture) {
    this._texture.value = value;
  }

  // ============= Internal Accessors =============

  /**
   * Enabled uniform node (for alpha compositing in waterFragment).
   * @internal
   */
  get _enabledNode(): Node {
    return this._enabled;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: ShorelineFoamParams): void {
    this.color = params.color;
    this.coverage = params.coverage;
    this.enabled = params.enabled;
    this.opacity = params.opacity;
    this.range = params.range;
    this.size = params.size;
    void this._texture.load(params.texture);
  }

  /**
   * Switch to a bundled foam texture by name, leaving every other parameter
   * untouched. Use this for an isolated texture change; {@link foamTexture}
   * binds a caller-owned texture instead.
   */
  loadTexture(name: BuiltInFoamName): void {
    void this._texture.load(name);
  }

  /**
   * Builds shoreline foam strength, color, and zone mask.
   *
   * @param params - World coordinates, water depth, and foam texture.
   * @returns Foam strength, color, and zone mask nodes.
   */
  build(params: ShorelineFoamBuildParams): ShorelineFoamResult {
    const { worldX, worldZ, waterColumnDepth } = params;

    const strength = this.calculateShorelineFoam(
      worldX, worldZ, waterColumnDepth,
    );

    // Tight edge mask at shore for alpha compositing
    const shoreEdgeWidth = this._range.mul(0.5);
    const zoneMask = float(1.0).sub(
      smoothstep(float(0.0), shoreEdgeWidth, waterColumnDepth),
    );

    return { strength, color: vec3(this._color), zoneMask };
  }

  // ============= Private Helpers =============

  /**
   * Calculates shoreline foam using a tileable texture and depth-based masking.
   */
  private calculateShorelineFoam(
    worldX: Node,
    worldZ: Node,
    waterColumnDepth: Node,
  ): Node {
    const result = float(0.0).toVar();

    If(this._enabled.greaterThan(0.5), () => {
      const foamUV = vec2(worldX.div(this._size), worldZ.div(this._size));
      const foamIntensity = this._texture.node.sample(foamUV).r;

      const depthFalloff = float(1.0).div(this._range.add(0.001));
      const baseThreshold = float(1.0).sub(this._coverage);
      const depthRatio = waterColumnDepth.mul(depthFalloff);

      const rangeThreshold = depthRatio.add(baseThreshold);

      const shoreFade = smoothstep(float(0.0), float(0.3), depthRatio);
      const shoreThreshold = mix(float(1.0), rangeThreshold, shoreFade);

      const alphaMask = smoothstep(
        shoreThreshold,
        shoreThreshold.add(0.15),
        foamIntensity,
      );

      result.assign(alphaMask.mul(this._opacity));
    });

    return result;
  }
}

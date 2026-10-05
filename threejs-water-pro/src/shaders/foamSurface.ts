// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Simple texture-based surface foam.
 *
 * No Jacobian dependency — appears everywhere based on texture alpha.
 * Foam advects with waves automatically since UVs use undisplaced grid position.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import { vec2, vec3, float, If, smoothstep, uniform } from "three/tsl";
import type { Node } from "./types";
import { FoamTextureSlot } from "./foamTextureSlot";
import type { BuiltInFoamName } from "./builtInFoamTextures";

// ============= Params & Result interfaces =============

/** Preset-facing parameters for surface foam. */
export interface SurfaceFoamParams {
  /** Foam tint color (hex string). */
  color: string;
  /** How much foam is visible (0–1). Higher = more foam. */
  coverage: number;
  /** Whether surface foam is active. */
  enabled: boolean;
  /** Master opacity (0–1). */
  opacity: number;
  /** Texture size in world units (larger = bigger foam pattern). */
  size: number;
  /** Name of the bundled foam texture to use. */
  texture: BuiltInFoamName;
}

/** Parameters for {@link SurfaceFoam.build}. */
export interface SurfaceFoamBuildParams {
  /** Undisplaced world X coordinate. */
  worldX: Node;
  /** Undisplaced world Z coordinate. */
  worldZ: Node;
}

/** Output nodes produced by {@link SurfaceFoam.build}. */
export interface SurfaceFoamResult {
  /** Foam strength (0–1). */
  strength: Node;
  /** Foam color. */
  color: Node;
}

/**
 * Simple texture-based surface foam.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class SurfaceFoam {
  // ============= Private Uniforms =============
  private _color = uniform(new THREE.Color(0xffffff));
  private _coverage = uniform(0.5);
  private _enabled = uniform(1.0);
  private _opacity = uniform(0.5);
  private _size = uniform(20.0);
  private _texture = new FoamTextureSlot();

  // ============= Public Getters/Setters =============

  /** Foam tint color. */
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

  /** Whether surface foam is active. */
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

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: SurfaceFoamParams): void {
    this.color = params.color;
    this.coverage = params.coverage;
    this.enabled = params.enabled;
    this.opacity = params.opacity;
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
   * Builds surface foam strength from texture sampling.
   *
   * @param params - World coordinates and foam texture.
   * @returns Foam strength and color nodes.
   */
  build(params: SurfaceFoamBuildParams): SurfaceFoamResult {
    const { worldX, worldZ } = params;
    const strength = this.calculateSurfaceFoam(worldX, worldZ);
    return { strength, color: vec3(this._color) };
  }

  // ============= Private Helpers =============

  /**
   * Calculates simple surface foam using texture sampling.
   * No Jacobian dependency — appears everywhere based on texture alpha.
   */
  private calculateSurfaceFoam(worldX: Node, worldZ: Node): Node {
    const result = float(0.0).toVar();

    If(this._enabled.greaterThan(0.5), () => {
      const foamUV = vec2(worldX.div(this._size), worldZ.div(this._size));
      const foamIntensity = this._texture.node.sample(foamUV).r;

      const threshold = float(1.0).sub(this._coverage);
      const alphaMask = smoothstep(
        threshold,
        threshold.add(0.15),
        foamIntensity,
      );

      result.assign(foamIntensity.mul(alphaMask).mul(this._opacity));
    });

    return result;
  }
}

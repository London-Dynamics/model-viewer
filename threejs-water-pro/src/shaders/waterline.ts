/**
 * Waterline meniscus effect at the clip plane boundary.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via the clip plane uniform object.
 */
import { uniform } from "three/tsl";

/** Preset-facing parameters for the waterline meniscus. */
export interface WaterlineParams {
  /** Sharpness/power of the rim highlight falloff (higher = sharper edge). */
  highlightSharpness: number;
  /** Intensity of the rim highlight at the waterline edge. */
  highlightStrength: number;
  /** How much the surface normal tilts toward the camera at the waterline (0-1). */
  normalStrength: number;
  /** Width of the smooth fade on each edge (0 = hard edge, higher = softer). */
  smoothness: number;
  /** Half-width of the waterline in world units (meters). */
  thickness: number;
}

/**
 * Waterline meniscus effect at the clip plane boundary.
 *
 * Controls the visual appearance where the water surface meets partially
 * submerged objects: edge thickness, fade smoothness, normal perturbation,
 * and rim highlight.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via the clip plane uniform object.
 */
export class Waterline {
  // ============= Private Uniforms =============
  private _enabled = uniform(1.0);
  private _highlightSharpness = uniform(3.0);
  private _highlightStrength = uniform(0.8);
  private _normalStrength = uniform(0.7);
  private _smoothness = uniform(0.3);
  private _thickness = uniform(0.5);

  // ============= Public Getters/Setters =============

  /** Whether the waterline meniscus effect is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Sharpness/power of the rim highlight falloff (higher = sharper edge). */
  get highlightSharpness(): number {
    return this._highlightSharpness.value;
  }
  set highlightSharpness(value: number) {
    this._highlightSharpness.value = value;
  }

  /** Intensity of the rim highlight at the waterline edge. */
  get highlightStrength(): number {
    return this._highlightStrength.value;
  }
  set highlightStrength(value: number) {
    this._highlightStrength.value = value;
  }

  /** How much the surface normal tilts toward the camera at the waterline (0-1). */
  get normalStrength(): number {
    return this._normalStrength.value;
  }
  set normalStrength(value: number) {
    this._normalStrength.value = value;
  }

  /** Width of the smooth fade on each edge (0 = hard edge, higher = softer). */
  get smoothness(): number {
    return this._smoothness.value;
  }
  set smoothness(value: number) {
    this._smoothness.value = value;
  }

  /** Half-width of the waterline in world units (meters). */
  get thickness(): number {
    return this._thickness.value;
  }
  set thickness(value: number) {
    this._thickness.value = value;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: WaterlineParams): void {
    this.highlightSharpness = params.highlightSharpness;
    this.highlightStrength = params.highlightStrength;
    this.normalStrength = params.normalStrength;
    this.smoothness = params.smoothness;
    this.thickness = params.thickness;
  }

  /** Returns the uniform nodes for binding into the clip plane uniform object. */
  get uniforms() {
    return {
      waterlineEnabled: this._enabled,
      waterlineHighlightSharpness: this._highlightSharpness,
      waterlineHighlightStrength: this._highlightStrength,
      waterlineNormalStrength: this._normalStrength,
      waterlineSmoothness: this._smoothness,
      waterlineThickness: this._thickness,
    };
  }
}

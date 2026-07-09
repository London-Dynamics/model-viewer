/**
 * Sun sparkle (specular highlights) on water surface.
 *
 * Combines above-water Blinn-Phong specular, underwater reflected-view specular,
 * distance-based fade, and an underwater sun glow effect. The class owns its own
 * TSL uniform nodes; external code reads/writes parameters through getters and
 * setters, and the shader graph binds to the private uniform nodes via {@link build}.
 */
import {
  float,
  normalize,
  dot,
  pow,
  max,
  smoothstep,
  uniform,
  If,
} from "three/tsl";
import type { Node } from "./types";

// ============= Params & Result interfaces =============

/** Preset-facing parameters for sun sparkle. */
export interface SparkleParams {
  /** Whether sparkle is active. */
  enabled: boolean;
  /** Distance where sparkles fully fade (world units). */
  fadeDistance: number;
  /** Sparkle intensity multiplier. */
  intensity: number;
  /** Distance where sparkles fully appear (world units). */
  minDistance: number;
  /** Specular power (shininess). */
  power: number;
}

/** Parameters for {@link Sparkle.build}. */
export interface SparkleBuildParams {
  /** Distance from camera to fragment. */
  distanceToCamera: Node;
  /** Foam strength at the fragment (sparkles reduced on foam). */
  earlyFoamStrength: Node;
  /** Interpolated surface normal. */
  interpolatedNormal: Node;
  /** Direction toward the sun. */
  sunDir: Node;
  /** Sun light intensity. */
  sunIntensity: Node;
  /** View direction (from surface to camera). */
  viewDir: Node;
}

// ============= Sparkle class =============

/**
 * Sun sparkle (specular highlights) on the water surface.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class Sparkle {
  // ============= Private Uniforms =============
  private _enabled = uniform(1.0);
  private _fadeDistance = uniform(500.0);
  private _intensity = uniform(1.0);
  private _minDistance = uniform(10.0);
  private _power = uniform(512.0);

  // ============= Public Getters/Setters =============

  /** Whether sparkle is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Distance where sparkles fully fade (world units). */
  get fadeDistance(): number {
    return this._fadeDistance.value;
  }

  set fadeDistance(value: number) {
    this._fadeDistance.value = value;
  }

  /** Sparkle intensity multiplier. */
  get intensity(): number {
    return this._intensity.value;
  }

  set intensity(value: number) {
    this._intensity.value = value;
  }

  /** Distance where sparkles fully appear (world units). */
  get minDistance(): number {
    return this._minDistance.value;
  }

  set minDistance(value: number) {
    this._minDistance.value = value;
  }

  /** Specular power (shininess). */
  get power(): number {
    return this._power.value;
  }

  set power(value: number) {
    this._power.value = value;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: SparkleParams): void {
    this.enabled = params.enabled;
    this.fadeDistance = params.fadeDistance;
    this.intensity = params.intensity;
    this.minDistance = params.minDistance;
    this.power = params.power;
  }

  /**
   * Builds sun sparkle effect shader nodes.
   * Uses Blinn-Phong specular for above-water sparkle.
   *
   * @returns Total sparkle amount to add to final color.
   */
  build(params: SparkleBuildParams): Node {
    const {
      distanceToCamera,
      earlyFoamStrength,
      interpolatedNormal,
      sunDir,
      sunIntensity,
      viewDir,
    } = params;

    const result = float(0.0).toVar();

    If(this._enabled.greaterThan(0.5), () => {
      // Above water: standard Blinn-Phong specular
      const sparkleSpec = this.buildAboveWaterSpecular(
        viewDir,
        sunDir,
        interpolatedNormal,
      );

      // Distance fade
      const sparkleDistanceFade = this.buildDistanceFade(distanceToCamera);

      // Final sparkle: spec * intensity * sun * fade * foam reduction
      const sparkleReduction = float(1.0).sub(earlyFoamStrength.mul(0.7));
      result.assign(
        sparkleSpec
          .mul(this._intensity)
          .mul(sunIntensity)
          .mul(sparkleDistanceFade)
          .mul(sparkleReduction),
      );
    });

    return result;
  }

  // ============= Private Methods =============

  /**
   * Blinn-Phong specular for above-water view.
   *
   * @param viewDir - View direction (surface to camera).
   * @param sunDir - Direction toward the sun.
   * @param normal - Surface normal.
   */
  private buildAboveWaterSpecular(
    viewDir: Node,
    sunDir: Node,
    normal: Node,
  ): Node {
    const halfVector = normalize(viewDir.add(sunDir));
    const NdotH = max(dot(normal, halfVector), 0.0);
    return pow(NdotH, this._power);
  }

  /**
   * Mid-range fade: sparkles appear at minDistance, fade out at fadeDistance.
   *
   * @param distanceToCamera - Distance from camera to surface point.
   */
  private buildDistanceFade(distanceToCamera: Node): Node {
    const fadeIn = smoothstep(float(0.0), this._minDistance, distanceToCamera);
    const fadeOut = float(1.0).sub(
      smoothstep(this._minDistance, this._fadeDistance, distanceToCamera),
    );
    return fadeIn.mul(fadeOut);
  }
}

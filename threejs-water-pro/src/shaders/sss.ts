/**
 * Physics-based subsurface scattering (SSS) for water.
 *
 * Based on real-time forward scattering approximation used in production engines
 * (Frostbite, Unity water shaders). Light transmitting through thin translucent
 * water at wave crests creates a bright glow when backlit by the sun.
 *
 * References:
 * - GPU Gems: Real-Time Approximations to Subsurface Scattering
 * - GDC 2011: Approximating Translucency for a Fast, Cheap SSS Look (Frostbite)
 * - Unity water shader implementations
 */
import {
  float,
  dot,
  pow,
  clamp,
  smoothstep,
  mix,
  vec3,
  uniform,
  If,
} from "three/tsl";
import type { Node } from "./types";

/** Preset-facing parameters for subsurface scattering. */
export interface SSSParams {
  /** Whether SSS is active. */
  enabled: boolean;
  /** SSS intensity multiplier (0–2). */
  intensity: number;
  /** Forward scattering power falloff (0.05–3). */
  power: number;
}

/** Parameters for {@link SSS.build}. */
export interface SSSBuildParams {
  /** Fragment view direction. */
  viewDir: Node;
  /** Normalized sun direction. */
  sunDir: Node;
  /** Interpolated wave normal. */
  waveNormal: Node;
  /** Base water color to apply SSS to. */
  waterColor: Node;
  /** Distance from camera to fragment. */
  distanceToCamera: Node;
  /** Transmission color for scattered light. */
  transmissionColor: Node;
  /** Sun light intensity. */
  sunIntensity: Node;
  /** Distance at which fresnel fade starts. */
  fadeStart: Node;
  /** Distance at which fresnel fade ends. */
  fadeEnd: Node;
}

/**
 * Physics-based subsurface scattering for water.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class SSS {
  // ============= Private Uniforms =============
  private _enabled = uniform(1.0);
  private _intensity = uniform(1.0);
  private _power = uniform(4.0);

  // ============= Public Getters/Setters =============

  /** Whether SSS is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** SSS intensity multiplier (0–2). */
  get intensity(): number {
    return this._intensity.value;
  }

  set intensity(value: number) {
    this._intensity.value = value;
  }

  /** Forward scattering power falloff (0.05–3). */
  get power(): number {
    return this._power.value;
  }

  set power(value: number) {
    this._power.value = value;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: SSSParams): void {
    this.enabled = params.enabled;
    this.intensity = params.intensity;
    this.power = params.power;
  }

  /**
   * Builds physics-based subsurface scattering for water.
   *
   * @returns Water color with SSS applied.
   */
  build(params: SSSBuildParams): Node {
    const {
      viewDir,
      sunDir,
      waveNormal,
      waterColor,
      distanceToCamera,
      transmissionColor,
      sunIntensity,
      fadeStart,
      fadeEnd,
    } = params;

    const result = vec3(waterColor).toVar();

    If(this._enabled.greaterThan(0.5), () => {
      const transmissionVec = vec3(transmissionColor);

      // Wrapped backlit: extends SSS visibility beyond strict backlit region
      const viewDotLight = dot(viewDir, sunDir.negate());
      const wrappedBacklit = clamp(
        viewDotLight.add(0.5).div(float(1.5)),
        0.0,
        1.0,
      );

      // Wave transmission: waves tilted toward sun transmit more light
      const normalDotLight = dot(waveNormal, sunDir.negate());
      const waveTransmission = clamp(normalDotLight.add(0.3), 0.0, 1.0);

      // Forward scattering: combine backlit and transmission with power falloff
      const forwardScatter = pow(
        wrappedBacklit.mul(waveTransmission),
        this._power,
      );

      // Distance fade: fade out SSS at distance to avoid popping at horizon
      const distanceFade = float(1.0).sub(
        smoothstep(fadeStart, fadeEnd, distanceToCamera),
      );

      // Final SSS factor
      const sssFactor = forwardScatter
        .mul(sunIntensity)
        .mul(this._intensity)
        .mul(distanceFade);

      result.assign(
        mix(waterColor, transmissionVec, clamp(sssFactor, 0.0, 1.0)),
      );
    });

    return result;
  }
}

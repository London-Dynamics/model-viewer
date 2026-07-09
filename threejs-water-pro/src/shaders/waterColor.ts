/**
 * Physical Beer-Lambert water color.
 *
 * Single intrinsic water color plus a per-channel absorption coefficient.
 * The depth-dependent appearance falls out of the physics:
 *
 *   transmitted = refractedScene * exp(-absorption * depth)
 *               + waterColor     * (1 - exp(-absorption * depth))
 *
 * where `absorption` is a `vec3` (per RGB channel). Shallow water reads
 * as seabed tinted toward `waterColor`; deep water reads as `waterColor`.
 * The wavelength-dependent attenuation is what makes clear ocean go
 * blue-green at depth — a scalar absorption rate cannot reproduce that.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import {
  float,
  positionView,
  cameraNear,
  cameraFar,
  step,
  mix,
  max,
  abs,
  exp,
  vec3,
  reflect,
  uniform,
} from "three/tsl";
import type { Node } from "./types";

// ============= Params & Result interfaces =============

/** Preset-facing parameters for water color. */
export interface WaterColorParams {
  /**
   * Per-channel Beer-Lambert absorption coefficient (1/world-unit), encoded
   * as a hex color. Each RGB channel is its own extinction rate, so red can
   * absorb faster than blue — the mechanism that turns clear ocean
   * blue-green with depth. Typical clear ocean ≈ `#0a0503` (R≈0.04, G≈0.02,
   * B≈0.01 per metre); murkier water uses larger values uniformly.
   */
  absorptionColor: string;
  /** Color of light transmitted through the water (hex string). */
  transmissionColor: string;
  /**
   * Intrinsic water color — the in-scattered radiance the camera receives
   * from the water column itself, independent of what's behind it. What
   * infinite-depth water looks like. Hex string.
   */
  waterColor: string;
}

/** Parameters for {@link WaterColor.build}. */
export interface WaterColorBuildParams {
  /** Depth sample from the depth texture (R = normalized depth). */
  depthSample: Node;
  /** View direction Y component for fallback depth. */
  viewDirY: Node;
  /** Whether the depth texture is available (0 or 1). */
  useDepthTexture: Node;
}

/** Output nodes produced by {@link WaterColor.build}. */
export interface WaterColorResult {
  /**
   * Per-channel Beer-Lambert clear-fraction `exp(-absorptionColor * depth)`.
   * `1.0` per channel = perfectly clear (light passes unattenuated),
   * `0.0` = fully absorbed. Used by the fragment composite to weight the
   * refracted seabed sample against the water's intrinsic in-scatter color.
   */
  clearFactor: Node;
  /** 1.0 when scene geometry is in front of water surface, 0.0 otherwise. */
  isObjectInFront: Node;
  /** The intrinsic water color (in-scatter radiance) as a vec3 node. */
  waterColor: Node;
  /** Water column depth in world units. */
  waterColumnDepth: Node;
}

/**
 * Physical Beer-Lambert water color with per-channel absorption.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class WaterColor {
  // ============= Private Uniforms =============
  private _absorptionColor = uniform(new THREE.Color(0x0a0503));
  private _transmissionColor = uniform(new THREE.Color(0x00ffcc));
  private _waterColor = uniform(new THREE.Color(0x003366));
  private _waterDepth = uniform(20.0);

  // ============= Public Getters/Setters =============

  /**
   * Per-channel Beer-Lambert absorption coefficient (1/world-unit).
   * Each RGB channel is its own extinction rate.
   */
  get absorptionColor(): THREE.Color {
    return this._absorptionColor.value;
  }

  set absorptionColor(value: THREE.Color | string) {
    this._absorptionColor.value = new THREE.Color(value);
  }

  /** Color of light transmitted through the water. */
  get transmissionColor(): THREE.Color {
    return this._transmissionColor.value;
  }

  set transmissionColor(value: THREE.Color | string) {
    this._transmissionColor.value = new THREE.Color(value);
  }

  /**
   * Intrinsic water color (in-scatter radiance) — what infinite-depth
   * water looks like.
   */
  get waterColor(): THREE.Color {
    return this._waterColor.value;
  }

  set waterColor(value: THREE.Color | string) {
    this._waterColor.value = new THREE.Color(value);
  }

  /**
   * Water depth for fallback depth calculation (world units).
   * Set from ocean floor depth — not part of {@link WaterColorParams}.
   */
  get waterDepth(): number {
    return this._waterDepth.value;
  }

  set waterDepth(value: number) {
    this._waterDepth.value = value;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: WaterColorParams): void {
    this.absorptionColor = params.absorptionColor;
    this.transmissionColor = params.transmissionColor;
    this.waterColor = params.waterColor;
  }

  /**
   * Builds the water-column depth and per-channel Beer-Lambert clear
   * fraction at the unrefracted screen UV. The refracted composite
   * resamples depth at the refracted UV and computes its own clearFactor
   * via {@link _absorptionColorNode}.
   *
   * @param params - Depth sample, view direction, and depth texture flag.
   */
  build(params: WaterColorBuildParams): WaterColorResult {
    const { depthSample, viewDirY, useDepthTexture } = params;

    const { waterColumnDepth, isObjectInFront } =
      this.buildWaterColumnDepth(viewDirY, depthSample, useDepthTexture);

    // Per-channel Beer-Lambert clear fraction.
    const clearFactor = exp(
      vec3(this._absorptionColor).negate().mul(waterColumnDepth),
    );

    return {
      clearFactor,
      isObjectInFront,
      waterColor: vec3(this._waterColor),
      waterColumnDepth,
    };
  }

  // ============= Private Helpers =============

  /**
   * Calculates the water column depth from depth texture or fallback.
   *
   * @param viewDirY - Y component of the view direction.
   * @param depthSample - Depth texture sample (R = normalized depth).
   * @param useDepthTexture - Whether the depth texture is available (0 or 1).
   */
  private buildWaterColumnDepth(
    viewDirY: Node,
    depthSample: Node,
    useDepthTexture: Node,
  ): { waterColumnDepth: Node; isObjectInFront: Node } {
    const fallbackDepth = this._waterDepth.div(max(abs(viewDirY), 0.1));

    const waterSurfaceViewDepth = positionView.z.negate();

    const sceneDepthNormalized = depthSample.x;
    const sceneLinearDepth = sceneDepthNormalized
      .mul(cameraFar.sub(cameraNear))
      .add(cameraNear);

    const depthDiff = sceneLinearDepth.sub(waterSurfaceViewDepth);
    const isObjectInFront = step(depthDiff, float(-0.01));

    const waterColumnDepth = max(depthDiff, 0.0);

    // Use fallback for sky (depth near far plane)
    const isSky = step(cameraFar.mul(0.99), sceneLinearDepth);
    const depthTextureResult = mix(waterColumnDepth, fallbackDepth, isSky);

    const finalDepth = mix(fallbackDepth, depthTextureResult, useDepthTexture);
    const finalIsObjectInFront = isObjectInFront.mul(useDepthTexture);

    return {
      waterColumnDepth: finalDepth,
      isObjectInFront: finalIsObjectInFront,
    };
  }

  // ============= Internal Accessors =============

  /**
   * Transmission color uniform node (for SSS and other stages).
   * @internal
   */
  get _transmissionColorNode(): Node {
    return this._transmissionColor;
  }

  /**
   * Per-channel Beer-Lambert absorption uniform node. The front-face
   * refraction path resamples depth at the refracted UV and computes its
   * own per-channel clearFactor from this value.
   * @internal
   */
  get _absorptionColorNode(): Node {
    return this._absorptionColor;
  }

  /**
   * Intrinsic water-color uniform node. The screen-space underwater
   * post-pass binds to this same node so above- and below-water Beer-Lambert
   * use a single in-scatter color (Phase 01).
   * @internal
   */
  get _waterColorNode(): Node {
    return this._waterColor;
  }
}

// ============= Standalone Reflection Builder =============

/**
 * Input parameters for buildReflectionSampling.
 */
export interface ReflectionSamplingParams {
  /** View direction (from surface toward camera). */
  viewDir: Node;
  /** Surface normal for reflection direction. */
  fresnelNormal: Node;
  /** Sky reflection sampler (optional). */
  reflectionSampler?: (dir: Node) => Node;
}

/**
 * Result from buildReflectionSampling.
 */
export interface ReflectionSamplingResult {
  /** Sampled reflection color. */
  reflectionColor: Node;
  /** World-space reflection direction. */
  reflectDir: Node;
}

/**
 * Samples reflection color from sky or environment map.
 * This is a standalone builder function (not part of WaterColor) because
 * it handles optional JS-level samplers and doesn't depend on color uniforms.
 *
 * @param params - View direction, normal, and optional samplers.
 * @returns Reflection color and direction.
 */
export function buildReflectionSampling(
  params: ReflectionSamplingParams,
): ReflectionSamplingResult {
  const { viewDir, fresnelNormal, reflectionSampler } = params;

  const reflectDir = reflect(viewDir.negate(), fresnelNormal);
  const reflectionColor: Node = reflectionSampler
    ? reflectionSampler(reflectDir)
    : vec3(0.6, 0.8, 1.0);

  return { reflectionColor, reflectDir };
}

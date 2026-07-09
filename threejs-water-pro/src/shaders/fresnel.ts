/**
 * Full dielectric Fresnel for the air–water interface, with distance-based
 * normal fading.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import {
  float,
  vec3,
  positionWorld,
  cameraPosition,
  dot,
  normalize,
  mix,
  min,
  max,
  smoothstep,
  pow,
  length,
  uniform,
  Fn,
  select,
  sqrt,
} from "three/tsl";
import type { FloatNode, Node } from "../types/tsl";

// ============= Module-level TSL helper =============

/**
 * Full dielectric Fresnel reflectance for unpolarized light.
 *
 * Symmetric in incident direction: pass a negative `cosThetaI` for rays
 * leaving the denser medium and the function inverts `eta` internally.
 * Returns 1.0 when total internal reflection occurs (equivalently, when
 * `sin²θₜ ≥ 1`).
 *
 * `eta` is the IOR ratio `nₜ / nᵢ` for the front-face direction (e.g. 1.33
 * for air → water). The same value is passed for both sides; the function
 * flips when the cosine is negative.
 *
 * Reference: Pharr et al., *Physically Based Rendering* (4th ed.) §9.5.1.
 */
export const fresnelDielectric = /*@__PURE__*/ Fn(
  ({ cosThetaI, eta }: { cosThetaI: FloatNode; eta: FloatNode }) => {
    const flipped = cosThetaI.lessThan(0.0);
    const cI = select(flipped, cosThetaI.negate(), cosThetaI);
    const e = select(flipped, float(1.0).div(eta), eta);

    const sin2T = float(1.0).sub(cI.mul(cI)).div(e.mul(e));
    // sqrt(max(0,...)) keeps the value well-defined when TIR fires; the
    // outer select discards this branch in that case.
    const cosT = sqrt(max(float(0.0), float(1.0).sub(sin2T)));

    const eCi = e.mul(cI);
    const eCt = e.mul(cosT);
    const rParl = eCi.sub(cosT).div(eCi.add(cosT));
    const rPerp = cI.sub(eCt).div(cI.add(eCt));
    const F = float(0.5).mul(rParl.mul(rParl).add(rPerp.mul(rPerp)));

    return select(sin2T.greaterThanEqual(1.0), float(1.0), F);
  },
);

// ============= Params & Result interfaces =============

/** Preset-facing parameters for surface fresnel. */
export interface FresnelParams {
  /** Power curve for distance fade falloff. */
  fadePower: number;
  /** Distance at which normal detail begins to fade (world units). */
  fadeStart: number;
  /**
   * Refractive index of water relative to air. 1.33 is physical seawater.
   * Higher values shrink Snell's window and raise grazing reflectance.
   */
  iorRatio: number;
  /** How much the surface normal influences the fresnel term (0–1). */
  normalStrength: number;
  /**
   * Screen-space refraction UV-offset strength. Scales the wave-normal
   * displacement applied when sampling the scene through the water surface
   * for both above- and below-water observers. Higher values make the
   * seabed (and Snell's window contents) wobble more with the waves.
   */
  refractionStrength: number;
}

/** Output nodes produced by {@link Fresnel.build}. */
export interface FresnelResult {
  /** Fresnel distance fade factor (1 at close range, 0 at distance). */
  distanceFade: Node;
  /** Distance from the camera to the fragment (world units). */
  distanceToCamera: Node;
  /** The uniform node for fade end distance (for other stages that need it). */
  fadeEnd: Node;
  /** The uniform node for fade start distance (for other stages that need it). */
  fadeStart: Node;
  /** Fresnel reflectance for the front-face viewing direction (0–1). */
  fresnel: Node;
  /** Surface normal blended toward flat based on distance and strength. */
  fresnelNormal: Node;
}

/** Parameters for {@link Fresnel.build}. */
export interface FresnelBuildParams {
  /** Interpolated surface normal. */
  interpolatedNormal: Node;
  /** View direction (from surface toward camera). */
  viewDir: Node;
  /** Undisplaced world X coordinate. */
  worldX: Node;
  /** Undisplaced world Z coordinate. */
  worldZ: Node;
}

/**
 * Full dielectric Fresnel for the air–water interface with distance-based
 * normal fading for a clean horizon line.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class Fresnel {
  // ============= Private Uniforms =============
  private _fadeEnd = uniform(200.0);
  private _fadePower = uniform(1.0);
  private _fadeStart = uniform(50.0);
  private _iorRatio = uniform(1.33);
  private _normalStrength = uniform(0.1);
  private _refractionStrength = uniform(0.1);

  // ============= Public Getters/Setters =============

  /** Distance at which normal detail fully fades (world units). */
  get fadeEnd(): number {
    return this._fadeEnd.value;
  }

  set fadeEnd(value: number) {
    this._fadeEnd.value = value;
  }

  /** Power curve for distance fade falloff. */
  get fadePower(): number {
    return this._fadePower.value;
  }

  set fadePower(value: number) {
    this._fadePower.value = value;
  }

  /** Distance at which normal detail begins to fade (world units). */
  get fadeStart(): number {
    return this._fadeStart.value;
  }

  set fadeStart(value: number) {
    this._fadeStart.value = value;
  }

  /**
   * Refractive index of water relative to air. 1.33 is physical seawater.
   * Same value is used on both sides of the interface; the underwater
   * branch passes a negated cosine so the Fresnel function flips internally.
   */
  get iorRatio(): number {
    return this._iorRatio.value;
  }

  set iorRatio(value: number) {
    this._iorRatio.value = value;
  }

  /**
   * IOR uniform node, for cross-module shader graph access (e.g. the
   * underwater surface branch in `waterFragment.ts`).
   * @internal
   */
  get _iorRatioNode(): Node {
    return this._iorRatio;
  }

  /** How much the surface normal influences the fresnel term (0–1). */
  get normalStrength(): number {
    return this._normalStrength.value;
  }

  set normalStrength(value: number) {
    this._normalStrength.value = value;
  }

  /**
   * Screen-space refraction UV-offset strength. Drives how far the
   * wave-perturbed surface displaces sampled scene UVs for both the
   * above-water seabed view and the below-water Snell's window.
   */
  get refractionStrength(): number {
    return this._refractionStrength.value;
  }

  set refractionStrength(value: number) {
    this._refractionStrength.value = value;
  }

  /**
   * Refraction-strength uniform node, for cross-module shader graph
   * access (the above- and below-water refraction paths in
   * `waterFragment.ts` share this value).
   * @internal
   */
  get _refractionStrengthNode(): Node {
    return this._refractionStrength;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: FresnelParams): void {
    this.fadePower = params.fadePower;
    this.fadeStart = params.fadeStart;
    this.iorRatio = params.iorRatio;
    this.normalStrength = params.normalStrength;
    this.refractionStrength = params.refractionStrength;
  }

  /**
   * Builds the dielectric Fresnel reflectance with distance-based normal
   * fading. The returned `fresnel` node is the reflectance `F` for the
   * front-face view direction; it can be used directly as the mix weight
   * between refraction (weight `1 - F`) and reflection (weight `F`).
   *
   * @param params - View direction, surface normal, and world coordinates.
   * @returns Fresnel value, modified normal, distance metrics, and fade uniform nodes.
   */
  build(params: FresnelBuildParams): FresnelResult {
    const { viewDir, interpolatedNormal, worldX, worldZ } = params;

    const actualWorldPos = vec3(worldX, positionWorld.y, worldZ);
    const distanceToCamera = length(cameraPosition.sub(actualWorldPos));

    // Reduce normal detail at far distances for cleaner horizon.
    // Clamp start to not exceed end.
    const clampedStart = min(this._fadeStart, this._fadeEnd);
    const distanceFade = pow(
      float(1.0).sub(smoothstep(clampedStart, this._fadeEnd, distanceToCamera)),
      this._fadePower,
    );
    const effectiveNormalStrength = this._normalStrength.mul(distanceFade);

    // Blend normal toward flat (0,1,0) based on strength for fresnel.
    const fresnelNormal = normalize(
      mix(vec3(0.0, 1.0, 0.0), interpolatedNormal, effectiveNormalStrength),
    );

    // Full dielectric Fresnel: handles both above- and below-water cases
    // from one formula, including TIR.
    const cosTheta = max(dot(viewDir, fresnelNormal), 0.0);
    const fresnel = fresnelDielectric({
      cosThetaI: cosTheta,
      eta: this._iorRatio,
    });

    return {
      fresnel,
      fresnelNormal,
      distanceToCamera,
      distanceFade,
      fadeStart: this._fadeStart,
      fadeEnd: this._fadeEnd,
    };
  }
}

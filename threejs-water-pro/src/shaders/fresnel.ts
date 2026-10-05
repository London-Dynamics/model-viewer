// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Full dielectric Fresnel for the air–water interface.
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
  clamp,
  dot,
  normalize,
  mix,
  max,
  length,
  pow,
  uniform,
  Fn,
  select,
  sqrt,
} from "three/tsl";
import type { FloatNode, Node } from "../types/tsl";

/**
 * Cosine floor for the above-water reflection path. Wave normals can tilt
 * past edge-on at grazing angles (`dot(V, N) < 0`); reflecting off such a
 * normal yields a below-horizon direction that samples the environment
 * map's lower hemisphere, and the Fresnel clamp pins F to 1 on exactly
 * those fragments. At cos θ = 0.05 the dielectric Fresnel is already near
 * total, so flooring here is visually seamless.
 */
const MIN_GRAZING_COS = 0.05;

// sqrt(1 - MIN_GRAZING_COS^2), the sine component paired with
// MIN_GRAZING_COS's cosine in the bent-normal reconstruction below.
// Precomputed as a literal (rather than Math.sqrt(...) inline) because the
// WASM shader compiler (scripts/compile-tsl-to-as.ts) only folds bare
// numeric literals into module-level constants, not arbitrary expressions —
// update this alongside MIN_GRAZING_COS if it ever changes.
const MIN_GRAZING_SIN = 0.998749217771909;

/**
 * How strongly sub-footprint slope variance caps the grazing reflectance. At
 * full variance the grazing Fresnel is pulled to `1 − this` of its flat-surface
 * value — the microfacet-masking effect that keeps a wind-roughened sea from
 * reading as a grazing mirror. A tuning scale over the length-deficit variance
 * proxy, not a calibrated Smith term.
 */
const GRAZING_MASKING_STRENGTH = 0.7;

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
  /**
   * Refractive index of water relative to air. 1.33 is physical seawater.
   * Higher values shrink Snell's window and raise grazing reflectance.
   */
  iorRatio: number;
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
  /** Distance from the camera to the fragment (world units). */
  distanceToCamera: Node;
  /** Uniform node for the distance-fade range end, consumed by SSS. */
  fadeEnd: Node;
  /** Fresnel reflectance for the front-face viewing direction (0–1). */
  fresnel: Node;
  /** Surface normal blended toward flat based on distance and strength. */
  fresnelNormal: Node;
  /**
   * `fresnelNormal` bent in the view–normal plane so the view ray never
   * sees it back-facing. Use for above-water reflection directions only;
   * underwater paths need the signed cosine of {@link fresnelNormal} for
   * total internal reflection.
   */
  reflectionNormal: Node;
}

/** Parameters for {@link Fresnel.build}. */
export interface FresnelBuildParams {
  /** Interpolated surface normal. */
  interpolatedNormal: Node;
  /**
   * Sub-footprint slope variance (0-1) from the cascade normal mips. Caps the
   * grazing reflectance so a wind-roughened / distant surface is not a mirror.
   */
  slopeVariance: Node;
  /** View direction (from surface toward camera). */
  viewDir: Node;
  /** Undisplaced world X coordinate. */
  worldX: Node;
  /** Undisplaced world Z coordinate. */
  worldZ: Node;
}

/**
 * Full dielectric Fresnel for the air–water interface.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}. Also owns the `fadeEnd` distance-fade
 * range consumed by SSS.
 */
export class Fresnel {
  // ============= Private Uniforms =============
  private _fadeEnd = uniform(200.0);
  private _iorRatio = uniform(1.33);
  private _refractionStrength = uniform(0.1);

  // ============= Public Getters/Setters =============

  /**
   * End of the distance-fade range (world units), consumed by SSS.
   * Auto-synced to the water extent by `WaterSystem`.
   */
  get fadeEnd(): number {
    return this._fadeEnd.value;
  }

  set fadeEnd(value: number) {
    this._fadeEnd.value = value;
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
    this.iorRatio = params.iorRatio;
    this.refractionStrength = params.refractionStrength;
  }

  /**
   * Builds the dielectric Fresnel reflectance. The returned `fresnel` node
   * is the reflectance `F` for the front-face view direction; it can be
   * used directly as the mix weight between refraction (weight `1 - F`)
   * and reflection (weight `F`).
   *
   * @param params - View direction, surface normal, and world coordinates.
   * @returns Fresnel value, modified normals, distance metrics, and fade uniform nodes.
   */
  build(params: FresnelBuildParams): FresnelResult {
    const { viewDir, interpolatedNormal, slopeVariance, worldX, worldZ } =
      params;

    const actualWorldPos = vec3(worldX, positionWorld.y, worldZ);
    const distanceToCamera = length(cameraPosition.sub(actualWorldPos));

    // Use the mip-band-limited wave normal directly. The FFT normal textures
    // are already filtered to the pixel footprint, so the reflectance follows
    // the resolved waves and the unresolved detail is accounted for by the
    // slope-variance grazing term below.
    const fresnelNormal = normalize(interpolatedNormal);

    // Above-water reflection normal: rotate the normal in the V–N plane
    // just far enough that the view ray grazes it at MIN_GRAZING_COS.
    // Decompose N into components parallel and perpendicular to the view
    // direction, then reassemble with the floored cosine.
    const cosRaw = dot(viewDir, fresnelNormal);
    const sinRaw = sqrt(max(float(1.0).sub(cosRaw.mul(cosRaw)), 1e-6));
    const perpDir = fresnelNormal.sub(viewDir.mul(cosRaw)).div(sinRaw);
    const bentNormal = normalize(
      viewDir
        .mul(MIN_GRAZING_COS)
        .add(perpDir.mul(MIN_GRAZING_SIN)),
    );
    const reflectionNormal = select(
      cosRaw.lessThan(MIN_GRAZING_COS),
      bentNormal,
      fresnelNormal,
    );

    // Full dielectric Fresnel for the front face. The floored cosine
    // equals dot(viewDir, reflectionNormal), keeping the reflectance
    // consistent with the bent reflection direction.
    const cosTheta = max(cosRaw, MIN_GRAZING_COS);
    const fresnelRaw = fresnelDielectric({
      cosThetaI: cosTheta,
      eta: this._iorRatio,
    });

    // Effective (roughness-aware) Fresnel. A flat surface at grazing is a
    // mirror (F → 1), but a wind-roughened one is not: microfacet masking of
    // the slope distribution caps the grazing reflectance below 1 (Bruneton
    // et al. 2010). Pull only the grazing lobe down, scaled by how much wave
    // detail the footprint folds away, so calm water stays a mirror and
    // rough/distant water shows more of the water body instead of the sky.
    const grazing = pow(float(1.0).sub(cosTheta), 5.0);
    const grazingCap = clamp(
      float(1.0).sub(slopeVariance.mul(GRAZING_MASKING_STRENGTH)),
      0.0,
      1.0,
    );
    const fresnel = fresnelRaw.mul(mix(float(1.0), grazingCap, grazing));

    return {
      fresnel,
      fresnelNormal,
      reflectionNormal,
      distanceToCamera,
      fadeEnd: this._fadeEnd,
    };
  }
}

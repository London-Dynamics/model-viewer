/**
 * Wave crest (turbulent) foam with Jacobian-driven wave breaking detection.
 *
 * Combines texture-based foam with anisotropic wind stretching and Jacobian
 * eigenvalue analysis for realistic whitecaps on wave crests.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
import * as THREE from "three/webgpu";
import {
  vec2,
  vec3,
  float,
  If,
  smoothstep,
  clamp,
  texture,
  uniform,
  cos,
  sin,
  dot,
} from "three/tsl";
import type { Node } from "./types";
import { createDefaultFoamTexture } from "./foamDefaults";
import {
  loadBuiltInFoamTexture,
  type BuiltInFoamName,
} from "./builtInFoamTextures";

// Dissolve smoothstep parameters for the persistent wave foam.
// Half-width = 0.3 (texture units). Band width = 2 × half-width = 0.6.
// Energy scale = 1 + band width = 1.6 — this offset makes energy=0 push the
// whole band above texture max (no pixel passes) and energy=1 push it below
// texture min (every pixel passes). The TSL-to-AS compiler only resolves
// module constants whose initializer is a plain numeric literal, so these
// are written as literals rather than computed from a single source.
const DISSOLVE_BAND_WIDTH = 0.6;
const DISSOLVE_ENERGY_SCALE = 1.6;
// ============= Params & Result interfaces =============

/** Preset-facing parameters for wave crest foam. */
export interface WaveFoamParams {
  /** Foam tint color (hex string). */
  color: string;
  /** How much foam is visible (0–1). Higher = more foam. */
  coverage: number;
  /** How much foam appears on wave crests (0–1). Higher = more foam. */
  crestCoverage: number;
  /** Whether wave foam is active. */
  enabled: boolean;
  /** Master opacity (0–1). */
  opacity: number;
  /** Caps the maximum foam intensity (0–1). */
  peakIntensity: number;
  /** How much the ripple cascade contributes to foam (0–1). */
  rippleWeight: number;
  /** Texture size in world units (larger = bigger foam pattern). */
  size: number;
  /** Name of the bundled foam texture to use. */
  texture: BuiltInFoamName;
  /** How much the wave cascade contributes to foam (0–1). */
  waveWeight: number;
  /** Stretches foam in the wind direction for streaky whitecaps. 0 = round, 1 = fully stretched. */
  windStretch: number;
}

/** Parameters for {@link WaveFoam.build}. */
export interface WaveFoamBuildParams {
  /** Eigenvalue from wave cascade (1 = flat, <1 = compressed/folding). */
  eigen0: Node;
  /** Eigenvalue from ripple cascade. */
  eigen1: Node;
  /**
   * Persistent foam energy sampled from {@link FoamAccumulation}. When
   * provided (WebGPU + persistentFoamBuffer quality), the build path
   * returns the energy-buffer foam; otherwise it falls back to the
   * stateless smoothstep mask used on WebGL.
   */
  foamEnergy?: Node;
  /** Whether Jacobian data is available (WebGL stateless path only). */
  hasJacobianFoam: boolean;
  /** Displaced surface normal (for WebGL leading edge detection). */
  surfaceNormal: Node;
  /** Global wind direction (radians). */
  windDirection: Node;
  /** Undisplaced world X coordinate. */
  worldX: Node;
  /** Undisplaced world Z coordinate. */
  worldZ: Node;
}

/** Output nodes produced by {@link WaveFoam.build}. */
export interface WaveFoamResult {
  /** Foam strength (0–1). */
  strength: Node;
  /** Foam color. */
  color: Node;
}

/**
 * Wave crest (turbulent) foam with Jacobian-driven wave breaking.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class WaveFoam {
  // ============= Private Uniforms =============
  private _color = uniform(new THREE.Color(0xffffff));
  private _coverage = uniform(0.5);
  private _crestCoverage = uniform(0.5);
  private _enabled = uniform(1.0);
  private _opacity = uniform(0.5);
  private _peakIntensity = uniform(1.0);
  private _rippleWeight = uniform(1.0);
  private _size = uniform(100.0);
  private _texture = texture(createDefaultFoamTexture());
  private _waveWeight = uniform(1.0);
  // Hardcoded to 1.0: leading-edge gating in `computeNormals.ts` is now
  // exclusively the persistent foam's job. The `windwardStrength` uniform
  // on FoamAccumulation gives the user control over windward injection
  // strength directly. Kept as a uniform node so existing TSL bindings
  // (computeNormals, stateless WebGL foam) don't need rewiring.
  private _windBias = uniform(1.0);
  private _windStretch = uniform(0.5);

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

  /** How much foam appears on wave crests (0–1). Higher = more foam. */
  get crestCoverage(): number {
    return this._crestCoverage.value;
  }

  set crestCoverage(value: number) {
    this._crestCoverage.value = value;
  }

  /** Whether wave foam is active. */
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

  /** Caps the maximum foam intensity (0–1). */
  get peakIntensity(): number {
    return this._peakIntensity.value;
  }

  set peakIntensity(value: number) {
    this._peakIntensity.value = value;
  }

  /** How much the ripple cascade contributes to foam (0–1). */
  get rippleWeight(): number {
    return this._rippleWeight.value;
  }

  set rippleWeight(value: number) {
    this._rippleWeight.value = value;
  }

  /** Texture size in world units (larger = bigger foam pattern). */
  get size(): number {
    return this._size.value;
  }

  set size(value: number) {
    this._size.value = value;
  }

  /** How much the wave cascade contributes to foam (0–1). */
  get waveWeight(): number {
    return this._waveWeight.value;
  }

  set waveWeight(value: number) {
    this._waveWeight.value = value;
  }

  /** Stretches foam in the wind direction for streaky whitecaps. */
  get windStretch(): number {
    return this._windStretch.value;
  }

  set windStretch(value: number) {
    this._windStretch.value = value;
  }

  /** Tileable foam texture. */
  get foamTexture(): THREE.Texture {
    return this._texture.value;
  }

  set foamTexture(value: THREE.Texture) {
    this._texture.value = value;
  }

  // ============= Internal Accessors =============

  /** @internal TSL uniform node for wind bias — used by simulation Jacobian computation. */
  get _windBiasNode(): Node {
    return this._windBias;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: WaveFoamParams): void {
    this.color = params.color;
    this.coverage = params.coverage;
    this.crestCoverage = params.crestCoverage;
    this.enabled = params.enabled;
    this.opacity = params.opacity;
    this.peakIntensity = params.peakIntensity;
    this.rippleWeight = params.rippleWeight;
    this.size = params.size;
    this.waveWeight = params.waveWeight;
    this.windStretch = params.windStretch;
    this.foamTexture = loadBuiltInFoamTexture(params.texture);
  }

  /**
   * Builds turbulent foam with Jacobian wave breaking and leading edge detection.
   *
   * @param params - World coordinates, texture, eigenvalues, wind, and surface normal.
   * @returns Foam strength and color nodes.
   */
  build(params: WaveFoamBuildParams): WaveFoamResult {
    const {
      worldX,
      worldZ,
      eigen0,
      eigen1,
      windDirection,
      surfaceNormal,
      hasJacobianFoam,
      foamEnergy,
    } = params;

    const strength = float(0.0).toVar();

    If(this._enabled.greaterThan(0.5), () => {
      if (foamEnergy !== undefined) {
        // WebGPU path: persistent accumulation buffer is the only source of
        // wave-crest foam. Toggling persistence off zeroes the buffer, so
        // no runtime branch is needed here — disabled === zero energy.
        const persistentFoam = this.calculatePersistentFoam(
          worldX,
          worldZ,
          foamEnergy,
          windDirection,
        );
        strength.assign(clamp(persistentFoam, 0.0, 1.0));
        return;
      }

      // WebGL fallback: no compute support, so the stateless Jacobian +
      // leading-edge path stands in for the accumulation buffer.
      strength.assign(
        this.buildStatelessFoam(
          worldX,
          worldZ,
          eigen0,
          eigen1,
          windDirection,
          surfaceNormal,
          hasJacobianFoam,
        ),
      );
    });

    return { strength, color: vec3(this._color) };
  }

  /**
   * Stateless wave-crest foam: Jacobian mask + leading-edge smoothstep +
   * anisotropic texture sample. Used on WebGL, below the `persistentFoamBuffer`
   * quality tier, and whenever the user toggles persistence off at runtime.
   *
   * @param worldX - Undisplaced world X.
   * @param worldZ - Undisplaced world Z.
   * @param eigen0 - Wave cascade eigenvalue.
   * @param eigen1 - Ripple cascade eigenvalue.
   * @param windDirection - Global wind direction (radians).
   * @param surfaceNormal - Displaced surface normal for leading-edge detection.
   * @param hasJacobianFoam - Whether Jacobian data is available.
   */
  private buildStatelessFoam(
    worldX: Node,
    worldZ: Node,
    eigen0: Node,
    eigen1: Node,
    windDirection: Node,
    surfaceNormal: Node,
    hasJacobianFoam: boolean,
  ): Node {
    let jacobianValue: Node = float(0.0);
    if (hasJacobianFoam) {
      jacobianValue = this.buildJacobian(eigen0, eigen1);
    }

    const windDirX = cos(windDirection);
    const windDirZ = sin(windDirection);
    const normalDotWind = dot(
      vec2(surfaceNormal.x, surfaceNormal.z),
      vec2(windDirX, windDirZ),
    );
    const leadingEdgeFactor = smoothstep(0.0, 0.3, normalDotWind);

    const foamMask = clamp(
      jacobianValue.add(leadingEdgeFactor.mul(this._windBias)),
      0.0,
      1.0,
    );

    const rawTurbulentFoam = this.calculateTurbulentFoam(
      worldX,
      worldZ,
      jacobianValue,
      windDirection,
    );

    return clamp(rawTurbulentFoam.mul(foamMask), 0.0, this._peakIntensity);
  }

  // ============= Private Helpers =============

  /**
   * Computes Jacobian value from eigenvalues for wave breaking detection.
   *
   * @param eigen0 - Eigenvalue from wave cascade.
   * @param eigen1 - Eigenvalue from ripple cascade.
   */
  private buildJacobian(eigen0: Node, eigen1: Node): Node {
    const foldingAmount = clamp(
      float(1.0)
        .sub(eigen0)
        .mul(this._waveWeight)
        .add(float(1.0).sub(eigen1).mul(this._rippleWeight)),
      0.0,
      1.0,
    );

    const derivedThreshold = float(0.5).mul(
      float(1.0).sub(this._crestCoverage),
    );
    const derivedSoftness = float(0.2);

    return smoothstep(
      derivedThreshold,
      derivedThreshold.add(derivedSoftness),
      foldingAmount,
    );
  }

  /**
   * Calculates turbulent foam with anisotropic stretching along wind direction.
   */
  private calculateTurbulentFoam(
    worldX: Node,
    worldZ: Node,
    jacobianValue: Node,
    windDirection: Node,
  ): Node {
    const baseUV = vec2(worldX.div(this._size), worldZ.div(this._size));

    const stretchedUV = this.calculateAnisotropicUV(
      baseUV,
      windDirection,
      this._windStretch,
    );

    const foamIntensity = this._texture.sample(stretchedUV).r;

    const baseThreshold = float(1.0).sub(this._coverage);
    const effectiveThreshold = clamp(
      baseThreshold.sub(jacobianValue.mul(this._crestCoverage)),
      0.0,
      1.0,
    );

    const alphaMask = smoothstep(
      effectiveThreshold,
      effectiveThreshold.add(0.15),
      foamIntensity,
    );

    return foamIntensity.mul(alphaMask).mul(this._opacity);
  }

  /**
   * Dissolve-style mask for the persistent wave foam.
   *
   * The foam texture is the visible value (so the bubble pattern shows
   * through inside the foam patches). The persistent buffer drives a
   * smoothstep threshold over the texture: as energy decays the threshold
   * rises through the texture's histogram, clipping out dark pixels first
   * — so patches dissolve into islands of bright bubbles instead of fading
   * uniformly.
   *
   * The mapping from energy to threshold is offset by the band half-width
   * on both ends so that:
   *   - `energy = 0` → the entire smoothstep band sits above texture max
   *     (1.0). No texture pixel passes, so foam goes fully to zero.
   *   - `energy = 1` → the entire band sits below texture min (0.0). Every
   *     texture pixel passes, so foam saturates.
   */
  private calculatePersistentFoam(
    worldX: Node,
    worldZ: Node,
    foamEnergy: Node,
    windDirection: Node,
  ): Node {
    const baseUV = vec2(worldX.div(this._size), worldZ.div(this._size));
    const stretchedUV = this.calculateAnisotropicUV(
      baseUV,
      windDirection,
      this._windStretch,
    );
    const foamTexValue = this._texture.sample(stretchedUV).r;

    const energy = (foamEnergy as Node).max(float(0.0));
    const threshold = float(1.0).sub(energy.mul(DISSOLVE_ENERGY_SCALE));
    const alphaMask = smoothstep(
      threshold,
      threshold.add(DISSOLVE_BAND_WIDTH),
      foamTexValue,
    );

    return foamTexValue.mul(alphaMask).mul(this._opacity);
  }

  /**
   * Calculates anisotropic UV stretching based on wind direction.
   * Stretches foam perpendicular to wave fronts for realistic streaky whitecaps.
   */
  private calculateAnisotropicUV(
    uv: Node,
    windDirection: Node,
    strength: Node,
  ): Node {
    const windDirX = cos(windDirection);
    const windDirZ = sin(windDirection);

    const u = uv.x;
    const v = uv.y;

    const parallel = u.mul(windDirX).add(v.mul(windDirZ));
    const perpendicular = u.mul(windDirZ.negate()).add(v.mul(windDirX));

    const stretchFactor = float(1.0).sub(strength).max(0.01);
    const stretchedParallel = parallel.mul(stretchFactor);

    const newU = stretchedParallel
      .mul(windDirX)
      .add(perpendicular.mul(windDirZ.negate()));
    const newV = stretchedParallel
      .mul(windDirZ)
      .add(perpendicular.mul(windDirX));

    return vec2(newU, newV);
  }
}

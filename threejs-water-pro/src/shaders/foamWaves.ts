// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Wave crest (turbulent) foam.
 *
 * Shades the persistent foam-energy field through a dissolve-textured mask:
 * lingering whitecaps that streak along the wind and break up into bubble
 * patterns as their energy decays. The energy itself is produced upstream by
 * the foam accumulation (breaking-crest injection + exponential decay); this
 * class only turns that energy into the visible, anisotropically-stretched foam.
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
  uniform,
  cos,
  sin,
} from "three/tsl";
import type { Node, UniformFloatNode } from "./types";
import { FoamPersistence, type FoamPersistenceParams } from "./foamPersistence";
import { FoamTextureSlot } from "./foamTextureSlot";
import type { BuiltInFoamName } from "./builtInFoamTextures";

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
  /** Whether wave foam is active. */
  enabled: boolean;
  /** Master opacity (0–1). */
  opacity: number;
  /** Persistent foam-energy field tuning (crest/decay/windward). */
  persistence: FoamPersistenceParams;
  /** Texture size in world units (larger = bigger foam pattern). */
  size: number;
  /** Name of the bundled foam texture to use. */
  texture: BuiltInFoamName;
  /** Stretches foam in the wind direction for streaky whitecaps. 0 = round, 1 = fully stretched. */
  windStretch: number;
}

/** Parameters for {@link WaveFoam.build}. */
export interface WaveFoamBuildParams {
  /**
   * Persistent foam energy sampled from the foam-accumulation field. The
   * crest-foam energy source; gated by `enabled`. Omitted on quality tiers
   * where wave foam is off.
   */
  foamEnergy?: Node;
  /**
   * Persistent wake-foam energy sampled from the wake field. When provided, it
   * is shaded through the same dissolve-textured path as crest foam and merged
   * on top, so wake foam appears even when crest foam is off.
   */
  wakeFoamEnergy?: Node;
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
 * Wave crest (turbulent) foam shaded from the persistent foam-energy field.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class WaveFoam {
  // ============= Private Uniforms =============
  private _color = uniform(new THREE.Color(0xffffff));
  private _enabled = uniform(1.0);
  private _opacity = uniform(0.5);
  private _size = uniform(12.0);
  private _texture = new FoamTextureSlot();
  // Hardcoded to 1.0: leading-edge gating in `computeNormals.ts` is now
  // exclusively the persistent foam's job. The `windwardStrength` foam
  // uniform gives the user control over windward injection strength
  // directly. Kept as a uniform node so the simulation's Jacobian/leading-edge
  // binding (computeNormals) doesn't need rewiring.
  private _windBias = uniform(1.0);
  private _windStretch = uniform(0.5);

  // ============= Owned Subobjects =============
  // The persistent energy field's tuning lives here so the runtime path
  // (`water.foam.waves.persistence`) matches the preset's `foam.waves.persistence`.
  // The foam-field inject pass binds these same uniform nodes by reference.
  private _persistence = new FoamPersistence();

  // ============= Public Getters/Setters =============

  /** Foam tint color. */
  get color(): THREE.Color {
    return this._color.value;
  }

  set color(value: THREE.Color | string) {
    this._color.value = new THREE.Color(value);
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

  /** Texture size in world units (larger = bigger foam pattern). */
  get size(): number {
    return this._size.value;
  }

  set size(value: number) {
    this._size.value = value;
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

  /**
   * Persistent foam-energy tuning (crest/decay/windward), surfaced as
   * `water.foam.waves.persistence`. Always present — the energy field that
   * consumes these may be absent on a tier, but the parameters are not.
   */
  get persistence(): FoamPersistence {
    return this._persistence;
  }

  // ============= Internal Accessors =============

  /** @internal TSL uniform node for wind bias — used by simulation Jacobian computation. */
  get _windBiasNode(): Node {
    return this._windBias;
  }

  /** @internal Wave-foam enable node — read by the foam field for its CPU-side gate. */
  get _enabledNode(): UniformFloatNode {
    return this._enabled;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: WaveFoamParams): void {
    this.color = params.color;
    this.enabled = params.enabled;
    this.opacity = params.opacity;
    this.size = params.size;
    this.windStretch = params.windStretch;
    void this._texture.load(params.texture);
    this._persistence.update(params.persistence);
  }

  /**
   * Switch to a bundled foam texture by name, leaving every other parameter
   * untouched — notably the persistence tuning. Use this for an isolated
   * texture change; {@link foamTexture} binds a caller-owned texture instead.
   */
  loadTexture(name: BuiltInFoamName): void {
    void this._texture.load(name);
  }

  /**
   * Builds wave-crest foam from the persistent energy field. Crest energy is
   * gated by `enabled`; wake energy (owned by the wake system) always
   * contributes, so wake foam appears even when crest foam is off.
   *
   * @param params - World coordinates, energies, and wind direction.
   * @returns Foam strength and color nodes.
   */
  build(params: WaveFoamBuildParams): WaveFoamResult {
    const { worldX, worldZ, windDirection, foamEnergy, wakeFoamEnergy } = params;

    const strength = float(0.0).toVar();

    if (foamEnergy !== undefined && wakeFoamEnergy !== undefined) {
      // Crest and wake foam share the same dissolve-textured shading, and that
      // shading is monotonic in energy, so merging the two energies and shading
      // once is identical to shading each and taking the max — one foam-texture
      // sample per fragment instead of two.
      const mergedEnergy = foamEnergy.mul(this._enabled).max(wakeFoamEnergy);
      const foam = this.calculatePersistentFoam(worldX, worldZ, mergedEnergy, windDirection);
      strength.assign(clamp(foam, 0.0, 1.0));
    } else if (foamEnergy !== undefined) {
      // Crest only — guard the texture sample so it's skipped when foam is off.
      If(this._enabled.greaterThan(0.5), () => {
        const foam = this.calculatePersistentFoam(worldX, worldZ, foamEnergy, windDirection);
        strength.assign(clamp(foam, 0.0, 1.0));
      });
    } else if (wakeFoamEnergy !== undefined) {
      // No crest field for this tier; wake foam still shades through the same path.
      const foam = this.calculatePersistentFoam(worldX, worldZ, wakeFoamEnergy, windDirection);
      strength.assign(clamp(foam, 0.0, 1.0));
    }

    return { strength, color: vec3(this._color) };
  }

  // ============= Private Helpers =============

  /**
   * Dissolve-style mask for the persistent wave foam.
   *
   * The foam texture is the visible value (so the bubble pattern shows
   * through inside the foam patches). The persistent energy drives a
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
    const foamTexValue = this._texture.node.sample(stretchedUV).r;

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

// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Persistent wave-foam energy parameters: how strongly breaking crests and
 * wind-facing faces inject foam energy, and how long it lingers.
 *
 * The single source of truth for these three values. {@link WaveFoam} owns one
 * instance and exposes it as `water.foam.waves.persistence`; the foam-field
 * inject pass binds the same uniform nodes by reference, so reading or writing
 * here is exactly what the GPU accumulation sees — no copy, no per-frame sync.
 */
import { uniform } from "three/tsl";
import type { UniformFloatNode } from "./types";

// Below ~0.05 s the per-frame inject/decay balance flickers (a spike then
// collapse within one frame), so the setter floors the e-folding time here.
const MIN_DECAY_TIME = 0.05;

/** Preset-facing parameters for the persistent wave-foam energy field. */
export interface FoamPersistenceParams {
  /**
   * Crest-driven foam strength. Equilibrium energy at a sustained sharp fold;
   * gentle folding is suppressed by the breaking-rate gate in the inject pass.
   */
  crestStrength: number;
  /** Exponential decay e-folding time (seconds). */
  decayTime: number;
  /**
   * Windward-face foam strength. Equilibrium energy on a fully wind-facing
   * pixel. Drives foam onto the rising face of waves; the field carries it past
   * the crest and into the leeward trail.
   */
  windwardStrength: number;
}

/**
 * Owns the persistent wave-foam energy uniforms. External code reads/writes
 * through getters and setters; the foam-field inject pass binds the private
 * uniform nodes via the internal node accessors.
 */
export class FoamPersistence {
  // ============= Private Uniforms =============
  private _crestStrength = uniform(2.5);
  private _decayTime = uniform(0.5);
  private _windwardStrength = uniform(1.5);

  // ============= Public Getters/Setters =============

  /** Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. */
  get crestStrength(): number {
    return this._crestStrength.value;
  }
  set crestStrength(value: number) {
    this._crestStrength.value = value;
  }

  /** Exponential decay e-folding time (seconds). Floored at 0.05 s. */
  get decayTime(): number {
    return this._decayTime.value;
  }
  set decayTime(value: number) {
    this._decayTime.value = Math.max(value, MIN_DECAY_TIME);
  }

  /** Windward-face foam strength. Equilibrium energy on a fully wind-facing pixel. */
  get windwardStrength(): number {
    return this._windwardStrength.value;
  }
  set windwardStrength(value: number) {
    this._windwardStrength.value = value;
  }

  // ============= Internal Accessors =============

  /** @internal Uniform node bound by the foam-inject pass. */
  get crestStrengthNode(): UniformFloatNode {
    return this._crestStrength;
  }
  /** @internal Uniform node bound by the foam-inject pass. */
  get decayTimeNode(): UniformFloatNode {
    return this._decayTime;
  }
  /** @internal Uniform node bound by the foam-inject pass. */
  get windwardStrengthNode(): UniformFloatNode {
    return this._windwardStrength;
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: FoamPersistenceParams): void {
    this.crestStrength = params.crestStrength;
    this.decayTime = params.decayTime;
    this.windwardStrength = params.windwardStrength;
  }
}

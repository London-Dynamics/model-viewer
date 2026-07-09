/**
 * Gerstner wave system for large-scale swells.
 *
 * This class owns the Gerstner wave parameters. External code reads/writes
 * parameters through getters and setters. The TSL shader function
 * {@link computeGerstner} reads from a wave buffer populated by the simulation.
 *
 * The class also provides {@link getInternalParams} which computes derived
 * values (steepness, direction, scaled amplitude) from WaveUniforms for
 * populating the simulation's wave buffer.
 */

import { float, int, vec3, cos, sin, normalize } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TSLUniformNode } from "../types/tsl";
import type { WaveUniforms } from "../uniforms";

// ============= Params interfaces =============

/** Preset-facing parameters for Gerstner waves. */
export interface GerstnerParams {
  /** Base amplitude in world units. */
  amplitude: number;
  /** Angular spread of wave directions in radians. */
  directionalSpread: number;
  /** Base wavelength in world units. Waves distribute geometrically around this. */
  wavelength: number;
  /** Geometric ratio between consecutive wave wavelengths (1 = identical, 2 = doubling). */
  wavelengthSpread: number;
}

/** Internal parameters including derived values (used by simulation buffer population). */
export interface InternalGerstnerParams extends GerstnerParams {
  /** Wave steepness (derived from choppiness). */
  steepness: number;
  /** Wave direction in radians (derived from wind direction). */
  direction: number;
}

/** Parameters for {@link computeGerstner}. */
export interface ComputeGerstnerParams {
  worldX: Node;
  worldZ: Node;
  time: TSLUniformNode;
  /** Wave buffer: uniformArray or instancedArray — both support .element(i) */
  waveBuffer: Node;
  waveCount: TSLUniformNode;
  maxWaves: number;
}

/** Result from {@link computeGerstner}. */
export interface GerstnerResult {
  displacement: Node;
  normal: Node;
  /** Analytical time derivative of displacement (m/s). */
  velocity: Node;
  /** Approximate Jacobian folding: sum(Q*k*A*cos(phase)). Subtract from FFT eigenvalue. */
  folding: Node;
}

/**
 * Gerstner wave parameter manager.
 *
 * Owns the base Gerstner parameters and computes derived values from WaveUniforms.
 * When parameters change via setters, the onUpdate callback is invoked to trigger
 * simulation buffer population.
 */
export class Gerstner {
  // ============= Private Fields =============
  private _amplitude = 1.0;
  private _directionalSpread = 0.1;
  private _wavelength = 200.0;
  private _wavelengthSpread = 1.4;

  private waveUniforms: WaveUniforms;
  private onUpdate: () => void;

  // ============= Constructor =============

  /**
   * Creates a Gerstner parameter manager.
   *
   * @param waveUniforms - Reference to wave uniforms for computing derived values.
   * @param onUpdate - Callback invoked when any parameter changes.
   */
  constructor(waveUniforms: WaveUniforms, onUpdate: () => void) {
    this.waveUniforms = waveUniforms;
    this.onUpdate = onUpdate;
  }

  // ============= Public Getters/Setters =============

  /** Base amplitude in world units. */
  get amplitude(): number {
    return this._amplitude;
  }

  set amplitude(value: number) {
    this._amplitude = value;
    this.onUpdate();
  }

  /** Angular spread of wave directions in radians. */
  get directionalSpread(): number {
    return this._directionalSpread;
  }

  set directionalSpread(value: number) {
    this._directionalSpread = value;
    this.onUpdate();
  }

  /** Base wavelength in world units. */
  get wavelength(): number {
    return this._wavelength;
  }

  set wavelength(value: number) {
    this._wavelength = value;
    this.onUpdate();
  }

  /** Geometric ratio between consecutive wave wavelengths. */
  get wavelengthSpread(): number {
    return this._wavelengthSpread;
  }

  set wavelengthSpread(value: number) {
    this._wavelengthSpread = value;
    this.onUpdate();
  }

  // ============= Public Methods =============

  /** Bulk-set parameters from a preset or params object. */
  update(params: GerstnerParams): void {
    this._amplitude = params.amplitude;
    this._directionalSpread = params.directionalSpread;
    this._wavelength = params.wavelength;
    this._wavelengthSpread = params.wavelengthSpread;
    this.onUpdate();
  }

  /**
   * Computes internal parameters including derived values from WaveUniforms.
   * Used by the simulation to populate the Gerstner wave buffer.
   */
  getInternalParams(): InternalGerstnerParams {
    const windScale = this.waveUniforms.windSpeed.value / 10.0;
    return {
      amplitude: this._amplitude * windScale * this.waveUniforms.amplitude.value,
      directionalSpread: this._directionalSpread,
      wavelength: this._wavelength,
      wavelengthSpread: this._wavelengthSpread,
      steepness: Math.min(this.waveUniforms.choppiness.value * 0.5, 1.0),
      direction: this.waveUniforms.windDirection.value,
    };
  }

  /**
   * Triggers an update without changing parameters.
   * Call this when WaveUniforms change to recompute derived values.
   */
  triggerUpdate(): void {
    this.onUpdate();
  }
}

// ============= TSL Shader Function =============

/**
 * Computes Gerstner wave displacement and analytical normal.
 *
 * Displacement:
 *   dx = -Q * A * dirX * sin(phase)
 *   dy =  A * cos(phase)
 *   dz = -Q * A * dirZ * sin(phase)
 *
 * Normal (analytical derivative, for cos-height convention):
 *   nx =  dirX * k * A * sin(phase)
 *   ny =  1 - Q * k * A * cos(phase)
 *   nz =  dirZ * k * A * sin(phase)
 *
 * Uses a compile-time static loop (GPU requires fixed bounds).
 * Returns {displacement, normal, folding}.
 */
export function computeGerstner({
  worldX,
  worldZ,
  time,
  waveBuffer,
  waveCount,
  maxWaves,
}: ComputeGerstnerParams): GerstnerResult {
  if (maxWaves === 0) {
    return {
      displacement: vec3(0, 0, 0),
      normal: vec3(0, 1, 0),
      velocity: vec3(0, 0, 0),
      folding: float(0.0),
    };
  }

  let totalDx: Node = float(0.0);
  let totalDy: Node = float(0.0);
  let totalDz: Node = float(0.0);

  let totalVx: Node = float(0.0);
  let totalVy: Node = float(0.0);
  let totalVz: Node = float(0.0);

  let totalNx: Node = float(0.0);
  let totalNySub: Node = float(0.0); // accumulates Q*k*A*cos(phase) (also used for folding)
  let totalNz: Node = float(0.0);

  for (let i = 0; i < maxWaves; i++) {
    const iFloat = float(i);

    // Read wave parameters (two vec4s per wave)
    const params0 = waveBuffer.element(int(i * 2));
    const params1 = waveBuffer.element(int(i * 2 + 1));

    const dirX = params0.x;
    const dirZ = params0.y;
    const amplitude = params0.z;
    const wavelength = params0.w;

    const steepness = params1.x;
    const phaseOffset = params1.y;
    const omega = params1.z;

    // Skip inactive waves (wave index >= waveCount)
    const active = iFloat.lessThan(waveCount.toFloat());
    const mask = active.toFloat();

    // Wave number magnitude
    const k = float(2.0 * Math.PI).div(wavelength.add(0.0001));

    // Phase: dot(k_vec, worldPos) - omega * time + phaseOffset
    const phase = k
      .mul(dirX.mul(worldX).add(dirZ.mul(worldZ)))
      .sub(omega.mul(time))
      .add(phaseOffset);

    const cosPhase = cos(phase);
    const sinPhase = sin(phase);

    // Displacement
    const dx = steepness.negate().mul(amplitude).mul(dirX).mul(sinPhase).mul(mask);
    const dy = amplitude.mul(cosPhase).mul(mask);
    const dz = steepness.negate().mul(amplitude).mul(dirZ).mul(sinPhase).mul(mask);

    totalDx = totalDx.add(dx);
    totalDy = totalDy.add(dy);
    totalDz = totalDz.add(dz);

    // Analytical velocity: d/dt of displacement.
    //   d/dt(dx) = -Q*A*dirX*cos(phase)*(-omega) = Q*A*omega*dirX*cos(phase)
    //   d/dt(dy) = A*(-sin(phase))*(-omega)     = A*omega*sin(phase)
    //   d/dt(dz) = Q*A*omega*dirZ*cos(phase)
    const aOmega = amplitude.mul(omega);
    const vx = steepness.mul(aOmega).mul(dirX).mul(cosPhase).mul(mask);
    const vy = aOmega.mul(sinPhase).mul(mask);
    const vz = steepness.mul(aOmega).mul(dirZ).mul(cosPhase).mul(mask);

    totalVx = totalVx.add(vx);
    totalVy = totalVy.add(vy);
    totalVz = totalVz.add(vz);

    // Analytical normal components (derived from cos-height displacement convention)
    const kA = k.mul(amplitude);
    const nx = dirX.mul(kA).mul(sinPhase).mul(mask);
    const nySub = steepness.mul(kA).mul(cosPhase).mul(mask);
    const nz = dirZ.mul(kA).mul(sinPhase).mul(mask);

    totalNx = totalNx.add(nx);
    totalNySub = totalNySub.add(nySub);
    totalNz = totalNz.add(nz);
  }

  const displacement = vec3(totalDx, totalDy, totalDz);
  const velocity = vec3(totalVx, totalVy, totalVz);

  const normal = normalize(
    vec3(totalNx, float(1.0).sub(totalNySub), totalNz),
  );

  // Folding is the same accumulation as totalNySub (Q*k*A*cos(phase) per wave)
  const folding = totalNySub;

  return { displacement, normal, velocity, folding };
}

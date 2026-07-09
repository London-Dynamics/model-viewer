/**
 * Persistent wave-crest foam accumulation system.
 *
 * Maintains per-cascade ping-pong storage buffers of turbulent-energy
 * values. Each frame runs two compute passes per cascade:
 *
 *   1. **Decay** — `E_next = E_prev * exp(-dt / τ)`
 *   2. **Inject** — `E_next += injectionRate * max(0, threshold - eigen) * dt`
 *
 * The surface material shader samples the current read buffers via
 * {@link CascadeSampler.sampleFoamAccumulation}. This is the War Thunder /
 * Sea of Thieves persistent-foam pattern: foam lingers for seconds after a
 * breaking event, producing visible streaks and decay tails instead of a
 * flat stateless mask.
 */

import * as THREE from "three/webgpu";
import { storage } from "three/tsl";
import { WebGPUWaveSimulation } from "../waves/webgpu/WebGPUWaveSimulation";
import type { IWaveSimulation } from "../waves";
import type { StorageBufferNode } from "../../shaders/types";
import type { TSLComputeShader } from "../../types/tsl";
import type { WaveUniforms } from "../../uniforms";
import {
  createFoamAccumulationUniforms,
  type FoamAccumulationUniforms,
} from "./shaders/uniforms";
import { createFoamDecayCompute } from "./shaders/decay";
import { createFoamInjectCompute } from "./shaders/inject";

// ============================================
// Types
// ============================================

/** Preset-facing parameters for {@link FoamAccumulation}. */
export interface FoamAccumulationParams {
  /**
   * Crest-driven foam strength. Equilibrium energy at a sustained sharp
   * fold; gentle folding is suppressed by the built-in smoothstep gate.
   */
  crestStrength: number;
  /** Exponential decay e-folding time (seconds). */
  decayTime: number;
  /**
   * Windward-face foam strength. Equilibrium energy on a fully wind-facing
   * pixel, regardless of folding. Drives foam onto the rising face of
   * waves; the persistent buffer carries it through the crest and beyond.
   */
  windwardStrength: number;
}

// ============================================
// Constants
// ============================================

/** Floats per texel (`.x = energy`, `.y = age`). */
const FOAM_STRIDE_FLOATS = 2;

/**
 * Lower bound for the e-folding time. Below this the buffer decays faster
 * than the simulation can produce a coherent injection across frames, so
 * the energy field flickers as crests spike-and-collapse each tick.
 */
const MIN_DECAY_TIME = 0.05;

/** Internal state for the wave-cascade ping-pong pair. */
interface CascadeState {
  readonly resolution: number;
  readonly bufferA: THREE.StorageInstancedBufferAttribute;
  readonly bufferB: THREE.StorageInstancedBufferAttribute;
  readonly nodeA: StorageBufferNode;
  readonly nodeB: StorageBufferNode;
  decayAtoB: TSLComputeShader;
  decayBtoA: TSLComputeShader;
  injectAtoB: TSLComputeShader;
  injectBtoA: TSLComputeShader;
  /** Which buffer currently holds the latest (post-update) state. */
  current: "A" | "B";
}

// ============================================
// FoamAccumulation
// ============================================

/**
 * Per-cascade persistent foam energy buffers.
 *
 * Owns its storage buffers and uniform nodes. External code reads/writes
 * parameters through getters/setters; the compute passes bind to the
 * private uniform nodes at construction time.
 */
export class FoamAccumulation {
  // Dependencies
  private _renderer: THREE.WebGPURenderer;
  private _oceanSim: WebGPUWaveSimulation;
  private _waveUniforms: WaveUniforms;

  // Shared uniforms (single source of truth).
  private _uniforms: FoamAccumulationUniforms = createFoamAccumulationUniforms();

  // Per-cascade ping-pong state.
  private _cascades: CascadeState[] = [];

  constructor(
    renderer: THREE.WebGPURenderer,
    oceanSim: WebGPUWaveSimulation,
    waveUniforms: WaveUniforms,
  ) {
    this._renderer = renderer;
    this._oceanSim = oceanSim;
    this._waveUniforms = waveUniforms;

    // Only cascade 0 is allocated. Higher cascades would only carry
    // ripple-scale folding that smears into a uniform haze; with no
    // injection source they'd decay to an empty buffer anyway.
    const state = this._buildCascade(0);
    if (state) this._cascades.push(state);
  }

  /**
   * Construct only when the backend supports persistent storage buffers
   * AND the active quality level opts in. Returns `null` on WebGL or on
   * quality tiers where the buffer is disabled. Centralises the
   * three-fold guard so callers do not duplicate the instanceof /
   * capability / quality-feature triplet.
   */
  static tryCreate(
    renderer: THREE.WebGPURenderer,
    oceanSim: IWaveSimulation,
    waveUniforms: WaveUniforms,
    persistentFoamFeatureEnabled: boolean,
  ): FoamAccumulation | null {
    if (
      !(oceanSim instanceof WebGPUWaveSimulation) ||
      !oceanSim.getCapabilities().hasPersistentFoamBuffer ||
      !persistentFoamFeatureEnabled
    ) {
      return null;
    }
    return new FoamAccumulation(renderer, oceanSim, waveUniforms);
  }

  // ============================================
  // Cascade construction
  // ============================================

  private _buildCascade(cascadeIndex: number): CascadeState | null {
    const normalBuffer = this._oceanSim.getNormalBuffer(cascadeIndex);
    if (!normalBuffer) return null;

    const resolution = this._oceanSim.getResolution(cascadeIndex);
    const texelCount = resolution * resolution;

    const bufferA = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(texelCount * FOAM_STRIDE_FLOATS),
      FOAM_STRIDE_FLOATS,
    );
    const bufferB = new THREE.StorageInstancedBufferAttribute(
      new Float32Array(texelCount * FOAM_STRIDE_FLOATS),
      FOAM_STRIDE_FLOATS,
    );
    const nodeA = storage(bufferA, "vec2", texelCount) as StorageBufferNode;
    const nodeB = storage(bufferB, "vec2", texelCount) as StorageBufferNode;

    // Pre-build both ping-pong compute pairs. Binding direction is baked
    // into the TSL graph, so we need one pair per direction and alternate
    // them at dispatch time via {@link CascadeState.current}.
    const decayAtoB = createFoamDecayCompute({
      bufferIn: nodeA,
      bufferOut: nodeB,
      decayTime: this._uniforms.decayTime,
      deltaTime: this._uniforms.deltaTime,
      resolution,
    });
    const decayBtoA = createFoamDecayCompute({
      bufferIn: nodeB,
      bufferOut: nodeA,
      decayTime: this._uniforms.decayTime,
      deltaTime: this._uniforms.deltaTime,
      resolution,
    });

    const injectShared = {
      normalBuffer: normalBuffer as StorageBufferNode,
      crestStrength: this._uniforms.crestStrength,
      windwardStrength: this._uniforms.windwardStrength,
      windDirection: this._waveUniforms.windDirection,
      decayTime: this._uniforms.decayTime,
      deltaTime: this._uniforms.deltaTime,
      resolution,
    };
    const injectAtoB = createFoamInjectCompute({ ...injectShared, bufferOut: nodeB });
    const injectBtoA = createFoamInjectCompute({ ...injectShared, bufferOut: nodeA });

    return {
      resolution,
      bufferA,
      bufferB,
      nodeA,
      nodeB,
      decayAtoB,
      injectAtoB,
      decayBtoA,
      injectBtoA,
      current: "A",
    };
  }

  // ============================================
  // Public API — buffer access
  // ============================================

  /**
   * Get the storage node of the cascade's current read buffer — the buffer
   * holding the latest (post-update) foam energy. Returns null if the
   * cascade index is out of range.
   */
  getFoamBuffer(cascadeIndex: number): StorageBufferNode | null {
    const state = this._cascades[cascadeIndex];
    if (!state) return null;
    return state.current === "A" ? state.nodeA : state.nodeB;
  }

  // ============================================
  // Public API — getters/setters
  // ============================================

  /**
   * Whether persistent foam is enabled. Disabling zeros the accumulation
   * buffers so previously-deposited energy does not reappear on re-enable,
   * and skips all compute dispatches while off.
   */
  get enabled(): boolean {
    return this._uniforms.enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    const wasEnabled = this._uniforms.enabled.value === 1.0;
    this._uniforms.enabled.value = value ? 1.0 : 0.0;
    if (wasEnabled && !value) {
      this._clearBuffers();
    }
  }

  /** Exponential decay e-folding time (seconds). */
  get decayTime(): number {
    return this._uniforms.decayTime.value;
  }

  set decayTime(value: number) {
    this._uniforms.decayTime.value = Math.max(value, MIN_DECAY_TIME);
  }

  /**
   * Crest-driven foam strength. Equilibrium energy at a sustained sharp
   * fold equals this value; gentle surface folding is suppressed by the
   * breaking-rate curve baked into the inject pass.
   */
  get crestStrength(): number {
    return this._uniforms.crestStrength.value;
  }

  set crestStrength(value: number) {
    this._uniforms.crestStrength.value = value;
  }

  /**
   * Windward-face foam strength. Equilibrium energy on a fully wind-facing
   * pixel, regardless of folding.
   */
  get windwardStrength(): number {
    return this._uniforms.windwardStrength.value;
  }

  set windwardStrength(value: number) {
    this._uniforms.windwardStrength.value = value;
  }

  /**
   * @internal Bulk-set parameters from a preset or params object.
   * `enabled` is owned by {@link WaterSystem} (driven by the quality-level
   * `persistentFoamBuffer` flag) — it's intentionally not in the params.
   */
  update(params: FoamAccumulationParams): void {
    this.crestStrength = params.crestStrength;
    this.decayTime = params.decayTime;
    this.windwardStrength = params.windwardStrength;
  }

  // ============================================
  // Per-frame update
  // ============================================

  /**
   * Dispatch decay + inject for every cascade. No-op when disabled.
   *
   * @param deltaTime - Seconds since the previous frame.
   */
  async tick(deltaTime: number): Promise<void> {
    if (this._uniforms.enabled.value !== 1.0 || this._cascades.length === 0) {
      return;
    }

    this._uniforms.deltaTime.value = Math.min(deltaTime, 0.05);

    for (const state of this._cascades) {
      if (state.current === "A") {
        // Read A, write B, then B becomes current.
        await this._renderer.computeAsync(state.decayAtoB);
        await this._renderer.computeAsync(state.injectAtoB);
        state.current = "B";
      } else {
        await this._renderer.computeAsync(state.decayBtoA);
        await this._renderer.computeAsync(state.injectBtoA);
        state.current = "A";
      }
    }
  }

  /**
   * Zero both ping-pong buffers for every cascade and mark them dirty so
   * the GPU picks up the cleared data on the next compute or sample.
   * Called when persistence is toggled off to avoid leaving frozen energy
   * in the accumulation buffers.
   */
  private _clearBuffers(): void {
    for (const state of this._cascades) {
      (state.bufferA.array as Float32Array).fill(0);
      (state.bufferB.array as Float32Array).fill(0);
      state.bufferA.needsUpdate = true;
      state.bufferB.needsUpdate = true;
    }
  }

  // ============================================
  // Disposal
  // ============================================

  /** Dispose GPU resources. */
  dispose(): void {
    this._cascades = [];
  }
}

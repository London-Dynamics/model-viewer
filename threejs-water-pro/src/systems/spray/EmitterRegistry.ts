/**
 * Spray emitter registry.
 *
 * Owns the two GPU buffers consumed by the emission compute:
 *
 *   - **Probe buffer**: per-probe object-local position, runtime cooldown
 *     state, pending-burst slot, **and resolved per-probe params**. The
 *     last is the same {@link EmitterParams} block that used to live in
 *     a separate per-emitter buffer — moving it inline lets every probe
 *     hold its own override layer (`defaults → emitter → probe`) at
 *     spawn time without a second buffer binding.
 *   - **State buffer**: per-frame world matrix + linear velocity + angular
 *     velocity + active flag, one slot per emitter. Re-uploaded every
 *     tick. The emission shader only reads the matrix and active flag;
 *     the velocity slots are kept populated for the debug visualizer's
 *     world-velocity arrow.
 *
 * Slot allocation is a free-list stack — `add` pops, `remove` pushes. A
 * single slot index addresses the same emitter in both buffers.
 *
 * Firing is gated by relative impact speed at the contact point — the
 * vertical convergence rate between probe and water surface over the
 * last frame. The artist authors probe positions; the system derives
 * impact magnitude per frame from probe-vs-surface motion, so a moving
 * boat striking still water and a stationary obstruction struck by a
 * rising wave both fire correctly.
 */

import * as THREE from "three/webgpu";
import { storage } from "three/tsl";
import {
  bakeFromProbes,
  EMITTER_PARAM_KEYS,
  type BakedProbes,
  type EmitterParams,
  type SprayProbe,
} from "./EmitterBake";

// ============================================
// Constants
// ============================================

/** Maximum simultaneously registered emitters. */
export const MAX_EMITTERS = 16;

/** Authored probes per emitter. */
export const MAX_PROBES_PER_EMITTER = 32;

/**
 * vec4 entries per probe slot:
 *
 *   0: (localX, localY, localZ, validAndEnabled)                            ← authored
 *   1: (lastFireTime, prevSignedDist, hasPrevSample, lastBurstBirthLife)    ← cooldown / crossing state
 *   2: (pendingFireTime, pendingSizeScale, pendingHeightScale, pendingVariantIdx)  ← scheduled burst
 *   3: (size, stretchX, stretchY, opacity)                                   ← resolved per-probe params
 *   4: (duration, fadeOutTime, velocityThreshold, respawnTime)
 *   5: (spawnJitterTime, submersionDepth, velocityScaleFactor, velocityHeightFactor)
 *   6: (bottomFadeStart, bottomFadeStop, _pad, _pad)
 *
 * The params block (vec4[3..6]) is rewritten on registration, on
 * `updateEmitter`, and on `broadcastParams` — but only the keys *not*
 * overridden by the probe are touched, so per-probe overrides survive
 * later emitter-level or system-level edits.
 *
 * `validAndEnabled` is `1.0` for an authored probe whose user-toggleable
 * `enabled` flag is true, `0.0` otherwise (padding, or authored-but-disabled).
 * The emission compute's `>0.5` skip then naturally drops disabled probes
 * without a separate gate; the CPU registry mirrors the user-authored
 * enabled flag for `getDebugData` and `setProbeEnabled` to consult.
 *
 * `prevSignedDist` is `probeWorldY − displacedSurfaceY` from the previous
 * frame; `hasPrevSample` is a 0/1 flag indicating whether `prevSignedDist`
 * is meaningful yet (false on the very first tick after registration).
 * Together they let the emission compute detect water-line crossing edges.
 *
 * `lastBurstBirthLife` is `(duration + jitter)` captured at trigger so the
 * cooldown gate stays consistent across the full alive window (jitter
 * dwell + visible duration) even if `duration` or `spawnJitterTime` change
 * mid-flight. Total cooldown is `lastBurstBirthLife + respawnTime`.
 *
 * The pending slot decouples *trigger* from *spawn*. On the crossing
 * frame, the impact decision is captured (when to fire, what size,
 * which atlas variant) but no particle is written yet. On the frame
 * `time ≥ pendingFireTime`, the particle is written at the probe's
 * **current** world position. `pendingFireTime = -1` (or any negative
 * value) means "no pending burst".
 */
export const PROBE_VEC4_PER_POINT = 7;

/** Index (in vec4 units) of the first param slot inside each probe entry. */
export const PROBE_PARAMS_VEC4_OFFSET = 3;

/** vec4 entries per emitter state slot. */
const STATE_VEC4_PER_EMITTER = 5;

/** Total emission threads dispatched per frame (compile-time constant). */
export const EMISSION_THREADS = MAX_EMITTERS * MAX_PROBES_PER_EMITTER;

/** Hard cap on |velocity| (m/s) — guards against teleport spikes. */
const MAX_LINEAR_VELOCITY = 100.0;
/** Hard cap on |angular velocity| (rad/s). */
const MAX_ANGULAR_VELOCITY = 20.0;

// ============================================
// Types
// ============================================

/** Re-export for callers. */
export {
  DEFAULT_EMITTER_PARAMS,
  type EmitterParams,
  type SprayProbe,
} from "./EmitterBake";

/** Three-state CPU approximation of probe lifecycle for debug viz. */
export type ProbeState = "disabled" | "inactive" | "playing" | "respawning";

/** Per-probe debug snapshot (one per registered probe across all emitters). */
export interface ProbeDebugSnapshot {
  /** Emitter id this probe belongs to. */
  emitterId: number;
  /**
   * Vertical convergence rate (m/s) between probe and approximate water
   * line over the last debug snapshot. Mirrors the firing gate the GPU
   * uses; captured for visualizers that want to colour or label probes
   * by impact intensity. Always ≥ 0.
   */
  impactSpeed: number;
  /** Probe index within its emitter (0..probeCount). */
  probeIndex: number;
  /** `|worldVelocity|`. */
  speed: number;
  /**
   * CPU-side approximation of probe lifecycle.
   *   - `disabled`    — probe's user-authored `enabled` flag is false; the
   *                     GPU skips it entirely.
   *   - `inactive`    — probe is enabled but not firing this frame (no
   *                     crossing edge or impact speed below threshold).
   *   - `playing`     — last fire is within the spray's `duration`; the
   *                     billboard's flipbook is still on screen.
   *   - `respawning`  — past `duration` but still inside the
   *                     `duration + respawnTime` cooldown window;
   *                     waiting for the cooldown to expire.
   *
   * Approximated CPU-side without GPU readback — uses mean water height
   * (no displaced-surface lookup), so the state can disagree with the
   * actual GPU emission decision in rough seas. Debug indicator only.
   */
  state: ProbeState;
  /** Current probe world position. */
  worldPosition: THREE.Vector3;
  /** Current probe world velocity (rigid-body kinematics). */
  worldVelocity: THREE.Vector3;
}

/**
 * Public options accepted by `SpraySystem.addEmitter` /
 * `SpraySystem.updateEmitter`. Per-emitter param overrides apply on top
 * of the system's current defaults; per-probe overrides further override
 * the emitter values for that one probe (see {@link SprayProbe}).
 */
export interface AddEmitterOptions extends Partial<EmitterParams> {
  /** Whether the emitter is initially active. Default true. */
  active?: boolean;
  /** Authored emission probes. Required (no procedural fallback). */
  probes: SprayProbe[];
}

/** Internal options used by the registry — emitter params are pre-resolved. */
export interface RegistryAddOptions {
  active?: boolean;
  params: EmitterParams;
  probes: SprayProbe[];
}

/** Internal per-emitter state. */
interface RegisteredEmitter {
  active: boolean;
  /**
   * Per-probe user-authored enabled flag (CPU mirror). 1 = enabled, 0 =
   * disabled. The GPU's combined `validAndEnabled` slot is derived from
   * this, but we keep it CPU-side too so the debug visualizer can
   * distinguish "padding" (probeIndex >= probeCount) from "disabled"
   * (probeIndex < probeCount && enabledFlags[i] === 0).
   */
  enabledFlags: Uint8Array;
  hasLastTransform: boolean;
  /**
   * Per-probe flag indicating whether `prevSignedDistApprox[i]` is
   * meaningful (1) or still uninitialised (0). Set on the first
   * `getDebugData` call after registration.
   */
  hasPrevSampleApprox: Uint8Array;
  id: number;
  /**
   * Per-probe approximate last-fire timestamp in seconds (CPU mirror of
   * the GPU's lastFireTime). Mirrors the same predicates the emission
   * compute uses, so the debug visualizer can colour probes without
   * round-tripping GPU buffers. Sized to `MAX_PROBES_PER_EMITTER`;
   * unused entries stay at `-Infinity`.
   */
  lastFireApprox: Float32Array;
  lastQuaternion: THREE.Quaternion;
  lastTranslation: THREE.Vector3;
  object: THREE.Object3D;
  /** Resolved emitter-level params (defaults + emitter overrides). */
  params: EmitterParams;
  probeCount: number;
  /**
   * Per-probe override map. Empty objects mean the probe inherits every
   * field from `params`; keys present here override the emitter value
   * and survive subsequent broadcasts. Length === `probeCount`.
   */
  probeOverrides: Array<Partial<EmitterParams>>;
  /**
   * Per-probe previous-frame signed distance to the mean water line
   * (CPU mirror of the GPU's `prevSignedDist`, but using `meanY` rather
   * than the displaced surface). Drives the debug visualizer's
   * crossing-edge approximation.
   */
  prevSignedDistApprox: Float32Array;
  slot: number;
}

// ============================================
// Registry
// ============================================

export class EmitterRegistry {
  // ── Backing GPU storage ────────────────────────────────
  readonly probeBufferNode: ReturnType<typeof storage>;
  readonly stateBufferNode: ReturnType<typeof storage>;

  private readonly _emitters: Map<number, RegisteredEmitter> = new Map();
  // ── Slot bookkeeping ───────────────────────────────────
  private readonly _freeSlots: number[];
  private _nextId = 0;

  private readonly _probeAttribute: THREE.StorageInstancedBufferAttribute;
  private readonly _probeData: Float32Array;
  private readonly _stateAttribute: THREE.StorageInstancedBufferAttribute;
  private readonly _stateData: Float32Array;

  // ── Reusable scratch ───────────────────────────────────
  private readonly _scratchDeltaQ = new THREE.Quaternion();
  private readonly _scratchInvLast = new THREE.Quaternion();
  private readonly _scratchPos = new THREE.Vector3();
  private readonly _scratchQuat = new THREE.Quaternion();
  private readonly _scratchScale = new THREE.Vector3();

  constructor() {
    // Probe buffer: vec4 × PROBE_VEC4_PER_POINT × MAX_EMITTERS × MAX_PROBES_PER_EMITTER.
    const probeVec4Count =
      MAX_EMITTERS * MAX_PROBES_PER_EMITTER * PROBE_VEC4_PER_POINT;
    this._probeData = new Float32Array(probeVec4Count * 4);
    this._probeAttribute = new THREE.StorageInstancedBufferAttribute(
      this._probeData,
      4,
    );
    this.probeBufferNode = storage(
      this._probeAttribute,
      "vec4",
      probeVec4Count,
    );

    // State buffer: vec4 × STATE_VEC4_PER_EMITTER × MAX_EMITTERS.
    const stateVec4Count = MAX_EMITTERS * STATE_VEC4_PER_EMITTER;
    this._stateData = new Float32Array(stateVec4Count * 4);
    this._stateAttribute = new THREE.StorageInstancedBufferAttribute(
      this._stateData,
      4,
    );
    this.stateBufferNode = storage(
      this._stateAttribute,
      "vec4",
      stateVec4Count,
    );

    // Free-slot stack — LIFO so freshly removed slots get reused first.
    this._freeSlots = [];
    for (let i = MAX_EMITTERS - 1; i >= 0; i--) this._freeSlots.push(i);
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Register an object as a spray emitter. Returns an id, or `-1` if the
   * `MAX_EMITTERS` cap has been reached.
   */
  add(object: THREE.Object3D, options: RegistryAddOptions): number {
    if (!options.probes || options.probes.length === 0) {
      throw new Error(
        "SpraySystem.addEmitter: `options.probes` is required and must contain " +
          "at least one probe.",
      );
    }

    if (this._freeSlots.length === 0) {
      console.warn(
        `SpraySystem: maximum of ${MAX_EMITTERS} emitters reached — addEmitter ignored.`,
      );
      return -1;
    }

    let baked: BakedProbes = bakeFromProbes(options.probes);
    if (baked.count > MAX_PROBES_PER_EMITTER) {
      console.warn(
        `SpraySystem: emitter has ${baked.count} probes; ` +
          `truncating to ${MAX_PROBES_PER_EMITTER}.`,
      );
      baked = {
        count: MAX_PROBES_PER_EMITTER,
        enabled: baked.enabled.subarray(0, MAX_PROBES_PER_EMITTER),
        overrides: baked.overrides.slice(0, MAX_PROBES_PER_EMITTER),
        positions: baked.positions.subarray(0, MAX_PROBES_PER_EMITTER * 3),
      };
    }

    const slot = this._freeSlots.pop()!;
    const id = this._nextId++;

    const lastFireApprox = new Float32Array(MAX_PROBES_PER_EMITTER);
    lastFireApprox.fill(-Infinity);
    const prevSignedDistApprox = new Float32Array(MAX_PROBES_PER_EMITTER);
    const hasPrevSampleApprox = new Uint8Array(MAX_PROBES_PER_EMITTER);
    const enabledFlags = new Uint8Array(MAX_PROBES_PER_EMITTER);
    enabledFlags.set(baked.enabled);

    const emitter: RegisteredEmitter = {
      active: options.active ?? true,
      enabledFlags,
      hasLastTransform: false,
      hasPrevSampleApprox,
      id,
      lastFireApprox,
      lastQuaternion: new THREE.Quaternion(),
      lastTranslation: new THREE.Vector3(),
      object,
      params: { ...options.params },
      probeCount: baked.count,
      probeOverrides: baked.overrides.map((o) => ({ ...o })),
      prevSignedDistApprox,
      slot,
    };
    this._emitters.set(id, emitter);

    this._writeProbes(emitter, baked);

    return id;
  }

  /** Remove an emitter. Returns true if found. */
  remove(id: number): boolean {
    const emitter = this._emitters.get(id);
    if (!emitter) return false;

    this._zeroProbeSlot(emitter.slot);
    this._zeroStateSlot(emitter.slot);
    this._emitters.delete(id);
    this._freeSlots.push(emitter.slot);
    return true;
  }

  /**
   * Update tunable parameters on an existing emitter. The probe set is
   * **not** re-baked — change probes by removing and re-adding the emitter.
   * Per-probe enabled toggling goes through {@link setProbeEnabled}.
   *
   * Param changes touch only those keys the probe didn't override at
   * registration, so per-probe overrides survive an `updateEmitter` call.
   */
  update(id: number, options: Partial<AddEmitterOptions>): boolean {
    const emitter = this._emitters.get(id);
    if (!emitter) return false;

    if (options.active !== undefined) emitter.active = options.active;

    if (options.probes !== undefined) {
      console.warn(
        "SpraySystem.updateEmitter: `probes` are baked at registration. " +
          "Remove and re-add the emitter to change them, or use " +
          "setProbeEnabled to toggle individual probes.",
      );
    }

    const changedKeys: Array<keyof EmitterParams> = [];
    for (const key of EMITTER_PARAM_KEYS) {
      const v = options[key];
      if (v !== undefined && v !== emitter.params[key]) {
        emitter.params[key] = v;
        changedKeys.push(key);
      }
    }
    if (changedKeys.length > 0) this._propagateParamChanges(emitter, changedKeys);

    return true;
  }

  /**
   * Apply a partial param update to every registered emitter, overwriting
   * any per-emitter override for the keys present. Per-probe overrides
   * survive — only fields the probe didn't override are updated. Used by
   * `SpraySystem`'s setters so a global tweak still reaches every emitter
   * that hasn't authored its own value.
   */
  broadcastParams(partial: Partial<EmitterParams>): void {
    for (const emitter of this._emitters.values()) {
      const changedKeys: Array<keyof EmitterParams> = [];
      for (const key of EMITTER_PARAM_KEYS) {
        const v = partial[key];
        if (v !== undefined && v !== emitter.params[key]) {
          emitter.params[key] = v;
          changedKeys.push(key);
        }
      }
      if (changedKeys.length > 0) this._propagateParamChanges(emitter, changedKeys);
    }
  }

  /**
   * Toggle a single authored probe on/off. Returns true if found.
   *
   * Disabling resets the probe's GPU-side runtime state (prev-sample,
   * pending burst, cooldown) so re-enabling it never inherits a stale
   * crossing edge or a stuck pending burst from the previous activation.
   */
  setProbeEnabled(
    emitterId: number,
    probeIndex: number,
    enabled: boolean,
  ): boolean {
    const emitter = this._emitters.get(emitterId);
    if (!emitter) return false;
    if (probeIndex < 0 || probeIndex >= emitter.probeCount) return false;

    const flag = enabled ? 1 : 0;
    if (emitter.enabledFlags[probeIndex] === flag) return true;
    emitter.enabledFlags[probeIndex] = flag;

    const offset = this._probeFloatOffset(emitter.slot, probeIndex);

    // vec4[0].w = validAndEnabled
    this._probeData[offset + 3] = enabled ? 1.0 : 0.0;

    // Reset runtime slots so re-enable starts fresh.
    if (!enabled) {
      this._probeData[offset + 4] = -1e6; // lastFireTime
      this._probeData[offset + 5] = 0; // prevSignedDist
      this._probeData[offset + 6] = 0; // hasPrevSample
      this._probeData[offset + 7] = 0; // lastBurstBirthLife
      this._probeData[offset + 8] = -1.0; // pendingFireTime
      this._probeData[offset + 9] = 0;
      this._probeData[offset + 10] = 0;
      this._probeData[offset + 11] = 0;
      // Mirror in CPU debug state.
      emitter.lastFireApprox[probeIndex] = -Infinity;
      emitter.prevSignedDistApprox[probeIndex] = 0;
      emitter.hasPrevSampleApprox[probeIndex] = 0;
    }

    this._probeAttribute.needsUpdate = true;
    return true;
  }

  /** Free GPU resources. */
  dispose(): void {
    this._emitters.clear();
    this._freeSlots.length = 0;
  }

  /**
   * Build per-probe debug snapshots for every registered emitter.
   *
   * Allocates fresh `Vector3`s per probe — debug-path only, not perf-critical.
   * The state field mirrors the GPU emission decision *approximately* on
   * the CPU: it uses mean water height (no displaced-surface lookup) and a
   * per-probe `lastFireApprox` clock advanced inside this method whenever
   * the firing predicates would pass. The visualizer can therefore colour
   * probes without GPU readback.
   *
   * Per-probe overrides are honoured — `duration` / `velocityThreshold` /
   * `respawnTime` used for state classification are the resolved values
   * (emitter + probe override), so the colours match what the GPU does.
   *
   * @param meanY — mean water surface Y; used for the (approximate)
   *   crossing-edge check.
   * @param currentTime — current CPU simulation time (matches the GPU
   *   `time` uniform).
   * @param deltaTime — frame delta (s) used to compute the approximate
   *   probe-vs-surface convergence rate.
   */
  getDebugData(
    meanY: number,
    currentTime: number,
    deltaTime: number,
  ): ProbeDebugSnapshot[] {
    const dtSafe = Math.max(deltaTime, 1e-4);
    const out: ProbeDebugSnapshot[] = [];
    const tempLocal = new THREE.Vector3();
    const tempR = new THREE.Vector3();
    const tempCross = new THREE.Vector3();

    for (const emitter of this._emitters.values()) {
      const slot = emitter.slot;
      const m = emitter.object.matrixWorld.elements;
      const emitterCenterX = m[12];
      const emitterCenterY = m[13];
      const emitterCenterZ = m[14];

      // Read this emitter's slice of the state buffer for the current
      // linear/angular velocity.
      const stateBase = slot * STATE_VEC4_PER_EMITTER * 4;
      const lvx = this._stateData[stateBase + 12];
      const lvy = this._stateData[stateBase + 13];
      const lvz = this._stateData[stateBase + 14];
      const avx = this._stateData[stateBase + 16];
      const avy = this._stateData[stateBase + 17];
      const avz = this._stateData[stateBase + 18];

      for (let i = 0; i < emitter.probeCount; i++) {
        const offset = this._probeFloatOffset(slot, i);

        // Local probe data.
        tempLocal.set(
          this._probeData[offset + 0],
          this._probeData[offset + 1],
          this._probeData[offset + 2],
        );
        const worldPosition = tempLocal
          .clone()
          .applyMatrix4(emitter.object.matrixWorld);

        // Per-probe velocity = linVel + ω × r.
        tempR.set(
          worldPosition.x - emitterCenterX,
          worldPosition.y - emitterCenterY,
          worldPosition.z - emitterCenterZ,
        );
        tempCross.set(
          avy * tempR.z - avz * tempR.y,
          avz * tempR.x - avx * tempR.z,
          avx * tempR.y - avy * tempR.x,
        );
        const worldVelocity = new THREE.Vector3(
          lvx + tempCross.x,
          lvy + tempCross.y,
          lvz + tempCross.z,
        );
        const speed = worldVelocity.length();

        const isEnabled = emitter.enabledFlags[i] === 1;

        // Resolve the firing-relevant params for this probe so the colour
        // mirrors the GPU's decision when the probe overrides them.
        const o = emitter.probeOverrides[i];
        const duration = o.duration ?? emitter.params.duration;
        const velocityThreshold =
          o.velocityThreshold ?? emitter.params.velocityThreshold;
        const respawnTime = o.respawnTime ?? emitter.params.respawnTime;
        const cooldown = duration + respawnTime;

        // Approximate state. Same crossing-edge gate the GPU uses, but
        // against `meanY` rather than the displaced surface.
        const signedDistApprox = worldPosition.y - meanY;
        const hasPrev = emitter.hasPrevSampleApprox[i] === 1;
        const prevDist = emitter.prevSignedDistApprox[i];
        const crossing = hasPrev && prevDist > 0 && signedDistApprox <= 0;
        // Vertical convergence rate between probe and approximate water
        // line over the last debug call. Mirrors the GPU's impact-speed
        // gate so the lifecycle colour reflects the new firing logic.
        const impactSpeed = hasPrev
          ? Math.max(0, (prevDist - signedDistApprox) / dtSafe)
          : 0;
        const fastEnough = impactSpeed > velocityThreshold;
        const canFire =
          emitter.active && isEnabled && crossing && fastEnough;

        const elapsed = currentTime - emitter.lastFireApprox[i];

        let state: ProbeState;
        if (!isEnabled) {
          state = "disabled";
        } else if (elapsed >= cooldown && canFire) {
          // GPU is about to fire this frame — advance our clock too.
          emitter.lastFireApprox[i] = currentTime;
          state = "playing";
        } else if (elapsed < duration) {
          state = "playing";
        } else if (elapsed < cooldown) {
          state = "respawning";
        } else {
          state = "inactive";
        }

        // Track prev signed distance for next frame's crossing test.
        // Updated regardless of fire decision, matching the GPU. Disabled
        // probes don't update so re-enable starts fresh.
        if (isEnabled) {
          emitter.prevSignedDistApprox[i] = signedDistApprox;
          emitter.hasPrevSampleApprox[i] = 1;
        }

        out.push({
          emitterId: emitter.id,
          impactSpeed,
          probeIndex: i,
          speed,
          state,
          worldPosition,
          worldVelocity,
        });
      }
    }
    return out;
  }

  // ============================================
  // Per-frame
  // ============================================

  /**
   * Walk all registered emitters, derive per-frame state (world matrix +
   * linear velocity + angular velocity), write to the GPU state buffer,
   * and mark it for upload. Inactive slots are zeroed.
   */
  prepareFrame(deltaTime: number): void {
    this._stateData.fill(0);

    const dt = Math.max(deltaTime, 1e-4);
    const dtInv = 1.0 / dt;

    for (const emitter of this._emitters.values()) {
      if (!emitter.active || !emitter.object.parent) {
        emitter.hasLastTransform = false;
        continue;
      }

      emitter.object.updateMatrixWorld();

      // Decompose into translation + rotation + scale so we can derive
      // linear and angular velocity independently.
      emitter.object.matrixWorld.decompose(
        this._scratchPos,
        this._scratchQuat,
        this._scratchScale,
      );

      let lvx = 0;
      let lvy = 0;
      let lvz = 0;
      let avx = 0;
      let avy = 0;
      let avz = 0;

      if (emitter.hasLastTransform) {
        // Linear velocity = clamped position delta.
        lvx = (this._scratchPos.x - emitter.lastTranslation.x) * dtInv;
        lvy = (this._scratchPos.y - emitter.lastTranslation.y) * dtInv;
        lvz = (this._scratchPos.z - emitter.lastTranslation.z) * dtInv;
        const ls = Math.hypot(lvx, lvy, lvz);
        if (ls > MAX_LINEAR_VELOCITY) {
          const k = MAX_LINEAR_VELOCITY / ls;
          lvx *= k;
          lvy *= k;
          lvz *= k;
        }

        // Angular velocity from quaternion delta. Small-angle
        // approximation: dq = currentQ * lastQ⁻¹ ≈ (½ω·dt, 1).
        // → ω ≈ 2 * dq.xyz * sign(dq.w) / dt.
        // Robust for boat rotation rates at 60 fps.
        this._scratchInvLast.copy(emitter.lastQuaternion).invert();
        this._scratchDeltaQ
          .copy(this._scratchQuat)
          .multiply(this._scratchInvLast);
        const sign = this._scratchDeltaQ.w >= 0 ? 1 : -1;
        avx = 2 * this._scratchDeltaQ.x * sign * dtInv;
        avy = 2 * this._scratchDeltaQ.y * sign * dtInv;
        avz = 2 * this._scratchDeltaQ.z * sign * dtInv;
        const as = Math.hypot(avx, avy, avz);
        if (as > MAX_ANGULAR_VELOCITY) {
          const k = MAX_ANGULAR_VELOCITY / as;
          avx *= k;
          avy *= k;
          avz *= k;
        }
      }

      emitter.lastTranslation.copy(this._scratchPos);
      emitter.lastQuaternion.copy(this._scratchQuat);
      emitter.hasLastTransform = true;

      this._writeState(
        emitter.slot,
        emitter.object.matrixWorld.elements,
        lvx,
        lvy,
        lvz,
        avx,
        avy,
        avz,
        emitter,
      );
    }

    this._stateAttribute.needsUpdate = true;
  }

  // ============================================
  // GPU writes
  // ============================================

  /** Float index of the start of probe `(slot, probeIndex)`'s data. */
  private _probeFloatOffset(slot: number, probeIndex: number): number {
    return (
      slot * MAX_PROBES_PER_EMITTER * PROBE_VEC4_PER_POINT * 4 +
      probeIndex * PROBE_VEC4_PER_POINT * 4
    );
  }

  /** Resolve a probe's params from its emitter's params + its overrides. */
  private _resolveProbeParams(
    emitter: RegisteredEmitter,
    probeIndex: number,
  ): EmitterParams {
    const o = emitter.probeOverrides[probeIndex];
    const out: EmitterParams = { ...emitter.params };
    for (const key of EMITTER_PARAM_KEYS) {
      const v = o[key];
      if (v !== undefined) out[key] = v;
    }
    return out;
  }

  /**
   * Update the GPU params block for every probe of `emitter` whose
   * override does not specify any of `changedKeys`. Emitter-level
   * changes never touch a probe-overridden key.
   */
  private _propagateParamChanges(
    emitter: RegisteredEmitter,
    changedKeys: Array<keyof EmitterParams>,
  ): void {
    for (let i = 0; i < emitter.probeCount; i++) {
      const o = emitter.probeOverrides[i];
      let probeNeedsUpdate = false;
      for (const key of changedKeys) {
        if (o[key] === undefined) {
          probeNeedsUpdate = true;
          break;
        }
      }
      if (!probeNeedsUpdate) continue;
      const resolved = this._resolveProbeParams(emitter, i);
      this._writeProbeParams(emitter.slot, i, resolved);
    }
  }

  private _writeProbes(
    emitter: RegisteredEmitter,
    baked: BakedProbes,
  ): void {
    const slotBase = emitter.slot * MAX_PROBES_PER_EMITTER * PROBE_VEC4_PER_POINT * 4;
    const slotFloats = MAX_PROBES_PER_EMITTER * PROBE_VEC4_PER_POINT * 4;

    // Zero entire slot first so padding probes are invalid.
    this._probeData.fill(0, slotBase, slotBase + slotFloats);

    for (let i = 0; i < baked.count; i++) {
      const offset = slotBase + i * PROBE_VEC4_PER_POINT * 4;
      // vec4[0]: (localPos, validAndEnabled)
      this._probeData[offset + 0] = baked.positions[i * 3 + 0];
      this._probeData[offset + 1] = baked.positions[i * 3 + 1];
      this._probeData[offset + 2] = baked.positions[i * 3 + 2];
      this._probeData[offset + 3] = baked.enabled[i] === 1 ? 1.0 : 0.0;
      // vec4[1]: cooldown / crossing state.
      //   .x = lastFireTime — far-past sentinel so the cooldown gate is
      //        satisfied on the first qualifying frame.
      //   .y = prevSignedDist — zero until the first tick fills it in.
      //   .z = hasPrevSample — 0 means .y is not yet meaningful; the
      //        emission shader skips crossing detection until this flips
      //        to 1, which it does on every per-probe write below.
      this._probeData[offset + 4] = -1e6;
      this._probeData[offset + 5] = 0;
      this._probeData[offset + 6] = 0;
      this._probeData[offset + 7] = 0;
      // vec4[2]: scheduled-burst state.
      //   .x = pendingFireTime — `-1` is the "no pending burst" sentinel.
      //        On a crossing the emission compute writes this to the
      //        absolute time the burst should become visible, then on a
      //        later frame (when time ≥ pendingFireTime) clears it back
      //        to -1 after spawning the particle at the probe's current
      //        world position.
      this._probeData[offset + 8] = -1.0;
      this._probeData[offset + 9] = 0;
      this._probeData[offset + 10] = 0;
      this._probeData[offset + 11] = 0;

      // vec4[3..6]: resolved params.
      const resolved = this._resolveProbeParams(emitter, i);
      this._writeProbeParamsAtOffset(offset, resolved);
    }
    this._probeAttribute.needsUpdate = true;
  }

  /** Write only the param block (vec4[3..6]) of probe `(slot, probeIndex)`. */
  private _writeProbeParams(
    slot: number,
    probeIndex: number,
    p: EmitterParams,
  ): void {
    const base = this._probeFloatOffset(slot, probeIndex);
    this._writeProbeParamsAtOffset(base, p);
    this._probeAttribute.needsUpdate = true;
  }

  /**
   * Write the resolved params block at `floatOffset`, where `floatOffset`
   * is the float index of the probe's vec4[0]. `vec4[3..6]` are written.
   */
  private _writeProbeParamsAtOffset(
    floatOffset: number,
    p: EmitterParams,
  ): void {
    const paramsBase = floatOffset + PROBE_PARAMS_VEC4_OFFSET * 4;
    // vec4[3]: (size, stretchX, stretchY, opacity)
    this._probeData[paramsBase + 0] = p.size;
    this._probeData[paramsBase + 1] = p.stretchX;
    this._probeData[paramsBase + 2] = p.stretchY;
    this._probeData[paramsBase + 3] = p.opacity;
    // vec4[4]: (duration, fadeOutTime, velocityThreshold, respawnTime)
    this._probeData[paramsBase + 4] = p.duration;
    this._probeData[paramsBase + 5] = p.fadeOutTime;
    this._probeData[paramsBase + 6] = p.velocityThreshold;
    this._probeData[paramsBase + 7] = p.respawnTime;
    // vec4[5]: (spawnJitterTime, submersionDepth, velScale, velHeight)
    this._probeData[paramsBase + 8] = p.spawnJitterTime;
    this._probeData[paramsBase + 9] = p.submersionDepth;
    this._probeData[paramsBase + 10] = p.velocityScaleFactor;
    this._probeData[paramsBase + 11] = p.velocityHeightFactor;
    // vec4[6]: (bottomFadeStart, bottomFadeStop, _pad, _pad)
    this._probeData[paramsBase + 12] = p.bottomFadeStart;
    this._probeData[paramsBase + 13] = p.bottomFadeStop;
    this._probeData[paramsBase + 14] = 0;
    this._probeData[paramsBase + 15] = 0;
  }

  private _zeroProbeSlot(slot: number): void {
    const slotBase =
      slot * MAX_PROBES_PER_EMITTER * PROBE_VEC4_PER_POINT * 4;
    const slotFloats = MAX_PROBES_PER_EMITTER * PROBE_VEC4_PER_POINT * 4;
    this._probeData.fill(0, slotBase, slotBase + slotFloats);
    this._probeAttribute.needsUpdate = true;
  }

  private _zeroStateSlot(slot: number): void {
    const slotBase = slot * STATE_VEC4_PER_EMITTER * 4;
    const slotFloats = STATE_VEC4_PER_EMITTER * 4;
    this._stateData.fill(0, slotBase, slotBase + slotFloats);
    this._stateAttribute.needsUpdate = true;
  }

  /**
   * Pack the per-emitter state into 5 vec4 slots:
   *
   *   slot 0..2: world matrix rows 0,1,2 (affine — bottom row dropped)
   *   slot 3:   (linVelX, linVelY, linVelZ, _pad)
   *   slot 4:   (angVelX, angVelY, angVelZ, isActive)
   *
   * Three.js stores `matrixWorld.elements` in column-major order. We pack
   * the matrix as **rows** so the shader can do `row · localPos` directly.
   */
  private _writeState(
    slot: number,
    m: number[] | Float32Array,
    lvx: number,
    lvy: number,
    lvz: number,
    avx: number,
    avy: number,
    avz: number,
    e: RegisteredEmitter,
  ): void {
    const base = slot * STATE_VEC4_PER_EMITTER * 4;

    // Row 0
    this._stateData[base + 0] = m[0];
    this._stateData[base + 1] = m[4];
    this._stateData[base + 2] = m[8];
    this._stateData[base + 3] = m[12];
    // Row 1
    this._stateData[base + 4] = m[1];
    this._stateData[base + 5] = m[5];
    this._stateData[base + 6] = m[9];
    this._stateData[base + 7] = m[13];
    // Row 2
    this._stateData[base + 8] = m[2];
    this._stateData[base + 9] = m[6];
    this._stateData[base + 10] = m[10];
    this._stateData[base + 11] = m[14];
    // Linear velocity
    this._stateData[base + 12] = lvx;
    this._stateData[base + 13] = lvy;
    this._stateData[base + 14] = lvz;
    this._stateData[base + 15] = 0;
    // Angular velocity + active flag
    this._stateData[base + 16] = avx;
    this._stateData[base + 17] = avy;
    this._stateData[base + 18] = avz;
    this._stateData[base + 19] = e.active ? 1.0 : 0.0;
  }
}

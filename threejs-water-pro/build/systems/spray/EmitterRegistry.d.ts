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
import { type EmitterParams, type SprayProbe } from "./EmitterBake";
/** Maximum simultaneously registered emitters. */
export declare const MAX_EMITTERS = 16;
/** Authored probes per emitter. */
export declare const MAX_PROBES_PER_EMITTER = 32;
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
export declare const PROBE_VEC4_PER_POINT = 7;
/** Index (in vec4 units) of the first param slot inside each probe entry. */
export declare const PROBE_PARAMS_VEC4_OFFSET = 3;
/** Total emission threads dispatched per frame (compile-time constant). */
export declare const EMISSION_THREADS: number;
/** Re-export for callers. */
export { DEFAULT_EMITTER_PARAMS, type EmitterParams, type SprayProbe, } from "./EmitterBake";
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
export declare class EmitterRegistry {
    readonly probeBufferNode: ReturnType<typeof storage>;
    readonly stateBufferNode: ReturnType<typeof storage>;
    private readonly _emitters;
    private readonly _freeSlots;
    private _nextId;
    private readonly _probeAttribute;
    private readonly _probeData;
    private readonly _stateAttribute;
    private readonly _stateData;
    private readonly _scratchDeltaQ;
    private readonly _scratchInvLast;
    private readonly _scratchPos;
    private readonly _scratchQuat;
    private readonly _scratchScale;
    constructor();
    /**
     * Register an object as a spray emitter. Returns an id, or `-1` if the
     * `MAX_EMITTERS` cap has been reached.
     */
    add(object: THREE.Object3D, options: RegistryAddOptions): number;
    /** Remove an emitter. Returns true if found. */
    remove(id: number): boolean;
    /**
     * Update tunable parameters on an existing emitter. The probe set is
     * **not** re-baked — change probes by removing and re-adding the emitter.
     * Per-probe enabled toggling goes through {@link setProbeEnabled}.
     *
     * Param changes touch only those keys the probe didn't override at
     * registration, so per-probe overrides survive an `updateEmitter` call.
     */
    update(id: number, options: Partial<AddEmitterOptions>): boolean;
    /**
     * Apply a partial param update to every registered emitter, overwriting
     * any per-emitter override for the keys present. Per-probe overrides
     * survive — only fields the probe didn't override are updated. Used by
     * `SpraySystem`'s setters so a global tweak still reaches every emitter
     * that hasn't authored its own value.
     */
    broadcastParams(partial: Partial<EmitterParams>): void;
    /**
     * Toggle a single authored probe on/off. Returns true if found.
     *
     * Disabling resets the probe's GPU-side runtime state (prev-sample,
     * pending burst, cooldown) so re-enabling it never inherits a stale
     * crossing edge or a stuck pending burst from the previous activation.
     */
    setProbeEnabled(emitterId: number, probeIndex: number, enabled: boolean): boolean;
    /** Free GPU resources. */
    dispose(): void;
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
    getDebugData(meanY: number, currentTime: number, deltaTime: number): ProbeDebugSnapshot[];
    /**
     * Walk all registered emitters, derive per-frame state (world matrix +
     * linear velocity + angular velocity), write to the GPU state buffer,
     * and mark it for upload. Inactive slots are zeroed.
     */
    prepareFrame(deltaTime: number): void;
    /** Float index of the start of probe `(slot, probeIndex)`'s data. */
    private _probeFloatOffset;
    /** Resolve a probe's params from its emitter's params + its overrides. */
    private _resolveProbeParams;
    /**
     * Update the GPU params block for every probe of `emitter` whose
     * override does not specify any of `changedKeys`. Emitter-level
     * changes never touch a probe-overridden key.
     */
    private _propagateParamChanges;
    private _writeProbes;
    /** Write only the param block (vec4[3..6]) of probe `(slot, probeIndex)`. */
    private _writeProbeParams;
    /**
     * Write the resolved params block at `floatOffset`, where `floatOffset`
     * is the float index of the probe's vec4[0]. `vec4[3..6]` are written.
     */
    private _writeProbeParamsAtOffset;
    private _zeroProbeSlot;
    private _zeroStateSlot;
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
    private _writeState;
}
//# sourceMappingURL=EmitterRegistry.d.ts.map
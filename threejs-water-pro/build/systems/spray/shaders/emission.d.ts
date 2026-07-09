/**
 * Spray emission compute shader (probe-driven, edge-triggered).
 *
 * Iterates over `(emitter, probe)` pairs. Each thread owns exactly one
 * particle slot — a probe holds at most one alive particle at a time.
 * Two distinct events run in the same compute pass:
 *
 *   • **Schedule (on the crossing frame).** Detect the water-line
 *     crossing edge, gate by impact speed and cooldown, and on success
 *     stamp a *pending burst* into the probe state — the absolute time
 *     the burst should become visible plus the size / variant frozen at
 *     impact. No particle is written.
 *   • **Dispatch (on a later frame, possibly the same one).** Once
 *     `time ≥ pendingFireTime`, write the particle at the probe's
 *     **current** world position. This keeps a moving boat's plume
 *     attached to the probe even after it has travelled several meters
 *     during the jitter dwell. Then clear the pending state.
 *
 * All visual / timing tunables are **per probe** — read straight out of
 * the probe slot (vec4[3..6]) and frozen onto the spawned particle
 * (slot2 + slot3) so the burst's appearance is fully captured at
 * trigger time. The CPU registry resolves `defaults → emitter →
 * probe` overrides into the slot at registration; live edits to a
 * setter rewrite probe slots whose own override doesn't lock that key,
 * so future bursts pick up the change while already-alive particles
 * stay consistent.
 *
 * Per thread, per frame:
 *
 *   1. Read probe authored position, the cooldown / crossing slot, the
 *      pending-burst slot, and the resolved params block.
 *   2. Read the emitter's per-frame world matrix.
 *   3. Transform the probe position into world space.
 *   4. Sample the displaced water surface height at the probe's world XZ
 *      using one Newton step against the horizontal displacement (shared
 *      with the simulate compute via {@link createSurfaceHeightSampler}).
 *   5. Compute `signedDist = worldY − surfaceY` and the crossing edge
 *      `hasPrevSample ∧ (prevSignedDist > 0) ∧ (signedDist ≤ 0)`. The
 *      reverse direction (probe rising out of water) never schedules.
 *   6. Compute the relative impact speed at the contact point — the
 *      vertical convergence rate over the last frame:
 *        impactSpeed = (prevSignedDist − signedDist) / dt
 *                    = v_water.y − v_probe.y
 *      Symmetric in the two motions, so a wave rising onto a stationary
 *      probe (rock, pier piling) and a probe falling onto still water
 *      both register the same impact magnitude.
 *   7. **Schedule** when `crossing ∧ impactSpeed > velocityThreshold ∧
 *      respawnElapsed ∧ no burst already pending`. Hash a
 *      `jitter ∈ [0, spawnJitterTime)` and write it (plus size /
 *      variant) into the pending slot.
 *   8. **Dispatch** when `pendingFireTime > 0 ∧ time ≥ pendingFireTime`.
 *      Spawn the particle at the *current* probe world position with
 *      `lifeRemaining = birthLife = duration`, freezing this probe's
 *      visual + fade params into the particle's slot2 / slot3, then
 *      clear the pending slot.
 *   9. Always write the new `signedDist` and pending state back, even
 *      while the emitter is inactive, so reactivation never inherits a
 *      stale edge or a stuck pending burst.
 *
 * Cooldown is anchored to the trigger frame (not the dispatch frame) so
 * a re-trigger can never overlap a still-pending or still-playing
 * burst: `lastFireTime = T_trigger`, `lastBurstBirthLife = duration +
 * jitter`, total cooldown = `lastBurstBirthLife + respawnTime` =
 * `duration + jitter + respawnTime`. The values are captured at trigger
 * so live changes to `duration` / `spawnJitterTime` don't shrink the
 * window under the in-flight burst.
 */
import { type SprayGerstnerBindings } from "./surfaceSample";
import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type { StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
/** Everything the emission compute needs, bound once at build time. */
export interface EmissionComputeBindings {
    /**
     * Particle pool storage (4 × vec4 per particle):
     *   slot0 = `(posX, posY, posZ, lifeRemaining)`
     *   slot1 = `(sizeScale, heightScale, variantIdx, birthLife)`
     *   slot2 = `(size, stretchX, stretchY, opacity)`           ← baked at spawn
     *   slot3 = `(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)` ← baked at spawn
     */
    particleBuffer: StorageBufferNode;
    /**
     * Per-emitter probe buffer (vec4 × PROBE_VEC4_PER_POINT per probe).
     * Each probe carries its authored position, runtime cooldown state,
     * the pending-burst slot, and the resolved per-probe params block at
     * vec4[3..6] (see `EmitterRegistry` for the full layout).
     */
    probeBuffer: StorageBufferNode;
    /**
     * Per-emitter state buffer (vec4 × 5 per emitter). The emission shader
     * only reads the world matrix (rows 0..2) and the active flag (slot 4
     * `.w`); the linear/angular velocity slots are populated by the registry
     * for the CPU debug visualizer and not read here.
     */
    stateBuffer: StorageBufferNode;
    /** Shared cascade sampler (single source of truth for scale/resolution uniforms). */
    cascadeSampler: CascadeSampler;
    /** Cascade-0 displacement buffer. */
    displacementBuffer0: StorageBufferNode;
    /** Cascade-1 displacement buffer (optional). */
    displacementBuffer1?: StorageBufferNode;
    /** Gerstner wave bindings, or null if Gerstner is disabled. */
    gerstner: SprayGerstnerBindings | null;
    /** Mean water surface Y (world). */
    meanY: UniformFloatNode;
    /** Wall-clock simulation time in seconds (CPU-accumulated). */
    time: UniformFloatNode;
    /** Frame delta time (s), clamped on the CPU side. */
    deltaTime: UniformFloatNode;
    /** Compile-time constants. */
    maxEmitters: number;
    maxProbesPerEmitter: number;
    /** Number of independent atlas variants in the spray array texture. */
    variantCount: number;
}
/**
 * Build the spray emission compute node.
 */
export declare function createEmissionCompute(bindings: EmissionComputeBindings): any;
//# sourceMappingURL=emission.d.ts.map
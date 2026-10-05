// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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

import {
  float,
  Fn,
  If,
  instanceIndex,
  int,
  uint,
  vec3,
  vec4,
} from "three/tsl";
import {
  PROBE_PARAMS_VEC4_OFFSET,
  PROBE_VEC4_PER_POINT,
} from "../EmitterRegistry";
import { createSurfaceHeightSampler } from "./surfaceSample";
import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type {
  FloatNode,
  Node,
  StorageBufferNode,
  UniformFloatNode,
} from "../../../shaders/types";

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
  /** Displacement buffers, one per cascade, coarsest first. */
  displacementBuffers: StorageBufferNode[];

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

/** vec4 entries per emitter state slot — must match `EmitterRegistry`. */
const STATE_VEC4_PER_EMITTER = 5;

/** Minimum dt used for the impact-speed division (avoids divide-by-zero). */
const MIN_DT = 1e-4;

/** Scrambling constants for the per-fire PCG-style hash. */
const HASH_GOLDEN = 0x9e3779b9;
const HASH_MIX_A = 0x85ebca6b;
const HASH_MIX_B = 0xc2b2ae35;

/** "No pending burst" sentinel for `pendingFireTime`. */
const NO_PENDING_BURST = -1.0;

/** Probe authored / runtime state read out of the probe buffer. */
interface ProbeRead {
  hasPrevSample: FloatNode;
  lastBurstBirthLife: FloatNode;
  lastFireTime: FloatNode;
  localPos: Node;
  pendingFireTime: FloatNode;
  pendingHeightScale: FloatNode;
  pendingSizeScale: FloatNode;
  pendingVariantIdx: FloatNode;
  prevSignedDist: FloatNode;
  probeValid: FloatNode;
}

/** Per-probe resolved params read out of the probe buffer (vec4[3..6]). */
interface ProbeParamsRead {
  bottomFadeStart: FloatNode;
  bottomFadeStop: FloatNode;
  duration: FloatNode;
  fadeOutTime: FloatNode;
  opacity: FloatNode;
  respawnTime: FloatNode;
  size: FloatNode;
  spawnJitterTime: FloatNode;
  stretchX: FloatNode;
  stretchY: FloatNode;
  submersionDepth: FloatNode;
  velocityHeightFactor: FloatNode;
  velocityScaleFactor: FloatNode;
  velocityThreshold: FloatNode;
}

/** Mutable shadow of the probe-state writeback fields. */
interface ProbeWriteVars {
  lastBurstBirthLife: ReturnType<FloatNode["toVar"]>;
  lastFireTime: ReturnType<FloatNode["toVar"]>;
  pendingFireTime: ReturnType<FloatNode["toVar"]>;
  pendingHeightScale: ReturnType<FloatNode["toVar"]>;
  pendingSizeScale: ReturnType<FloatNode["toVar"]>;
  pendingVariantIdx: ReturnType<FloatNode["toVar"]>;
}

/**
 * Build the spray emission compute node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createEmissionCompute(bindings: EmissionComputeBindings): any {
  const {
    particleBuffer,
    probeBuffer,
    stateBuffer,
    meanY,
    time,
    deltaTime,
    maxEmitters,
    maxProbesPerEmitter,
    variantCount,
  } = bindings;

  const totalThreads = maxEmitters * maxProbesPerEmitter;
  const probesPerEmitter = int(maxProbesPerEmitter);
  const stateStride = int(STATE_VEC4_PER_EMITTER);
  const probeStride = int(PROBE_VEC4_PER_POINT);
  const paramsOffset = int(PROBE_PARAMS_VEC4_OFFSET);

  const sampleSurfaceY = createSurfaceHeightSampler(bindings, meanY);

  // ── Local TSL builders ───────────────────────────────────────────────
  // These run during graph construction. They return TSL nodes so the
  // main `Fn` body reads as a sequence of named phases instead of a
  // single 200-line block.

  /** Decompose the linear thread index into emitter/probe coordinates. */
  const decodeThreadIndex = (idx: Node) => {
    const emitterSlot = idx.div(probesPerEmitter);
    const probeIdx = idx.sub(emitterSlot.mul(probesPerEmitter));
    const probeBase = emitterSlot
      .mul(probesPerEmitter)
      .add(probeIdx)
      .mul(probeStride);
    const stateBase = emitterSlot.mul(stateStride);
    return { emitterSlot, probeBase, probeIdx, stateBase };
  };

  /** Read the authored / runtime probe-buffer fields for this thread's probe. */
  const loadProbe = (probeBase: Node): ProbeRead => {
    const probe0 = probeBuffer.element(probeBase);
    const probe1 = probeBuffer.element(probeBase.add(int(1)));
    const probe2 = probeBuffer.element(probeBase.add(int(2)));
    return {
      hasPrevSample: probe1.z as FloatNode,
      lastBurstBirthLife: probe1.w as FloatNode,
      lastFireTime: probe1.x as FloatNode,
      localPos: vec3(probe0.x, probe0.y, probe0.z),
      pendingFireTime: probe2.x as FloatNode,
      pendingHeightScale: probe2.z as FloatNode,
      pendingSizeScale: probe2.y as FloatNode,
      pendingVariantIdx: probe2.w as FloatNode,
      prevSignedDist: probe1.y as FloatNode,
      probeValid: probe0.w as FloatNode,
    };
  };

  /** Read this probe's resolved params block (vec4[3..6]). */
  const loadProbeParams = (probeBase: Node): ProbeParamsRead => {
    const paramsBase = probeBase.add(paramsOffset);
    const p0 = probeBuffer.element(paramsBase);
    const p1 = probeBuffer.element(paramsBase.add(int(1)));
    const p2 = probeBuffer.element(paramsBase.add(int(2)));
    const p3 = probeBuffer.element(paramsBase.add(int(3)));
    return {
      bottomFadeStart: p3.x as FloatNode,
      bottomFadeStop: p3.y as FloatNode,
      duration: p1.x as FloatNode,
      fadeOutTime: p1.y as FloatNode,
      opacity: p0.w as FloatNode,
      respawnTime: p1.w as FloatNode,
      size: p0.x as FloatNode,
      spawnJitterTime: p2.x as FloatNode,
      stretchX: p0.y as FloatNode,
      stretchY: p0.z as FloatNode,
      submersionDepth: p2.y as FloatNode,
      velocityHeightFactor: p2.w as FloatNode,
      velocityScaleFactor: p2.z as FloatNode,
      velocityThreshold: p1.z as FloatNode,
    };
  };

  /** Read the emitter's per-frame world matrix rows + active flag. */
  const loadEmitterMatrix = (stateBase: Node) => ({
    isActive: stateBuffer.element(stateBase.add(int(4))).w as FloatNode,
    matRow0: stateBuffer.element(stateBase),
    matRow1: stateBuffer.element(stateBase.add(int(1))),
    matRow2: stateBuffer.element(stateBase.add(int(2))),
  });

  /**
   * Pick a flipbook variant by hashing (thread idx, fire frame) through a
   * PCG-style integer scramble, and draw a random dwell ∈
   * `[0, spawnJitterTime)` from a different bit slice of the same hash.
   * Frame counter quantises `time` to 60 Hz so two probes that fire on
   * the same frame still get different variants (their thread indices
   * differ), and a single probe firing on adjacent frames advances the
   * scramble.
   */
  const pickVariantAndJitter = (
    idx: Node,
    currentTime: FloatNode,
    spawnJitterTime: FloatNode,
  ): { jitter: FloatNode; variantIdx: FloatNode } => {
    const seed = uint(idx).add(
      uint(currentTime.mul(60.0).floor()).mul(uint(HASH_GOLDEN)),
    );
    const h1 = seed.bitXor(seed.shiftRight(uint(16))).mul(uint(HASH_MIX_A));
    const h2 = h1.bitXor(h1.shiftRight(uint(13))).mul(uint(HASH_MIX_B));
    const h3 = h2.bitXor(h2.shiftRight(uint(16)));

    const variantIdx = float(h3.mod(uint(variantCount)));

    // Upper 24 bits of the hash, normalised to [0, 1). Independent of the
    // low bits consumed by `variantIdx`.
    const jitter01 = float(h3.shiftRight(uint(8)).bitAnd(uint(0xffffff))).div(
      float(0x1000000),
    );
    const jitter = jitter01.mul(spawnJitterTime) as FloatNode;
    return { jitter, variantIdx };
  };

  /**
   * Write the probe-state vec4s back to the buffer. Always called for
   * valid probes (even while inactive) so the next active frame doesn't
   * inherit a stale prev-sample edge or a stuck pending burst.
   */
  const writeProbeState = (
    probeBase: Node,
    signedDist: FloatNode,
    w: ProbeWriteVars,
  ): void => {
    probeBuffer
      .element(probeBase.add(int(1)))
      .assign(vec4(w.lastFireTime, signedDist, 1.0, w.lastBurstBirthLife));
    probeBuffer
      .element(probeBase.add(int(2)))
      .assign(
        vec4(
          w.pendingFireTime,
          w.pendingSizeScale,
          w.pendingHeightScale,
          w.pendingVariantIdx,
        ),
      );
  };

  // ── Main compute body ────────────────────────────────────────────────

  const computeFn = Fn(() => {
    const idx = instanceIndex;
    const { probeBase, stateBase } = decodeThreadIndex(idx);
    const probe = loadProbe(probeBase);

    // One slot per probe — particle index = thread index. Four vec4 per
    // particle (slot0 = pos_life, slot1 = scales / variant / birthLife,
    // slot2 = size / stretch / opacity, slot3 = fade params + submersion).
    const slot0 = idx.mul(4);
    const slot1 = slot0.add(1);
    const slot2 = slot0.add(2);
    const slot3 = slot0.add(3);

    If(probe.probeValid.greaterThan(0.5), () => {
      const { matRow0, matRow1, matRow2, isActive } = loadEmitterMatrix(stateBase);
      const params = loadProbeParams(probeBase);

      // ── Local → world transform ─────────────────────────────────────
      const localH = vec4(probe.localPos.x, probe.localPos.y, probe.localPos.z, 1.0);
      const worldX = matRow0.dot(localH) as FloatNode;
      const worldY = matRow1.dot(localH) as FloatNode;
      const worldZ = matRow2.dot(localH) as FloatNode;

      // ── Sample the displaced surface (two-pass Newton) ──────────────
      const surfaceY = sampleSurfaceY(worldX, worldZ);

      // Signed distance to the surface: positive above water, negative
      // below. Compared against last frame's value to find the crossing.
      const signedDist = worldY.sub(surfaceY) as FloatNode;

      // Default: keep all bookkeeping unchanged this frame. The schedule
      // branch overwrites the cooldown + pending fields; the dispatch
      // branch clears the pending field after spawning.
      const w: ProbeWriteVars = {
        lastBurstBirthLife: probe.lastBurstBirthLife.toVar(),
        lastFireTime: probe.lastFireTime.toVar(),
        pendingFireTime: probe.pendingFireTime.toVar(),
        pendingHeightScale: probe.pendingHeightScale.toVar(),
        pendingSizeScale: probe.pendingSizeScale.toVar(),
        pendingVariantIdx: probe.pendingVariantIdx.toVar(),
      };

      // ── Schedule (only when the emitter is active) ──────────────────
      If(isActive.greaterThan(0.5), () => {
        // Crossing edge: above last frame, at-or-below this frame.
        const crossing = probe.hasPrevSample
          .greaterThan(0.5)
          .and(probe.prevSignedDist.greaterThan(0.0))
          .and(signedDist.lessThanEqual(0.0));

        // Vertical convergence rate between probe and surface over the
        // last frame. Symmetric: a wave rising onto a stationary probe
        // and a probe falling onto still water both register the same
        // magnitude. Clamped to ≥ 0 so a non-converging frame never
        // passes the gate even if numerical noise puts cur > prev.
        const dtSafe = deltaTime.max(MIN_DT) as FloatNode;
        const impactSpeed = probe.prevSignedDist
          .sub(signedDist)
          .div(dtSafe)
          .max(0.0) as FloatNode;

        const fastEnough = impactSpeed.greaterThan(params.velocityThreshold);
        // Cooldown spans the full alive window (jitter dwell + visible
        // duration), captured at trigger so live changes to `duration` /
        // `spawnJitterTime` can't shrink it under an in-flight burst.
        const cooldown = probe.lastBurstBirthLife.add(params.respawnTime);
        const respawnElapsed = time
          .sub(probe.lastFireTime)
          .greaterThanEqual(cooldown);
        // Block re-scheduling while a burst is already pending. The
        // cooldown gate above also covers this since lastFireTime is
        // stamped at trigger, but the explicit check is cheap insurance.
        const noPending = w.pendingFireTime.lessThanEqual(0.0);

        const schedule = crossing
          .and(fastEnough)
          .and(respawnElapsed)
          .and(noPending);

        If(schedule, () => {
          // Per-particle impact-driven size + height scales, frozen at
          // trigger so the visual "weight" of the plume reflects the
          // impact that produced it (heavier hits → bigger and/or taller
          // plumes) and stays constant for the burst's lifetime. Capped
          // at 2x.
          const deltaSpeed = impactSpeed.sub(params.velocityThreshold).max(0.0);
          const sizeScale = float(1.0)
            .add(params.velocityScaleFactor.mul(deltaSpeed))
            .min(2.0);
          const heightScale = float(1.0)
            .add(params.velocityHeightFactor.mul(deltaSpeed))
            .min(2.0);

          const { variantIdx, jitter } = pickVariantAndJitter(
            idx,
            time,
            params.spawnJitterTime,
          );
          const totalLife = params.duration.add(jitter);

          // Stamp the pending burst — no particle is written yet. The
          // dispatch branch below will spawn it once `time ≥
          // pendingFireTime`, using the probe's *current* world position
          // so a moving boat keeps its plume attached.
          w.pendingFireTime.assign(time.add(jitter));
          w.pendingSizeScale.assign(sizeScale);
          w.pendingHeightScale.assign(heightScale);
          w.pendingVariantIdx.assign(variantIdx);

          w.lastFireTime.assign(time);
          w.lastBurstBirthLife.assign(totalLife);
        });
      });

      // ── Dispatch ────────────────────────────────────────────────────
      // Fires the moment time crosses the scheduled fire time. With
      // `spawnJitterTime = 0` this runs in the same frame as the
      // schedule branch above. Spawn position is the probe's *current*
      // world XZ — the whole point of the deferred-spawn model.
      const dispatchReady = w.pendingFireTime
        .greaterThan(0.0)
        .and(time.greaterThanEqual(w.pendingFireTime));

      If(dispatchReady, () => {
        // Spawn the billboard's bottom edge on the displaced surface
        // (offset by `submersionDepth`) — the same target the simulate
        // compute re-anchors to next frame, so there's no Y pop on the
        // spawn frame.
        const spawnY = surfaceY.sub(params.submersionDepth);

        particleBuffer
          .element(slot0)
          .assign(vec4(worldX, spawnY, worldZ, params.duration));
        particleBuffer
          .element(slot1)
          .assign(
            vec4(
              w.pendingSizeScale,
              w.pendingHeightScale,
              w.pendingVariantIdx,
              params.duration,
            ),
          );
        // slot2 / slot3 freeze this probe's visual + fade + submersion
        // params onto the particle. The render shader and simulate
        // compute read these directly so per-probe values follow each
        // particle through its lifetime even if the params are edited
        // mid-burst.
        particleBuffer
          .element(slot2)
          .assign(
            vec4(params.size, params.stretchX, params.stretchY, params.opacity),
          );
        particleBuffer
          .element(slot3)
          .assign(
            vec4(
              params.bottomFadeStart,
              params.bottomFadeStop,
              params.fadeOutTime,
              params.submersionDepth,
            ),
          );

        // Clear the pending slot.
        w.pendingFireTime.assign(NO_PENDING_BURST);
        w.pendingSizeScale.assign(0.0);
        w.pendingHeightScale.assign(0.0);
        w.pendingVariantIdx.assign(0.0);
      });

      writeProbeState(probeBase, signedDist, w);
    });
  });

  return computeFn().compute(totalThreads);
}

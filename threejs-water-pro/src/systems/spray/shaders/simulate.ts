/**
 * Spray simulation compute shader.
 *
 * Runs once per frame across the entire particle pool. For each slot:
 *   - If the particle is dead, do nothing.
 *   - Otherwise: re-anchor `pos.y` to the displaced water surface at the
 *     particle's XZ (offset down by the per-particle `submersionDepth`
 *     baked at spawn), decrement life, and kill the slot the moment life
 *     reaches zero. Bursts always run to completion — there is no
 *     early-out kill path.
 *
 * Re-anchoring keeps the billboard's bottom edge attached to the moving
 * surface — without it, a particle spawned on a wave crest is left floating
 * above the water as the wave passes. The two-pass Newton step is shared
 * with the emission compute via {@link createSurfaceHeightSampler} so the
 * sampled height matches the visible surface at the particle's XZ rather
 * than the height of the surface element that originated there.
 *
 * XZ stays at the spawn point — the plume rides the wave vertically without
 * drifting horizontally.
 */

import { Fn, If, instanceIndex, vec3, vec4 } from "three/tsl";
import {
  createSurfaceHeightSampler,
  type SprayGerstnerBindings,
} from "./surfaceSample";
import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type {
  FloatNode,
  StorageBufferNode,
  UniformFloatNode,
} from "../../../shaders/types";

/** Everything the simulation compute needs. */
export interface SimulateComputeBindings {
  /**
   * Particle pool storage (4 × vec4 per particle):
   *   slot0 = `(posX, posY, posZ, lifeRemaining)`
   *   slot1 = `(sizeScale, heightScale, variantIdx, birthLife)`
   *   slot2 = `(size, stretchX, stretchY, opacity)`               ← spawn-baked
   *   slot3 = `(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)` ← spawn-baked
   *
   * Slots 1–3 must persist across re-anchor — only `pos.y` and life change.
   */
  particleBuffer: StorageBufferNode;
  /** Total pool size (compile-time constant). */
  maxCount: number;

  /** Shared cascade sampler (single source of truth for scale/resolution uniforms). */
  cascadeSampler: CascadeSampler;
  /** Cascade-0 displacement buffer. */
  displacementBuffer0: StorageBufferNode;
  /** Cascade-1 displacement buffer (optional). */
  displacementBuffer1?: StorageBufferNode;
  /** Gerstner wave bindings, or null if Gerstner is disabled. */
  gerstner: SprayGerstnerBindings | null;

  /** Per-frame delta time in seconds (CPU-updated uniform). */
  deltaTime: UniformFloatNode;
  /** Mean water surface Y. */
  meanY: UniformFloatNode;
}

/**
 * Build the spray simulation compute node.
 *
 * `lifeRemaining` is stored in absolute seconds. When it drops to `<= 0`
 * the particle is killed by zeroing all four slots.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSimulateCompute(bindings: SimulateComputeBindings): any {
  const {
    particleBuffer,
    maxCount,
    deltaTime,
    meanY,
  } = bindings;

  const sampleSurfaceY = createSurfaceHeightSampler(bindings, meanY);

  const computeFn = Fn(() => {
    const idx = instanceIndex;
    const slot0 = idx.mul(4);
    const slot1 = slot0.add(1);
    const slot2 = slot0.add(2);
    const slot3 = slot0.add(3);

    const posLife = particleBuffer.element(slot0);
    const meta = particleBuffer.element(slot1);
    const visual = particleBuffer.element(slot2);
    const fade = particleBuffer.element(slot3);

    const life = posLife.w as FloatNode;

    // Dead particles: nothing to do. TSL `If()` generates a real GPU branch
    // so the bookkeeping is skipped.
    If(life.greaterThan(0.0), () => {
      const lifeAfter = life.sub(deltaTime);
      const expired = lifeAfter.lessThanEqual(0.0);

      If(expired, () => {
        particleBuffer.element(slot0).assign(vec4(0.0, 0.0, 0.0, 0.0));
        particleBuffer.element(slot1).assign(vec4(0.0, 0.0, 0.0, 0.0));
        particleBuffer.element(slot2).assign(vec4(0.0, 0.0, 0.0, 0.0));
        particleBuffer.element(slot3).assign(vec4(0.0, 0.0, 0.0, 0.0));
      }).Else(() => {
        const surfaceY = sampleSurfaceY(
          posLife.x as FloatNode,
          posLife.z as FloatNode,
        );
        // Per-particle submersion frozen at spawn — fade.w. So per-emitter
        // submersionDepth follows each plume even if the emitter's value
        // is edited mid-burst.
        const submersionDepth = fade.w as FloatNode;
        const anchoredY = surfaceY.sub(submersionDepth);

        particleBuffer
          .element(slot0)
          .assign(vec4(vec3(posLife.x, anchoredY, posLife.z), lifeAfter));
        // slots 1–3 untouched — sizeScale (.x), heightScale (.y),
        // variantIdx (.z), birthLife (.w), and the spawn-baked visual /
        // fade params must all persist across re-anchor frames.
        particleBuffer.element(slot1).assign(meta);
        particleBuffer.element(slot2).assign(visual);
        particleBuffer.element(slot3).assign(fade);
      });
    });
  });

  return computeFn().compute(maxCount);
}

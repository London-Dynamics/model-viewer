// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Uniform nodes for the persistent foam accumulation inject pass.
 *
 * The energy-shaping parameters (crest / decay / windward) are not owned here —
 * they live in the {@link FoamPersistence} holder on `WaveFoam` and are bound by
 * reference, so `water.foam.waves.persistence` and the GPU accumulation read the
 * same nodes. Only `deltaTime` is private to the inject pass (CPU-updated each
 * step). The wave-foam enable is read straight off `WaveFoam`'s node on the CPU,
 * so it is not part of this bundle either.
 */

import { uniform } from "three/tsl";
import type { FoamPersistence } from "../../../shaders/foamPersistence";

/** Shared uniform nodes for the persistent foam accumulation inject pass. */
export function createFoamAccumulationUniforms(persistence: FoamPersistence) {
  return {
    /** Per-frame delta-time (seconds). CPU-updated each step. */
    deltaTime: uniform(0.016),
    /** Shared from {@link FoamPersistence} — crest-driven foam strength. */
    crestStrength: persistence.crestStrengthNode,
    /** Shared from {@link FoamPersistence} — decay e-folding time (seconds). */
    decayTime: persistence.decayTimeNode,
    /** Shared from {@link FoamPersistence} — windward-face foam strength. */
    windwardStrength: persistence.windwardStrengthNode,
  };
}

/** Concrete uniform-node type for the foam accumulation inject pass. */
export type FoamAccumulationUniforms = ReturnType<
  typeof createFoamAccumulationUniforms
>;

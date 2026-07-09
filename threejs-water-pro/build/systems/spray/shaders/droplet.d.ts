/**
 * Spray billboard shader graph.
 *
 * Builds the `positionNode`, `colorNode`, and `opacityNode` for the spray
 * render material. Each instance reads its particle state from the shared
 * storage buffer:
 *
 *   slot0 = vec4(posX, posY, posZ, lifeRemaining)
 *   slot1 = vec4(sizeScale, heightScale, variantIdx, birthLife)
 *   slot2 = vec4(size, stretchX, stretchY, opacity)             ← spawn-baked
 *   slot3 = vec4(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)
 *
 * `sizeScale` and `heightScale` are per-particle multipliers frozen at
 * spawn (a function of the firing probe's speed) — fast impacts produce
 * larger and/or taller plumes. `sizeScale` multiplies both axes;
 * `heightScale` further multiplies only the Y axis. `variantIdx` selects
 * one of `SPRAY_VARIANT_COUNT` flipbook atlases packed as layers in the
 * `DataArrayTexture` so consecutive plumes don't all play the same burst.
 *
 * `size`, `stretchX`, `stretchY`, `opacity`, `bottomFadeStart`,
 * `bottomFadeStop`, and `fadeOutTime` are **per-emitter** values, frozen
 * onto the particle at spawn. Editing the emitter's params mid-burst
 * doesn't retro-update alive particles, but new bursts pick up the
 * change immediately.
 *
 * The billboard is **upright and bottom-anchored**:
 *   - The local `up` axis is world-up `(0, 1, 0)`. Particles never tilt —
 *     the plume always rises straight out of the water.
 *   - The local `right` axis is the camera's right vector projected onto
 *     the horizontal plane (XZ), so the quad faces the camera horizontally
 *     while keeping its long axis vertical. When the camera is rolled or
 *     looking straight down, the projection collapses; the resulting quad
 *     is degenerate but invisible at those angles anyway.
 *   - The quad is anchored at its bottom edge (vtxY = -0.5 sits at the
 *     particle position) and extends *upward*. Combined with the emission
 *     shader spawning at the displaced water surface, the bottom of the
 *     texture lands exactly on the waterline.
 *
 * `stretchX` and `stretchY` independently scale the right and up axes so
 * the user can tune width vs height without re-authoring the texture.
 *
 * Alpha comes from a 7×7 flipbook atlas — a one-shot burst that walks
 * frames 0 → frameCount-1 over the *active* portion of life
 * (`birthLife − fadeOutTime`) and then holds the final frame while alpha
 * fades to zero across the trailing `fadeOutTime` seconds.
 *
 * Per-particle, frozen at spawn:
 *   - `sizeScale` / `heightScale` — velocity-driven billboard scale.
 *   - `variantIdx` — atlas layer index in [0, SPRAY_VARIANT_COUNT), so
 *     consecutive plumes off the same probe play different bursts.
 *   - `size` / `stretchX` / `stretchY` / `opacity` / fade params /
 *     `submersionDepth` — emitter-tunable values captured at spawn.
 *
 * Frame phase, UV flip, and brightness are *not* per-particle: every alive
 * particle reads the same flipbook frame at the same active progress.
 */
import type * as THREE from "three/webgpu";
import type { Node, StorageBufferNode, UniformFloatNode } from "../../../shaders/types";
export interface DropletShaderBindings {
    /**
     * Particle pool storage (4 × vec4 per particle):
     *   slot0 = `(posX, posY, posZ, lifeRemaining)`
     *   slot1 = `(sizeScale, heightScale, variantIdx, birthLife)`
     *   slot2 = `(size, stretchX, stretchY, opacity)`             — spawn-baked
     *   slot3 = `(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)`
     */
    particleBuffer: StorageBufferNode;
    /**
     * Pre-baked spray flipbook atlas array (one-shot bursts, life-indexed).
     * Each layer is an independent 7×7 atlas; the per-particle `variantIdx`
     * (slot1.z) selects which one this fragment samples.
     */
    sprayTexture: THREE.DataArrayTexture;
    /**
     * Screen-space mask texture from the water mask pass. Spray fragments
     * behind a registered mask object (e.g., the boat hull) are discarded
     * so the plume doesn't visibly cut through the geometry.
     *   R = mask presence (1.0 = masked, 0.0 = visible)
     *   G = camera distance to the mask fragment
     */
    maskTexture: THREE.Texture;
    /** Master mask enable (0.0 = off — discard skipped). */
    maskEnabled: UniformFloatNode;
}
export interface DropletShaderNodes {
    positionNode: Node;
    colorNode: Node;
    opacityNode: Node;
}
/** Build the three material nodes for the spray render pass. */
export declare function buildDropletShader(bindings: DropletShaderBindings): DropletShaderNodes;
//# sourceMappingURL=droplet.d.ts.map
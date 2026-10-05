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
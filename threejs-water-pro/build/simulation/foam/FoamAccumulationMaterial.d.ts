import * as THREE from "three/webgpu";
import type { Node, TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../types/tsl";
import type { FoamAccumulationUniforms } from "./shaders/uniforms";
/** One FFT cascade's normal texture + the scale node for its world→UV mapping. */
export interface FoamInjectCascade {
    /** Cascade normal texture — `.xyz` normal in `[0, 1]`, `.w` directional eigenvalue. */
    normalTexture: THREE.Texture;
    /** Cascade world-space scale uniform node. */
    scaleNode: Node;
}
/** Camera-anchoring uniforms shared between the inject material and the field. */
export interface FoamInjectAnchor {
    originX: TSLUniformNode;
    originZ: TSLUniformNode;
    worldSizeNode: TSLUniformNode;
    /** Per-frame camera texel shift (float, used in UV space). */
    shiftX: TSLUniformNode;
    shiftZ: TSLUniformNode;
}
/** Bindings for {@link buildFoamAccumulationMaterial}. */
export interface FoamAccumulationMaterialBindings {
    uniforms: FoamAccumulationUniforms;
    windDirection: TSLUniformNode;
    cascades: FoamInjectCascade[];
    anchor: FoamInjectAnchor;
    resolution: number;
    /** The render target the previous-frame energy starts on (a cleared target). */
    initialPrevTexture: THREE.Texture;
}
/** The foam-inject material plus the swappable previous-energy texture node. */
export interface FoamAccumulationMaterialResult {
    material: THREE.MeshBasicNodeMaterial;
    /** Re-pointed at the read target each step (the ping-pong source). */
    prevFoamTextureNode: TextureNode;
}
/**
 * Full-screen foam-inject material for the world-fixed field (both backends).
 *
 * Each output texel maps to a world position inside the camera-anchored window.
 * The shader samples the FFT cascade normal textures there, sums the foldings
 * before the breaking threshold ({@link accumulateCombinedFoam}), and
 * accumulates with decay against the previous energy read at the
 * camera-shifted UV. The global enable is handled by the accumulator (it
 * skips the pass and clears), so there's no `_enabled` gate inside the shader.
 */
export declare function buildFoamAccumulationMaterial(bindings: FoamAccumulationMaterialBindings): FoamAccumulationMaterialResult;
//# sourceMappingURL=FoamAccumulationMaterial.d.ts.map
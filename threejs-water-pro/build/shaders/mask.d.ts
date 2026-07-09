import type { Texture } from "three";
import type { FloatNode, Node, Vec3Node } from "./types";
/**
 * Applies screen-space masking to water fragments.
 * Discards fragments where the mask texture indicates water should be hidden.
 *
 * Call this at the START of the fragment shader (before expensive calculations)
 * to early-out masked pixels.
 *
 * This is a shader graph builder function that adds conditional discard nodes
 * to the shader graph. Must be called within a TSL Fn() context.
 *
 * @param maskTexture - Screen-space mask texture (R channel: 1.0 = masked, 0.0 = visible)
 * @param maskEnabled - Uniform to enable/disable masking (0.0 = disabled, 1.0 = enabled)
 */
export declare function applyMask(maskTexture: Texture, maskEnabled: FloatNode): void;
/**
 * Applies a camera-parallel clip plane to water fragments.
 * Discards fragments that are closer to the camera than the clip distance.
 * Used for partial submersion effects where water between the clip plane
 * and camera should be hidden to reveal the underwater scene.
 *
 * Call this at the START of the fragment shader (before expensive calculations)
 * to early-out clipped pixels.
 *
 * @param cameraForward - Camera's forward direction (normalized, world space)
 * @param clipDistance - Distance from camera to the clip plane
 */
export declare function applyClipPlane(cameraForward: Vec3Node, clipDistance: FloatNode): void;
export interface ClipPlaneWaterlineParams {
    cameraForward: Vec3Node;
    clipDistance: FloatNode;
    /** Half-width of the waterline in world units (meters) */
    thickness: Node;
    /** Width of the smooth fade on each edge (0 = hard edge, higher = softer) */
    smoothness: Node;
}
export interface WaterlineResult {
    /** 0-1 factor indicating proximity to waterline (1.0 = center, 0.0 = outside) */
    factor: Node;
    /** Horizontal direction toward camera (meniscus tilt direction) */
    meniscusDir: Node;
}
/**
 * Returns waterline proximity factor and meniscus direction for physical waterline effects.
 * The meniscus direction is the horizontal vector toward the camera, used to tilt
 * the surface normal to simulate the curved water profile at contact edges.
 */
export declare function getClipPlaneWaterline(params: ClipPlaneWaterlineParams): WaterlineResult;
//# sourceMappingURL=mask.d.ts.map
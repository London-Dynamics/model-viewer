import * as THREE from "three/webgpu";
/**
 * SceneDepthPass renders the scene depth to a color texture for use in water depth calculations.
 * This allows the water shader to know the actual depth to the sea floor at each pixel.
 *
 * We render depth to a color texture (not a depth texture) because TSL's texture()
 * function works more reliably with color textures.
 *
 * Main depth target layout:
 *   R = opaque depth (normalized linear)
 *   G = unused
 *
 * Transparent objects' depth and alpha live in a separate target
 * ({@link getTransparentDepthTexture}): B = depth, A = opacity (1.0 = none).
 * Keeping them apart means the pass needs no per-channel MIN blend (which the
 * WebGL backend cannot map). Render passes:
 *   1. Opaque/alpha-tested objects → main target R, G.
 *   2. Transparent objects → transparent-depth target B, A (no blend; occlusion
 *      against opaques is resolved in the consumer).
 *   3. Transparent objects' premultiplied colour → transparent-colour target.
 */
export declare class SceneDepthPass {
    private renderTarget;
    private transparentColorTarget;
    /** Transparent objects' depth (B) and alpha (A) — its own target so no MIN
     * blend is needed to preserve the opaque R/G (MIN is unsupported on WebGL). */
    private transparentDepthTarget;
    private depthMaterial;
    private camera;
    private scene;
    private excludedObjects;
    private originalVisibility;
    private alphaDepthMaterials;
    private transparentDepthMaterials;
    private originalMaterials;
    constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number);
    /**
     * Get or create a depth material that respects alpha testing for a given texture
     */
    private getAlphaDepthMaterial;
    /**
     * Get or create a transparent depth material that writes straight through
     * (no blend) to its own target. Outputs depth to B and opacity to A.
     */
    private getTransparentDepthMaterial;
    /**
     * Update the camera used for depth rendering.
     */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Add an object to be excluded from depth rendering (e.g., the water surface)
     */
    excludeObject(object: THREE.Object3D): void;
    /**
     * Remove an object from the exclusion list
     */
    includeObject(object: THREE.Object3D): void;
    /**
     * Clear all excluded objects
     */
    clearExcludedObjects(): void;
    /**
     * Get the depth texture for use in other materials
     */
    getDepthTexture(): THREE.Texture;
    /**
     * Get the transparent object color texture (premultiplied alpha in RGB).
     * Standard alpha blending over black yields RGB = alpha * objectColor.
     */
    getTransparentColorTexture(): THREE.Texture;
    /**
     * Get the transparent object depth/alpha texture (B = depth, A = opacity),
     * written to its own target so no MIN blend is needed.
     */
    getTransparentDepthTexture(): THREE.Texture;
    /**
     * Get camera near plane value
     */
    getCameraNear(): number;
    /**
     * Get camera far plane value
     */
    getCameraFar(): number;
    /**
     * Resize the depth render target.
     * Old render target is not explicitly disposed - it will be garbage collected.
     * This avoids "destroyed texture used in submit" errors from in-flight GPU work.
     */
    setSize(width: number, height: number): void;
    /**
     * Render the scene depth in three passes:
     * 1. Opaque/alpha-tested objects → main target R (depth); G is unused.
     * 2. Transparent objects → the dedicated transparent-depth target B (depth),
     *    A (opacity), no blend; occlusion against opaques is resolved in consumers.
     * 3. Transparent objects' premultiplied colour + per-pixel alpha → the
     *    transparent-colour target, consumed by both fog passes.
     */
    render(renderer: THREE.WebGPURenderer): void;
    /**
     * Dispose of resources
     */
    dispose(): void;
}
//# sourceMappingURL=SceneDepthPass.d.ts.map
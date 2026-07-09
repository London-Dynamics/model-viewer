import * as THREE from "three/webgpu";
/**
 * MaskPass renders mask geometry to a screen-space texture.
 * Used to hide water in specific areas (e.g., inside boat hulls).
 *
 * Only objects explicitly added as masks are rendered. The mask texture
 * outputs 1.0 where mask geometry is present, 0.0 elsewhere.
 */
export declare class MaskPass {
    private renderTarget;
    private maskMaterial;
    private camera;
    private scene;
    private maskObjects;
    private originalVisibility;
    constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number);
    /**
     * Update the camera used for mask rendering.
     */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Add an object to render as a water mask.
     * Water will be hidden where this object is visible.
     */
    addMaskObject(object: THREE.Object3D): void;
    /**
     * Remove an object from mask rendering.
     */
    removeMaskObject(object: THREE.Object3D): void;
    /**
     * Check if an object is registered as a mask.
     */
    hasMaskObject(object: THREE.Object3D): boolean;
    /**
     * Clear all mask objects.
     */
    clearMaskObjects(): void;
    /**
     * Get the number of registered mask objects.
     */
    getMaskObjectCount(): number;
    /**
     * Get all registered mask objects.
     */
    getMaskObjects(): ReadonlySet<THREE.Object3D>;
    /**
     * Get the mask texture for use in the water shader.
     * R channel contains mask value: 1.0 = masked (hide water), 0.0 = not masked
     */
    getMaskTexture(): THREE.Texture;
    /**
     * Resize the mask render target.
     * Old render target is not explicitly disposed - it will be garbage collected.
     * This avoids "destroyed texture used in submit" errors from in-flight GPU work.
     */
    setSize(width: number, height: number): void;
    /**
     * Render mask objects to the mask texture.
     * Only renders objects that have been added via addMaskObject().
     */
    render(renderer: THREE.WebGPURenderer): void;
    /**
     * Dispose of resources.
     */
    dispose(): void;
}
//# sourceMappingURL=MaskPass.d.ts.map
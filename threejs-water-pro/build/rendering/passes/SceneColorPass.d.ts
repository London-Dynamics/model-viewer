import * as THREE from "three/webgpu";
/**
 * SceneColorPass renders the scene to a color texture for use in screen-space refraction.
 * This allows the water shader to sample what's "behind" the water surface and apply
 * refraction distortion, enabling underwater viewing of above-water objects.
 */
export declare class SceneColorPass {
    private renderTarget;
    private camera;
    private scene;
    private resolutionScale;
    private fullWidth;
    private fullHeight;
    private excludedObjects;
    private originalVisibility;
    constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number, resolutionScale?: number);
    /**
     * Update the camera used for scene color rendering.
     */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Add an object to be excluded from scene color rendering (e.g., the water surface)
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
     * Get the scene color texture for use in other materials
     */
    getColorTexture(): THREE.Texture;
    /**
     * Resize the render target.
     * Old render target is not explicitly disposed - it will be garbage collected.
     * This avoids "destroyed texture used in submit" errors from in-flight GPU work.
     */
    setSize(width: number, height: number): void;
    /**
     * Update the resolution scale and rebuild the render target.
     */
    setResolutionScale(scale: number): void;
    getResolutionScale(): number;
    private rebuildRenderTarget;
    /**
     * Render the scene colors (excluding specified objects)
     */
    render(renderer: THREE.WebGPURenderer): void;
    /**
     * Dispose of resources
     */
    dispose(): void;
}
//# sourceMappingURL=SceneColorPass.d.ts.map
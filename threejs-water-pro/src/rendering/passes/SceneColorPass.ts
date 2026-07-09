import * as THREE from "three/webgpu";

/**
 * SceneColorPass renders the scene to a color texture for use in screen-space refraction.
 * This allows the water shader to sample what's "behind" the water surface and apply
 * refraction distortion, enabling underwater viewing of above-water objects.
 */
export class SceneColorPass {
  private renderTarget: THREE.RenderTarget;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private resolutionScale: number;
  private fullWidth: number;
  private fullHeight: number;
  private excludedObjects: Set<THREE.Object3D> = new Set();

  // Store original visibility for restoration
  private originalVisibility: Map<THREE.Object3D, boolean> = new Map();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    resolutionScale: number = 1,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.resolutionScale = resolutionScale;
    this.fullWidth = width;
    this.fullHeight = height;

    const scaledWidth = Math.max(1, Math.floor(width * resolutionScale));
    const scaledHeight = Math.max(1, Math.floor(height * resolutionScale));

    // Create render target with standard color format
    this.renderTarget = new THREE.RenderTarget(scaledWidth, scaledHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, // HDR for bloom compatibility
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
  }

  /**
   * Update the camera used for scene color rendering.
   */
  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  /**
   * Add an object to be excluded from scene color rendering (e.g., the water surface)
   */
  public excludeObject(object: THREE.Object3D) {
    this.excludedObjects.add(object);
  }

  /**
   * Remove an object from the exclusion list
   */
  public includeObject(object: THREE.Object3D) {
    this.excludedObjects.delete(object);
  }

  /**
   * Clear all excluded objects
   */
  public clearExcludedObjects() {
    this.excludedObjects.clear();
  }

  /**
   * Get the scene color texture for use in other materials
   */
  public getColorTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  /**
   * Resize the render target.
   * Old render target is not explicitly disposed - it will be garbage collected.
   * This avoids "destroyed texture used in submit" errors from in-flight GPU work.
   */
  public setSize(width: number, height: number) {
    this.fullWidth = width;
    this.fullHeight = height;
    this.rebuildRenderTarget();
  }

  /**
   * Update the resolution scale and rebuild the render target.
   */
  public setResolutionScale(scale: number) {
    this.resolutionScale = scale;
    this.rebuildRenderTarget();
  }

  public getResolutionScale(): number {
    return this.resolutionScale;
  }

  private rebuildRenderTarget() {
    const scaledWidth = Math.max(
      1,
      Math.floor(this.fullWidth * this.resolutionScale),
    );
    const scaledHeight = Math.max(
      1,
      Math.floor(this.fullHeight * this.resolutionScale),
    );

    this.renderTarget = new THREE.RenderTarget(scaledWidth, scaledHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
  }

  /**
   * Render the scene colors (excluding specified objects)
   */
  public render(renderer: THREE.WebGPURenderer) {
    // Store and hide excluded objects
    for (const obj of this.excludedObjects) {
      this.originalVisibility.set(obj, obj.visible);
      obj.visible = false;
    }

    // Render to color target
    const originalRenderTarget = renderer.getRenderTarget();

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(originalRenderTarget);

    // Restore visibility of excluded objects
    for (const [obj, visible] of this.originalVisibility) {
      obj.visible = visible;
    }
    this.originalVisibility.clear();
  }

  /**
   * Dispose of resources
   */
  public dispose() {
    this.renderTarget.dispose();
  }
}

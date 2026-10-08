// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { Fn, float, vec4, positionWorld, cameraPosition } from "three/tsl";

/**
 * MaskPass renders mask geometry to a screen-space texture.
 * Used to hide water in specific areas (e.g., inside boat hulls).
 *
 * Only objects explicitly added as masks are rendered. The mask texture
 * outputs 1.0 where mask geometry is present, 0.0 elsewhere.
 */
export class MaskPass {
  private renderTarget: THREE.RenderTarget;
  private maskMaterial: THREE.MeshBasicNodeMaterial;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private maskObjects: Set<THREE.Object3D> = new Set();

  // Store original visibility for restoration
  private originalVisibility: Map<THREE.Object3D, boolean> = new Map();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    this.scene = scene;
    this.camera = camera;

    // R is a binary 0/1 flag, but G stores world-space camera distance in
    // metres for spray's depth-occlusion test, so the target must hold values
    // outside [0, 1]. HalfFloatType keeps the buffer half the size of FloatType
    // while preserving ~1 m precision at typical scene scales.
    this.renderTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    // Create mask material that outputs 1.0 where geometry is rendered
    this.maskMaterial = new THREE.MeshBasicNodeMaterial();
    this.maskMaterial.side = THREE.DoubleSide;
    // Renders the user's scene as an override; keep the mask values unfogged.
    this.maskMaterial.fog = false;

    // R = mask presence (1.0), G = distance from camera (for depth comparison)
    const maskOutput = Fn(() => {
      const dist = positionWorld.sub(cameraPosition).length();
      return vec4(float(1.0), dist, float(0.0), float(1.0));
    });

    this.maskMaterial.colorNode = maskOutput();
  }

  /**
   * Update the camera used for mask rendering.
   */
  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  /**
   * Add an object to render as a water mask.
   * Water will be hidden where this object is visible.
   */
  public addMaskObject(object: THREE.Object3D): void {
    this.maskObjects.add(object);
  }

  /**
   * Remove an object from mask rendering.
   */
  public removeMaskObject(object: THREE.Object3D): void {
    this.maskObjects.delete(object);
  }

  /**
   * Check if an object is registered as a mask.
   */
  public hasMaskObject(object: THREE.Object3D): boolean {
    return this.maskObjects.has(object);
  }

  /**
   * Clear all mask objects.
   */
  public clearMaskObjects(): void {
    this.maskObjects.clear();
  }

  /**
   * Get the number of registered mask objects.
   */
  public getMaskObjectCount(): number {
    return this.maskObjects.size;
  }

  /**
   * Get all registered mask objects.
   */
  public getMaskObjects(): ReadonlySet<THREE.Object3D> {
    return this.maskObjects;
  }

  /**
   * Get the mask texture for use in the water shader.
   * R channel contains mask value: 1.0 = masked (hide water), 0.0 = not masked
   */
  public getMaskTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  /**
   * Resize the mask render target.
   * Old render target is not explicitly disposed - it will be garbage collected.
   * This avoids "destroyed texture used in submit" errors from in-flight GPU work.
   */
  public setSize(width: number, height: number): void {
    this.renderTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
  }

  /**
   * Render mask objects to the mask texture.
   * Only renders objects that have been added via addMaskObject().
   */
  public render(renderer: THREE.WebGPURenderer): void {
    // Skip render if no mask objects
    if (this.maskObjects.size === 0) {
      return;
    }

    // Store visibility of all scene objects and hide them
    this.scene.traverse((obj) => {
      if (obj !== this.scene) {
        this.originalVisibility.set(obj, obj.visible);
        obj.visible = false;
      }
    });

    // Show mask objects that were already visible. Hidden variants (folded
    // terraces, inactive options) stay out of the mask so they cannot cut a
    // boat-shaped hole offset from the hull the camera actually draws.
    for (const maskObj of this.maskObjects) {
      maskObj.traverse((child) => {
        if (this.originalVisibility.get(child) !== false) {
          child.visible = true;
        }
      });

      let parent = maskObj.parent;
      while (parent && parent !== this.scene) {
        if (this.originalVisibility.get(parent) !== false) {
          parent.visible = true;
        }
        parent = parent.parent;
      }
    }

    // Store original state
    const originalRenderTarget = renderer.getRenderTarget();
    const originalBackground = this.scene.background;

    // Use overrideMaterial to render all visible geometry with mask material
    this.scene.overrideMaterial = this.maskMaterial;

    // Set background to black (0 = no mask) so unrendered areas show no mask
    this.scene.background = new THREE.Color(0, 0, 0);

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(originalRenderTarget);

    // Restore state
    this.scene.overrideMaterial = null;
    this.scene.background = originalBackground;

    // Restore visibility of all objects
    for (const [obj, visible] of this.originalVisibility) {
      obj.visible = visible;
    }
    this.originalVisibility.clear();
  }

  /**
   * Dispose of resources.
   */
  public dispose(): void {
    this.renderTarget.dispose();
    this.maskMaterial.dispose();
    this.maskObjects.clear();
  }
}

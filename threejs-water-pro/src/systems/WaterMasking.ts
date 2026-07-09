/**
 * Manages water masking — hiding water where mask objects are visible.
 *
 * Owns the mask-enabled uniform and the set of registered mask objects.
 * Created once by WaterSystem and stable across quality changes.
 * Call {@link bind} after each render pass manager rebuild to sync state.
 */
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { RenderPassManager } from "../rendering/RenderPassManager";

export class WaterMasking {
  private _enabled = uniform(0.0);
  private _objects = new Set<THREE.Object3D>();
  private _renderPassManager: RenderPassManager | null = null;

  /** Whether water masking is active. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** @internal Uniform node for the mask-enabled flag (used by shader). */
  get enabledNode() {
    return this._enabled;
  }

  /**
   * Bind to a new render pass manager.
   * Re-adds all registered mask objects to the new manager.
   */
  bind(renderPassManager: RenderPassManager): void {
    this._renderPassManager = renderPassManager;
    for (const obj of this._objects) {
      renderPassManager.addMaskObject(obj);
    }
    this.enabled = this._objects.size > 0;
  }

  /** Add an object as a water mask. Water will be hidden where this object is visible. */
  add(object: THREE.Object3D): void {
    this._objects.add(object);
    this._renderPassManager?.addMaskObject(object);
    this.enabled = true;
  }

  /** Remove an object from water masking. */
  remove(object: THREE.Object3D): void {
    this._objects.delete(object);
    this._renderPassManager?.removeMaskObject(object);
    if (this._objects.size === 0) {
      this.enabled = false;
    }
  }

  /** Check if an object is registered as a water mask. */
  has(object: THREE.Object3D): boolean {
    return this._objects.has(object);
  }
}

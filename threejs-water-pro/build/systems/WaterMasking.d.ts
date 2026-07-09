/**
 * Manages water masking — hiding water where mask objects are visible.
 *
 * Owns the mask-enabled uniform and the set of registered mask objects.
 * Created once by WaterSystem and stable across quality changes.
 * Call {@link bind} after each render pass manager rebuild to sync state.
 */
import * as THREE from "three/webgpu";
import type { RenderPassManager } from "../rendering/RenderPassManager";
export declare class WaterMasking {
    private _enabled;
    private _objects;
    private _renderPassManager;
    /** Whether water masking is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** @internal Uniform node for the mask-enabled flag (used by shader). */
    get enabledNode(): THREE.UniformNode<number>;
    /**
     * Bind to a new render pass manager.
     * Re-adds all registered mask objects to the new manager.
     */
    bind(renderPassManager: RenderPassManager): void;
    /** Add an object as a water mask. Water will be hidden where this object is visible. */
    add(object: THREE.Object3D): void;
    /** Remove an object from water masking. */
    remove(object: THREE.Object3D): void;
    /** Check if an object is registered as a water mask. */
    has(object: THREE.Object3D): boolean;
}
//# sourceMappingURL=WaterMasking.d.ts.map
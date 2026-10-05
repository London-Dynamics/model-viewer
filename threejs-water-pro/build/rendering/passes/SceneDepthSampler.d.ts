import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
/**
 * TSL sampler over the hardware depth texture captured by
 * `SceneCapturePass`.
 *
 * Owns the depth texture node and the camera-plane uniforms, so consumers
 * embed `sample(uv)` in their node graphs once and never re-bind: render
 * target rebuilds (resize) swap the texture node's `.value`, and camera
 * changes update the plane uniforms — both propagate automatically.
 *
 * `sample(uv)` returns depth in the encoding every consumer already speaks:
 * normalized linear view depth `(viewZ − near) / (far − near)` — `0` at the
 * near plane, `1` at the far plane or wherever no depth-writing geometry
 * rendered (the depth buffer clears to 1, which linearizes to 1).
 */
export declare class SceneDepthSampler {
    private readonly _cameraFar;
    private readonly _cameraNear;
    private readonly _depthTexture;
    constructor(depthTexture: THREE.DepthTexture);
    /** Track the capture camera's clip planes (linearization inputs). */
    setCameraPlanes(near: number, far: number): void;
    /** Swap the underlying depth texture after a render-target rebuild. */
    setDepthTexture(depthTexture: THREE.DepthTexture): void;
    /**
     * TSL: normalized linear scene depth at `uv` — 0 at the near plane, 1 at
     * the far plane or where nothing wrote depth. Perspective cameras only,
     * matching the water system's camera contract.
     */
    sample(uv: Node): Node;
}
//# sourceMappingURL=SceneDepthSampler.d.ts.map
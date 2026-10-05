// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { texture, uniform, perspectiveDepthToViewZ } from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";

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
export class SceneDepthSampler {
  private readonly _cameraFar = uniform(50000.0);
  private readonly _cameraNear = uniform(0.1);
  private readonly _depthTexture: TextureNode;

  constructor(depthTexture: THREE.DepthTexture) {
    this._depthTexture = texture(depthTexture);
  }

  /** Track the capture camera's clip planes (linearization inputs). */
  setCameraPlanes(near: number, far: number): void {
    this._cameraNear.value = near;
    this._cameraFar.value = far;
  }

  /** Swap the underlying depth texture after a render-target rebuild. */
  setDepthTexture(depthTexture: THREE.DepthTexture): void {
    this._depthTexture.value = depthTexture;
  }

  /**
   * TSL: normalized linear scene depth at `uv` — 0 at the near plane, 1 at
   * the far plane or where nothing wrote depth. Perspective cameras only,
   * matching the water system's camera contract.
   */
  sample(uv: Node): Node {
    const rawDepth = this._depthTexture.sample(uv).x;
    const viewZ = perspectiveDepthToViewZ(
      rawDepth,
      this._cameraNear,
      this._cameraFar,
    );
    return viewZ
      .negate()
      .sub(this._cameraNear)
      .div(this._cameraFar.sub(this._cameraNear));
  }
}

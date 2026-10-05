// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import { float, floor, fract, mix, normalize, vec2, vec3 } from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../../../types/tsl";
import type { IWakeFieldSampler, WakeDisplacementSample } from "../IWakeFieldSampler";

/**
 * Bilinear sampler for the WebGL wake displacement target.
 *
 * Reads the packed `vec2(height, foam)` (RG channels) of the float render target
 * the leapfrog pass writes and returns height, surface normal, and foam energy
 * at an arbitrary world position. The target uses `NearestFilter`, so this does
 * its own four-tap bilinear blend (matching {@link WebGPUWakeFieldSampler}'s
 * manual interpolation over the storage buffer). Coordinates outside the buffer
 * extent clamp to the border (near-zero — calm water away from disturbances).
 *
 * The bound texture node's `value` is re-pointed at the freshly written target
 * each step by {@link WebGLWakeSimulation}; the node identity is stable, so the
 * surface material compiles against it once.
 */
export class WebGLWakeFieldSampler implements IWakeFieldSampler {
  private readonly _resolution: number;

  constructor(
    private readonly _displacement: TextureNode,
    resolution: number,
    private readonly _worldSizeNode: TSLUniformNode,
    private readonly _originXNode: TSLUniformNode,
    private readonly _originZNode: TSLUniformNode,
  ) {
    this._resolution = resolution;
  }

  sample(worldX: Node, worldZ: Node): WakeDisplacementSample {
    return { height: this._bilinear(worldX, worldZ).x };
  }

  sampleFoamEnergy(worldX: Node, worldZ: Node): Node {
    return this._bilinear(worldX, worldZ).y;
  }

  sampleNormal(worldX: Node, worldZ: Node): Node {
    const grad = this._gradient(worldX, worldZ);
    return normalize(vec3(grad.x.negate(), float(1.0), grad.y.negate()));
  }

  /** Central-difference height gradient `(∂h/∂x, ∂h/∂z)` over one texel as a `vec3`. */
  private _gradient(worldX: Node, worldZ: Node): Node {
    const x = worldX as ReturnType<typeof float>;
    const z = worldZ as ReturnType<typeof float>;
    const eps = this._worldSizeNode.div(float(this._resolution));
    const hxp = this._bilinear(x.add(eps), z).x;
    const hxm = this._bilinear(x.sub(eps), z).x;
    const hzp = this._bilinear(x, z.add(eps)).x;
    const hzm = this._bilinear(x, z.sub(eps)).x;
    const twoEps = eps.mul(2.0);
    return vec3(hxp.sub(hxm).div(twoEps), hzp.sub(hzm).div(twoEps), 0.0);
  }

  /** Fetch the texel centre `(tx, tz)` from the displacement target. */
  private _fetch(tx: Node, tz: Node): Node {
    const res = this._resolution;
    return this._displacement.sample(
      vec2(tx.add(0.5).div(res), tz.add(0.5).div(res)),
    );
  }

  /** Four-tap bilinear fetch of the packed displacement at world `(worldX, worldZ)`. */
  private _bilinear(worldX: Node, worldZ: Node): Node {
    const res = this._resolution;
    const { _worldSizeNode, _originXNode, _originZNode } = this;

    const texelSize = _worldSizeNode.div(float(res));
    const txFloat = (worldX as ReturnType<typeof float>)
      .sub(_originXNode)
      .div(texelSize)
      .add(float(res * 0.5 - 0.5));
    const tzFloat = (worldZ as ReturnType<typeof float>)
      .sub(_originZNode)
      .div(texelSize)
      .add(float(res * 0.5 - 0.5));

    const resM1 = res - 1;
    const tx0 = floor(txFloat).clamp(0, resM1);
    const tz0 = floor(tzFloat).clamp(0, resM1);
    const tx1 = tx0.add(1).clamp(0, resM1);
    const tz1 = tz0.add(1).clamp(0, resM1);
    const fx = fract(txFloat);
    const fz = fract(tzFloat);

    const v00 = this._fetch(tx0, tz0);
    const v10 = this._fetch(tx1, tz0);
    const v01 = this._fetch(tx0, tz1);
    const v11 = this._fetch(tx1, tz1);

    return mix(mix(v00, v10, fx), mix(v01, v11, fx), fz);
  }
}

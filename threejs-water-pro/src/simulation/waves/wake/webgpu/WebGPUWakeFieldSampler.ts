// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import { float, floor, fract, int, mix, normalize, vec3 } from "three/tsl";
import type { Node } from "three/webgpu";
import type { TSLBuffer, TSLUniformNode } from "../../../../types/tsl";
import type { IWakeFieldSampler, WakeDisplacementSample } from "../IWakeFieldSampler";

/**
 * Bilinear sampler for the WebGPU wake displacement buffer.
 *
 * Reads the packed `vec2(height, foam)` storage buffer written by the iWave
 * update kernel and returns height, surface normal, and foam energy at an
 * arbitrary world position. Coordinates outside the buffer extent clamp to the
 * border (near-zero — the field decays to calm water away from disturbances).
 *
 * Owned by {@link WebGPUWakeSimulation}; the same instance is handed to
 * `WaterSurfaceMaterial` and survives until the field is rebuilt.
 */
export class WebGPUWakeFieldSampler implements IWakeFieldSampler {
  private readonly _resolution: number;

  constructor(
    private readonly _displacement: TSLBuffer,
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

  /** Bilinear fetch of the packed displacement `vec2` at world `(worldX, worldZ)`. */
  private _bilinear(worldX: Node, worldZ: Node): Node {
    const res = this._resolution;
    const { _displacement, _worldSizeNode, _originXNode, _originZNode } = this;

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
    const tx0 = floor(txFloat).toInt().clamp(0, resM1);
    const tz0 = floor(tzFloat).toInt().clamp(0, resM1);
    const tx1 = tx0.add(1).clamp(0, resM1);
    const tz1 = tz0.add(1).clamp(0, resM1);
    const fx = fract(txFloat);
    const fz = fract(tzFloat);

    const iRes = int(res);
    const v00 = _displacement.element(tz0.mul(iRes).add(tx0));
    const v10 = _displacement.element(tz0.mul(iRes).add(tx1));
    const v01 = _displacement.element(tz1.mul(iRes).add(tx0));
    const v11 = _displacement.element(tz1.mul(iRes).add(tx1));

    return mix(mix(v00, v10, fx), mix(v01, v11, fx), fz);
  }
}

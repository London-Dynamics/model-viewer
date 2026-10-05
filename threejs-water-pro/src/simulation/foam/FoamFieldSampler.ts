// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import { float, smoothstep, texture, vec2 } from "three/tsl";
import type * as THREE from "three/webgpu";
import type { Node, TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../types/tsl";
import type { IFoamFieldSampler } from "./IFoamFieldSampler";

/** Fraction of the window over which foam fades to calm at the rim. */
export const EDGE_FADE = 0.12;

/** Construction parameters for {@link FoamFieldSampler}. */
export interface FoamFieldSamplerParams {
  /** The target texture the sampler starts on (re-pointed each step by the accumulator). */
  initialTexture: THREE.Texture;
  resolution: number;
  worldSizeNode: TSLUniformNode;
  originXNode: TSLUniformNode;
  originZNode: TSLUniformNode;
}

/**
 * Camera-anchored sampler for the WebGL world-fixed foam target.
 *
 * Reads the energy (`.r`) at an arbitrary world position via hardware bilinear
 * filtering at the camera-anchored UV, then fades to zero over {@link EDGE_FADE}
 * of the window at the rim. The bound texture node ({@link energyNode}) is
 * re-pointed at the freshly written target each step by the accumulator; its
 * identity is stable, so the surface material compiles against it once.
 */
export class FoamFieldSampler implements IFoamFieldSampler {
  /** Texture node sampled by the surface; re-pointed at the latest target each step. */
  readonly energyNode: TextureNode;

  private readonly _worldSizeNode: TSLUniformNode;
  private readonly _originXNode: TSLUniformNode;
  private readonly _originZNode: TSLUniformNode;

  constructor(params: FoamFieldSamplerParams) {
    this.energyNode = texture(params.initialTexture);
    this._worldSizeNode = params.worldSizeNode;
    this._originXNode = params.originXNode;
    this._originZNode = params.originZNode;
  }

  sampleEnergy(worldX: Node, worldZ: Node): Node {
    const u = (worldX as ReturnType<typeof float>)
      .sub(this._originXNode)
      .div(this._worldSizeNode)
      .add(0.5);
    const v = (worldZ as ReturnType<typeof float>)
      .sub(this._originZNode)
      .div(this._worldSizeNode)
      .add(0.5);

    const energy = this.energyNode.sample(vec2(u, v)).r;

    // Rim fade: 0 at the window edge, 1 inside; also zeros out-of-window reads
    // (the target is clamp-to-edge, so the fade is what kills the border bleed).
    const fadeW = float(EDGE_FADE);
    const fadeU = smoothstep(float(0.0), fadeW, u.min(float(1.0).sub(u)));
    const fadeV = smoothstep(float(0.0), fadeW, v.min(float(1.0).sub(v)));

    return energy.mul(fadeU).mul(fadeV);
  }
}

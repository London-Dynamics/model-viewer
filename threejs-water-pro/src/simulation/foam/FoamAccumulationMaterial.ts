// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  int,
  texture,
  textureLevel,
  uv,
  vec2,
  vec4,
} from "three/tsl";
import type { Node, TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../types/tsl";
import type { FoamAccumulationUniforms } from "./shaders/uniforms";
import {
  accumulateCombinedFoam,
  type FoamFoldSource,
} from "./shaders/accumulation";

/** One FFT cascade's normal texture + the scale node for its world→UV mapping. */
export interface FoamInjectCascade {
  /** Cascade normal texture — `.xyz` normal in `[0, 1]`, `.w` directional eigenvalue. */
  normalTexture: THREE.Texture;
  /** Cascade world-space scale uniform node. */
  scaleNode: Node;
}

/** Camera-anchoring uniforms shared between the inject material and the field. */
export interface FoamInjectAnchor {
  originX: TSLUniformNode;
  originZ: TSLUniformNode;
  worldSizeNode: TSLUniformNode;
  /** Per-frame camera texel shift (float, used in UV space). */
  shiftX: TSLUniformNode;
  shiftZ: TSLUniformNode;
}

/** Bindings for {@link buildFoamAccumulationMaterial}. */
export interface FoamAccumulationMaterialBindings {
  uniforms: FoamAccumulationUniforms;
  windDirection: TSLUniformNode;
  cascades: FoamInjectCascade[];
  anchor: FoamInjectAnchor;
  resolution: number;
  /** The render target the previous-frame energy starts on (a cleared target). */
  initialPrevTexture: THREE.Texture;
}

/** The foam-inject material plus the swappable previous-energy texture node. */
export interface FoamAccumulationMaterialResult {
  material: THREE.MeshBasicNodeMaterial;
  /** Re-pointed at the read target each step (the ping-pong source). */
  prevFoamTextureNode: TextureNode;
}

/**
 * World→UV for a cascade normal texture (`u = worldX/scale + 0.5`). The
 * cascade tile spans exactly `scale` meters (see worldToPixelCoords).
 */
function cascadeUV(worldX: Node, worldZ: Node, scaleNode: Node): Node {
  const scale = scaleNode as ReturnType<typeof float>;
  const u = (worldX as ReturnType<typeof float>).div(scale).add(0.5);
  const v = (worldZ as ReturnType<typeof float>).div(scale).add(0.5);
  return vec2(u, v);
}

/**
 * Full-screen foam-inject material for the world-fixed field (both backends).
 *
 * Each output texel maps to a world position inside the camera-anchored window.
 * The shader samples the FFT cascade normal textures there, sums the foldings
 * before the breaking threshold ({@link accumulateCombinedFoam}), and
 * accumulates with decay against the previous energy read at the
 * camera-shifted UV. The global enable is handled by the accumulator (it
 * skips the pass and clears), so there's no `_enabled` gate inside the shader.
 */
export function buildFoamAccumulationMaterial(
  bindings: FoamAccumulationMaterialBindings,
): FoamAccumulationMaterialResult {
  const { uniforms, windDirection, cascades, anchor, resolution } = bindings;
  const res = resolution;

  const prevFoamTextureNode = texture(bindings.initialPrevTexture);
  const cascadeNodes = cascades.map((c) => ({
    node: texture(c.normalTexture),
    scaleNode: c.scaleNode,
  }));

  const outputNode = Fn(() => {
    const sampleUv = uv();

    // Texel world position within the camera-anchored window.
    const worldX = (anchor.originX as Node).add(
      anchor.worldSizeNode.mul(sampleUv.x.sub(0.5)),
    );
    const worldZ = (anchor.originZ as Node).add(
      anchor.worldSizeNode.mul(sampleUv.y.sub(0.5)),
    );

    const cascadeSources: FoamFoldSource[] = cascadeNodes.map((c) => {
      // The cascade normal textures are mipmapped for the water surface,
      // whose pixel footprint is unrelated to this field's — a foam texel
      // spans many cascade texels. Foam also thresholds `.w`, an eigenvalue
      // whose mip average is not the eigenvalue of the averaged normal.
      const sample = textureLevel(
        c.node,
        cascadeUV(worldX, worldZ, c.scaleNode),
        int(0),
      );
      return {
        folding: float(1.0).sub(sample.w),
        normal: sample.xyz.mul(2.0).sub(1.0),
      };
    });

    // Previous energy at the camera-shifted UV (zero outside the field).
    const prevUv = sampleUv.add(
      vec2(anchor.shiftX, anchor.shiftZ).div(float(res)),
    );
    const inBounds = prevUv.x
      .greaterThanEqual(0.0)
      .and(prevUv.x.lessThanEqual(1.0))
      .and(prevUv.y.greaterThanEqual(0.0))
      .and(prevUv.y.lessThanEqual(1.0));
    const prevRaw = prevFoamTextureNode.sample(prevUv.clamp(0.0, 1.0)).r;
    const prevEnergy = inBounds.select(prevRaw, float(0.0));

    const nextEnergy = accumulateCombinedFoam({
      prevEnergy,
      cascades: cascadeSources,
      crestStrength: uniforms.crestStrength,
      windwardStrength: uniforms.windwardStrength,
      windDirection,
      decayTime: uniforms.decayTime,
      deltaTime: uniforms.deltaTime,
    });

    return vec4(nextEnergy, 0.0, 0.0, 1.0);
  })();

  const material = new THREE.MeshBasicNodeMaterial();
  material.outputNode = outputNode;
  material.depthTest = false;
  material.depthWrite = false;

  return { material, prevFoamTextureNode };
}

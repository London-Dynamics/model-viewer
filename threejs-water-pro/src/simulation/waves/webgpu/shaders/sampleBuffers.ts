// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Shared TSL helpers for sampling FFT cascade GPU resources from compute shaders.
 *
 * These were previously inlined inside `WebGPUWaveSampler.createComputeShader()`.
 * Extracted so other compute passes (spray emission, debug visualizers, etc.) can
 * reuse the same coordinate logic without duplicating the math.
 */

import { float, int, textureLevel, vec2 } from "three/tsl";
import type * as THREE from "three/webgpu";
import { sampleBufferBilinear, worldToPixelCoords } from "../../../../shaders/common";
import type { FloatNode, Node, StorageBufferNode } from "../../../../shaders/types";

/**
 * Sample full XYZ displacement from a cascade displacement buffer at a world
 * position using bilinear interpolation and seamless tile wraparound.
 *
 * @param worldX - World-space X coordinate.
 * @param worldZ - World-space Z coordinate.
 * @param buffer - Cascade displacement storage buffer (vec4 per texel, `.xyz` = displacement).
 * @param resolution - Buffer side length in texels (int node).
 * @param scale - Cascade world-space tile extent (float node).
 * @returns vec3 XYZ displacement at that world position.
 */
export function sampleDisplacementXYZ(
  worldX: Node,
  worldZ: Node,
  buffer: StorageBufferNode,
  resolution: Node,
  scale: Node,
): Node {
  const { px, py } = worldToPixelCoords(
    worldX as FloatNode,
    worldZ as FloatNode,
    resolution,
    scale,
  );
  return sampleBufferBilinear(px, py, buffer, int(resolution)).xyz;
}

/**
 * Sample a surface normal from a cascade normal texture at explicit LOD 0.
 * Converts the texture's `[0, 1]` encoding back to `[-1, 1]` normal space.
 *
 * The half-texel offset preserves the old storage-buffer convention, where an
 * integer pixel coordinate addressed the center of that texel. Hardware
 * filtering maps normalized coordinate `i / resolution` halfway between
 * texels `i - 1` and `i`, so adding `0.5 / resolution` keeps query and legacy
 * node results aligned with their former buffer path.
 *
 * @param worldX - World-space X coordinate.
 * @param worldZ - World-space Z coordinate.
 * @param normalTexture - Filterable cascade normal texture.
 * @param resolution - Texture side length in texels.
 * @param scale - Cascade world-space tile extent.
 * @returns vec3 surface normal in world space.
 */
export function sampleNormalTexture(
  worldX: Node,
  worldZ: Node,
  normalTexture: THREE.Texture,
  resolution: Node,
  scale: Node,
): Node {
  const halfTexel = float(0.5).div(float(resolution));
  const uv = vec2(
    (worldX as FloatNode).div(scale).add(0.5).add(halfTexel),
    (worldZ as FloatNode).div(scale).add(0.5).add(halfTexel),
  );
  return textureLevel(normalTexture, uv, int(0)).xyz.mul(2.0).sub(1.0);
}

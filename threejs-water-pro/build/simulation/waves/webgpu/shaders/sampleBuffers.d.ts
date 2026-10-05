import type * as THREE from "three/webgpu";
import type { Node, StorageBufferNode } from "../../../../shaders/types";
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
export declare function sampleDisplacementXYZ(worldX: Node, worldZ: Node, buffer: StorageBufferNode, resolution: Node, scale: Node): Node;
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
export declare function sampleNormalTexture(worldX: Node, worldZ: Node, normalTexture: THREE.Texture, resolution: Node, scale: Node): Node;
//# sourceMappingURL=sampleBuffers.d.ts.map
/**
 * Shared TSL helpers for sampling FFT cascade storage buffers from compute shaders.
 *
 * These were previously inlined inside `WebGPUWaveSampler.createComputeShader()`.
 * Extracted so other compute passes (spray emission, debug visualizers, etc.) can
 * reuse the same coordinate logic without duplicating the math.
 */
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
 * Sample a surface normal from a cascade normal buffer at a world position.
 * Converts the buffer's `[0, 1]` encoding back to `[-1, 1]` normal space.
 *
 * Note: the normal buffer's `.w` channel carries the directional foam/Jacobian
 * signal (see `computeNormals.ts`). Use {@link sampleNormalFull} if you need it.
 *
 * @param worldX - World-space X coordinate.
 * @param worldZ - World-space Z coordinate.
 * @param buffer - Cascade normal storage buffer.
 * @param resolution - Buffer side length in texels (int node).
 * @param scale - Cascade world-space tile extent (float node).
 * @returns vec3 surface normal in world space.
 */
export declare function sampleNormal(worldX: Node, worldZ: Node, buffer: StorageBufferNode, resolution: Node, scale: Node): Node;
/**
 * Sample the full vec4 from a cascade normal buffer at a world position.
 * Keeps `.xyz` in encoded `[0, 1]` space and passes `.w` through untouched
 * (directional foam / Jacobian signal: LOW = break, HIGH = calm).
 *
 * Use this when you need both the normal and the foam signal from a single
 * bilinear read.
 *
 * @param worldX - World-space X coordinate.
 * @param worldZ - World-space Z coordinate.
 * @param buffer - Cascade normal storage buffer.
 * @param resolution - Buffer side length in texels (int node).
 * @param scale - Cascade world-space tile extent (float node).
 * @returns Raw vec4 from the cascade normal buffer.
 */
export declare function sampleNormalFull(worldX: Node, worldZ: Node, buffer: StorageBufferNode, resolution: Node, scale: Node): Node;
//# sourceMappingURL=sampleBuffers.d.ts.map
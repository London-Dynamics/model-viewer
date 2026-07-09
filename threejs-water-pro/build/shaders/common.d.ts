import type { FloatNode, Node, StorageBufferNode } from "./types";
/**
 * Hash function for pseudo-random number generation
 * Uses a simple hash function to generate deterministic pseudo-random values
 * @returns A TSL function node that takes a seed and returns a pseudo-random value [0, 1]
 */
export declare const hash: import("three/src/nodes/TSL.js").ShaderNodeFn<[]>;
/**
 * Bit-reverse a number using arithmetic operations
 * Reverses the bits for any power-of-2 FFT size (6-11 bits for resolutions 64-2048)
 * Uses division and modulo instead of bitwise operations (WGSL compatibility)
 *
 * @param numBits - Number of bits to reverse (log2 of FFT resolution)
 * @returns A TSL function node that takes a number and returns its bit-reversed version
 */
export declare const createBitReverseFn: (numBits: number) => import("three/src/nodes/TSL.js").ShaderNodeFn<[]>;
/**
 * Samples a vec4 storage buffer with bilinear interpolation and seamless tiling.
 *
 * @param px - Pixel X coordinate (can be fractional).
 * @param py - Pixel Y coordinate (can be fractional).
 * @param buffer - Storage buffer to sample (vec4 elements).
 * @param resolution - Buffer resolution (texels per side, int node).
 */
export declare function sampleBufferBilinear(px: Node, py: Node, buffer: StorageBufferNode, resolution: Node): Node;
/**
 * Converts world coordinates to pixel coordinates for cascade buffer sampling.
 * Applies scale normalization so 'scale' represents world-space wavelength
 * independent of FFT resolution (base resolution = 256).
 *
 * @param worldX - World X coordinate.
 * @param worldZ - World Z coordinate.
 * @param resolution - Buffer resolution (texels per side).
 * @param scale - World-space scale of the cascade.
 */
export declare function worldToPixelCoords(worldX: FloatNode, worldZ: FloatNode, resolution: Node, scale: Node): {
    px: Node;
    py: Node;
};
//# sourceMappingURL=common.d.ts.map
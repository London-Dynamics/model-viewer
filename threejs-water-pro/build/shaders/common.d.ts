import type { FloatNode, Node, StorageBufferNode } from "./types";
/**
 * Integer-avalanche PCG hash used for deterministic spectrum randomization.
 *
 * The previous float hash began with `fract(seed * 0.1031)`. Spectrum seeds
 * are separated by 100000, and `100000 * 0.1031` is the integer 10310, so the
 * fractional part discarded the entire cascade/session seed. Every cascade
 * therefore received the same random sequence and began phase-correlated.
 * Three.js's PCG hash converts the input to `u32` and avalanches every bit, so
 * adjacent cells and seed streams remain decorrelated on WebGPU and WebGL.
 */
export declare const hash: (seed: Node) => Node;
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
 * The cascade tile spans exactly `scale` meters in world space — the same
 * convention the spectrum shader uses to generate it (kx = 2πn/scale) — so
 * the mapping must not depend on FFT resolution.
 *
 * @param worldX - World X coordinate.
 * @param worldZ - World Z coordinate.
 * @param resolution - Buffer resolution (texels per side).
 * @param scale - World-space tile size of the cascade, in meters.
 */
export declare function worldToPixelCoords(worldX: FloatNode, worldZ: FloatNode, resolution: Node, scale: Node): {
    px: Node;
    py: Node;
};
//# sourceMappingURL=common.d.ts.map
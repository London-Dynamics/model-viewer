// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import { float, floor, Fn, hash as pcgHash, mix, uint } from "three/tsl";
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
export const hash = pcgHash;

/**
 * Bit-reverse a number using arithmetic operations
 * Reverses the bits for any power-of-2 FFT size (6-11 bits for resolutions 64-2048)
 * Uses division and modulo instead of bitwise operations (WGSL compatibility)
 *
 * @param numBits - Number of bits to reverse (log2 of FFT resolution)
 * @returns A TSL function node that takes a number and returns its bit-reversed version
 */
export const createBitReverseFn = (numBits: number) => {
  // @ts-expect-error - TSL Fn with array destructuring has type issues
  return Fn(([n]) => {
    const num = uint(n);

    // Extract all 11 bits (we'll only use numBits of them)
    const b0 = num.div(1).mod(2);
    const b1 = num.div(2).mod(2);
    const b2 = num.div(4).mod(2);
    const b3 = num.div(8).mod(2);
    const b4 = num.div(16).mod(2);
    const b5 = num.div(32).mod(2);
    const b6 = num.div(64).mod(2);
    const b7 = num.div(128).mod(2);
    const b8 = num.div(256).mod(2);
    const b9 = num.div(512).mod(2);
    const b10 = num.div(1024).mod(2);

    // Multipliers: bit[i] goes to position (numBits-1-i)
    const m0 = Math.pow(2, numBits - 1);
    const m1 = Math.pow(2, Math.max(0, numBits - 2));
    const m2 = Math.pow(2, Math.max(0, numBits - 3));
    const m3 = Math.pow(2, Math.max(0, numBits - 4));
    const m4 = Math.pow(2, Math.max(0, numBits - 5));
    const m5 = Math.pow(2, Math.max(0, numBits - 6));
    const m6 = Math.pow(2, Math.max(0, numBits - 7));
    const m7 = Math.pow(2, Math.max(0, numBits - 8));
    const m8 = Math.pow(2, Math.max(0, numBits - 9));
    const m9 = Math.pow(2, Math.max(0, numBits - 10));
    const m10 = Math.pow(2, Math.max(0, numBits - 11));

    const result = uint(0)
      .add(b0.mul(m0))
      .add(b1.mul(m1))
      .add(b2.mul(m2))
      .add(b3.mul(m3))
      .add(b4.mul(m4))
      .add(b5.mul(m5))
      .add(b6.mul(m6))
      .add(b7.mul(m7))
      .add(b8.mul(m8))
      .add(b9.mul(m9))
      .add(b10.mul(m10));

    return result;
  });
};

/**
 * Samples a vec4 storage buffer with bilinear interpolation and seamless tiling.
 *
 * @param px - Pixel X coordinate (can be fractional).
 * @param py - Pixel Y coordinate (can be fractional).
 * @param buffer - Storage buffer to sample (vec4 elements).
 * @param resolution - Buffer resolution (texels per side, int node).
 */
export function sampleBufferBilinear(
  px: Node,
  py: Node,
  buffer: StorageBufferNode,
  resolution: Node,
): Node {
  const x0Float = floor(px);
  const y0Float = floor(py);
  const fx = (px as FloatNode).sub(x0Float);
  const fy = (py as FloatNode).sub(y0Float);

  const res = resolution;
  const x0 = x0Float.toInt().mod(res).add(res).mod(res);
  const y0 = y0Float.toInt().mod(res).add(res).mod(res);
  const x1 = x0.add(1).mod(res);
  const y1 = y0.add(1).mod(res);

  const d00 = buffer.element(y0.mul(res).add(x0));
  const d10 = buffer.element(y0.mul(res).add(x1));
  const d01 = buffer.element(y1.mul(res).add(x0));
  const d11 = buffer.element(y1.mul(res).add(x1));

  const d0 = mix(d00, d10, fx);
  const d1 = mix(d01, d11, fx);
  return mix(d0, d1, fy);
}


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
export function worldToPixelCoords(
  worldX: FloatNode,
  worldZ: FloatNode,
  resolution: Node,
  scale: Node,
): { px: Node; py: Node } {
  const resFloat = float(resolution);
  const px = worldX.div(scale).add(0.5).mul(resFloat);
  const py = worldZ.div(scale).add(0.5).mul(resFloat);
  return { px, py };
}

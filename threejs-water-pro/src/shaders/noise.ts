// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Simple 2D and 3D noise implementation in TSL
 * Uses a hash-based approach that's more reliable in TSL
 */
import {
  vec2,
  vec3,
  float,
  Fn,
  floor,
  dot,
  fract,
  mix,
  sin,
  step,
} from "three/tsl";

/**
 * Hash function returning vec2 for gradient
 */
const hash2D_vec2 = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const px = dot(p, vec2(127.1, 311.7));
  const py = dot(p, vec2(269.5, 183.3));
  return fract(vec2(sin(px), sin(py)).mul(43758.5453123)).mul(2.0).sub(1.0);
});

/**
 * 2D Gradient Noise (Perlin-style)
 * Smoother than value noise with less grid-aligned artifacts
 * Returns value in range approximately [-1, 1]
 */
export const gradientNoise2D = Fn(([p]: [ReturnType<typeof vec2>]) => {
  const i = floor(p);
  const f = fract(p);

  // Smooth interpolation curve
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));

  // Get gradients at 4 corners and compute dot products
  const g00 = hash2D_vec2(i);
  const g10 = hash2D_vec2(i.add(vec2(1.0, 0.0)));
  const g01 = hash2D_vec2(i.add(vec2(0.0, 1.0)));
  const g11 = hash2D_vec2(i.add(vec2(1.0, 1.0)));

  // Distance vectors to corners
  const d00 = f;
  const d10 = f.sub(vec2(1.0, 0.0));
  const d01 = f.sub(vec2(0.0, 1.0));
  const d11 = f.sub(vec2(1.0, 1.0));

  // Dot products
  const n00 = dot(g00, d00);
  const n10 = dot(g10, d10);
  const n01 = dot(g01, d01);
  const n11 = dot(g11, d11);

  // Bilinear interpolation
  return mix(
    mix(n00, n10, u.x),
    mix(n01, n11, u.x),
    u.y
  );
});

/**
 * Simple 2D noise - alias for gradient noise
 * Returns value in range approximately [-1, 1]
 */
export const simplex2D = gradientNoise2D;

// ============================================================================
// 3D Noise Functions
// ============================================================================

/**
 * Hash function for 3D returning vec3 gradient
 */
const hash3D_vec3 = Fn(([p]: [ReturnType<typeof vec3>]) => {
  const px = dot(p, vec3(127.1, 311.7, 74.7));
  const py = dot(p, vec3(269.5, 183.3, 246.1));
  const pz = dot(p, vec3(113.5, 271.9, 124.6));
  return fract(vec3(sin(px), sin(py), sin(pz)).mul(43758.5453123)).mul(2.0).sub(1.0);
});

/**
 * 3D Gradient Noise (Perlin-style)
 * Returns value in range approximately [-1, 1]
 */
export const gradientNoise3D = Fn(([p]: [ReturnType<typeof vec3>]) => {
  const i = floor(p);
  const f = fract(p);

  // Smooth interpolation curve (quintic)
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0));

  // Get gradients at 8 corners and compute dot products
  const g000 = hash3D_vec3(i);
  const g100 = hash3D_vec3(i.add(vec3(1.0, 0.0, 0.0)));
  const g010 = hash3D_vec3(i.add(vec3(0.0, 1.0, 0.0)));
  const g110 = hash3D_vec3(i.add(vec3(1.0, 1.0, 0.0)));
  const g001 = hash3D_vec3(i.add(vec3(0.0, 0.0, 1.0)));
  const g101 = hash3D_vec3(i.add(vec3(1.0, 0.0, 1.0)));
  const g011 = hash3D_vec3(i.add(vec3(0.0, 1.0, 1.0)));
  const g111 = hash3D_vec3(i.add(vec3(1.0, 1.0, 1.0)));

  // Distance vectors to corners
  const d000 = f;
  const d100 = f.sub(vec3(1.0, 0.0, 0.0));
  const d010 = f.sub(vec3(0.0, 1.0, 0.0));
  const d110 = f.sub(vec3(1.0, 1.0, 0.0));
  const d001 = f.sub(vec3(0.0, 0.0, 1.0));
  const d101 = f.sub(vec3(1.0, 0.0, 1.0));
  const d011 = f.sub(vec3(0.0, 1.0, 1.0));
  const d111 = f.sub(vec3(1.0, 1.0, 1.0));

  // Dot products
  const n000 = dot(g000, d000);
  const n100 = dot(g100, d100);
  const n010 = dot(g010, d010);
  const n110 = dot(g110, d110);
  const n001 = dot(g001, d001);
  const n101 = dot(g101, d101);
  const n011 = dot(g011, d011);
  const n111 = dot(g111, d111);

  // Trilinear interpolation
  const nx00 = mix(n000, n100, u.x);
  const nx10 = mix(n010, n110, u.x);
  const nx01 = mix(n001, n101, u.x);
  const nx11 = mix(n011, n111, u.x);

  const nxy0 = mix(nx00, nx10, u.y);
  const nxy1 = mix(nx01, nx11, u.y);

  return mix(nxy0, nxy1, u.z);
});

/**
 * Fractal Brownian Motion
 * Layers multiple octaves of noise (1-4 octaves)
 * Uses step functions to conditionally include octaves
 */
export const fbm2D = Fn(([
  p,
  octaveCount,
  lacunarity,
  persistence
]: [
  ReturnType<typeof vec2>,
  ReturnType<typeof float>,
  ReturnType<typeof float>,
  ReturnType<typeof float>
]) => {
  // Precompute frequency and amplitude multipliers for each octave (max 4)
  const freq1 = float(1.0);
  const freq2 = lacunarity;
  const freq3 = freq2.mul(lacunarity);
  const freq4 = freq3.mul(lacunarity);

  const amp1 = float(0.5);
  const amp2 = amp1.mul(persistence);
  const amp3 = amp2.mul(persistence);
  const amp4 = amp3.mul(persistence);

  // Use step functions to conditionally include each octave
  const has1 = step(0.5, octaveCount);
  const has2 = step(1.5, octaveCount);
  const has3 = step(2.5, octaveCount);
  const has4 = step(3.5, octaveCount);

  // Sample noise at each octave frequency
  const n1 = gradientNoise2D(p.mul(freq1)).mul(amp1).mul(has1);
  const n2 = gradientNoise2D(p.mul(freq2)).mul(amp2).mul(has2);
  const n3 = gradientNoise2D(p.mul(freq3)).mul(amp3).mul(has3);
  const n4 = gradientNoise2D(p.mul(freq4)).mul(amp4).mul(has4);

  return n1.add(n2).add(n3).add(n4);
});


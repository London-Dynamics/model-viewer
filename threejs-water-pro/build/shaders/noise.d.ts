/**
 * 2D Gradient Noise (Perlin-style)
 * Smoother than value noise with less grid-aligned artifacts
 * Returns value in range approximately [-1, 1]
 */
export declare const gradientNoise2D: import("three/src/nodes/TSL.js").ShaderNodeFn<[number | import("three/webgpu").Node]>;
/**
 * Simple 2D noise - alias for gradient noise
 * Returns value in range approximately [-1, 1]
 */
export declare const simplex2D: import("three/src/nodes/TSL.js").ShaderNodeFn<[number | import("three/webgpu").Node]>;
/**
 * 3D Gradient Noise (Perlin-style)
 * Returns value in range approximately [-1, 1]
 */
export declare const gradientNoise3D: import("three/src/nodes/TSL.js").ShaderNodeFn<[number | import("three/webgpu").Node]>;
/**
 * Fractal Brownian Motion
 * Layers multiple octaves of noise (1-4 octaves)
 * Uses step functions to conditionally include octaves
 */
export declare const fbm2D: import("three/src/nodes/TSL.js").ShaderNodeFn<[number | import("three/webgpu").Node, number | import("three/webgpu").Node, number | import("three/webgpu").Node, number | import("three/webgpu").Node]>;
//# sourceMappingURL=noise.d.ts.map
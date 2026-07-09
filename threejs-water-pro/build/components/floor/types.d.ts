/**
 * Type definitions for OceanFloor.
 */
import type { Node } from "../../shaders/types";
/**
 * Custom texture paths for sand textures
 */
export interface CustomTextureConfig {
    colorUrl?: string;
    normalUrl?: string;
}
/**
 * Caustics configuration for ocean floor
 */
export interface OceanFloorCaustics {
    /** Intensity fade with depth (0 = no fade, 1 = strong fade). */
    depthAttenuation: number;
    /** Whether caustics are active. */
    enabled: boolean;
    /** Overall brightness multiplier (0–5). */
    intensity: number;
    /** World-space tile scale. */
    scale: number;
    /** How strongly wave normals distort the procedural UVs. */
    waveDistortion: number;
}
/**
 * Configuration options for creating an OceanFloor.
 * This is a flat structure - all params are at the top level.
 */
export interface OceanFloorOptions {
    /** Size of the ocean floor mesh (should match water size) */
    size: number;
    /** Initial depth (Y position, positive value = below water) */
    depth: number;
    /** Resolution of the mesh geometry */
    meshResolution?: number;
    /** Tile size for texture/caustics */
    tileSize?: number;
    displacementScale?: number;
    displacementStrength?: number;
    lacunarity?: number;
    persistence?: number;
    normalScale?: number;
    /** Normalized terrain height where blend transitions (0=lowest, 1=highest) */
    blendThreshold?: number;
    /** Width of blend transition (larger = softer transition) */
    blendSoftness?: number;
    /** Strength of texture-based displacement added to procedural */
    textureDisplacementStrength?: number;
    caustics?: OceanFloorCaustics;
    customTextures?: CustomTextureConfig;
    /**
     * Shared wave-uniforms `windDirection` node. Passed by reference so
     * the caustic stretch stays in sync with the wave wind direction;
     * not cascade-coupled, so it is a one-time wire at construction.
     */
    windDirection?: Node;
}
//# sourceMappingURL=types.d.ts.map
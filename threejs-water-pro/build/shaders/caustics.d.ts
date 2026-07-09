/**
 * Caustics shader for ocean floor lighting effects.
 *
 * Samples a pre-generated seamless Voronoi texture at multiple UV
 * offsets/scales/scroll speeds. Two independently scrolling layers
 * are combined with `min()` to create natural interference patterns
 * that mimic real water caustics. Wave simulation normals distort the
 * UVs so the pattern swims in sync with wave motion.
 *
 * Supports two wave data sources (selected at build time):
 * - **Storage buffers** (WebGPU): Bilinear interpolation on storage buffer.
 * - **Textures** (WebGL): UV-tiled texture sampling.
 */
import * as THREE from "three/webgpu";
import type { Node, TSLBuffer } from "../types/tsl";
/** Options for {@link Caustics.setWaveBuffers}. */
export interface WaveCausticsBufferOptions {
    /** Normal buffer from wave simulation. */
    normalBuffer: TSLBuffer;
    /** Buffer resolution in texels. */
    resolution: number;
    /** World-space scale of the buffer. */
    scale: number;
}
/** Options for {@link Caustics.setWaveTexture}. */
export interface WaveCausticsTextureOptions {
    /** Normal texture from wave simulation (WebGL render target). */
    normalTexture: THREE.Texture;
    /** Texture resolution in texels. */
    resolution: number;
    /** World-space scale of the cascade. */
    scale: number;
}
/** Preset-facing parameters for caustics. */
export interface CausticsParams {
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
 * Caustics effect for ocean floor.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export declare class Caustics {
    private _depthAttenuation;
    private _enabled;
    private _intensity;
    private _scale;
    private _waterSize;
    private _waveDistortion;
    private _windDirection;
    private _voronoiTexture;
    private _waveResolution;
    private _waveScale;
    private _normalBuffer;
    private _normalTexture;
    private _time;
    constructor(time: Node);
    /** Intensity fade with depth (0 = no fade, 1 = strong fade). */
    get depthAttenuation(): number;
    set depthAttenuation(value: number);
    /** @internal Depth attenuation uniform node for shared binding. */
    get depthAttenuationNode(): Node;
    /** Whether caustics are active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Overall brightness multiplier (0–5). */
    get intensity(): number;
    set intensity(value: number);
    /** World-space tile scale. */
    get scale(): number;
    set scale(value: number);
    /** How strongly wave normals distort the procedural UVs. */
    get waveDistortion(): number;
    set waveDistortion(value: number);
    /** Tile size for UV coordinate scaling. */
    get waterSize(): number;
    set waterSize(value: number);
    /** Bulk-set parameters from a preset or params object. */
    update(params: CausticsParams): void;
    /**
     * Binds the wind direction uniform node so caustics scroll in the wave direction.
     * Must be called before build().
     *
     * @param windDirection - Shared wind direction uniform node (radians).
     */
    setWindDirection(windDirection: Node): void;
    /**
     * Set wave buffer references for caustics (WebGPU).
     * Must be called before build() for caustics to take effect.
     */
    setWaveBuffers(options: WaveCausticsBufferOptions): void;
    /**
     * Set wave texture reference for caustics (WebGL).
     * Must be called before build() for caustics to take effect.
     */
    setWaveTexture(options: WaveCausticsTextureOptions): void;
    /**
     * Updates buffer resolution and scale at runtime.
     *
     * @param resolution - Resolution in texels.
     * @param scale - World-space scale in units.
     */
    updateBufferParams(resolution: number, scale: number): void;
    /**
     * Builds the caustics shader node graph for the ocean floor material.
     * Uses `positionWorld` for fragment position and applies depth fade.
     *
     * @returns RGB caustics color to add to the floor.
     */
    build(): Node;
    /**
     * Evaluates the caustic pattern at a given world XZ position.
     * Returns RGB caustic color with intensity, chromatic dispersion,
     * and wave distortion applied. Does NOT apply depth fade or enabled guard.
     *
     * Used by both the floor material and screen-space caustics post-processing.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     */
    buildPatternAtWorldPos(worldX: Node, worldZ: Node): Node;
    /**
     * Combines two Voronoi samples with min() for interference.
     *
     * @param layer1 - Voronoi texture sample for layer 1.
     * @param layer2 - Voronoi texture sample for layer 2.
     */
    private combineLayers;
    /**
     * Samples the wave normal at a world position and converts to [-1,1] space.
     * Used for UV distortion of procedural patterns.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     */
    private sampleWaveNormal;
    /**
     * Bilinear interpolation on the normal storage buffer.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     * @param effectiveScale - Resolution-adjusted scale.
     * @param res - Buffer resolution (int uniform).
     * @param resFloat - Buffer resolution (float uniform).
     */
    private sampleNormalBuffer;
}
//# sourceMappingURL=caustics.d.ts.map
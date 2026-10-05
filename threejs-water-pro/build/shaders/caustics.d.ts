/**
 * Caustics shader for ocean floor lighting effects.
 *
 * Samples a pre-generated seamless Voronoi texture at multiple UV
 * offsets/scales/scroll speeds. Two independently scrolling layers
 * are combined with `min()` to create natural interference patterns
 * that mimic real water caustics. Wave simulation normals distort the
 * UVs so the pattern swims in sync with wave motion.
 *
 * Wave normals are sampled from the simulation's shared normal texture.
 */
import * as THREE from "three/webgpu";
import type { Node } from "../types/tsl";
/** Options for {@link Caustics.setWaveTexture}. */
export interface WaveCausticsTextureOptions {
    /** Normal texture from the wave simulation. */
    normalTexture: THREE.Texture;
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
    private _waveScale;
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
     * Set the wave-normal texture used by caustics.
     * Must be called before build() for caustics to take effect.
     */
    setWaveTexture(options: WaveCausticsTextureOptions): void;
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
}
//# sourceMappingURL=caustics.d.ts.map
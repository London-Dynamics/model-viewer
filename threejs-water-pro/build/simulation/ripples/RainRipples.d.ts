import type { Node } from "three/webgpu";
/** Preset-facing parameters for rain ripples. */
export interface RainRippleParams {
    /** How quickly ripples fade (0.1–5). Scales both temporal and spatial decay. */
    decay: number;
    /** Ripple spawn density (0–1). Higher = more ripples per area. */
    density: number;
    /** Whether ripple effect is enabled. */
    enabled: boolean;
    /** Distance where ripples fully fade out from camera. */
    fadeEnd: number;
    /** Ripple cell size in meters (0.1–1). Controls individual ripple diameter. */
    size: number;
    /** Ripple normal perturbation strength (0–1). */
    strength: number;
}
/** Output nodes produced by {@link RainRipples.build}. */
export interface RainRipplesResult {
    /** Perturbed surface normal from ripple rings. */
    normal: Node;
    /** 0–1 additive brightness from drop impact flashes. */
    splash: Node;
}
/**
 * Procedural rain ripple effect.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link buildNormals}.
 */
export declare class RainRipples {
    private _enabled;
    private _time;
    private _decayUniform;
    private _densityUniform;
    private _sizeUniform;
    private _strengthUniform;
    private _fadeEnd;
    /** Whether ripple effect is enabled. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** How quickly ripples fade. Scales both temporal and spatial decay. */
    get decay(): number;
    set decay(value: number);
    /** Ripple spawn density (0–1). */
    get density(): number;
    set density(value: number);
    /** Ripple cell size in meters (0.1–1). */
    get size(): number;
    set size(value: number);
    /** Ripple normal perturbation strength. */
    get strength(): number;
    set strength(value: number);
    /** Distance where ripples fully fade out from camera. */
    get fadeEnd(): number;
    set fadeEnd(value: number);
    /** @internal Update the time uniform. Call once per frame. */
    updateTime(time: number): void;
    /** @internal Bulk-set parameters from a preset. */
    update(params: RainRippleParams): void;
    /**
     * @internal Build TSL nodes for ripple normal perturbation and impact splash flash.
     *
     * Tiles world space into cells. Each cell spawns a raindrop on a time
     * cycle. An expanding wavefront mask ensures rings start as a point
     * impact and propagate outward. Analytical gradients give per-pixel normals.
     * The same per-drop timing drives a brief additive white flash at impact.
     *
     * @param worldX - Fragment world X coordinate.
     * @param worldZ - Fragment world Z coordinate.
     * @param cameraWorldPos - Camera world position node (for distance fade).
     */
    build(worldX: Node, worldZ: Node, cameraWorldPos: Node): RainRipplesResult;
    dispose(): void;
}
//# sourceMappingURL=RainRipples.d.ts.map
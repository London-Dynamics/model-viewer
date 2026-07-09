/**
 * World-space instanced billboard rain particles.
 *
 * Each rain streak is a quad billboard oriented along the fall direction —
 * right axis perpendicular to the camera ray, length axis along gravity+wind.
 * The vertex shader expands each instance into a billboard entirely in world
 * space; there is no geometry shader, no sorting, and no CPU→GPU position
 * upload cost beyond the position array itself.
 *
 * 1 draw call regardless of particle count.
 * CPU update (suitable up to ~50k particles; above that, prefer GPU compute).
 */
import * as THREE from "three/webgpu";
/** Parameters for controlling rain streaks. Used by presets and the demo UI. */
export interface RainParams {
    /** Rain streak tint color (hex string). */
    color: string;
    /** Whether rain is enabled. */
    enabled: boolean;
    /** Distance (m) at which streaks begin fading out toward the domain boundary. */
    fadeDistance: number;
    /** Rain streak density (0–1). */
    intensity: number;
    /** Visual opacity of rain streaks (0–1). */
    opacity: number;
    /** Speed multiplier for rain fall animation (default 1.0). */
    speed: number;
    /** Maximum streak length in world units (default 1.0). */
    streakLength: number;
    /** Maximum streak width in world units (default 0.008). */
    streakWidth: number;
}
/**
 * World-space instanced billboard rain.
 *
 * Add the mesh returned by `getMesh()` to the scene. Call `tick()` each frame
 * to simulate particle physics and upload updated positions to the GPU.
 */
export declare class RainParticles {
    private _geometry;
    private _material;
    private _mesh;
    private _positions;
    private _lengths;
    private _widths;
    private _positionAttr;
    private _fallDir;
    private _color;
    private _opacity;
    private _maxLength;
    private _maxWidth;
    private _fadeDistance;
    private _maxCount;
    private _enabled;
    private _speed;
    private _initialized;
    private _prevCameraPos;
    constructor(maxCount?: number);
    private _buildMaterial;
    /** @internal The mesh to add to the scene. */
    getMesh(): THREE.Mesh;
    /** Whether particle rain is enabled. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Rain streak tint color. */
    get color(): THREE.Color;
    set color(value: THREE.Color | string);
    /** Visual opacity of streaks (0–1). */
    get opacity(): number;
    set opacity(value: number);
    /** Fall speed multiplier (default 5.0). */
    get speed(): number;
    set speed(value: number);
    /** Maximum streak length in world units. */
    get streakLength(): number;
    set streakLength(value: number);
    /** Maximum streak width in world units. */
    get streakWidth(): number;
    set streakWidth(value: number);
    /** Distance (m) at which streaks begin fading toward the domain boundary. */
    get fadeDistance(): number;
    set fadeDistance(value: number);
    /** @internal Bulk-set parameters from a preset or params object. */
    update(params: RainParams): void;
    /** Rain density (0–1). Maps linearly to active instance count. */
    get intensity(): number;
    set intensity(value: number);
    /**
     * @internal Simulate one frame: integrate positions, wrap domain, upload to GPU.
     */
    tick(deltaTime: number, camera: THREE.Camera, windDirection: number, windSpeed: number): void;
    /** Dispose GPU resources. */
    dispose(): void;
}
//# sourceMappingURL=RainParticles.d.ts.map
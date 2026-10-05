import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { SkyProvider } from "../../components/sky/SkyProvider";
/** Options for {@link AtmosphericFog.createFoggedColorNode}. */
export interface FoggedColorOptions {
    /** Radial view distance (world units, camera → point). */
    distance: Node;
    /**
     * How fog consumes the colour. `"tint"` (default) mixes toward the fog
     * colour — for surfaces. `"fade"` scales toward zero — for additive light,
     * which loses energy with distance rather than taking on the fog's colour.
     */
    mode?: "fade" | "tint";
    /** World-space direction from the camera to the point (for the sky-colour blend). */
    worldDirection: Node;
}
/** Parameters for atmospheric fog. */
export interface FogParams {
    /** Constant near-distance fog colour (hex string or THREE.Color). */
    color: string;
    /** Whether fog is enabled. */
    enabled: boolean;
    /** Distance where fog reaches full intensity (world units). */
    fadeEnd: number;
    /** Power curve for fog falloff. 1 = linear, <1 = faster ramp, >1 = slower ramp. */
    fadePower: number;
    /** Distance where fog begins (world units). */
    fadeStart: number;
    /** Distance over which the fog colour blends from `color` to the sky colour (world units). */
    skyBlendDistance: number;
}
/**
 * Atmospheric fog above water.
 *
 * `WaterSystem` assigns {@link createSceneFogNode} to `scene.fogNode`, so the
 * renderer applies the fog inside every material that keeps the default
 * `material.fog = true`. Set `material.fog = false` on backdrops (sky domes,
 * clouds, starfields) and on anything that self-fogs via the public builders.
 */
export declare class AtmosphericFog {
    private sky;
    private _color;
    private _fadeStart;
    private _fadeEnd;
    private _fadePower;
    private _skyBlendDistance;
    private _enabled;
    /**
     * Constant near-distance fog colour. Distant fog blends toward the sky colour
     * over `skyBlendDistance`, so this is the tint nearby geometry fades into.
     */
    get color(): THREE.Color;
    set color(value: THREE.Color | string);
    /** Distance where fog begins (world units). */
    get fadeStart(): number;
    set fadeStart(value: number);
    /** Distance where fog reaches full intensity (world units). */
    get fadeEnd(): number;
    set fadeEnd(value: number);
    /** Power curve for fog falloff. 1 = linear, <1 = faster ramp, >1 = slower ramp. */
    get fadePower(): number;
    set fadePower(value: number);
    /**
     * Distance over which the fog colour blends from `color` (near) to the sky
     * colour (far), in world units. Smaller values reach the sky colour sooner.
     */
    get skyBlendDistance(): number;
    set skyBlendDistance(value: number);
    /** Whether fog is enabled. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Bulk-set parameters from a preset or params object. */
    update(params: FogParams): void;
    /**
     * Set the sky for fog colour sampling.
     */
    setSky(sky: SkyProvider | null): void;
    /**
     * The per-material fog node `WaterSystem` assigns to `scene.fogNode`. Runs
     * at the end of every fogged material's fragment shading, before blending.
     *
     * Additive-blended materials fade toward zero with distance — light loses
     * energy in fog rather than taking on its colour — and everything else
     * mixes toward the sky-blended fog colour. The blend mode is read through
     * `materialReference`, a per-object uniform, so materials that share a
     * compiled shader program still fog by their own blending.
     */
    createSceneFogNode(): Node;
    /**
     * TSL: fog opacity in [0, 1] at a radial view distance (world units,
     * camera → point), on the same curve the scene fog applies, gated by
     * {@link enabled}.
     *
     * The distance must be radial — `length(worldPos - cameraPos)` — not the
     * view-space depth `viewZ`; the scene fogs by radial distance, so a `viewZ`
     * self-fogged object would mismatch it toward the frame edges.
     *
     * Binds the live parameter uniforms: preset loads and setter changes
     * propagate without rebuilding.
     */
    createFogFactorNode(distance: Node): Node;
    /**
     * TSL: the fog colour seen at `distance` along `worldDirection` — the flat
     * near {@link color} blending toward the sky sample over
     * {@link skyBlendDistance}, exactly as the scene fog computes it. Samples
     * the sky texture once; callers compositing many layers should hoist the
     * result. Falls back to the flat {@link color} when no sky is set, so call
     * after `water.setSky(...)`.
     */
    createFogColorNode(worldDirection: Node, distance: Node): Node;
    /**
     * TSL convenience: `color` as seen through fog at a radial view distance.
     * `mode: "tint"` (default) mixes toward the fog colour; `mode: "fade"`
     * scales toward zero, for additive light. Use this to self-fog content the
     * scene fog can't reach (e.g. FX composited after post-processing) so it
     * fades on the same curve as the scene — and set `material.fog = false` on
     * such materials so the scene fog doesn't apply twice.
     */
    createFoggedColorNode(color: Node, options: FoggedColorOptions): Node;
    /**
     * Fog opacity at a radial view distance:
     * `smoothstep(fadeStart, fadeEnd, distance) ^ fadePower`, gated by the
     * enable uniform. Single source of the curve — the scene fog node and the
     * public builders must never diverge.
     */
    private buildFogFactor;
    /**
     * Blend the flat near-fog colour toward the sky colour with distance, so
     * geometry meeting the horizon carries no colour seam. Guards against a
     * degenerate (zero) blend distance.
     */
    private buildFogColor;
}
//# sourceMappingURL=AtmosphericFog.d.ts.map
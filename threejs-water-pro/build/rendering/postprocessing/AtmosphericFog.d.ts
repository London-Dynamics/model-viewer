import * as THREE from "three/webgpu";
import { Node, PassNode } from "three/webgpu";
import type { Sky } from "../../components/sky/Sky";
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
 * Post-processing atmospheric fog.
 *
 * Applies distance-based fog using the scene pass depth buffer,
 * which includes water surface depth for correct fog on water.
 */
export declare class AtmosphericFog {
    private sky;
    private _color;
    private _fadeStart;
    private _fadeEnd;
    private _fadePower;
    private _skyBlendDistance;
    private _enabled;
    /** Transparent object depth (B=depth) from the depth pre-pass. */
    private transparentDepthTextureNode;
    /** Transparent object per-pixel alpha (A) from the depth pre-pass colour target. */
    private transparentColorTextureNode;
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
    setSky(sky: Sky | null): void;
    /** Bind the transparent object depth texture from the depth pre-pass. */
    setTransparentDepthTexture(tex: THREE.Texture): void;
    /** Bind the transparent object premultiplied-colour/alpha texture from the depth pre-pass. */
    setTransparentColorTexture(tex: THREE.Texture): void;
    /**
     * Create the post-processing effect node.
     *
     * @param scenePass - The scene pass node for texture sampling (includes depth)
     * @returns TSL node that applies atmospheric fog, or the input unchanged if no sky
     */
    createEffectNode(scenePass: PassNode, inputColor?: Node): Node;
}
//# sourceMappingURL=AtmosphericFog.d.ts.map
import * as THREE from "three/webgpu";
import { PassNode } from "three/webgpu";
import type { Node } from "../../shaders/types";
import type { TextureNode } from "three/webgpu";
import type { IWaterDepthPass } from "../passes/IWaterDepthPass";
import type { SceneDepthSampler } from "../passes/SceneDepthSampler";
import type { WaterColor } from "../../shaders/waterColor";
/**
 * Underwater applies screen-space post-processing effects for pixels
 * below the water surface. It reads the same physical or custom `WaterColor`
 * model as the surface shader, so attenuation remains continuous across the
 * waterline.
 *
 * UV distortion (refraction warp) is handled separately by
 * {@link UnderwaterDistortion}, which produces a shared distorted UV node
 * passed into {@link createEffectNode}.
 *
 * **Per-pixel detection.** Reads two clipped depth channels from the
 * water-depth pass:
 *
 *   - `clippedFront` — closest behind-clip water fragment that is
 *     front-facing.
 *   - `clippedAny`   — closest behind-clip water fragment, any face
 *     direction. Equals `min(clippedFront, clippedBack)`, so the back
 *     face is closer than the front face iff `clippedAny < clippedFront`.
 *
 * Classification: a pixel is underwater when the closest behind-clip
 * fragment is a back face — `clippedAny < clippedFront`, since
 * `clippedAny = min(clippedFront, clippedBack)`. The view ray crossed the
 * surface and is looking back out through the underside (Snell's window).
 * Front-facing pixels (`clippedAny == clippedFront`) never receive fog.
 * The same rule holds for both camera states; when submerged it can leave
 * scattered "firefly" pixels on wave triangles whose back face drops out
 * of the depth pass on the rasterizer's coverage knife-edge.
 *
 * **Column thickness.** `min(opaqueDepth, waterDepth)` covers every
 * geometric case with a single expression:
 *
 *   - Submerged with an opaque underwater object: `opaque < water` →
 *     column = opaque (whole ray was in water).
 *   - Submerged with the ray exiting through the surface (sky/land
 *     above): `water < opaque` → column = water (only the in-water
 *     segment before the ray crosses back into air).
 *   - Above water + Snell's-window pixel: `water` is the entry point,
 *     `opaque` is the seabed; the closer one wins.
 *
 * `waterDepth` is the closer of the two behind-clip water faces, sampled
 * via `clippedAny` (= `min(clippedFront, clippedBack)`).
 */
export declare class Underwater {
    timeUniform: THREE.UniformNode<number>;
    private _enabled;
    private _enabledUniform;
    private _tintColor;
    private _waterColor;
    private _waterDepthPass;
    private _sceneDepth;
    private transparentColorTextureNode;
    private transparentDepthTextureNode;
    private cameraNearUniform;
    private cameraFarUniform;
    constructor();
    /**
     * Wire the depth-sample source. Called once during `RenderPassManager`
     * construction; the post-pass samples depth through the source's
     * builder methods, so subsequent texture swaps (resize, quality switch)
     * propagate automatically via the source's internal TSL nodes.
     */
    setWaterDepthPass(waterDepthPass: IWaterDepthPass): void;
    /** Bind the scene-depth sampler from the capture pass. Called once —
     * target rebuilds and camera changes propagate through the sampler. */
    setSceneDepth(sceneDepth: SceneDepthSampler): void;
    /** Set the transparent object color texture from DepthPass. */
    setTransparentColorTexture(tex: THREE.Texture): void;
    /** Set the transparent object depth/alpha texture from DepthPass. */
    setTransparentDepthTexture(tex: THREE.Texture): void;
    /** Bind depth reconstruction uniforms. */
    setDepthUniforms(near: number, far: number): void;
    /** Bind the same water-color model used by the surface shader. */
    bindWaterColor(waterColor: WaterColor): void;
    /** Whether underwater effects are enabled. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Multiplicative tint applied over the entire underwater region (hex string). Default `"#ffffff"` = no tint. */
    get tintColor(): THREE.Color;
    set tintColor(value: THREE.Color | string);
    /**
     * Update underwater effects. Call once per frame.
     * @param time Current time for animation
     */
    update(time: number): void;
    /**
     * Create the post-processing effect node.
     *
     * @param scenePass - The scene pass node for texture resampling.
     * @param aboveWaterNode - Optional node to use when above water (e.g., atmospheric fog result).
     * @param distortedUV - Pre-computed distorted UV from {@link UnderwaterDistortion}.
     *   When provided, all texture sampling uses this UV so the refraction
     *   warp is consistent with other underwater passes (e.g., caustics).
     *   When omitted, sampling uses the undistorted screen UV.
     * @returns TSL node that applies underwater effects.
     */
    createEffectNode(scenePass: PassNode, aboveWaterNode?: Node, distortedUV?: Node): Node;
    /**
     * Despeckle the underwater region by dilating the fog mask: any non-fog
     * pixel that touches the fog region is reclassified as fog and adopts the
     * neighbouring fog colour. Both underwater artifacts share one root cause —
     * a surface pixel the per-pixel detection misclassifies as not-fog. With sun
     * shafts off it reads as a bright firefly speck (no fog); with shafts on, the
     * shaft brightens its fog neighbours but skips it, so it inverts into a dark
     * hole. Filling it from its fog neighbours fixes both: a misclassified pixel
     * is, by definition, surrounded by correctly-classified fog pixels.
     *
     * This runs after the sun-shaft composite, so the neighbour colour it copies
     * already includes the shaft contribution — the filled pixel matches its
     * shafted surroundings rather than punching a hole in the shaft glow.
     *
     * @param colorTex - Materialized fog + sun-shaft composite (an RTT texture
     *   node) so neighbours can be sampled. Build it with `convertToTexture`.
     */
    buildDespeckle(colorTex: TextureNode): Node;
}
//# sourceMappingURL=Underwater.d.ts.map
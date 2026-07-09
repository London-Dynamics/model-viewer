import type { Node } from "./types";
import type { RenderPassManager } from "../rendering/RenderPassManager";
import type { WaterSubsystem } from "../systems/types";
import type { UnderwaterConfig } from "../rendering/postprocessing/types";
/**
 * Screen-space underwater UV distortion.
 *
 * Owns its own TSL uniform nodes and a pre-baked tileable gradient noise
 * texture. Call {@link buildDistortedUV} once during post-processing node
 * construction; the returned node can be fed to any pass that needs
 * refraction-warped texture sampling.
 */
export declare class UnderwaterDistortion implements WaterSubsystem {
    private _enabled;
    private _intensity;
    private _scale;
    private _speed;
    private _time;
    private _waterDepthPass;
    private _noiseTextureNode;
    private static readonly NOISE_PERIOD;
    constructor(time: Node);
    /** Whether distortion is active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** UV offset strength. */
    get intensity(): number;
    set intensity(value: number);
    /** Noise frequency. */
    get scale(): number;
    set scale(value: number);
    /** Animation speed. */
    get speed(): number;
    set speed(value: number);
    /**
     * Wire the water-depth source. Called once at construction and again
     * on every quality switch. Internal texture swaps inside
     * `IWaterDepthPass` propagate through its TSL nodes automatically; the
     * sample builders we hold onto don't need re-binding on resize.
     */
    bindDepthTextures(rp: RenderPassManager): void;
    /** Bulk-set parameters from a preset or params object. */
    /**
     * Apply distortion params from the shared {@link UnderwaterConfig}.
     * Picks the four `distortion*` fields out of the underwater preset
     * slice so callers can hand the whole config object straight through.
     */
    update(params: UnderwaterConfig): void;
    /**
     * Builds a TSL node that evaluates to a UV coordinate.
     *
     * For underwater pixels with distortion enabled, the UV is offset by
     * animated gradient noise. For above-water pixels (or when disabled),
     * the original UV is returned unchanged.
     */
    buildDistortedUV(): Node;
    /**
     * Generates a 256x256 tileable gradient noise texture.
     * Bakes Perlin-style gradient noise, replacing 16 trig operations per
     * pixel with a single texture sample.
     */
    private static createNoiseTexture;
}
//# sourceMappingURL=underwaterDistortion.d.ts.map
import type * as THREE from "three/webgpu";
import type { Node, TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../types/tsl";
import type { IFoamFieldSampler } from "./IFoamFieldSampler";
/** Fraction of the window over which foam fades to calm at the rim. */
export declare const EDGE_FADE = 0.12;
/** Construction parameters for {@link FoamFieldSampler}. */
export interface FoamFieldSamplerParams {
    /** The target texture the sampler starts on (re-pointed each step by the accumulator). */
    initialTexture: THREE.Texture;
    resolution: number;
    worldSizeNode: TSLUniformNode;
    originXNode: TSLUniformNode;
    originZNode: TSLUniformNode;
}
/**
 * Camera-anchored sampler for the WebGL world-fixed foam target.
 *
 * Reads the energy (`.r`) at an arbitrary world position via hardware bilinear
 * filtering at the camera-anchored UV, then fades to zero over {@link EDGE_FADE}
 * of the window at the rim. The bound texture node ({@link energyNode}) is
 * re-pointed at the freshly written target each step by the accumulator; its
 * identity is stable, so the surface material compiles against it once.
 */
export declare class FoamFieldSampler implements IFoamFieldSampler {
    /** Texture node sampled by the surface; re-pointed at the latest target each step. */
    readonly energyNode: TextureNode;
    private readonly _worldSizeNode;
    private readonly _originXNode;
    private readonly _originZNode;
    constructor(params: FoamFieldSamplerParams);
    sampleEnergy(worldX: Node, worldZ: Node): Node;
}
//# sourceMappingURL=FoamFieldSampler.d.ts.map
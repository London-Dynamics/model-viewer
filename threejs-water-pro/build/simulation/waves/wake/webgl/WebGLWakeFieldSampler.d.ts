import type { Node, TextureNode } from "three/webgpu";
import type { TSLUniformNode } from "../../../../types/tsl";
import type { IWakeFieldSampler, WakeDisplacementSample } from "../IWakeFieldSampler";
/**
 * Bilinear sampler for the WebGL wake displacement target.
 *
 * Reads the packed `vec2(height, foam)` (RG channels) of the float render target
 * the leapfrog pass writes and returns height, surface normal, and foam energy
 * at an arbitrary world position. The target uses `NearestFilter`, so this does
 * its own four-tap bilinear blend (matching {@link WebGPUWakeFieldSampler}'s
 * manual interpolation over the storage buffer). Coordinates outside the buffer
 * extent clamp to the border (near-zero — calm water away from disturbances).
 *
 * The bound texture node's `value` is re-pointed at the freshly written target
 * each step by {@link WebGLWakeSimulation}; the node identity is stable, so the
 * surface material compiles against it once.
 */
export declare class WebGLWakeFieldSampler implements IWakeFieldSampler {
    private readonly _displacement;
    private readonly _worldSizeNode;
    private readonly _originXNode;
    private readonly _originZNode;
    private readonly _resolution;
    constructor(_displacement: TextureNode, resolution: number, _worldSizeNode: TSLUniformNode, _originXNode: TSLUniformNode, _originZNode: TSLUniformNode);
    sample(worldX: Node, worldZ: Node): WakeDisplacementSample;
    sampleFoamEnergy(worldX: Node, worldZ: Node): Node;
    sampleNormal(worldX: Node, worldZ: Node): Node;
    /** Central-difference height gradient `(∂h/∂x, ∂h/∂z)` over one texel as a `vec3`. */
    private _gradient;
    /** Fetch the texel centre `(tx, tz)` from the displacement target. */
    private _fetch;
    /** Four-tap bilinear fetch of the packed displacement at world `(worldX, worldZ)`. */
    private _bilinear;
}
//# sourceMappingURL=WebGLWakeFieldSampler.d.ts.map
import type { Node } from "three/webgpu";
import type { TSLBuffer, TSLUniformNode } from "../../../../types/tsl";
import type { IWakeFieldSampler, WakeDisplacementSample } from "../IWakeFieldSampler";
/**
 * Bilinear sampler for the WebGPU wake displacement buffer.
 *
 * Reads the packed `vec2(height, foam)` storage buffer written by the iWave
 * update kernel and returns height, surface normal, and foam energy at an
 * arbitrary world position. Coordinates outside the buffer extent clamp to the
 * border (near-zero — the field decays to calm water away from disturbances).
 *
 * Owned by {@link WebGPUWakeSimulation}; the same instance is handed to
 * `WaterSurfaceMaterial` and survives until the field is rebuilt.
 */
export declare class WebGPUWakeFieldSampler implements IWakeFieldSampler {
    private readonly _displacement;
    private readonly _worldSizeNode;
    private readonly _originXNode;
    private readonly _originZNode;
    private readonly _resolution;
    constructor(_displacement: TSLBuffer, resolution: number, _worldSizeNode: TSLUniformNode, _originXNode: TSLUniformNode, _originZNode: TSLUniformNode);
    sample(worldX: Node, worldZ: Node): WakeDisplacementSample;
    sampleFoamEnergy(worldX: Node, worldZ: Node): Node;
    sampleNormal(worldX: Node, worldZ: Node): Node;
    /** Central-difference height gradient `(∂h/∂x, ∂h/∂z)` over one texel as a `vec3`. */
    private _gradient;
    /** Bilinear fetch of the packed displacement `vec2` at world `(worldX, worldZ)`. */
    private _bilinear;
}
//# sourceMappingURL=WebGPUWakeFieldSampler.d.ts.map
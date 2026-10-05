import type { Node } from "three/webgpu";
import type { IWaveSimulation } from "../simulation/waves";
import type { TSLUniformNode } from "../types/tsl";
import type { CascadeSampler } from "./cascadeSampler";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
export interface WaterVertexParams {
    clipmapOffset: TSLUniformNode;
    oceanSim: IWaveSimulation;
    /** CascadeSampler instance for WebGPU path. Null for WebGL. */
    cascadeSampler: CascadeSampler | null;
    /** Wave-particle displacement sampler. Null when the material is built before the wake system is wired. */
    wakeFieldSampler: IWakeFieldSampler | null;
}
export interface WaterVertexResult {
    positionNode: Node;
    vSampleCoords: Node;
    /**
     * Hierarchical sample coordinates for cascades 1..cascadeCount-1, in
     * order, one varying per cascade. Empty on the WebGL path (no
     * hierarchical sampling).
     */
    vHierarchicalCoords: Node[];
    worldX: Node;
    worldZ: Node;
    hasStorageBuffers: boolean;
}
/**
 * Builds vertex displacement shader nodes and returns varyings for the fragment shader.
 *
 * Uses hierarchical cascade sampling: waves displace the sampling position
 * of ripples, so ripples "ride" on larger wave structures. This prevents
 * the patterning artifacts that occur when cascades are combined independently.
 *
 * When storage buffers are not available (WebGL), uses noise-based displacement nodes.
 */
export declare function buildWaterVertexDisplacement(params: WaterVertexParams): WaterVertexResult;
//# sourceMappingURL=waterVertex.d.ts.map
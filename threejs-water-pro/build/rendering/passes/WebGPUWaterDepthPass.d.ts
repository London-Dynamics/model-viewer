import * as THREE from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import type { IWaterDepthPass } from "./IWaterDepthPass";
/**
 * Water-depth pre-pass for the WebGPU backend.
 *
 * Renders the water mesh once — double-sided, no depth test — with
 * MIN blending. A single RGBA render target encodes all four depth
 * channels per pixel:
 *
 *   R = unclipped depth (any face)
 *   G = clippedAny depth (behind clip, any face)
 *   B = clippedFront depth (behind clip, front-facing)
 *   A = unclippedFront depth (front-facing, ignoring clip)
 *
 * MIN blending across all fragments at a pixel keeps the closest value
 * per channel without needing a depth test. Consumers call the
 * `sampleX(uv)` methods to get TSL nodes; they receive the correct
 * channel swizzle automatically.
 */
export declare class WebGPUWaterDepthPass implements IWaterDepthPass {
    private _camera;
    private _clipDistanceUniform;
    private _waterObject;
    private _combinedTarget;
    private _combinedMaterial;
    private _combinedTexNode;
    private _tempScene;
    constructor(camera: THREE.PerspectiveCamera, width: number, height: number, clipDistanceUniform?: UniformNode<number>);
    sampleUnclippedDepth(uvNode: Node): Node;
    sampleUnclippedFrontDepth(uvNode: Node): Node;
    sampleClippedAnyDepth(uvNode: Node): Node;
    sampleClippedFrontDepth(uvNode: Node): Node;
    setWaterObject(obj: THREE.Object3D): void;
    setPositionNode(node: Node): void;
    setClipDistanceUniform(clipDistanceUniform: UniformNode<number>): void;
    setCamera(camera: THREE.PerspectiveCamera): void;
    setSize(width: number, height: number): void;
    render(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
}
//# sourceMappingURL=WebGPUWaterDepthPass.d.ts.map
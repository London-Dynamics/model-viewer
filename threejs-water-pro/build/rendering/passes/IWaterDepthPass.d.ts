import type * as THREE from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
/**
 * Unified interface for water-depth sampling, hiding the WebGPU (single
 * MIN-blending draw) vs. WebGL (four separate draws) backend split from
 * all consumers.
 *
 * See {@link WebGPUWaterDepthPass} and {@link WebGLWaterDepthPass} for
 * the two concrete implementations.
 */
export interface IWaterDepthPass {
    /** TSL node: closest water-mesh fragment along the view ray, any face, ignoring the clip plane. */
    sampleUnclippedDepth(uvNode: Node): Node;
    /** TSL node: closest front-facing water-mesh fragment, ignoring the clip plane. */
    sampleUnclippedFrontDepth(uvNode: Node): Node;
    /** TSL node: closest behind-clip water-mesh fragment, any face direction. */
    sampleClippedAnyDepth(uvNode: Node): Node;
    /** TSL node: closest behind-clip, front-facing water-mesh fragment. */
    sampleClippedFrontDepth(uvNode: Node): Node;
    /** Set the water mesh to render (the clipmap object). */
    setWaterObject(obj: THREE.Object3D): void;
    /** Share the surface material's displacement node so the depth pass renders the same wave-displaced geometry. */
    setPositionNode(node: Node): void;
    /** Repoint the depth pass at a new clip-plane uniform after a material swap. */
    setClipDistanceUniform(clipDistanceUniform: UniformNode<number>): void;
    /** Update the camera used for rendering. */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /** Reallocate render targets after a viewport resize. */
    setSize(width: number, height: number): void;
    /** Execute the depth pre-pass draw(s). */
    render(renderer: THREE.WebGPURenderer): void;
    /** Release GPU resources. */
    dispose(): void;
}
//# sourceMappingURL=IWaterDepthPass.d.ts.map
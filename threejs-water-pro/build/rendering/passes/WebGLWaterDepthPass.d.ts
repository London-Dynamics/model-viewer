import * as THREE from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
import type { IWaterDepthPass } from "./IWaterDepthPass";
/**
 * Water-depth pre-pass for the WebGL backend.
 *
 * MIN blending is unreliable on WebGL, so this renders four separate
 * draw calls into four render targets — one per depth channel. Standard
 * depth testing keeps the closest fragment per draw.
 *
 *   _frontTarget        — clippedFront: behind-clip, front-facing  (R)
 *   _backTarget         — clippedBack:  behind-clip, back-facing   (R)
 *   _unclippedTarget    — unclipped:    any face, no clip          (R)
 *   _unclippedFrontTarget — unclippedFront: front-facing, no clip  (R)
 *
 * `sampleClippedAnyDepth` derives the min of front and back on the CPU
 * side by combining the two nodes; no extra pass is needed.
 *
 * Consumers call the `sampleX(uv)` methods to get TSL nodes; the
 * four-pass detail stays hidden behind the interface.
 */
export declare class WebGLWaterDepthPass implements IWaterDepthPass {
    private _camera;
    private _clipDistanceUniform;
    private _waterObject;
    private _frontTarget;
    private _backTarget;
    private _unclippedTarget;
    private _unclippedFrontTarget;
    private _frontMaterial;
    private _backMaterial;
    private _unclippedMaterial;
    private _unclippedFrontMaterial;
    private _frontTexNode;
    private _backTexNode;
    private _unclippedTexNode;
    private _unclippedFrontTexNode;
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
//# sourceMappingURL=WebGLWaterDepthPass.d.ts.map
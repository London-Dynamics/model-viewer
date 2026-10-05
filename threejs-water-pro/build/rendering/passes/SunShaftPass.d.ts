/**
 * SunShaftPass renders sun shaft intensity to a scaled render target.
 *
 * The intensity computation (occlusion sampling, radial falloff, etc.) runs
 * at reduced resolution to save texture reads. The output is bilinear-filtered
 * when sampled at full resolution in the post-processing composite step.
 */
import * as THREE from "three/webgpu";
import type { Node } from "../../shaders/types";
export declare class SunShaftPass {
    private renderTarget;
    private quadMesh;
    private resolutionScale;
    private fullWidth;
    private fullHeight;
    constructor(width: number, height: number, resolutionScale?: number);
    /**
     * Build the QuadMesh material from a sun shaft intensity node.
     * Must be called before render(). Call again after wave data changes (quality level switch).
     *
     * @param intensityNode - vec4 node outputting scalar shaft intensity in R.
     */
    build(intensityNode: Node): void;
    /** Render sun shaft intensity to the scaled render target. */
    render(renderer: THREE.WebGPURenderer): void;
    /** Get the sun shaft intensity texture for composite sampling. */
    getTexture(): THREE.Texture;
    /**
     * Resize the render target to match new screen dimensions.
     * Returns the new texture for rebinding.
     */
    setSize(width: number, height: number): THREE.Texture;
    /**
     * Update the resolution scale and rebuild the render target.
     * Returns the new texture for rebinding.
     */
    setResolutionScale(scale: number): THREE.Texture;
    getResolutionScale(): number;
    dispose(): void;
    private createRenderTarget;
}
//# sourceMappingURL=SunShaftPass.d.ts.map
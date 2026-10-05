/**
 * SSRPass runs the screen-space ray march at full resolution and writes the
 * resulting reflection color + hit mask to its own render target. The water
 * material samples this texture to compose SSR into its surface color.
 *
 * Inputs:
 * - sceneDepth: normalized-linear scene depth sampler from the capture pass
 * - sceneColorTexture: scene color from the capture pass
 * - gBufferTexture: water reflectDir + viewZ from `WaterReflectionGBufferPass`
 *
 * Output: RGBA16F, RGB = reflection color sampled from sceneColor at the hit
 * point, A = 0–1 hit-mask × strength × enabled.
 */
import * as THREE from "three/webgpu";
import type { SSR } from "../../shaders/ssr";
import type { SceneDepthSampler } from "./SceneDepthSampler";
export declare class SSRPass {
    private renderTarget;
    private quadMesh;
    private material;
    private ssr;
    private sceneDepth;
    private sceneColorTexture;
    private gBufferTexture;
    private camera;
    private viewMatrixUniform;
    private projectionMatrixUniform;
    private projectionMatrixInverseUniform;
    private nearUniform;
    private farUniform;
    /**
     * True after the result target is created or receives an SSR frame. The
     * disabled path consumes this flag by clearing the target once, then skips
     * all subsequent GPU work until SSR renders again.
     */
    private disabledClearPending;
    private readonly previousClearColor;
    constructor(width: number, height: number, ssr: SSR, camera: THREE.PerspectiveCamera, sceneDepth: SceneDepthSampler, sceneColorTexture: THREE.Texture, gBufferTexture: THREE.Texture);
    /** Update the camera the SSR pass tracks (call after switching scene cameras). */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /** Get the SSR result texture (rgb, hitMask). */
    getTexture(): THREE.Texture;
    /** Resize the SSR render target to match new screen dimensions. */
    setSize(width: number, height: number): void;
    /**
     * Re-bind the input textures (e.g. after a resize swapped the scene-color
     * render target) and rebuild the shader graph. The scene-depth sampler
     * tracks target rebuilds internally, so only colour textures re-bind.
     */
    setInputTextures(sceneColorTexture: THREE.Texture, gBufferTexture: THREE.Texture): void;
    /** Render the SSR pass. */
    render(renderer: THREE.WebGPURenderer): void;
    /**
     * Clear the persistent SSR result to a zero-confidence miss once.
     *
     * Called on disabled frames. After the first clear this is a CPU-only no-op
     * until {@link render} writes a new result or {@link setSize} creates a new
     * target. Explicit transparent black guarantees both reflection RGB and the
     * alpha hit mask are zero without leaking renderer clear state.
     */
    clearResultIfNeeded(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
    private buildShaderGraph;
}
//# sourceMappingURL=SSRPass.d.ts.map
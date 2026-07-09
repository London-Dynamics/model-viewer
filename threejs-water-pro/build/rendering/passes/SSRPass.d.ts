/**
 * SSRPass runs the screen-space ray march at full resolution and writes the
 * resulting reflection color + hit mask to its own render target. The water
 * material samples this texture to compose SSR into its surface color.
 *
 * Inputs:
 * - depthTexture: scene linear depth
 * - sceneColorTexture: scene color (already scaled by sceneColorResolutionScale)
 * - gBufferTexture: water reflectDir + viewZ from `WaterReflectionGBufferPass`
 *
 * Output: RGBA16F, RGB = reflection color sampled from sceneColor at the hit
 * point, A = 0–1 hit-mask × strength × enabled.
 */
import * as THREE from "three/webgpu";
import type { SSR } from "../../shaders/ssr";
export declare class SSRPass {
    private renderTarget;
    private quadMesh;
    private material;
    private ssr;
    private depthTexture;
    private sceneColorTexture;
    private gBufferTexture;
    private camera;
    private viewMatrixUniform;
    private projectionMatrixUniform;
    private projectionMatrixInverseUniform;
    private nearUniform;
    private farUniform;
    constructor(width: number, height: number, ssr: SSR, camera: THREE.PerspectiveCamera, depthTexture: THREE.Texture, sceneColorTexture: THREE.Texture, gBufferTexture: THREE.Texture);
    /** Update the camera the SSR pass tracks (call after switching scene cameras). */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /** Get the SSR result texture (rgb, hitMask). */
    getTexture(): THREE.Texture;
    /** Resize the SSR render target to match new screen dimensions. */
    setSize(width: number, height: number): void;
    /**
     * Re-bind the input textures (e.g. after a resize swapped the depth or
     * scene-color render target) and rebuild the shader graph.
     */
    setInputTextures(depthTexture: THREE.Texture, sceneColorTexture: THREE.Texture, gBufferTexture: THREE.Texture): void;
    /** Render the SSR pass. */
    render(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
    private buildShaderGraph;
}
//# sourceMappingURL=SSRPass.d.ts.map
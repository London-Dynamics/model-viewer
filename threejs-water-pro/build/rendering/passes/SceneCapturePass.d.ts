import * as THREE from "three/webgpu";
import { SceneDepthSampler } from "./SceneDepthSampler";
/**
 * Captures everything the water pipeline needs to know about the rest of
 * the scene, using the renderer's own classification and depth semantics —
 * no scene traversals, no per-object material swaps:
 *
 * 1. **Scene capture** — one render of the scene (minus the water surface
 *    and excluded objects) with original materials, into a color target
 *    with a hardware `DepthTexture` attached. The color texture feeds
 *    screen-space refraction; the depth texture is the opaque scene depth,
 *    exposed through {@link SceneDepthSampler} as normalized linear depth.
 *    What occludes is exactly what writes depth: alpha-tested cutouts
 *    discard in their own shaders, alpha-blended objects and sprites leave
 *    depth untouched (`depthWrite: false`), and `depthWrite: true`
 *    transparents occlude — by definition. The scene background and sky
 *    backdrop meshes are excluded, so the capture's alpha channel is true
 *    per-pixel scene coverage: consumers composite a direction-sampled sky
 *    (at infinity) underneath wherever alpha < 1.
 * 2. **Transparent depth** — the transparent render list only
 *    (`renderer.opaque = false`) drawn with a single override material
 *    that writes normalized linear depth to R. The renderer forwards each
 *    object's `alphaTest`/`alphaMap` onto the override, so cutout
 *    silhouettes hold. Sprites are skipped via `setRenderObjectFunction`
 *    (they cannot billboard under a mesh override — see
 *    plans/reports/20-spikes.md) and stay color-only.
 * 3. **Transparent color** — the transparent list with original materials
 *    over transparent black: premultiplied RGB + true per-pixel alpha,
 *    consumed by the underwater fog decomposition.
 *
 * Passes 2–3 only feed the underwater decomposition and are skipped when
 * `includeTransparents` is false.
 */
export declare class SceneCapturePass {
    private captureTarget;
    private transparentColorTarget;
    private transparentDepthTarget;
    private readonly depthSampler;
    private readonly transparentDepthMaterial;
    private camera;
    private readonly scene;
    private readonly excludedObjects;
    private readonly originalVisibility;
    constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number);
    /** Scene color (minus water) for screen-space refraction and SSR hits. */
    getColorTexture(): THREE.Texture;
    /**
     * Normalized-linear-depth sampler over the capture's hardware depth.
     * Consumers embed `sample(uv)` once; resizes and camera changes propagate
     * through the sampler's internal nodes.
     */
    get sceneDepth(): SceneDepthSampler;
    /**
     * Transparent objects' premultiplied colour (RGB) and true per-pixel
     * alpha (A). Standard alpha blending over transparent black yields
     * RGB = alpha × objectColor.
     */
    getTransparentColorTexture(): THREE.Texture;
    /** Transparent objects' depth (R = normalized linear, 1 = none). */
    getTransparentDepthTexture(): THREE.Texture;
    /** Capture camera near plane. */
    getCameraNear(): number;
    /** Capture camera far plane. */
    getCameraFar(): number;
    /** Exclude an object from every capture (e.g. the water surface). */
    excludeObject(object: THREE.Object3D): void;
    /** Remove an object from the exclusion list. */
    includeObject(object: THREE.Object3D): void;
    /** Update the camera used for capture rendering. */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Resize the capture targets. Old targets are not explicitly disposed —
     * garbage collection reclaims them, avoiding "destroyed texture used in
     * submit" errors from in-flight GPU work.
     */
    setSize(width: number, height: number): void;
    /**
     * Run the captures. The scene capture (color + opaque depth) always
     * renders; the transparent sub-passes run only when
     * `includeTransparents` is true.
     */
    render(renderer: THREE.WebGPURenderer, includeTransparents?: boolean): void;
    dispose(): void;
    /**
     * Passes 2–3: transparent depth (override material, sprites skipped),
     * then transparent premultiplied colour (original materials).
     */
    private renderTransparentCaptures;
    /** Scene capture target: HDR color + hardware depth texture. */
    private createCaptureTarget;
    /**
     * Transparent colour target. NEAREST keeps its per-pixel alpha aligned
     * with the separately captured depth silhouette. The depth buffer lets
     * transparents depth-test among themselves as in the beauty pass.
     */
    private createTransparentColorTarget;
    /** Single-channel transparent depth; occlusion is resolved by the consumer. */
    private createTransparentDepthTarget;
    /**
     * The override for the transparent-depth pass: R = normalized linear
     * depth, `NoBlending` so values write straight through.
     *
     * The depth goes through `outputNode`, never `colorNode`: `colorNode`
     * replaces the material's diffuse pipeline, so the per-object
     * `alphaTest`/`alphaMap` the renderer forwards onto the override would
     * have nothing to discard against. `outputNode` runs after the alpha
     * test, so cutout silhouettes hold (plans/reports/20-spikes.md, Spike C).
     */
    private createTransparentDepthMaterial;
}
//# sourceMappingURL=SceneCapturePass.d.ts.map
/**
 * RenderPassManager handles depth and color pass lifecycle for the water system.
 * Manages texture creation, resize handling, and material texture binding.
 */
import * as THREE from "three/webgpu";
import type { IWaterDepthPass } from "./passes/IWaterDepthPass";
import type { WaterSurfaceMaterial } from "../components/surface/WaterSurfaceMaterial";
import type { Underwater, AtmosphericFog } from "./postprocessing";
import type { WaterSurfaceGeometry } from "../components/surface/WaterSurfaceGeometry";
import type { Sky } from "../components/sky/Sky";
import type { SpraySystem } from "../systems/spray";
export interface RenderPassManagerOptions {
    clipmap: WaterSurfaceGeometry;
    waterMaterial: WaterSurfaceMaterial;
    spray?: SpraySystem | null;
    sky?: Sky | null;
    underwater?: Underwater | null;
    atmosphericFog?: AtmosphericFog | null;
    excludedObjects?: THREE.Object3D[];
    sceneColorResolutionScale?: number;
    isWebGL: boolean;
}
/**
 * Options for {@link RenderPassManager.rebind}. Lets `setQualityLevel` swap
 * the water material and clipmap in place instead of disposing and
 * reconstructing the whole pass manager.
 */
export interface RenderPassManagerRebindOptions {
    clipmap: WaterSurfaceGeometry;
    waterMaterial: WaterSurfaceMaterial;
    sceneColorResolutionScale?: number;
}
export declare class RenderPassManager {
    private renderer;
    private depthPass;
    private sceneColorPass;
    private maskPass;
    private waterDepthPass;
    private gBufferPass;
    private ssrPass;
    private clipmap;
    private waterMaterial;
    private spray;
    private underwater;
    private atmosphericFogPass;
    private currentSky;
    private skyExcludedMeshes;
    constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: RenderPassManagerOptions);
    /**
     * Get the current sky provider.
     */
    getCurrentSky(): Sky | null;
    /**
     * Update the sky provider used for aux-pass exclusion and atmospheric fog.
     * All backdrop meshes (and their Mesh descendants) returned by
     * {@link Sky.getMeshes} are excluded from both the depth pass and
     * the scene-color pass, so sky geometry can never contaminate refraction
     * sampling or transparent-depth decomposition.
     */
    setSky(sky: Sky | null): void;
    /**
     * Register every mesh descendant of each object returned by
     * {@link Sky.getMeshes} with the depth and scene-color passes so
     * the sky disappears from both.
     */
    private applySkyExclusions;
    /** Undo every exclusion added by {@link applySkyExclusions}. */
    private clearSkyExclusions;
    /**
     * Swap the water material and clipmap in place without recreating any
     * passes or render targets. Used by {@link WaterSystem.setQualityLevel}
     * so that sky, mask objects, and excluded objects all
     * survive a quality change automatically.
     *
     * Render-target sizes track the drawing buffer (not quality), so resizes
     * still flow through {@link resize}.
     */
    rebind(options: RenderPassManagerRebindOptions): void;
    /**
     * Update the camera used by all render passes.
     */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Handle resize - recreates render targets at the renderer's current drawing buffer size
     * and rebinds textures to materials.
     */
    resize(): void;
    /**
     * Render the depth pass
     */
    renderDepthPass(renderer: THREE.WebGPURenderer): void;
    /**
     * Render the scene color pass (for underwater refraction)
     */
    renderSceneColorPass(renderer: THREE.WebGPURenderer): void;
    /**
     * Render the mask pass (for water masking)
     */
    renderMaskPass(renderer: THREE.WebGPURenderer): void;
    /**
     * Render the water depth pass.
     */
    renderWaterDepthPass(renderer: THREE.WebGPURenderer): void;
    /** Render the SSR water-reflection G-buffer (full-res reflectDir + viewZ). */
    renderSSRGBufferPass(renderer: THREE.WebGPURenderer): void;
    /** Render the SSR ray-march pass at the configured resolution scale. */
    renderSSRPass(renderer: THREE.WebGPURenderer): void;
    /**
     * Add an object to render as a water mask.
     * Water will be hidden where this object is visible.
     */
    addMaskObject(object: THREE.Object3D): void;
    /**
     * Remove an object from mask rendering.
     */
    removeMaskObject(object: THREE.Object3D): void;
    /**
     * Check if an object is registered as a mask.
     */
    hasMaskObject(object: THREE.Object3D): boolean;
    /**
     * Get the number of registered mask objects.
     */
    getMaskObjectCount(): number;
    /**
     * Get all registered mask objects.
     */
    getMaskObjects(): ReadonlySet<THREE.Object3D>;
    /** Get the scene depth texture. */
    get sceneDepthTexture(): THREE.Texture;
    /**
     * The water-depth source. Subsystems that need clipped or unclipped
     * water-mesh depth samples route through its `sampleX(uv)` builders so
     * the WebGPU/WebGL backend split stays opaque to them.
     */
    get waterDepth(): IWaterDepthPass;
    /** Get camera near plane distance. */
    get cameraNear(): number;
    /** Get camera far plane distance. */
    get cameraFar(): number;
    /**
     * Update the scene color pass resolution scale and rebuild its render target.
     */
    setSceneColorResolutionScale(scale: number): void;
    getSceneColorResolutionScale(): number;
    /**
     * Dispose of resources
     */
    dispose(): void;
}
//# sourceMappingURL=RenderPassManager.d.ts.map
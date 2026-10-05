/**
 * RenderPassManager handles capture-pass lifecycle for the water system.
 * Manages texture creation, resize handling, and material texture binding.
 */
import * as THREE from "three/webgpu";
import type { SceneDepthSampler } from "./passes/SceneDepthSampler";
import type { IWaterDepthPass } from "./passes/IWaterDepthPass";
import type { WaterSurfaceMaterial } from "../components/surface/WaterSurfaceMaterial";
import type { Underwater, AtmosphericFog } from "./postprocessing";
import type { WaterSurfaceGeometry } from "../components/surface/WaterSurfaceGeometry";
import type { SkyProvider } from "../components/sky/SkyProvider";
import type { SpraySystem } from "../systems/spray";
export interface RenderPassManagerOptions {
    clipmap: WaterSurfaceGeometry;
    waterMaterial: WaterSurfaceMaterial;
    spray?: SpraySystem | null;
    underwater?: Underwater | null;
    atmosphericFog?: AtmosphericFog | null;
    excludedObjects?: THREE.Object3D[];
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
}
export declare class RenderPassManager {
    private renderer;
    private capturePass;
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
    private maskActive;
    constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: RenderPassManagerOptions);
    /**
     * Get the current sky provider. The single query point for "what sky is
     * active" — other subsystems that need it (e.g. `WaterSystem._step`'s
     * `followCamera` call) read through here rather than tracking their own
     * reference.
     */
    getCurrentSky(): SkyProvider | null;
    /**
     * Rebind every consumer this manager owns a reference to when the active
     * sky provider changes: the water material (reflection/fog/sun-disk
     * samplers baked into its shader graph), atmospheric fog, and the
     * capture pass's exclusion set. Called from {@link WaterSystem.setSky} —
     * the manager is the single owner of these references, so it is the
     * natural fan-out point instead of `WaterSystem` calling each consumer
     * by name.
     */
    setSky(sky: SkyProvider | null): void;
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
     * Run the scene capture: refraction colour + opaque scene depth always,
     * plus the transparent captures (depth + premultiplied colour) when
     * `includeTransparents` is true.
     *
     * @param includeTransparents - Run the transparent capture sub-passes.
     *   Only the underwater fog decomposition consumes them, so callers skip
     *   them when underwater is disabled.
     */
    renderCapturePass(renderer: THREE.WebGPURenderer, includeTransparents?: boolean): void;
    /**
     * Render the mask pass (for water masking)
     */
    renderMaskPass(renderer: THREE.WebGPURenderer): void;
    /** Include or omit mask sampling in the water material's shader graph. */
    setMaskActive(active: boolean): void;
    /**
     * Render the water depth pass.
     */
    renderWaterDepthPass(renderer: THREE.WebGPURenderer): void;
    /** Render the SSR water-reflection G-buffer (full-res reflectDir + viewZ). */
    renderSSRGBufferPass(renderer: THREE.WebGPURenderer): void;
    /** Render the SSR ray-march pass at the configured resolution scale. */
    renderSSRPass(renderer: THREE.WebGPURenderer): void;
    /**
     * Clear a stale SSR result once after SSR is disabled or its target is
     * recreated. Repeated calls are CPU-only no-ops until the pass renders again.
     */
    clearSSRPassIfNeeded(renderer: THREE.WebGPURenderer): void;
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
    /**
     * The normalized-linear scene-depth sampler over the capture pass's
     * hardware depth. Subsystems embed `sample(uv)` in their node graphs
     * once; target rebuilds and camera changes propagate automatically.
     */
    get sceneDepth(): SceneDepthSampler;
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
     * Dispose of resources
     */
    dispose(): void;
}
//# sourceMappingURL=RenderPassManager.d.ts.map
import * as THREE from "three/webgpu";
import type { IWaveSimulation } from "../../simulation/waves";
import type { RainRipples } from "../../simulation/ripples";
import type { IFoamFieldSampler } from "../../simulation/foam";
import type { SkyProvider } from "../sky/SkyProvider";
import type { Node, TSLUniformNode } from "../../types/tsl";
import type { IWakeFieldSampler } from "../../simulation/waves/wake";
import { SceneDepthSampler } from "../../rendering/passes/SceneDepthSampler";
import type { IWaterDepthPass } from "../../rendering/passes/IWaterDepthPass";
import { type QualityLevel, type QualityLevelConfig } from "../../config/QualityLevels";
import { WaterColor, Fresnel, SurfaceFoam, WaveFoam, ShorelineFoam, Sparkle, SSR, SSS, CascadeSampler, Waterline } from "../../shaders";
/**
 * Shared instances injected from WaterSystem so that the material's
 * shader graph binds to the same uniform nodes used by the compute simulation,
 * and shader class references remain stable across quality level changes.
 */
export interface SharedMaterialUniforms {
    maskEnabled: TSLUniformNode;
    sunDirection: TSLUniformNode;
    sunIntensity: TSLUniformNode;
    windDirection: TSLUniformNode;
    fresnel: Fresnel;
    rainRipples: RainRipples | null;
    shorelineFoam: ShorelineFoam;
    sparkle: Sparkle;
    ssr: SSR;
    sss: SSS;
    surfaceFoam: SurfaceFoam;
    waterColor: WaterColor;
    waterline: Waterline;
    waveFoam: WaveFoam;
    wakeFieldSampler: IWakeFieldSampler | null;
    foamFieldSampler: IFoamFieldSampler | null;
}
export declare class WaterSurfaceMaterial extends THREE.MeshBasicNodeMaterial {
    private oceanSim;
    private sky;
    private features;
    private cascadeCount;
    waterColor: WaterColor;
    fresnel: Fresnel;
    surfaceFoam: SurfaceFoam;
    waveFoam: WaveFoam;
    shorelineFoam: ShorelineFoam;
    sss: SSS;
    sparkle: Sparkle;
    ssr: SSR;
    /** CascadeSampler for WebGPU cascade buffer sampling. Null for WebGL. */
    cascadeSampler: CascadeSampler | null;
    /** Wake field sampler for wake displacement (both backends). Null if no wake field. */
    private _wakeFieldSampler;
    private maskEnabledUniform;
    sunDirectionUniform: TSLUniformNode;
    sunIntensityUniform: TSLUniformNode;
    timeUniform: THREE.UniformNode<number>;
    clipmapOffsetUniform: THREE.UniformNode<THREE.Vector2>;
    windDirectionUniform: TSLUniformNode;
    private sceneDepth;
    useDepthTextureUniform: THREE.UniformNode<number>;
    private _waterDepth;
    cameraSubmergedUniform: THREE.UniformNode<number>;
    clipPlaneDistanceUniform: THREE.UniformNode<number>;
    cameraForwardUniform: THREE.UniformNode<THREE.Vector3>;
    waterline: Waterline;
    private sceneColorTexture;
    useSceneColorTextureUniform: THREE.UniformNode<number>;
    private maskTexture;
    rainRipples: RainRipples | null;
    private _foamFieldSampler;
    constructor(oceanSim: IWaveSimulation, sharedUniforms: SharedMaterialUniforms, sky?: SkyProvider, quality?: QualityLevel | QualityLevelConfig["features"]);
    updateCascadeUniforms(): void;
    /**
     * Rebind to the wave simulation when its cascade config changes.
     * Uses the stored sim reference — the parameter is for interface
     * uniformity with other cascade subscribers.
     */
    onCascadeChanged(_sim: IWaveSimulation): void;
    setSky(sky: SkyProvider | null): void;
    /**
     * Bind the scene-depth sampler from the capture pass and rebuild the
     * shader graph. The sampler tracks target rebuilds and camera-plane
     * changes internally, so this is called once per material instance.
     */
    setSceneDepth(sceneDepth: SceneDepthSampler): void;
    setSceneColorTexture(sceneColorTex: THREE.Texture): void;
    /**
     * Bind the water-depth pass and rebuild the shader graph. The refraction
     * path samples it so the refracted water column is measured from the
     * surface depth along the sampled ray.
     */
    setWaterDepth(waterDepth: IWaterDepthPass): void;
    /**
     * Bind the SSR result texture and rebuild the fragment shader. Required
     * because `ssr.sample()` is called inside `setupMaterial`; if the result
     * texture is null at build time the call short-circuits and the texture
     * binding is never wired into the graph.
     */
    setSSRResultTexture(resultTex: THREE.Texture): void;
    /**
     * Bind the active mask texture, or remove masking from the shader graph.
     *
     * @param maskTex - Screen-space mask texture from MaskPass, or `null`.
     */
    setMaskTexture(maskTex: THREE.Texture | null): void;
    /**
     * Bind the wake field sampler from {@link WakeSystem}. Triggers a material
     * rebuild so the vertex shader graph includes the wake displacement read.
     * Re-call when the field is rebuilt (resolution change) to bind the new
     * sampler. Pass null to remove the wake contribution.
     *
     * @param sampler - Wake field sampler, or null.
     */
    setWakeFieldSampler(sampler: IWakeFieldSampler | null): void;
    /**
     * Bind the world-fixed foam field sampler. Triggers a material rebuild so the
     * fragment graph reads the new sampler. Re-call when the field is rebuilt
     * (resolution change). Pass null to remove persistent foam.
     *
     * @param sampler - Foam field sampler, or null.
     */
    setFoamFieldSampler(sampler: IFoamFieldSampler | null): void;
    private setupMaterial;
    /**
     * Get the current quality features configuration.
     */
    getFeatures(): QualityLevelConfig["features"];
    /**
     * Change the quality tier and rebuild the shader graph.
     * Feature flags no longer control shader compilation — all effects are always
     * compiled in and gated at runtime via `If()` guards on their `_enabled`
     * uniforms. Quality levels set runtime defaults for which effects are enabled.
     */
    setQuality(quality: QualityLevel | QualityLevelConfig["features"]): void;
    /** Distance from camera to the clip plane. */
    get clipPlaneDistance(): number;
    set clipPlaneDistance(value: number);
    /**
     * Update the camera forward direction uniform.
     * Call this each frame with the camera's current forward direction.
     */
    updateCameraForward(forward: THREE.Vector3): void;
    /** The vertex displacement node used by the water shader. */
    get waterPositionNode(): Node;
    /** The wave simulation backing this material. Used by the SSR G-buffer pass. */
    get waveSimulation(): IWaveSimulation;
}
//# sourceMappingURL=WaterSurfaceMaterial.d.ts.map
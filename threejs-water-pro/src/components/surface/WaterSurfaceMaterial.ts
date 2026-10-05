// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { IWaveSimulation } from "../../simulation/waves";
import type { RainRipples } from "../../simulation/ripples";
import type { IFoamFieldSampler } from "../../simulation/foam";
import type { SkyProvider } from "../sky/SkyProvider";
import type { SurfaceUniforms } from "../../uniforms";
import type { Node, TSLUniformNode } from "../../types/tsl";
import type { IWakeFieldSampler } from "../../simulation/waves/wake";
import { SceneDepthSampler } from "../../rendering/passes/SceneDepthSampler";
import type { IWaterDepthPass } from "../../rendering/passes/IWaterDepthPass";
import {
  type QualityLevel,
  type QualityLevelConfig,
  getQualityFeatures,
} from "../../config/QualityLevels";
import {
  buildWaterVertexDisplacement,
  buildWaterFragmentColor,
  WaterColor,
  Fresnel,
  SurfaceFoam,
  WaveFoam,
  ShorelineFoam,
  Sparkle,
  SSR,
  SSS,
  CascadeSampler,
  Waterline,
} from "../../shaders";

/**
 * Shared instances injected from WaterSystem so that the material's
 * shader graph binds to the same uniform nodes used by the compute simulation,
 * and shader class references remain stable across quality level changes.
 */
export interface SharedMaterialUniforms {
  // Uniform nodes (single source of truth shared with compute simulation)
  maskEnabled: TSLUniformNode;
  sunDirection: TSLUniformNode;
  sunIntensity: TSLUniformNode;
  windDirection: TSLUniformNode;

  // Shader class instances (owned by WaterSystem, stable across quality changes)
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

  // Wake displacement sampler (owned by WakeSystem). Carried here so a
  // quality-rebuilt material re-binds the wake automatically, like the shader
  // instances above. Null on backends/configs without a wake field.
  wakeFieldSampler: IWakeFieldSampler | null;

  // Persistent wave-crest foam-energy sampler (owned by WaterSystem). Carried
  // here so a quality-rebuilt material re-binds it automatically. Null on
  // quality tiers where persistent foam is off.
  foamFieldSampler: IFoamFieldSampler | null;
}

export class WaterSurfaceMaterial extends THREE.MeshBasicNodeMaterial {
  private oceanSim: IWaveSimulation;
  private sky: SkyProvider | null = null;

  // Quality tier features - determines which shader nodes are included
  private features: QualityLevelConfig["features"];

  // Number of active cascades (1-3) - determines shader code paths
  private cascadeCount: 1 | 2 | 3;

  // ============= Shader Class Instances =============
  // All injected from WaterSystem via SharedMaterialUniforms.
  // WaterSystem owns these — they survive quality level changes.
  public waterColor: WaterColor;
  public fresnel: Fresnel;
  public surfaceFoam: SurfaceFoam;
  public waveFoam: WaveFoam;
  public shorelineFoam: ShorelineFoam;
  public sss: SSS;
  public sparkle: Sparkle;
  public ssr: SSR;

  // ============= Infrastructure =============
  /** CascadeSampler for WebGPU cascade buffer sampling. Null for WebGL. */
  public cascadeSampler: CascadeSampler | null = null;
  /** Wake field sampler for wake displacement (both backends). Null if no wake field. */
  private _wakeFieldSampler: IWakeFieldSampler | null = null;
  private maskEnabledUniform: TSLUniformNode;

  // ============= Standalone Uniforms =============
  // These are shared with WaterSystem's uniform groups (single source of truth).
  // They are injected via the constructor so that the shader graph and the
  // compute simulation bind to the same nodes — no per-frame sync needed.
  public sunDirectionUniform: TSLUniformNode;
  public sunIntensityUniform: TSLUniformNode;
  public timeUniform = uniform(0.0);
  public clipmapOffsetUniform = uniform(new THREE.Vector2(0, 0));
  public windDirectionUniform: TSLUniformNode;

  // Scene depth sampler for per-pixel water depth calculation
  private sceneDepth: SceneDepthSampler;
  public useDepthTextureUniform = uniform(0.0); // 0 = fallback mode, 1 = use depth texture

  // Water-surface depth source for the refracted-column measurement.
  // Null until RenderPassManager binds it.
  private _waterDepth: IWaterDepthPass | null = null;

  // 1.0 when the camera is below the water surface, 0.0 above. Written each
  // frame by UnderwaterStateController; drives the front/back-face split.
  public cameraSubmergedUniform = uniform(0.0);

  // Clip plane uniforms for partial submersion effect
  public clipPlaneDistanceUniform = uniform(0.5); // Distance from camera (m)
  public cameraForwardUniform = uniform(new THREE.Vector3(0, 0, -1)); // Camera forward direction

  // Waterline meniscus (injected via SharedMaterialUniforms)
  public waterline: Waterline;

  // Scene color texture for screen-space refraction (underwater viewing of above-water objects)
  private sceneColorTexture: THREE.Texture;
  public useSceneColorTextureUniform = uniform(0.0); // 0 = sky only, 1 = use scene texture

  // Mask texture enters the shader graph only while masking is active.
  private maskTexture: THREE.Texture | null = null;

  // Rain ripple simulation (optional - only set when rain is enabled)
  public rainRipples: RainRipples | null = null;

  // Persistent wave-crest foam-energy sampler (optional — quality gated). Read
  // by the fragment graph as the wave-crest foam energy source.
  private _foamFieldSampler: IFoamFieldSampler | null = null;

  constructor(
    oceanSim: IWaveSimulation,
    sharedUniforms: SharedMaterialUniforms,
    sky?: SkyProvider,
    quality: QualityLevel | QualityLevelConfig["features"] = "high",
  ) {
    super();

    this.oceanSim = oceanSim;
    this.features = getQualityFeatures(quality);

    // Wire shared uniform nodes and shader classes — single source of truth
    this.maskEnabledUniform = sharedUniforms.maskEnabled;
    this.windDirectionUniform = sharedUniforms.windDirection;
    this.sunDirectionUniform = sharedUniforms.sunDirection;
    this.sunIntensityUniform = sharedUniforms.sunIntensity;
    this.fresnel = sharedUniforms.fresnel;
    this.shorelineFoam = sharedUniforms.shorelineFoam;
    this.sparkle = sharedUniforms.sparkle;
    this.ssr = sharedUniforms.ssr;
    this.sss = sharedUniforms.sss;
    this.surfaceFoam = sharedUniforms.surfaceFoam;
    this.rainRipples = sharedUniforms.rainRipples;
    this._foamFieldSampler = sharedUniforms.foamFieldSampler;
    this.waterColor = sharedUniforms.waterColor;
    this.waterline = sharedUniforms.waterline;
    this.waveFoam = sharedUniforms.waveFoam;
    this._wakeFieldSampler = sharedUniforms.wakeFieldSampler;

    // Defensive check - should never happen after getQualityFeatures validation, but log if it does
    if (!this.features) {
      console.error(
        "WaterMaterial: features is undefined after getQualityFeatures, this should not happen",
      );
      this.features = getQualityFeatures("high");
    }

    // Determine cascade count and create CascadeSampler for WebGPU
    const capabilities = this.oceanSim.getCapabilities();
    if (capabilities.backend === "webgpu" && capabilities.cascadeCount >= 1) {
      this.cascadeCount = Math.min(
        3,
        Math.max(1, capabilities.cascadeCount),
      ) as 1 | 2 | 3;
      this.cascadeSampler = new CascadeSampler(this.cascadeCount);
    } else {
      // WebGL fallback - no cascade sampling
      this.cascadeCount = 1;
      this.cascadeSampler = null;
    }

    // Placeholder scene-depth sampler so the node graph compiles before the
    // render passes exist. Never meaningfully sampled: `useDepthTexture`
    // stays 0 (fallback water depth) until setSceneDepth binds the real
    // sampler from SceneCapturePass.
    this.sceneDepth = new SceneDepthSampler(new THREE.DepthTexture(1, 1));

    // Create a default scene color texture (black) as fallback
    // This will be replaced when setSceneColorTexture is called
    const defaultSceneData = new Float32Array([0, 0, 0, 1]); // RGBA black
    this.sceneColorTexture = new THREE.DataTexture(
      defaultSceneData,
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );

    this.updateCascadeUniforms();

    if (sky) {
      this.sky = sky;
    }

    this.setupMaterial();
  }

  public updateCascadeUniforms(): void {
    // WebGL samples cascades via texture lookups, not the CascadeSampler
    if (!this.cascadeSampler) {
      return;
    }

    // Cast to access cascade methods (WebGPU-specific)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gpuSim = this.oceanSim as any;
    const resolutions = gpuSim.getCascadeResolutions() as number[];
    const scales = gpuSim.getCascadeScales() as number[];
    const count = gpuSim.getCascadeCount() as number;

    // Update active cascades with their actual values
    for (let i = 0; i < count; i++) {
      this.cascadeSampler.updateCascade(i, resolutions[i], scales[i]);
    }
  }

  /**
   * Rebind to the wave simulation when its cascade config changes.
   * Uses the stored sim reference — the parameter is for interface
   * uniformity with other cascade subscribers.
   */
  public onCascadeChanged(_sim: IWaveSimulation): void {
    this.updateCascadeUniforms();
  }

  public setSky(sky: SkyProvider | null) {
    this.sky = sky;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  /**
   * Bind the scene-depth sampler from the capture pass and rebuild the
   * shader graph. The sampler tracks target rebuilds and camera-plane
   * changes internally, so this is called once per material instance.
   */
  public setSceneDepth(sceneDepth: SceneDepthSampler) {
    this.sceneDepth = sceneDepth;
    this.useDepthTextureUniform.value = 1.0;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  public setSceneColorTexture(sceneColorTex: THREE.Texture) {
    this.sceneColorTexture = sceneColorTex;
    this.useSceneColorTextureUniform.value = 1.0;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  /**
   * Bind the water-depth pass and rebuild the shader graph. The refraction
   * path samples it so the refracted water column is measured from the
   * surface depth along the sampled ray.
   */
  public setWaterDepth(waterDepth: IWaterDepthPass) {
    this._waterDepth = waterDepth;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  /**
   * Bind the SSR result texture and rebuild the fragment shader. Required
   * because `ssr.sample()` is called inside `setupMaterial`; if the result
   * texture is null at build time the call short-circuits and the texture
   * binding is never wired into the graph.
   */
  public setSSRResultTexture(resultTex: THREE.Texture) {
    this.ssr.setResultTexture(resultTex);
    this.setupMaterial();
    this.needsUpdate = true;
  }

  /**
   * Bind the active mask texture, or remove masking from the shader graph.
   *
   * @param maskTex - Screen-space mask texture from MaskPass, or `null`.
   */
  public setMaskTexture(maskTex: THREE.Texture | null) {
    if (this.maskTexture === maskTex) return;
    this.maskTexture = maskTex;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  /**
   * Bind the wake field sampler from {@link WakeSystem}. Triggers a material
   * rebuild so the vertex shader graph includes the wake displacement read.
   * Re-call when the field is rebuilt (resolution change) to bind the new
   * sampler. Pass null to remove the wake contribution.
   *
   * @param sampler - Wake field sampler, or null.
   */
  public setWakeFieldSampler(sampler: IWakeFieldSampler | null) {
    this._wakeFieldSampler = sampler;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  /**
   * Bind the world-fixed foam field sampler. Triggers a material rebuild so the
   * fragment graph reads the new sampler. Re-call when the field is rebuilt
   * (resolution change). Pass null to remove persistent foam.
   *
   * @param sampler - Foam field sampler, or null.
   */
  public setFoamFieldSampler(sampler: IFoamFieldSampler | null) {
    this._foamFieldSampler = sampler;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  private setupMaterial() {
    // Material properties
    this.transparent = true;

    // Premultiplied-alpha blend factors. The fragment shader emits the
    // Fresnel-weighted radiance directly (already in premultiplied form);
    // CustomBlending bypasses three's automatic `premultiplyAlpha()` step
    // (which would multiply the RGB by alpha a second time when
    // `material.premultipliedAlpha = true` is used).
    //
    //   dst = src * 1 + dst * (1 - srcAlpha)
    this.blending = THREE.CustomBlending;
    this.blendSrc = THREE.OneFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendEquation = THREE.AddEquation;

    this.side = THREE.DoubleSide;
    this.depthWrite = true;

    // `polygonOffsetFactor` becomes WebGPU's `depthBiasSlopeScale`, which
    // scales with the polygon's depth slope. The surface is edge-on at the
    // horizon where that slope diverges, so only the constant
    // `polygonOffsetUnits` bias is usable here.
    this.polygonOffset = true;
    this.polygonOffsetFactor = 0;
    this.polygonOffsetUnits = 1;

    // Assemble the slimmed-down uber-uniform (only infrastructure remains)
    const uniforms: SurfaceUniforms = {
      cameraSubmerged: this.cameraSubmergedUniform,
      clipPlane: {
        cameraForward: this.cameraForwardUniform,
        distance: this.clipPlaneDistanceUniform,
        ...this.waterline.uniforms,
      },
      maskEnabled: this.maskEnabledUniform,
      sun: {
        direction: this.sunDirectionUniform,
        intensity: this.sunIntensityUniform,
      },
      useDepthTexture: this.useDepthTextureUniform,
      useSceneColorTexture: this.useSceneColorTextureUniform,
      windDirection: this.windDirectionUniform,
    };

    // Build vertex displacement and get varyings
    const vertex = buildWaterVertexDisplacement({
      clipmapOffset: this.clipmapOffsetUniform,
      oceanSim: this.oceanSim,
      cascadeSampler: this.cascadeSampler,
      wakeFieldSampler: this._wakeFieldSampler,
    });

    this.positionNode = vertex.positionNode;

    // Build fragment color shader graph
    this.colorNode = buildWaterFragmentColor({
      uniforms,
      vertex,
      oceanSim: this.oceanSim,
      textures: {
        mask: this.maskTexture ?? undefined,
        sceneColor: this.sceneColorTexture,
        sceneDepth: this.sceneDepth,
      },
      waterColor: this.waterColor,
      fresnel: this.fresnel,
      surfaceFoam: this.surfaceFoam,
      waveFoam: this.waveFoam,
      shorelineFoam: this.shorelineFoam,
      sparkle: this.sparkle,
      ssr: this.ssr,
      sss: this.sss,
      sky: this.sky,
      cascadeSampler: this.cascadeSampler,
      foamFieldSampler: this._foamFieldSampler,
      rainRipples: this.rainRipples,
      wakeFieldSampler: this._wakeFieldSampler,
      waterDepth: this._waterDepth,
      isWebGL: this.oceanSim.getCapabilities().backend === "webgl",
    });
  }

  /**
   * Get the current quality features configuration.
   */
  public getFeatures(): QualityLevelConfig["features"] {
    return this.features;
  }

  /**
   * Change the quality tier and rebuild the shader graph.
   * Feature flags no longer control shader compilation — all effects are always
   * compiled in and gated at runtime via `If()` guards on their `_enabled`
   * uniforms. Quality levels set runtime defaults for which effects are enabled.
   */
  public setQuality(
    quality: QualityLevel | QualityLevelConfig["features"],
  ): void {
    const newFeatures = getQualityFeatures(quality);

    // Skip rebuild if features haven't changed
    if (this.features === newFeatures) {
      return;
    }

    this.features = newFeatures;
    this.setupMaterial();
    this.needsUpdate = true; // Force shader recompilation with new feature set
  }

  // ============= Clip Plane API =============

  /** Distance from camera to the clip plane. */
  get clipPlaneDistance(): number {
    return this.clipPlaneDistanceUniform.value;
  }
  set clipPlaneDistance(value: number) {
    this.clipPlaneDistanceUniform.value = value;
  }

  /**
   * Update the camera forward direction uniform.
   * Call this each frame with the camera's current forward direction.
   */
  public updateCameraForward(forward: THREE.Vector3): void {
    this.cameraForwardUniform.value.copy(forward);
  }

  /** The vertex displacement node used by the water shader. */
  get waterPositionNode(): Node {
    return this.positionNode!;
  }

  /** The wave simulation backing this material. Used by the SSR G-buffer pass. */
  get waveSimulation(): IWaveSimulation {
    return this.oceanSim;
  }
}

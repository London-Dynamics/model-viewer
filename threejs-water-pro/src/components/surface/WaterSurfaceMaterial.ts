import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { IWaveSimulation } from "../../simulation/waves";
import type { RainRipples } from "../../simulation/ripples";
import type { FoamAccumulation } from "../../simulation/foam/FoamAccumulation";
import type { Sky } from "../sky/Sky";
import type { SurfaceUniforms } from "../../uniforms";
import type { Node, TSLUniformNode } from "../../types/tsl";
import type { IWakeFieldSampler } from "../../simulation/waves/wake";
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
  foamAccumulation: FoamAccumulation | null;
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
}

export class WaterSurfaceMaterial extends THREE.MeshBasicNodeMaterial {
  private oceanSim: IWaveSimulation;
  private sky: Sky | null = null;

  // Quality tier features - determines which shader nodes are included
  private features: QualityLevelConfig["features"];

  // Number of active cascades (1 or 2) - determines shader code paths
  private cascadeCount: 1 | 2;

  // Gerstner wave compile-time max (0 = disabled, determines shader loop bounds)
  private gerstnerMaxWaves: number = 0;

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

  // Depth texture uniforms for per-pixel water depth calculation
  private depthTexture: THREE.Texture;
  public cameraNearUniform = uniform(0.1);
  public cameraFarUniform = uniform(50000.0);
  public useDepthTextureUniform = uniform(0.0); // 0 = fallback mode, 1 = use depth texture

  // 1.0 when the camera is below the water surface, 0.0 above. Written each
  // frame by UnderwaterStateController; drives the front/back-face split.
  public cameraSubmergedUniform = uniform(0.0);

  // Clip plane uniforms for partial submersion effect
  public clipPlaneDistanceUniform = uniform(20.0); // Distance from camera
  public cameraForwardUniform = uniform(new THREE.Vector3(0, 0, -1)); // Camera forward direction

  // Waterline meniscus (injected via SharedMaterialUniforms)
  public waterline: Waterline;

  // Scene color texture for screen-space refraction (underwater viewing of above-water objects)
  private sceneColorTexture: THREE.Texture;
  public useSceneColorTextureUniform = uniform(0.0); // 0 = sky only, 1 = use scene texture

  // Mask texture for hiding water in specific areas (e.g., inside boat hulls)
  private maskTexture: THREE.Texture;

  // Rain ripple simulation (optional - only set when rain is enabled)
  public rainRipples: RainRipples | null = null;

  // Persistent wave-crest foam accumulation (optional — WebGPU + quality gated).
  public foamAccumulation: FoamAccumulation | null = null;

  constructor(
    oceanSim: IWaveSimulation,
    sharedUniforms: SharedMaterialUniforms,
    sky?: Sky,
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
    this.foamAccumulation = sharedUniforms.foamAccumulation;
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
        2,
        Math.max(1, capabilities.cascadeCount),
      ) as 1 | 2;
      this.cascadeSampler = new CascadeSampler(this.cascadeCount);
    } else {
      // WebGL fallback - no cascade sampling
      this.cascadeCount = 1;
      this.cascadeSampler = null;
    }

    // Gerstner waves work on both backends (uniformArray-based)
    this.gerstnerMaxWaves = this.oceanSim.getGerstnerMaxWaves();

    // Create a default depth texture (white = max depth / far plane) as fallback
    // This will be replaced when setDepthTexture is called
    const defaultDepthData = new Float32Array([1, 1, 1, 1]); // RGBA white = max depth
    this.depthTexture = new THREE.DataTexture(
      defaultDepthData,
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );

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

    // Create a default mask texture (black = no mask) as fallback
    // This will be replaced when setMaskTexture is called
    const defaultMaskData = new Float32Array([0, 0, 0, 1]); // RGBA black = no mask
    this.maskTexture = new THREE.DataTexture(
      defaultMaskData,
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

  public setSky(sky: Sky) {
    this.sky = sky;
    this.setupMaterial();
    this.needsUpdate = true;
  }

  public setDepthTexture(depthTex: THREE.Texture, near: number, far: number) {
    this.depthTexture = depthTex;
    this.cameraNearUniform.value = near;
    this.cameraFarUniform.value = far;
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
   * Set the mask texture for hiding water in specific areas.
   * @param maskTex - Screen-space mask texture from MaskPass
   */
  public setMaskTexture(maskTex: THREE.Texture) {
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
    this.polygonOffset = true;
    this.polygonOffsetFactor = 1;
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
      gerstnerMaxWaves: this.gerstnerMaxWaves,
      wakeFieldSampler: this._wakeFieldSampler,
    });

    this.positionNode = vertex.positionNode;

    // Build fragment color shader graph
    this.colorNode = buildWaterFragmentColor({
      uniforms,
      vertex,
      oceanSim: this.oceanSim,
      textures: {
        depth: this.depthTexture,
        mask: this.maskTexture,
        sceneColor: this.sceneColorTexture,
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
      jacobianFoam: this.features.jacobianFoam,
      cascadeSampler: this.cascadeSampler,
      foamAccumulation: this.foamAccumulation,
      gerstnerMaxWaves: this.gerstnerMaxWaves,
      rainRipples: this.rainRipples,
      wakeFieldSampler: this._wakeFieldSampler,
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

  /** Compile-time max Gerstner wave count. Used by the SSR G-buffer pass. */
  get gerstnerWaveCount(): number {
    return this.gerstnerMaxWaves;
  }
}

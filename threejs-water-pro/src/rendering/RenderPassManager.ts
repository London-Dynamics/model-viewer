/**
 * RenderPassManager handles depth and color pass lifecycle for the water system.
 * Manages texture creation, resize handling, and material texture binding.
 */

import * as THREE from "three/webgpu";
import { SceneDepthPass } from "./passes/SceneDepthPass";
import { SceneColorPass } from "./passes/SceneColorPass";
import { MaskPass } from "./passes/MaskPass";
import type { IWaterDepthPass } from "./passes/IWaterDepthPass";
import { WebGPUWaterDepthPass } from "./passes/WebGPUWaterDepthPass";
import { WebGLWaterDepthPass } from "./passes/WebGLWaterDepthPass";
import { WaterReflectionGBufferPass } from "./passes/WaterReflectionGBufferPass";
import { SSRPass } from "./passes/SSRPass";
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

export class RenderPassManager {
  private renderer: THREE.WebGPURenderer;
  private depthPass: SceneDepthPass;
  private sceneColorPass: SceneColorPass;
  private maskPass: MaskPass;
  private waterDepthPass: IWaterDepthPass;
  private gBufferPass: WaterReflectionGBufferPass;
  private ssrPass: SSRPass;
  private clipmap: WaterSurfaceGeometry;
  private waterMaterial: WaterSurfaceMaterial;
  private spray: SpraySystem | null;
  private underwater: Underwater | null;
  private atmosphericFogPass: AtmosphericFog | null;
  private currentSky: Sky | null = null;
  // Meshes excluded on behalf of the active sky provider — tracked so
  // removal is exact even when getMeshes() returns different arrays over time.
  private skyExcludedMeshes: Set<THREE.Object3D> = new Set();

  constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    options: RenderPassManagerOptions,
  ) {
    const {
      clipmap,
      waterMaterial,
      spray = null,
      sky = null,
      underwater = null,
      atmosphericFog = null,
      excludedObjects = [],
      sceneColorResolutionScale = 1,
      isWebGL,
    } = options;

    this.renderer = renderer;
    this.clipmap = clipmap;
    this.waterMaterial = waterMaterial;
    this.spray = spray;
    this.underwater = underwater;
    this.atmosphericFogPass = atmosphericFog;

    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    const width = size.x;
    const height = size.y;

    this.depthPass = new SceneDepthPass(scene, camera, width, height);
    // Exclude water from depth pass so shoreline effects compare against scene depth
    this.depthPass.excludeObject(clipmap.getObject());

    for (const obj of excludedObjects) {
      this.depthPass.excludeObject(obj);
    }

    waterMaterial.setDepthTexture(
      this.depthPass.getDepthTexture(),
      this.depthPass.getCameraNear(),
      this.depthPass.getCameraFar(),
    );

    this.sceneColorPass = new SceneColorPass(
      scene,
      camera,
      width,
      height,
      sceneColorResolutionScale,
    );
    this.sceneColorPass.excludeObject(clipmap.getObject());
    for (const obj of excludedObjects) {
      this.sceneColorPass.excludeObject(obj);
    }
    waterMaterial.setSceneColorTexture(this.sceneColorPass.getColorTexture());

    if (sky) {
      this.applySkyExclusions(sky);
    }

    this.maskPass = new MaskPass(scene, camera, width, height);
    waterMaterial.setMaskTexture(this.maskPass.getMaskTexture());
    this.spray?.setMaskTexture(this.maskPass.getMaskTexture());

    // Depth sampling for underwater detection and column-thickness
    // calculation. WebGPU: single MIN-blending draw. WebGL: four draws.
    this.waterDepthPass = isWebGL
      ? new WebGLWaterDepthPass(
          camera,
          width,
          height,
          waterMaterial.clipPlaneDistanceUniform,
        )
      : new WebGPUWaterDepthPass(
          camera,
          width,
          height,
          waterMaterial.clipPlaneDistanceUniform,
        );
    this.waterDepthPass.setWaterObject(clipmap.getObject());
    this.waterDepthPass.setPositionNode(waterMaterial.waterPositionNode);

    // SSR water-reflection G-buffer (full-res) and SSR ray-march (scaled).
    // The G-buffer pass renders the water mesh with the same vertex
    // displacement and surface-normal pipeline as the main material so
    // `reflectDir` matches; only the march resolution scales.
    this.gBufferPass = new WaterReflectionGBufferPass(camera, width, height, {
      cascadeSampler: waterMaterial.cascadeSampler,
      clipmapOffset: waterMaterial.clipmapOffsetUniform,
      fresnel: waterMaterial.fresnel,
      gerstnerMaxWaves: waterMaterial.gerstnerWaveCount,
      oceanSim: waterMaterial.waveSimulation,
      rainRipples: waterMaterial.rainRipples,
    });
    this.gBufferPass.setWaterObject(clipmap.getObject());

    this.ssrPass = new SSRPass(
      width,
      height,
      waterMaterial.ssr,
      camera,
      this.depthPass.getDepthTexture(),
      this.sceneColorPass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
    waterMaterial.setSSRResultTexture(this.ssrPass.getTexture());

    if (underwater) {
      underwater.setWaterDepthPass(this.waterDepthPass);
      underwater.setSceneDepthTexture(this.depthPass.getDepthTexture());
      underwater.setTransparentColorTexture(
        this.depthPass.getTransparentColorTexture(),
      );
      underwater.setTransparentDepthTexture(
        this.depthPass.getTransparentDepthTexture(),
      );
      underwater.setDepthUniforms(
        this.depthPass.getCameraNear(),
        this.depthPass.getCameraFar(),
      );
    }

    if (atmosphericFog) {
      atmosphericFog.setTransparentDepthTexture(
        this.depthPass.getTransparentDepthTexture(),
      );
      atmosphericFog.setTransparentColorTexture(
        this.depthPass.getTransparentColorTexture(),
      );
    }
    if (atmosphericFog && sky) {
      atmosphericFog.setSky(sky);
    }
  }

  /**
   * Get the current sky provider.
   */
  getCurrentSky(): Sky | null {
    return this.currentSky;
  }

  /**
   * Update the sky provider used for aux-pass exclusion and atmospheric fog.
   * All backdrop meshes (and their Mesh descendants) returned by
   * {@link Sky.getMeshes} are excluded from both the depth pass and
   * the scene-color pass, so sky geometry can never contaminate refraction
   * sampling or transparent-depth decomposition.
   */
  setSky(sky: Sky | null): void {
    this.clearSkyExclusions();
    if (sky) {
      this.applySkyExclusions(sky);
    } else {
      this.currentSky = null;
    }
    if (this.atmosphericFogPass) {
      this.atmosphericFogPass.setSky(sky);
    }
  }

  /**
   * Register every mesh descendant of each object returned by
   * {@link Sky.getMeshes} with the depth and scene-color passes so
   * the sky disappears from both.
   */
  private applySkyExclusions(sky: Sky): void {
    this.currentSky = sky;
    for (const root of sky.getMeshes()) {
      root.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          this.skyExcludedMeshes.add(obj);
          this.depthPass.excludeObject(obj);
          this.sceneColorPass.excludeObject(obj);
        }
      });
    }
  }

  /** Undo every exclusion added by {@link applySkyExclusions}. */
  private clearSkyExclusions(): void {
    for (const obj of this.skyExcludedMeshes) {
      this.depthPass.includeObject(obj);
      this.sceneColorPass.includeObject(obj);
    }
    this.skyExcludedMeshes.clear();
  }

  /**
   * Swap the water material and clipmap in place without recreating any
   * passes or render targets. Used by {@link WaterSystem.setQualityLevel}
   * so that sky, mask objects, and excluded objects all
   * survive a quality change automatically.
   *
   * Render-target sizes track the drawing buffer (not quality), so resizes
   * still flow through {@link resize}.
   */
  rebind(options: RenderPassManagerRebindOptions): void {
    const { clipmap, waterMaterial, sceneColorResolutionScale } = options;

    // Swap the clipmap exclusion so the old (disposed) mesh is not retained.
    const prevClipmapObject = this.clipmap.getObject();
    this.depthPass.includeObject(prevClipmapObject);
    this.sceneColorPass.includeObject(prevClipmapObject);

    this.clipmap = clipmap;
    this.waterMaterial = waterMaterial;

    const newClipmapObject = clipmap.getObject();
    this.depthPass.excludeObject(newClipmapObject);
    this.sceneColorPass.excludeObject(newClipmapObject);

    // Point WaterDepthPass at the new water geometry and uniforms. The
    // clip-plane uniform is recreated with each material, so the colorNode
    // must be rebuilt to read from the new reference.
    this.waterDepthPass.setWaterObject(newClipmapObject);
    this.waterDepthPass.setPositionNode(waterMaterial.waterPositionNode);
    this.waterDepthPass.setClipDistanceUniform(
      waterMaterial.clipPlaneDistanceUniform,
    );

    // Rebuild the SSR G-buffer pass shader graph with the new material's
    // cascade sampler, gerstner config, fresnel, etc. The result texture is
    // then re-bound on the new material's SSR class.
    this.gBufferPass.setWaterObject(newClipmapObject);
    this.gBufferPass.rebuild({
      cascadeSampler: waterMaterial.cascadeSampler,
      clipmapOffset: waterMaterial.clipmapOffsetUniform,
      fresnel: waterMaterial.fresnel,
      gerstnerMaxWaves: waterMaterial.gerstnerWaveCount,
      oceanSim: waterMaterial.waveSimulation,
      rainRipples: waterMaterial.rainRipples,
    });
    this.ssrPass.setInputTextures(
      this.depthPass.getDepthTexture(),
      this.sceneColorPass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
    waterMaterial.setSSRResultTexture(this.ssrPass.getTexture());

    // Rebind existing pass textures onto the new material.
    waterMaterial.setDepthTexture(
      this.depthPass.getDepthTexture(),
      this.depthPass.getCameraNear(),
      this.depthPass.getCameraFar(),
    );
    waterMaterial.setSceneColorTexture(this.sceneColorPass.getColorTexture());
    waterMaterial.setMaskTexture(this.maskPass.getMaskTexture());

    if (this.currentSky) {
      waterMaterial.setSky(this.currentSky);
    }

    if (sceneColorResolutionScale !== undefined) {
      this.setSceneColorResolutionScale(sceneColorResolutionScale);
    }
  }

  /**
   * Update the camera used by all render passes.
   */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.depthPass.setCamera(camera);
    this.sceneColorPass.setCamera(camera);
    this.maskPass.setCamera(camera);
    this.waterDepthPass.setCamera(camera);
    this.gBufferPass.setCamera(camera);
    this.ssrPass.setCamera(camera);

    // Sync underwater depth uniforms with new camera's near/far
    if (this.underwater) {
      this.underwater.setDepthUniforms(
        this.depthPass.getCameraNear(),
        this.depthPass.getCameraFar(),
      );
    }
  }

  /**
   * Handle resize - recreates render targets at the renderer's current drawing buffer size
   * and rebinds textures to materials.
   */
  resize(): void {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);

    this.depthPass.setSize(size.x, size.y);
    this.sceneColorPass.setSize(size.x, size.y);
    this.maskPass.setSize(size.x, size.y);
    this.waterDepthPass.setSize(size.x, size.y);
    this.gBufferPass.setSize(size.x, size.y);
    this.ssrPass.setSize(size.x, size.y);
    // Re-bind input textures (depth/sceneColor/gBuffer all rebuilt above) and
    // the SSR result texture used by the water material.
    this.ssrPass.setInputTextures(
      this.depthPass.getDepthTexture(),
      this.sceneColorPass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
    this.waterMaterial.setSSRResultTexture(this.ssrPass.getTexture());

    this.waterMaterial.setDepthTexture(
      this.depthPass.getDepthTexture(),
      this.depthPass.getCameraNear(),
      this.depthPass.getCameraFar(),
    );
    this.waterMaterial.setSceneColorTexture(
      this.sceneColorPass.getColorTexture(),
    );
    this.waterMaterial.setMaskTexture(this.maskPass.getMaskTexture());
    this.spray?.setMaskTexture(this.maskPass.getMaskTexture());

    if (this.underwater) {
      // `setWaterDepthPass` was wired at construction; resize swaps
      // textures inside WaterDepthPass and Underwater's sample nodes
      // pick up the new `.value` automatically. Only the non-depth-pass
      // textures need re-binding here.
      this.underwater.setSceneDepthTexture(this.depthPass.getDepthTexture());
      this.underwater.setTransparentColorTexture(
        this.depthPass.getTransparentColorTexture(),
      );
      this.underwater.setTransparentDepthTexture(
        this.depthPass.getTransparentDepthTexture(),
      );
      this.underwater.setDepthUniforms(
        this.depthPass.getCameraNear(),
        this.depthPass.getCameraFar(),
      );
    }
    if (this.atmosphericFogPass) {
      this.atmosphericFogPass.setTransparentDepthTexture(
        this.depthPass.getTransparentDepthTexture(),
      );
      this.atmosphericFogPass.setTransparentColorTexture(
        this.depthPass.getTransparentColorTexture(),
      );
    }
  }

  /**
   * Render the depth pass
   */
  renderDepthPass(renderer: THREE.WebGPURenderer): void {
    this.depthPass.render(renderer);
  }

  /**
   * Render the scene color pass (for underwater refraction)
   */
  renderSceneColorPass(renderer: THREE.WebGPURenderer): void {
    this.sceneColorPass.render(renderer);
  }

  /**
   * Render the mask pass (for water masking)
   */
  renderMaskPass(renderer: THREE.WebGPURenderer): void {
    this.maskPass.render(renderer);
  }

  /**
   * Render the water depth pass.
   */
  renderWaterDepthPass(renderer: THREE.WebGPURenderer): void {
    this.waterDepthPass.render(renderer);
  }

  /** Render the SSR water-reflection G-buffer (full-res reflectDir + viewZ). */
  renderSSRGBufferPass(renderer: THREE.WebGPURenderer): void {
    this.gBufferPass.render(renderer);
  }

  /** Render the SSR ray-march pass at the configured resolution scale. */
  renderSSRPass(renderer: THREE.WebGPURenderer): void {
    this.ssrPass.render(renderer);
  }

  /**
   * Add an object to render as a water mask.
   * Water will be hidden where this object is visible.
   */
  addMaskObject(object: THREE.Object3D): void {
    this.maskPass.addMaskObject(object);
  }

  /**
   * Remove an object from mask rendering.
   */
  removeMaskObject(object: THREE.Object3D): void {
    this.maskPass.removeMaskObject(object);
  }

  /**
   * Check if an object is registered as a mask.
   */
  hasMaskObject(object: THREE.Object3D): boolean {
    return this.maskPass.hasMaskObject(object);
  }

  /**
   * Get the number of registered mask objects.
   */
  getMaskObjectCount(): number {
    return this.maskPass.getMaskObjectCount();
  }

  /**
   * Get all registered mask objects.
   */
  getMaskObjects(): ReadonlySet<THREE.Object3D> {
    return this.maskPass.getMaskObjects();
  }

  /** Get the scene depth texture. */
  get sceneDepthTexture(): THREE.Texture {
    return this.depthPass.getDepthTexture();
  }

  /**
   * The water-depth source. Subsystems that need clipped or unclipped
   * water-mesh depth samples route through its `sampleX(uv)` builders so
   * the WebGPU/WebGL backend split stays opaque to them.
   */
  get waterDepth(): IWaterDepthPass {
    return this.waterDepthPass;
  }

  /** Get camera near plane distance. */
  get cameraNear(): number {
    return this.depthPass.getCameraNear();
  }

  /** Get camera far plane distance. */
  get cameraFar(): number {
    return this.depthPass.getCameraFar();
  }

  /**
   * Update the scene color pass resolution scale and rebuild its render target.
   */
  setSceneColorResolutionScale(scale: number): void {
    this.sceneColorPass.setResolutionScale(scale);
    this.waterMaterial.setSceneColorTexture(
      this.sceneColorPass.getColorTexture(),
    );
    // SSR samples sceneColor for hit lookup, so rebind on the SSR pass too.
    this.ssrPass.setInputTextures(
      this.depthPass.getDepthTexture(),
      this.sceneColorPass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
  }

  getSceneColorResolutionScale(): number {
    return this.sceneColorPass.getResolutionScale();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.depthPass.dispose();
    this.sceneColorPass.dispose();
    this.maskPass.dispose();
    this.waterDepthPass.dispose();
    this.gBufferPass.dispose();
    this.ssrPass.dispose();
  }
}

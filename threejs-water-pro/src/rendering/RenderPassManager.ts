// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * RenderPassManager handles capture-pass lifecycle for the water system.
 * Manages texture creation, resize handling, and material texture binding.
 */

import * as THREE from "three/webgpu";
import { SceneCapturePass } from "./passes/SceneCapturePass";
import type { SceneDepthSampler } from "./passes/SceneDepthSampler";
import { MaskPass } from "./passes/MaskPass";
import type { IWaterDepthPass } from "./passes/IWaterDepthPass";
import { WebGPUWaterDepthPass } from "./passes/WebGPUWaterDepthPass";
import { WebGLWaterDepthPass } from "./passes/WebGLWaterDepthPass";
import { WaterReflectionGBufferPass } from "./passes/WaterReflectionGBufferPass";
import { SSRPass } from "./passes/SSRPass";
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

export class RenderPassManager {
  private renderer: THREE.WebGPURenderer;
  private capturePass: SceneCapturePass;
  private maskPass: MaskPass;
  private waterDepthPass: IWaterDepthPass;
  private gBufferPass: WaterReflectionGBufferPass;
  private ssrPass: SSRPass;
  private clipmap: WaterSurfaceGeometry;
  private waterMaterial: WaterSurfaceMaterial;
  private spray: SpraySystem | null;
  private underwater: Underwater | null;
  private atmosphericFogPass: AtmosphericFog | null;
  private currentSky: SkyProvider | null = null;
  private maskActive = false;

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
      underwater = null,
      atmosphericFog = null,
      excludedObjects = [],
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

    // One capture render provides both the refraction colour and the opaque
    // scene depth. The water surface and user-excluded objects are hidden here;
    // a provider's sky meshes are hidden too, added by `setSky` below.
    this.capturePass = new SceneCapturePass(scene, camera, width, height);
    this.capturePass.excludeObject(clipmap.getObject());
    for (const obj of excludedObjects) {
      this.capturePass.excludeObject(obj);
    }

    waterMaterial.setSceneDepth(this.capturePass.sceneDepth);
    waterMaterial.setSceneColorTexture(this.capturePass.getColorTexture());

    this.maskPass = new MaskPass(scene, camera, width, height);
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
    waterMaterial.setWaterDepth(this.waterDepthPass);

    // SSR water-reflection G-buffer (full-res) and SSR ray-march (scaled).
    // The G-buffer pass renders the water mesh with the same vertex
    // displacement and surface-normal pipeline as the main material so
    // `reflectDir` matches; only the march resolution scales.
    this.gBufferPass = new WaterReflectionGBufferPass(camera, width, height, {
      cascadeSampler: waterMaterial.cascadeSampler,
      clipmapOffset: waterMaterial.clipmapOffsetUniform,
      fresnel: waterMaterial.fresnel,
      oceanSim: waterMaterial.waveSimulation,
      rainRipples: waterMaterial.rainRipples,
    });
    this.gBufferPass.setWaterObject(clipmap.getObject());

    this.ssrPass = new SSRPass(
      width,
      height,
      waterMaterial.ssr,
      camera,
      this.capturePass.sceneDepth,
      this.capturePass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
    waterMaterial.setSSRResultTexture(this.ssrPass.getTexture());

    if (underwater) {
      underwater.setWaterDepthPass(this.waterDepthPass);
      underwater.setSceneDepth(this.capturePass.sceneDepth);
      underwater.setTransparentColorTexture(
        this.capturePass.getTransparentColorTexture(),
      );
      underwater.setTransparentDepthTexture(
        this.capturePass.getTransparentDepthTexture(),
      );
      underwater.setDepthUniforms(
        this.capturePass.getCameraNear(),
        this.capturePass.getCameraFar(),
      );
    }
  }

  /**
   * Get the current sky provider. The single query point for "what sky is
   * active" — other subsystems that need it (e.g. `WaterSystem._step`'s
   * `followCamera` call) read through here rather than tracking their own
   * reference.
   */
  getCurrentSky(): SkyProvider | null {
    return this.currentSky;
  }

  /**
   * Rebind every consumer this manager owns a reference to when the active
   * sky provider changes: the water material (reflection/fog/sun-disk
   * samplers baked into its shader graph), atmospheric fog, and the
   * capture pass's exclusion set. Called from {@link WaterSystem.setSky} —
   * the manager is the single owner of these references, so it is the
   * natural fan-out point instead of `WaterSystem` calling each consumer
   * by name.
   */
  setSky(sky: SkyProvider | null): void {
    // Provider backdrops (sky dome, cloud layers) are background at
    // infinity, not scene content: the captures leave them out so their
    // pixels stay alpha 0, and consumers composite the direction-sampled
    // sky underneath.
    if (this.currentSky) {
      for (const mesh of this.currentSky.getMeshes()) {
        this.capturePass.includeObject(mesh);
      }
    }
    this.currentSky = sky;
    if (sky) {
      this.waterMaterial.setSky(sky);
      for (const mesh of sky.getMeshes()) {
        this.capturePass.excludeObject(mesh);
      }
    }
    if (this.atmosphericFogPass) {
      this.atmosphericFogPass.setSky(sky);
    }
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
    const { clipmap, waterMaterial } = options;

    // Swap the clipmap exclusion so the old (disposed) mesh is not retained.
    const prevClipmapObject = this.clipmap.getObject();
    this.capturePass.includeObject(prevClipmapObject);

    this.clipmap = clipmap;
    this.waterMaterial = waterMaterial;

    const newClipmapObject = clipmap.getObject();
    this.capturePass.excludeObject(newClipmapObject);

    // Point WaterDepthPass at the new water geometry and uniforms. The
    // clip-plane uniform is recreated with each material, so the colorNode
    // must be rebuilt to read from the new reference.
    this.waterDepthPass.setWaterObject(newClipmapObject);
    this.waterDepthPass.setPositionNode(waterMaterial.waterPositionNode);
    this.waterDepthPass.setClipDistanceUniform(
      waterMaterial.clipPlaneDistanceUniform,
    );

    // Rebuild the SSR G-buffer pass shader graph with the new material's
    // cascade sampler, fresnel, etc. The result texture is then re-bound on
    // the new material's SSR class.
    this.gBufferPass.setWaterObject(newClipmapObject);
    this.gBufferPass.rebuild({
      cascadeSampler: waterMaterial.cascadeSampler,
      clipmapOffset: waterMaterial.clipmapOffsetUniform,
      fresnel: waterMaterial.fresnel,
      oceanSim: waterMaterial.waveSimulation,
      rainRipples: waterMaterial.rainRipples,
    });
    this.ssrPass.setInputTextures(
      this.capturePass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
    waterMaterial.setSSRResultTexture(this.ssrPass.getTexture());

    // Rebind existing pass textures onto the new material.
    waterMaterial.setSceneDepth(this.capturePass.sceneDepth);
    waterMaterial.setSceneColorTexture(this.capturePass.getColorTexture());
    waterMaterial.setMaskTexture(
      this.maskActive ? this.maskPass.getMaskTexture() : null,
    );
    waterMaterial.setWaterDepth(this.waterDepthPass);

    if (this.currentSky) {
      waterMaterial.setSky(this.currentSky);
    }
  }

  /**
   * Update the camera used by all render passes.
   */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.capturePass.setCamera(camera);
    this.maskPass.setCamera(camera);
    this.waterDepthPass.setCamera(camera);
    this.gBufferPass.setCamera(camera);
    this.ssrPass.setCamera(camera);

    // Sync underwater depth uniforms with new camera's near/far
    if (this.underwater) {
      this.underwater.setDepthUniforms(
        this.capturePass.getCameraNear(),
        this.capturePass.getCameraFar(),
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

    this.capturePass.setSize(size.x, size.y);
    this.maskPass.setSize(size.x, size.y);
    this.waterDepthPass.setSize(size.x, size.y);
    this.gBufferPass.setSize(size.x, size.y);
    this.ssrPass.setSize(size.x, size.y);
    // Re-bind input textures (depth/sceneColor/gBuffer all rebuilt above) and
    // the SSR result texture used by the water material.
    this.ssrPass.setInputTextures(
      this.capturePass.getColorTexture(),
      this.gBufferPass.getTexture(),
    );
    this.waterMaterial.setSSRResultTexture(this.ssrPass.getTexture());

    this.waterMaterial.setSceneColorTexture(
      this.capturePass.getColorTexture(),
    );
    if (this.maskActive) {
      this.waterMaterial.setMaskTexture(this.maskPass.getMaskTexture());
    }
    this.spray?.setMaskTexture(this.maskPass.getMaskTexture());

    if (this.underwater) {
      // The water-depth pass and the scene-depth sampler track their own
      // target rebuilds; only the transparent-capture textures re-bind.
      this.underwater.setTransparentColorTexture(
        this.capturePass.getTransparentColorTexture(),
      );
      this.underwater.setTransparentDepthTexture(
        this.capturePass.getTransparentDepthTexture(),
      );
    }
  }

  /**
   * Run the scene capture: refraction colour + opaque scene depth always,
   * plus the transparent captures (depth + premultiplied colour) when
   * `includeTransparents` is true.
   *
   * @param includeTransparents - Run the transparent capture sub-passes.
   *   Only the underwater fog decomposition consumes them, so callers skip
   *   them when underwater is disabled.
   */
  renderCapturePass(
    renderer: THREE.WebGPURenderer,
    includeTransparents = true,
  ): void {
    this.capturePass.render(renderer, includeTransparents);
  }

  /**
   * Render the mask pass (for water masking)
   */
  renderMaskPass(renderer: THREE.WebGPURenderer): void {
    if (!this.maskActive) return;
    this.maskPass.render(renderer);
  }

  /** Include or omit mask sampling in the water material's shader graph. */
  setMaskActive(active: boolean): void {
    if (this.maskActive === active) return;
    this.maskActive = active;
    this.waterMaterial.setMaskTexture(
      active ? this.maskPass.getMaskTexture() : null,
    );
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
   * Clear a stale SSR result once after SSR is disabled or its target is
   * recreated. Repeated calls are CPU-only no-ops until the pass renders again.
   */
  clearSSRPassIfNeeded(renderer: THREE.WebGPURenderer): void {
    this.ssrPass.clearResultIfNeeded(renderer);
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

  /**
   * The normalized-linear scene-depth sampler over the capture pass's
   * hardware depth. Subsystems embed `sample(uv)` in their node graphs
   * once; target rebuilds and camera changes propagate automatically.
   */
  get sceneDepth(): SceneDepthSampler {
    return this.capturePass.sceneDepth;
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
    return this.capturePass.getCameraNear();
  }

  /** Get camera far plane distance. */
  get cameraFar(): number {
    return this.capturePass.getCameraFar();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    this.capturePass.dispose();
    this.maskPass.dispose();
    this.waterDepthPass.dispose();
    this.gBufferPass.dispose();
    this.ssrPass.dispose();
  }
}

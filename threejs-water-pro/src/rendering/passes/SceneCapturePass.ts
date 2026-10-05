// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { Fn, vec4, positionView, cameraNear, cameraFar } from "three/tsl";
import { SceneDepthSampler } from "./SceneDepthSampler";

/** Full argument list of `renderer.renderObject`, including the trailing
 * clipping-context and pass-id parameters the render loop passes through. */
type RenderObjectArgs = Parameters<THREE.WebGPURenderer["renderObject"]>;

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
export class SceneCapturePass {
  private captureTarget: THREE.RenderTarget;
  private transparentColorTarget: THREE.RenderTarget;
  private transparentDepthTarget: THREE.RenderTarget;

  private readonly depthSampler: SceneDepthSampler;
  private readonly transparentDepthMaterial: THREE.MeshBasicNodeMaterial;

  private camera: THREE.PerspectiveCamera;
  private readonly scene: THREE.Scene;
  private readonly excludedObjects: Set<THREE.Object3D> = new Set();
  private readonly originalVisibility: Map<THREE.Object3D, boolean> =
    new Map();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    this.scene = scene;
    this.camera = camera;

    this.captureTarget = this.createCaptureTarget(width, height);
    this.transparentColorTarget = this.createTransparentColorTarget(
      width,
      height,
    );
    this.transparentDepthTarget = this.createTransparentDepthTarget(
      width,
      height,
    );

    this.depthSampler = new SceneDepthSampler(
      this.captureTarget.depthTexture as THREE.DepthTexture,
    );
    this.depthSampler.setCameraPlanes(camera.near, camera.far);

    this.transparentDepthMaterial = this.createTransparentDepthMaterial();
  }

  // ── Outputs ──

  /** Scene color (minus water) for screen-space refraction and SSR hits. */
  getColorTexture(): THREE.Texture {
    return this.captureTarget.texture;
  }

  /**
   * Normalized-linear-depth sampler over the capture's hardware depth.
   * Consumers embed `sample(uv)` once; resizes and camera changes propagate
   * through the sampler's internal nodes.
   */
  get sceneDepth(): SceneDepthSampler {
    return this.depthSampler;
  }

  /**
   * Transparent objects' premultiplied colour (RGB) and true per-pixel
   * alpha (A). Standard alpha blending over transparent black yields
   * RGB = alpha × objectColor.
   */
  getTransparentColorTexture(): THREE.Texture {
    return this.transparentColorTarget.texture;
  }

  /** Transparent objects' depth (R = normalized linear, 1 = none). */
  getTransparentDepthTexture(): THREE.Texture {
    return this.transparentDepthTarget.texture;
  }

  /** Capture camera near plane. */
  getCameraNear(): number {
    return this.camera.near;
  }

  /** Capture camera far plane. */
  getCameraFar(): number {
    return this.camera.far;
  }

  // ── Configuration ──

  /** Exclude an object from every capture (e.g. the water surface). */
  excludeObject(object: THREE.Object3D): void {
    this.excludedObjects.add(object);
  }

  /** Remove an object from the exclusion list. */
  includeObject(object: THREE.Object3D): void {
    this.excludedObjects.delete(object);
  }

  /** Update the camera used for capture rendering. */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
    this.depthSampler.setCameraPlanes(camera.near, camera.far);
  }

  /**
   * Resize the capture targets. Old targets are not explicitly disposed —
   * garbage collection reclaims them, avoiding "destroyed texture used in
   * submit" errors from in-flight GPU work.
   */
  setSize(width: number, height: number): void {
    this.captureTarget = this.createCaptureTarget(width, height);
    this.transparentColorTarget = this.createTransparentColorTarget(
      width,
      height,
    );
    this.transparentDepthTarget = this.createTransparentDepthTarget(
      width,
      height,
    );
    this.depthSampler.setDepthTexture(
      this.captureTarget.depthTexture as THREE.DepthTexture,
    );
  }

  // ── Rendering ──

  /**
   * Run the captures. The scene capture (color + opaque depth) always
   * renders; the transparent sub-passes run only when
   * `includeTransparents` is true.
   */
  render(renderer: THREE.WebGPURenderer, includeTransparents = true): void {
    for (const obj of this.excludedObjects) {
      this.originalVisibility.set(obj, obj.visible);
      obj.visible = false;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevBackground = this.scene.background;

    // Camera planes feed the depth linearization; track them every frame
    // so animated near/far stay correct.
    this.depthSampler.setCameraPlanes(this.camera.near, this.camera.far);

    renderer.autoClear = false;
    // Sky pixels must stay transparent black: the capture's alpha is scene
    // coverage, and consumers composite the direction-sampled sky under it.
    this.scene.background = null;

    try {
      // Pass 1: full scene, original materials → color + hardware depth.
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.captureTarget);
      renderer.clear();
      renderer.render(this.scene, this.camera);

      if (includeTransparents) {
        // R = 1 means "no transparent". Disabled frames skip this target
        // entirely because the underwater branch cannot sample it.
        renderer.setRenderTarget(this.transparentDepthTarget);
        renderer.setClearColor(0xff0000, 1);
        renderer.clear();
        this.renderTransparentCaptures(renderer);
      }
    } finally {
      // Normalise clear state so a non-zero transparent-depth clear cannot
      // leak into a later pass.
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = prevAutoClear;
      renderer.setRenderTarget(prevTarget);
      this.scene.background = prevBackground;

      for (const [obj, visible] of this.originalVisibility) {
        obj.visible = visible;
      }
      this.originalVisibility.clear();
    }
  }

  dispose(): void {
    this.captureTarget.dispose();
    this.transparentColorTarget.dispose();
    this.transparentDepthTarget.dispose();
    this.transparentDepthMaterial.dispose();
  }

  // ── Internals ──

  /**
   * Passes 2–3: transparent depth (override material, sprites skipped),
   * then transparent premultiplied colour (original materials).
   */
  private renderTransparentCaptures(renderer: THREE.WebGPURenderer): void {
    const prevOpaque = renderer.opaque;
    const prevOverride = this.scene.overrideMaterial;

    // Sprites cannot billboard under a mesh override material, so they are
    // color-only: skipped here, captured normally in the colour pass.
    const skipSprites = (...args: RenderObjectArgs): void => {
      if ((args[0] as { isSprite?: boolean }).isSprite === true) return;
      renderer.renderObject(...args);
    };

    renderer.opaque = false;

    try {
      // Pass 2: transparent depth → R, via the single override material.
      this.scene.overrideMaterial = this.transparentDepthMaterial;
      renderer.setRenderObjectFunction(skipSprites);
      renderer.setRenderTarget(this.transparentDepthTarget);
      renderer.render(this.scene, this.camera);
      renderer.setRenderObjectFunction(null);
      this.scene.overrideMaterial = prevOverride;

      // Pass 3: transparent premultiplied colour + per-pixel alpha, with
      // original materials (their own alpha, cutouts, and fog apply).
      renderer.setRenderTarget(this.transparentColorTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderObjectFunction(null);
      this.scene.overrideMaterial = prevOverride;
      renderer.opaque = prevOpaque;
    }
  }

  /** Scene capture target: HDR color + hardware depth texture. */
  private createCaptureTarget(
    width: number,
    height: number,
  ): THREE.RenderTarget {
    const target = new THREE.RenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    target.depthTexture = new THREE.DepthTexture(width, height);
    return target;
  }

  /**
   * Transparent colour target. NEAREST keeps its per-pixel alpha aligned
   * with the separately captured depth silhouette. The depth buffer lets
   * transparents depth-test among themselves as in the beauty pass.
   */
  private createTransparentColorTarget(
    width: number,
    height: number,
  ): THREE.RenderTarget {
    return new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
  }

  /** Single-channel transparent depth; occlusion is resolved by the consumer. */
  private createTransparentDepthTarget(
    width: number,
    height: number,
  ): THREE.RenderTarget {
    return new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RedFormat,
      depthBuffer: false,
    });
  }

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
  private createTransparentDepthMaterial(): THREE.MeshBasicNodeMaterial {
    const material = new THREE.MeshBasicNodeMaterial();
    material.outputNode = Fn(() => {
      const normalizedDepth = positionView.z
        .negate()
        .sub(cameraNear)
        .div(cameraFar.sub(cameraNear));
      return vec4(normalizedDepth, 0.0, 0.0, 1.0);
    })();
    material.blending = THREE.NoBlending;
    material.depthTest = false;
    material.depthWrite = false;
    material.side = THREE.DoubleSide;
    // The renderer forwards `transparent: true` per object, which would
    // trigger the double-sided two-pass split; one pass is enough for a
    // straight-through depth write.
    material.forceSinglePass = true;
    material.fog = false;
    return material;
  }
}

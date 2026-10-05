// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * SSRPass runs the screen-space ray march at full resolution and writes the
 * resulting reflection color + hit mask to its own render target. The water
 * material samples this texture to compose SSR into its surface color.
 *
 * Inputs:
 * - sceneDepth: normalized-linear scene depth sampler from the capture pass
 * - sceneColorTexture: scene color from the capture pass
 * - gBufferTexture: water reflectDir + viewZ from `WaterReflectionGBufferPass`
 *
 * Output: RGBA16F, RGB = reflection color sampled from sceneColor at the hit
 * point, A = 0–1 hit-mask × strength × enabled.
 */
import * as THREE from "three/webgpu";
import { positionLocal, uniform, vec4 } from "three/tsl";
import type { SceneCameraNodes, SSR } from "../../shaders/ssr";
import type { SceneDepthSampler } from "./SceneDepthSampler";

function createRenderTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
}

export class SSRPass {
  private renderTarget: THREE.RenderTarget;
  private quadMesh: THREE.QuadMesh;
  private material: THREE.NodeMaterial;
  private ssr: SSR;
  private sceneDepth: SceneDepthSampler;
  private sceneColorTexture: THREE.Texture;
  private gBufferTexture: THREE.Texture;
  private camera: THREE.PerspectiveCamera;

  private viewMatrixUniform: ReturnType<typeof uniform>;
  private projectionMatrixUniform: ReturnType<typeof uniform>;
  private projectionMatrixInverseUniform: ReturnType<typeof uniform>;
  private nearUniform: ReturnType<typeof uniform>;
  private farUniform: ReturnType<typeof uniform>;

  /**
   * True after the result target is created or receives an SSR frame. The
   * disabled path consumes this flag by clearing the target once, then skips
   * all subsequent GPU work until SSR renders again.
   */
  private disabledClearPending = true;
  // WebGPURenderer types its clear-color target as its private Color4 class.
  // A Color with the alpha field satisfies that shape; alpha is restored from
  // getClearAlpha() separately below.
  private readonly previousClearColor = Object.assign(new THREE.Color(), {
    a: 1,
  });

  constructor(
    width: number,
    height: number,
    ssr: SSR,
    camera: THREE.PerspectiveCamera,
    sceneDepth: SceneDepthSampler,
    sceneColorTexture: THREE.Texture,
    gBufferTexture: THREE.Texture,
  ) {
    this.ssr = ssr;
    this.camera = camera;
    this.sceneDepth = sceneDepth;
    this.sceneColorTexture = sceneColorTexture;
    this.gBufferTexture = gBufferTexture;

    this.viewMatrixUniform = uniform(new THREE.Matrix4());
    this.projectionMatrixUniform = uniform(new THREE.Matrix4());
    this.projectionMatrixInverseUniform = uniform(new THREE.Matrix4());
    this.nearUniform = uniform(0.1);
    this.farUniform = uniform(50000.0);

    this.renderTarget = createRenderTarget(width, height);
    this.material = new THREE.NodeMaterial();
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.vertexNode = vec4(positionLocal.x, positionLocal.y, 0, 1);
    this.quadMesh = new THREE.QuadMesh();
    this.quadMesh.material = this.material;
    this.quadMesh.frustumCulled = false;
    this.buildShaderGraph();
  }

  /** Update the camera the SSR pass tracks (call after switching scene cameras). */
  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  /** Get the SSR result texture (rgb, hitMask). */
  public getTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  /** Resize the SSR render target to match new screen dimensions. */
  public setSize(width: number, height: number): void {
    this.renderTarget = createRenderTarget(width, height);
    this.disabledClearPending = true;
  }

  /**
   * Re-bind the input textures (e.g. after a resize swapped the scene-color
   * render target) and rebuild the shader graph. The scene-depth sampler
   * tracks target rebuilds internally, so only colour textures re-bind.
   */
  public setInputTextures(
    sceneColorTexture: THREE.Texture,
    gBufferTexture: THREE.Texture,
  ): void {
    this.sceneColorTexture = sceneColorTexture;
    this.gBufferTexture = gBufferTexture;
    this.buildShaderGraph();
  }

  /** Render the SSR pass. */
  public render(renderer: THREE.WebGPURenderer): void {
    // The main render already kept matrixWorldInverse up to date; just read it.
    (this.viewMatrixUniform.value as THREE.Matrix4).copy(
      this.camera.matrixWorldInverse,
    );
    (this.projectionMatrixUniform.value as THREE.Matrix4).copy(
      this.camera.projectionMatrix,
    );
    (this.projectionMatrixInverseUniform.value as THREE.Matrix4).copy(
      this.camera.projectionMatrixInverse,
    );
    this.nearUniform.value = this.camera.near;
    this.farUniform.value = this.camera.far;

    const currentTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    this.quadMesh.render(renderer);
    renderer.setRenderTarget(currentTarget);

    // If SSR is disabled after this frame, its last reflection must be cleared
    // once before the water shader can continue sampling the persistent target.
    this.disabledClearPending = true;
  }

  /**
   * Clear the persistent SSR result to a zero-confidence miss once.
   *
   * Called on disabled frames. After the first clear this is a CPU-only no-op
   * until {@link render} writes a new result or {@link setSize} creates a new
   * target. Explicit transparent black guarantees both reflection RGB and the
   * alpha hit mask are zero without leaking renderer clear state.
   */
  public clearResultIfNeeded(renderer: THREE.WebGPURenderer): void {
    if (!this.disabledClearPending) return;

    const currentTarget = renderer.getRenderTarget();
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.previousClearColor);

    renderer.setRenderTarget(this.renderTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();

    renderer.setRenderTarget(currentTarget);
    renderer.setClearColor(this.previousClearColor, previousClearAlpha);
    this.disabledClearPending = false;
  }

  public dispose(): void {
    this.renderTarget.dispose();
    this.material.dispose();
  }

  private buildShaderGraph(): void {
    const sceneCamera: SceneCameraNodes = {
      viewMatrix: this.viewMatrixUniform,
      projectionMatrix: this.projectionMatrixUniform,
      projectionMatrixInverse: this.projectionMatrixInverseUniform,
      near: this.nearUniform,
      far: this.farUniform,
    };
    this.material.fragmentNode = this.ssr.buildMarchNode(
      this.sceneDepth,
      this.sceneColorTexture,
      this.gBufferTexture,
      sceneCamera,
    );
    this.material.needsUpdate = true;
  }
}

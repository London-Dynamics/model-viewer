/**
 * SunShaftPass renders sun shaft intensity to a scaled render target.
 *
 * The intensity computation (occlusion sampling, radial falloff, etc.) runs
 * at reduced resolution to save texture reads. The output is bilinear-filtered
 * when sampled at full resolution in the post-processing composite step.
 */
import * as THREE from "three/webgpu";
import type { Node } from "../../shaders/types";

export class SunShaftPass {
  private renderTarget: THREE.RenderTarget;
  private quadMesh: THREE.QuadMesh;
  private resolutionScale: number;
  private fullWidth: number;
  private fullHeight: number;

  constructor(width: number, height: number, resolutionScale: number = 1) {
    this.resolutionScale = resolutionScale;
    this.fullWidth = width;
    this.fullHeight = height;

    this.renderTarget = this.createRenderTarget(width, height, resolutionScale);
    this.quadMesh = new THREE.QuadMesh();
  }

  /**
   * Build the QuadMesh material from a sun shaft intensity node.
   * Must be called before render(). Call again after wave data changes (quality level switch).
   *
   * @param intensityNode - vec4 node outputting shaft color in RGB.
   */
  build(intensityNode: Node): void {
    const material = new THREE.NodeMaterial();
    material.fragmentNode = intensityNode;
    this.quadMesh.material = material;
  }

  /** Render sun shaft intensity to the scaled render target. */
  render(renderer: THREE.WebGPURenderer): void {
    const currentTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    this.quadMesh.render(renderer);
    renderer.setRenderTarget(currentTarget);
  }

  /** Get the sun shaft intensity texture for composite sampling. */
  getTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  /**
   * Resize the render target to match new screen dimensions.
   * Returns the new texture for rebinding.
   */
  setSize(width: number, height: number): THREE.Texture {
    this.fullWidth = width;
    this.fullHeight = height;
    this.renderTarget = this.createRenderTarget(
      width,
      height,
      this.resolutionScale,
    );
    return this.renderTarget.texture;
  }

  /**
   * Update the resolution scale and rebuild the render target.
   * Returns the new texture for rebinding.
   */
  setResolutionScale(scale: number): THREE.Texture {
    this.resolutionScale = scale;
    this.renderTarget = this.createRenderTarget(
      this.fullWidth,
      this.fullHeight,
      scale,
    );
    return this.renderTarget.texture;
  }

  getResolutionScale(): number {
    return this.resolutionScale;
  }

  dispose(): void {
    this.renderTarget.dispose();
  }

  private createRenderTarget(
    width: number,
    height: number,
    scale: number,
  ): THREE.RenderTarget {
    const scaledWidth = Math.max(1, Math.floor(width * scale));
    const scaledHeight = Math.max(1, Math.floor(height * scale));

    return new THREE.RenderTarget(scaledWidth, scaledHeight, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
    });
  }
}

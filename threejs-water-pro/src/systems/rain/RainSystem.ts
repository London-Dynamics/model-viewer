// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { float, pass, select, uv } from "three/tsl";
import { RainParticles, type RainParams } from "./RainParticles";
import { RainRipples } from "../../simulation/ripples";
import type { RenderPassManager } from "../../rendering/RenderPassManager";
import type { IWaterDepthPass } from "../../rendering/passes/IWaterDepthPass";
import type { WaveUniforms } from "../../uniforms";
import type { WaterSubsystem } from "../types";

export interface RainSystemParams extends RainParams {
  rippleDecay: number;
  rippleDensity: number;
  rippleFadeEnd: number;
  rippleSize: number;
  rippleStrength: number;
}

/**
 * Manages rain particle streaks and surface ripple simulation as a unit.
 *
 * Owns the separate rain scene (used for post-fog compositing) and the
 * per-pixel depth nodes needed to mask rain below the water surface.
 */
export class RainSystem implements WaterSubsystem {
  private _particles: RainParticles;
  private _ripples: RainRipples;
  // Rain is rendered in its own scene so it can be composited after the fog
  // post-process, preventing fog from being incorrectly applied to rain pixels.
  private _scene = new THREE.Scene();
  // Water-depth source — owned by `RenderPassManager`. Sample builders
  // route through `IWaterDepthPass.sampleX(uv)` so the WebGPU/WebGL split
  // is hidden from the composite node graph below.
  private _waterDepthPass: IWaterDepthPass | null = null;

  private readonly _waveUniforms: WaveUniforms;
  private _camera: THREE.Camera;

  /**
   * @param waveUniforms - Source of `windDirection` / `windSpeed` for the
   *   per-frame streak tick. Borrowed by reference so changes propagate
   *   without explicit sync.
   * @param camera - Camera used to position the streak field. Replaceable
   *   via {@link setCamera}.
   */
  constructor(waveUniforms: WaveUniforms, camera: THREE.Camera) {
    this._waveUniforms = waveUniforms;
    this._camera = camera;
    // RainRipples must be created before the water material — buildNormals is
    // called during shader compilation and needs the node references at build time.
    this._ripples = new RainRipples();
    this._particles = new RainParticles();
    this._scene.add(this._particles.getMesh());
  }

  /**
   * Replace the camera used to position the streak field. Called from
   * `WaterSystem.set camera` so reassignment propagates.
   */
  setCamera(camera: THREE.Camera): void {
    this._camera = camera;
  }

  /** Rain streak particles. */
  get particles(): RainParticles {
    return this._particles;
  }

  /** Rain ripple simulation. */
  get ripples(): RainRipples {
    return this._ripples;
  }

  /**
   * The dedicated rain scene. Pass this to the renderer as a separate pass
   * so rain is composited after atmospheric fog.
   * @internal
   */
  get scene(): THREE.Scene {
    return this._scene;
  }

  /**
   * Wire the water-depth source used to mask rain below the surface.
   * Called once at construction and again on every quality switch.
   * Resize-only swaps inside `IWaterDepthPass` propagate automatically
   * through its TSL nodes.
   * @internal
   */
  bindDepthTextures(rp: RenderPassManager): void {
    this._waterDepthPass = rp.waterDepth;
  }

  /**
   * Per-substep simulation update. Reads wind direction / speed from the
   * shared `WaveUniforms` and the camera held at construction time, so
   * the signature matches the {@link WaterSubsystem.step} contract and
   * the system can be iterated through the registry.
   *
   * @internal
   */
  step(deltaTime: number, gpuTime: number): void {
    this._particles.tick(
      deltaTime,
      this._camera,
      this._waveUniforms.windDirection.value,
      this._waveUniforms.windSpeed.value,
    );
    this._ripples.updateTime(gpuTime);
  }

  /** Apply preset parameters to streaks and ripples. */
  update(params: RainSystemParams): void {
    this._particles.update(params);
    this._ripples.update({
      decay: params.rippleDecay,
      density: params.rippleDensity,
      enabled: params.enabled,
      fadeEnd: params.rippleFadeEnd,
      size: params.rippleSize,
      strength: params.rippleStrength,
    });
  }

  /**
   * Build the TSL node that composites rain over the current frame.
   *
   * Underwater pixels are masked out: a back-facing water fragment
   * closer to the camera than any front-facing fragment means the ray
   * crosses the underside first (Snell's window from above-water), so
   * rain shouldn't be drawn on top.
   * @internal
   */
  createCompositeNode(camera: THREE.Camera) {
    const wdp = this._waterDepthPass;
    if (!wdp) {
      throw new Error(
        "RainSystem.createCompositeNode: bindDepthTextures() must be called before building the node graph.",
      );
    }
    const uvCoord = uv();
    // Per-pixel underwater classification matching the Underwater
    // post-pass: closest unclipped hit's facing tells us which side of
    // the surface the camera is on; rain is masked out wherever the
    // pixel ends up underwater (air-side clip-hole or water-side).
    const unclipped = wdp.sampleUnclippedDepth(uvCoord);
    const unclippedFront = wdp.sampleUnclippedFrontDepth(uvCoord);
    const clippedAny = wdp.sampleClippedAnyDepth(uvCoord);
    const closestIsFront = unclippedFront
      .sub(unclipped)
      .lessThan(float(1e-4));
    const waterInRay = unclipped.lessThan(float(1.0));
    const isUnderwater = waterInRay.and(
      closestIsFront
        .and(unclipped.lessThan(clippedAny))
        .or(closestIsFront.not()),
    );
    const rainPass = pass(this._scene, camera);
    return rainPass.getTextureNode("output").mul(select(isUnderwater, 0.0, 1.0));
  }

  dispose(): void {
    this._scene.remove(this._particles.getMesh());
    this._particles.dispose();
    this._ripples.dispose();
  }
}

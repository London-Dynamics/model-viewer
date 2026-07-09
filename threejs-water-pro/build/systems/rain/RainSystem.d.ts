import * as THREE from "three/webgpu";
import { RainParticles, type RainParams } from "./RainParticles";
import { RainRipples } from "../../simulation/ripples";
import type { RenderPassManager } from "../../rendering/RenderPassManager";
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
export declare class RainSystem implements WaterSubsystem {
    private _particles;
    private _ripples;
    private _scene;
    private _waterDepthPass;
    private readonly _waveUniforms;
    private _camera;
    /**
     * @param waveUniforms - Source of `windDirection` / `windSpeed` for the
     *   per-frame streak tick. Borrowed by reference so changes propagate
     *   without explicit sync.
     * @param camera - Camera used to position the streak field. Replaceable
     *   via {@link setCamera}.
     */
    constructor(waveUniforms: WaveUniforms, camera: THREE.Camera);
    /**
     * Replace the camera used to position the streak field. Called from
     * `WaterSystem.set camera` so reassignment propagates.
     */
    setCamera(camera: THREE.Camera): void;
    /** Rain streak particles. */
    get particles(): RainParticles;
    /** Rain ripple simulation. */
    get ripples(): RainRipples;
    /**
     * The dedicated rain scene. Pass this to the renderer as a separate pass
     * so rain is composited after atmospheric fog.
     * @internal
     */
    get scene(): THREE.Scene;
    /**
     * Wire the water-depth source used to mask rain below the surface.
     * Called once at construction and again on every quality switch.
     * Resize-only swaps inside `IWaterDepthPass` propagate automatically
     * through its TSL nodes.
     * @internal
     */
    bindDepthTextures(rp: RenderPassManager): void;
    /**
     * Per-substep simulation update. Reads wind direction / speed from the
     * shared `WaveUniforms` and the camera held at construction time, so
     * the signature matches the {@link WaterSubsystem.step} contract and
     * the system can be iterated through the registry.
     *
     * @internal
     */
    step(deltaTime: number, gpuTime: number): void;
    /** Apply preset parameters to streaks and ripples. */
    update(params: RainSystemParams): void;
    /**
     * Build the TSL node that composites rain over the current frame.
     *
     * Underwater pixels are masked out: a back-facing water fragment
     * closer to the camera than any front-facing fragment means the ray
     * crosses the underside first (Snell's window from above-water), so
     * rain shouldn't be drawn on top.
     * @internal
     */
    createCompositeNode(camera: THREE.Camera): import("three/src/nodes/math/OperatorNode.js").default;
    dispose(): void;
}
//# sourceMappingURL=RainSystem.d.ts.map
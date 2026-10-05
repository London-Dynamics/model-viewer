import * as THREE from "three/webgpu";
import type { Node } from "./types";
import type { RenderPassManager } from "../rendering/RenderPassManager";
import type { WaterSubsystem } from "../systems/types";
import type { IWaveSimulation } from "../simulation/waves";
import type { Lighting } from "../systems/Lighting";
import type { Fresnel } from "./fresnel";
import type { UnderwaterStateController } from "../systems/UnderwaterStateController";
import type { QualityLevel, QualityLevelConfig } from "../config/QualityLevels";
/** Preset-facing parameters for sun shafts. */
export interface SunShaftsParams {
    /** Whether sun shafts are active. */
    enabled: boolean;
    /** Master brightness (0–1). */
    intensity: number;
}
/** Options for {@link SunShafts.setWaveTexture}. */
export interface SunShaftsWaveTextureOptions {
    /** Normal texture from wave simulation (WebGL render target). */
    normalTexture: THREE.Texture;
    /** World-space scale of the cascade. */
    scale: number;
}
/**
 * Underwater sun shafts using screen-space radial projection.
 *
 * Creates volumetric-looking light shafts by projecting a radial
 * pattern from the sun's screen position, modulated by depth.
 *
 * The shader is split into two stages:
 * - {@link buildIntensityNode} computes scalar intensity at reduced resolution
 * - {@link buildComposite} reconstructs shaft color and adds it to scene color
 */
export declare class SunShafts implements WaterSubsystem {
    private _enabled;
    private _intensity;
    private _falloff;
    private _fadeIn;
    private _softness;
    private _sunScreenX;
    private _sunScreenY;
    private _sunVisible;
    private _cameraWorldX;
    private _cameraWorldZ;
    private _sceneDepth;
    private _waterDepthPass;
    private _outputTextureNode;
    private _waveScale;
    private _hasNormalSampler;
    private _normalTexture;
    /** Reused workspace vector for the per-frame screen-position projection. */
    private _sunViewPos;
    private _camera;
    private _lighting;
    private _fresnel;
    private _underwaterController;
    private _pass;
    constructor();
    /** Whether sun shafts are active. */
    get enabled(): boolean;
    set enabled(value: boolean);
    /** Distance from sun center where rays start appearing (0–1). */
    get fadeIn(): number;
    set fadeIn(value: number);
    /** Radial falloff distance from sun center (0.5–3). */
    get falloff(): number;
    set falloff(value: number);
    /** Master brightness (0–1). */
    get intensity(): number;
    set intensity(value: number);
    /** Width of the intensity fade region (0–1). Higher = softer rays. */
    get softness(): number;
    set softness(value: number);
    /**
     * Re-bind scene depth and wire the water depth source. Called once at
     * construction and again on every resize / quality switch — the scene
     * depth target identity changes across both. The `IWaterDepthPass`
     * reference itself survives quality changes; only its internal
     * texture targets get reallocated, and the TSL nodes returned by the
     * sample builders track those swaps automatically.
     */
    bindDepthTextures(rp: RenderPassManager): void;
    /** Bulk-set parameters from a preset or params object. */
    update(params: SunShaftsParams): void;
    /**
     * Wire the runtime refs SunShafts needs to project the sun into
     * screen space each frame. Called once during `WaterSystem.create`
     * after `UnderwaterStateController` exists; not needed for the
     * sub-classes invoked during shader compilation.
     */
    attachRuntimeRefs(refs: {
        camera: THREE.PerspectiveCamera;
        lighting: Lighting;
        fresnel: Fresnel;
        underwaterController: UnderwaterStateController;
    }): void;
    /** Replace the camera (called from `WaterSystem.set camera`). */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /**
     * Build the reduced-resolution intensity pass and bind its output
     * texture for the composite step. Idempotent; calling again recreates
     * the underlying render target with the new size / resolution scale.
     *
     * @param width - Drawing-buffer width in pixels.
     * @param height - Drawing-buffer height in pixels.
     * @param resolutionScale - Pass resolution scale from the quality config.
     */
    attachPass(width: number, height: number, resolutionScale: number): void;
    /** Resize the intensity pass to match the new drawing-buffer size. */
    resize(width: number, height: number): void;
    /**
     * Apply a quality-level switch. Updates the resolution scale on the
     * intensity pass, rebinds the output texture, and rebuilds the pass
     * material (the wave-data nodes the intensity shader binds to are
     * re-created on every cascade rebuild).
     */
    onQualityChanged(_quality: QualityLevel, config: QualityLevelConfig): void;
    /**
     * Once-per-displayed-frame render. Self-gates on `enabled` and on the
     * underwater controller's `underwaterEnabled` (sun shafts are an
     * underwater-only effect). Projection runs once at render time, not
     * once per simulation substep — multiple substeps in a frame still
     * produce one consistent shaft direction.
     */
    renderPass(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
    /**
     * Project the sun into screen space and refresh the uniforms the
     * radial shaft shader consumes. Invoked from {@link renderPass} once
     * per displayed frame while underwater rendering is active.
     *
     * The shafts are an underwater-only effect — they only render when
     * the per-pixel detection inside the intensity shader flags a pixel
     * as underwater, and `renderPass` already gates the entire pass on
     * `underwaterController.underwaterEnabled`. The sun is therefore
     * always being viewed through the refracting water surface, so the
     * apparent direction is Snell-compressed toward vertical
     * (`sin θ_apparent = sin θ_true / n_water`). When the sun is behind
     * the camera the visible flag drops to zero and the shafts vanish.
     */
    private _updateScreenPosition;
    /**
     * Set wave texture reference for surface transmission. Must be called
     * before {@link attachPass} for wave-based transmission to take
     * effect; the cascade-changed event in `OceanFloor` /
     * `WaterSystem._fireCascadeChanged` calls this whenever the cascade-0
     * normal texture is rebuilt.
     */
    setWaveTexture(options: SunShaftsWaveTextureOptions): void;
    /**
     * Rebind to the wave simulation. Reads cascade-0's normal texture and
     * scale — the inputs the surface-transmission shader consumes. Called
     * whenever cascade configuration changes or the wave sim is recreated.
     */
    onCascadeChanged(sim: IWaveSimulation): void;
    /**
     * Builds the sun shaft intensity node for rendering at reduced resolution.
     *
     * Returns a vec4 where R is the scalar shaft intensity.
     * When disabled, outputs vec4(0, 0, 0, 1). Called from {@link attachPass}
     * and {@link onQualityChanged} when the underlying wave data changes.
     *
     * @param sunDir - Sun direction node (normalized, pointing toward sun).
     */
    private buildIntensityNode;
    /**
     * Builds the underwater gate (1 = underwater, 0 = above water) that confines
     * the shaft composite. Same per-pixel rule as the Underwater post-pass:
     * `clippedAny < clippedFront` (closest behind-clip water fragment is a back
     * face). When no depth pass is wired, returns 1.0 (ungated).
     *
     * Built here, separate from {@link buildComposite}, because `buildComposite`
     * is compiled to AssemblyScript by the WASM shader engine, which can't follow
     * the `IWaterDepthPass` sample methods (they read a GPU-only render target).
     * The gate is computed on the GPU side (in the post-process pipeline, which
     * is not AS-compiled) and passed into `buildComposite` as a plain float node.
     */
    buildUnderwaterGate(): Node;
    /**
     * Builds the composite node that samples the reduced-resolution sun shaft
     * texture and adds it to the scene color, scaled by the underwater `gate`.
     *
     * The shaft texture is rendered at reduced resolution; scaling by the gate
     * (see {@link buildUnderwaterGate}) confines it to the underwater region so
     * bilinear upsampling can't bleed shaft brightening across the waterline.
     *
     * @param inputColor - Scene color after underwater effects.
     * @param gate - Underwater gate in [0, 1] from {@link buildUnderwaterGate}.
     */
    buildComposite(inputColor: Node, gate: Node): Node;
    /**
     * Builds the surface transmission factor based on Fresnel at the ray entry point.
     * When no normal sampler is configured, returns 1.0 (full transmission).
     *
     * @param toSunDir - Normalized 2D direction from pixel to sun in screen space.
     * @param sunDir - Sun direction (normalized, pointing toward sun).
     */
    private buildSurfaceTransmission;
    /**
     * Samples the wave normal at a world position.
     * Uses buffer path (WebGPU) or texture path (WebGL) based on data source.
     *
     * @param worldX - World X coordinate.
     * @param worldZ - World Z coordinate.
     */
    private sampleNormal;
}
//# sourceMappingURL=sunShafts.d.ts.map
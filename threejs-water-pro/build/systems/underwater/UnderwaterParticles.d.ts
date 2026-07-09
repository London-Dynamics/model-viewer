import * as THREE from "three/webgpu";
import type { TSLUniformNode } from "../../types/tsl";
import type { IWaterDepthPass } from "../../rendering/passes/IWaterDepthPass";
import type { RenderPassManager } from "../../rendering/RenderPassManager";
import type { WaterSubsystem } from "../types";
import { type ParticleParams } from "./types";
/** Internal options for clip plane uniforms (shared with water material). */
export interface ParticlesInternalOptions {
    clipDistance: TSLUniformNode;
    cameraForward: TSLUniformNode;
}
/**
 * UnderwaterParticles - Ambient particle system for underwater scenes.
 *
 * Renders small particles (sediment, plankton, dust) in a spherical shell
 * around the camera. Particles are static in world space — apparent
 * movement comes from underwater distortion.
 *
 * Visibility is per-fragment, not per-camera-state: the opacity node
 * fades each fragment to zero above the sea level so particles that
 * happen to be above water (a particle's world Y exceeded sea level
 * because it spawned high or the camera moved up) disappear smoothly
 * without any global submersion switch. The pass therefore always runs;
 * fragments that fall above water just discard themselves.
 *
 * Features:
 * - World-space positioning (particles stay in place as camera moves)
 * - Uniform distribution within spherical shell (nearDistance to farDistance)
 * - Distance-based opacity fade (fade out toward far distance)
 * - Circular particle shapes (soft falloff)
 * - Per-fragment waterline fade (no `cameraSubmerged` dependency)
 * - Size variation per particle
 *
 * Uses SpriteNodeMaterial for WebGPU compatibility.
 */
export declare class UnderwaterParticles implements WaterSubsystem {
    private mesh;
    private geometry;
    private material;
    private positions;
    private alphas;
    private sizes;
    private positionAttr;
    private alphaAttr;
    private sizeAttr;
    private minSizeUniform;
    private maxSizeUniform;
    private colorUniform;
    private opacityUniform;
    private clipDistanceUniform;
    private cameraForwardUniform;
    private _waterDepthPass;
    private maxParticles;
    private activeCount;
    private nearDistance;
    private farDistance;
    private _enabled;
    private _initialized;
    constructor(params?: Partial<ParticleParams>, internalOptions?: ParticlesInternalOptions);
    private _buildOpacityNode;
    private createMaterial;
    /** {@link WaterSubsystem} hook — delegates to {@link bindWaterDepthPass}. */
    bindDepthTextures(rp: RenderPassManager): void;
    /**
     * Wire the water depth pass for per-pixel underwater masking. Particles
     * are discarded at pixels not classified as underwater (clippedAny >= clippedFront),
     * preventing them from rendering through the water surface when viewed from above.
     */
    bindWaterDepthPass(pass: IWaterDepthPass): void;
    /**
     * Spawn a particle at a random position uniformly distributed within a spherical
     * shell around the camera, constrained to be below the water surface (y < 0).
     * Returns true if successfully spawned, false if no valid position found.
     */
    private spawnParticle;
    /**
     * Get the mesh for adding to scene.
     */
    getMesh(): THREE.Mesh;
    /**
     * Whether particles are enabled.
     */
    get enabled(): boolean;
    set enabled(value: boolean);
    /**
     * Update particles. Call once per frame.
     * Respawns particles that have left the distance range or are above water.
     */
    update(_deltaTime: number, camera: THREE.Camera): void;
    /**
     * Update parameters at runtime.
     */
    updateParams(params: Partial<ParticleParams>): void;
    /**
     * Dispose of GPU resources.
     */
    dispose(): void;
}
//# sourceMappingURL=UnderwaterParticles.d.ts.map
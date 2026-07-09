import * as THREE from "three/webgpu";
import type { IWaveSampler, IWaveSimulation } from "../../simulation/waves";
import { type BuoyancyOptions, type BuoyancyDebugData } from "./types";
/**
 * BuoyancySystem manages floating objects on the water surface.
 */
export declare class BuoyancySystem {
    private sampler;
    private objects;
    private nextId;
    private positionBuffer;
    private _cameraPos;
    private _cameraSampleIndex;
    private _cameraWaterHeight;
    private tempQuaternion;
    private tempOffsetQuaternion;
    private tempEuler;
    constructor(sampler: IWaveSampler);
    /**
     * Add an object to the buoyancy system.
     * @param object The THREE.js mesh to apply buoyancy to
     * @param options Configuration options for the buoyant object
     * @returns A unique ID that can be used to remove or update the object
     */
    addObject(object: THREE.Mesh, options?: BuoyancyOptions): number;
    /**
     * Remove an object from the buoyancy system.
     * @param id The ID returned by addObject
     * @returns True if the object was removed, false if not found
     */
    removeObject(id: number): boolean;
    /**
     * Update an object's configuration.
     * @param id The ID returned by addObject
     * @param options Configuration options to update
     * @returns True if the object was updated, false if not found
     */
    updateObjectConfig(id: number, options: BuoyancyOptions): boolean;
    /**
     * Update the position buffer from current object positions.
     * Called when objects are added/removed.
     * For multi-point sampling, adds center + 4 cardinal points per object.
     */
    private updatePositionBuffer;
    private tempForward;
    private tempRight;
    private tempPos;
    private tempEulerTarget;
    private tempEulerCurrent;
    /**
     * SmoothDamp - critically damped spring for smooth motion.
     * Guarantees smooth motion regardless of response time.
     * Based on Game Programming Gems 4, Chapter 1.10.
     *
     * @param current Current value
     * @param target Target value
     * @param velocity Current velocity (will be modified)
     * @param smoothTime Time to reach the target (response time in seconds)
     * @param deltaTime Frame delta time
     * @returns New smoothed value
     */
    private smoothDamp;
    /**
     * Smoothly interpolate rotation using angular velocity damping.
     * Converts quaternions to euler angles, applies SmoothDamp to each axis,
     * then converts back to quaternion.
     *
     * @param current Current quaternion (will be modified)
     * @param target Target quaternion
     * @param angularVelocity Current angular velocity in euler angles (will be modified)
     * @param smoothTime Response time in seconds
     * @param deltaTime Frame delta time
     */
    private smoothDampQuaternion;
    /**
     * Update all buoyant objects.
     * Should be called once per frame after the ocean simulation has updated.
     *
     * @param deltaTime Time since last frame in seconds (used for smoothing)
     */
    update(deltaTime: number): Promise<void>;
    /**
     * Populate the position buffer with sample positions for an object.
     */
    private populateSamplePositions;
    /**
     * Populate 5-point sample positions for multi-point sampling.
     */
    private populateMultiPointSamples;
    /**
     * Calculate target height and rotation for an object based on samples.
     * Returns null rotation for single-point mode (no rotation changes).
     */
    private calculateTargetTransform;
    /**
     * Calculate transform from 5-point sampling (height average + pitch/roll).
     */
    private calculateMultiPointTransform;
    /**
     * Calculate transform from single-point sampling (height only, no rotation).
     * Returns null rotation to indicate no rotation changes should be applied.
     */
    private calculateSinglePointTransform;
    /**
     * Blend rotation toward upright based on rotation influence.
     */
    private applyRotationInfluence;
    /**
     * Apply smoothed transform to object, handling first frame initialization.
     * If target.rotation is null, only height is updated (single-point mode).
     */
    private applySmoothedTransform;
    /**
     * Get the number of registered buoyant objects.
     */
    getObjectCount(): number;
    /**
     * Check if an object is registered.
     */
    hasObject(id: number): boolean;
    /**
     * Clear all buoyant objects.
     */
    clear(): void;
    /**
     * Set the camera position for water height sampling.
     * Call before update() each frame.
     */
    setCameraPosition(x: number, z: number): void;
    /**
     * Get the water height at the camera's position.
     * Only valid after update() has been called.
     */
    getCameraWaterHeight(): number;
    /**
     * Replace the wave sampler (e.g., after quality level change).
     */
    setSampler(sampler: IWaveSampler): void;
    /**
     * Update cascade uniforms (call when ocean simulation cascades change).
     */
    updateCascadeUniforms(): void;
    /**
     * Rebind to the wave simulation when its cascade config changes.
     * Uses the stored sampler — the parameter is for interface uniformity
     * with other cascade subscribers.
     */
    onCascadeChanged(_sim: IWaveSimulation): void;
    /**
     * Get the internal WaveSampler instance.
     * Useful for underwater detection or other systems that need to sample the ocean surface.
     */
    getSampler(): IWaveSampler;
    /**
     * Get debug data for visualization.
     * Returns sample point positions, heights, and normals for each buoyant object.
     */
    getDebugData(): BuoyancyDebugData[];
    /**
     * Dispose of resources.
     */
    dispose(): void;
}
//# sourceMappingURL=BuoyancySystem.d.ts.map
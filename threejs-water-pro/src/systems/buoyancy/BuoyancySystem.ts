// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type { IWaveSampler, IWaveSimulation } from "../../simulation/waves";
import { MAX_SAMPLE_POINTS } from "../../simulation/waves";
import {
  BUOYANCY_DEFAULTS,
  type BuoyantObject,
  type BuoyancyOptions,
  type BuoyancyDebugData,
  type SamplePointData,
} from "./types";

/**
 * BuoyancySystem manages floating objects on the water surface.
 */
export class BuoyancySystem {
  private sampler: IWaveSampler;
  private objects: Map<number, BuoyantObject> = new Map();
  private nextId: number = 0;
  private positionBuffer: THREE.Vector3[] = [];

  // Camera height sampling — always occupies the last slot in the position buffer.
  // Eliminates the need for a separate GPU readback to detect camera submersion.
  private _cameraPos = new THREE.Vector3();
  private _cameraSampleIndex: number = 0;
  private _cameraWaterHeight: number = 0;

  // Temporary vectors for calculations (reused to avoid allocations)
  private tempQuaternion = new THREE.Quaternion();
  private tempOffsetQuaternion = new THREE.Quaternion();
  private tempEuler = new THREE.Euler();

  constructor(sampler: IWaveSampler) {
    this.sampler = sampler;
    this.updatePositionBuffer();
  }

  /**
   * Add an object to the buoyancy system.
   * @param object The THREE.js mesh to apply buoyancy to
   * @param options Configuration options for the buoyant object
   * @returns A unique ID that can be used to remove or update the object
   */
  public addObject(object: THREE.Mesh, options?: BuoyancyOptions): number {
    if (this.objects.size >= MAX_SAMPLE_POINTS) {
      console.warn(
        `BuoyancySystem: Maximum of ${MAX_SAMPLE_POINTS} objects reached. Object not added.`,
      );
      return -1;
    }

    const id = this.nextId++;
    const opts = options ?? {};

    // Determine sampling mode
    const multiPoint = opts.multiPoint ?? BUOYANCY_DEFAULTS.multiPoint;

    // Compute sample dimensions and offset from bounding box if enabled (only for multiPoint mode)
    let sampleLength = opts.sampleLength ?? BUOYANCY_DEFAULTS.sampleLength;
    let sampleWidth = opts.sampleWidth ?? BUOYANCY_DEFAULTS.sampleWidth;
    const sampleOffset = opts.sampleOffset?.clone() ?? new THREE.Vector3(0, 0, 0);

    if (multiPoint) {
      const useBoundingBox = opts.useBoundingBox ?? BUOYANCY_DEFAULTS.useBoundingBox;
      if (useBoundingBox) {
        const box = new THREE.Box3().setFromObject(object);
        const bounds = new THREE.Vector3();
        box.getSize(bounds);
        sampleLength = bounds.z;
        sampleWidth = bounds.x;

        // Compute center offset if not explicitly provided
        // This handles models where the origin isn't at the visual center
        if (!opts.sampleOffset) {
          const center = new THREE.Vector3();
          box.getCenter(center);
          // Convert to local space (relative to object position)
          sampleOffset.x = center.x - object.position.x;
          sampleOffset.z = center.z - object.position.z;
        }
      }
    }

    const buoyantObject: BuoyantObject = {
      id,
      object,
      heightOffset: opts.heightOffset ?? BUOYANCY_DEFAULTS.heightOffset,
      heightSmoothing:
        opts.heightSmoothing ?? BUOYANCY_DEFAULTS.heightSmoothing,
      multiPoint,
      sampleLength,
      sampleWidth,
      sampleOffset,
      rotationOffset: opts.rotationOffset?.clone() ?? new THREE.Euler(0, 0, 0),
      rotationInfluence:
        opts.rotationInfluence ?? BUOYANCY_DEFAULTS.rotationInfluence,
      rotationSmoothing:
        opts.rotationSmoothing ?? BUOYANCY_DEFAULTS.rotationSmoothing,
      currentHeight: object.position.y,
      currentQuaternion: object.quaternion.clone(),
      heightVelocity: 0,
      angularVelocity: new THREE.Vector3(0, 0, 0),
      isFirstFrame: true,
      sampleIndices: [],
    };

    this.objects.set(id, buoyantObject);
    this.updatePositionBuffer();

    return id;
  }

  /**
   * Remove an object from the buoyancy system.
   * @param id The ID returned by addObject
   * @returns True if the object was removed, false if not found
   */
  public removeObject(id: number): boolean {
    const removed = this.objects.delete(id);
    if (removed) {
      this.updatePositionBuffer();
    }
    return removed;
  }

  /**
   * Update an object's configuration.
   * @param id The ID returned by addObject
   * @param options Configuration options to update
   * @returns True if the object was updated, false if not found
   */
  public updateObjectConfig(id: number, options: BuoyancyOptions): boolean {
    const obj = this.objects.get(id);
    if (!obj) return false;

    // Track if we need to rebuild position buffer
    const prevMultiPoint = obj.multiPoint;

    // Update simple properties
    if (options.heightOffset !== undefined) {
      obj.heightOffset = options.heightOffset;
    }
    if (options.heightSmoothing !== undefined) {
      obj.heightSmoothing = options.heightSmoothing;
    }

    // Handle multiPoint mode change
    if (options.multiPoint !== undefined) {
      obj.multiPoint = options.multiPoint;

      // If switching to multiPoint mode, compute bounding box dimensions if needed
      if (obj.multiPoint && (options.useBoundingBox ?? true)) {
        const box = new THREE.Box3().setFromObject(obj.object);
        const bounds = new THREE.Vector3();
        box.getSize(bounds);
        obj.sampleLength = bounds.z;
        obj.sampleWidth = bounds.x;

        // Compute center offset if not explicitly provided
        if (!options.sampleOffset) {
          const center = new THREE.Vector3();
          box.getCenter(center);
          obj.sampleOffset.x = center.x - obj.object.position.x;
          obj.sampleOffset.z = center.z - obj.object.position.z;
        }
      }
    }

    // Multi-point configuration
    if (options.sampleOffset !== undefined) {
      obj.sampleOffset = options.sampleOffset.clone();
    }
    if (options.sampleLength !== undefined) {
      obj.sampleLength = options.sampleLength;
    }
    if (options.sampleWidth !== undefined) {
      obj.sampleWidth = options.sampleWidth;
    }

    // Rotation properties (only meaningful when multiPoint: true)
    if (options.rotationOffset !== undefined) {
      obj.rotationOffset = options.rotationOffset.clone();
    }
    if (options.rotationInfluence !== undefined) {
      obj.rotationInfluence = options.rotationInfluence;
    }
    if (options.rotationSmoothing !== undefined) {
      obj.rotationSmoothing = options.rotationSmoothing;
    }

    // Handle useBoundingBox (recompute dimensions from bounding box)
    if (options.useBoundingBox && obj.multiPoint) {
      const box = new THREE.Box3().setFromObject(obj.object);
      const bounds = new THREE.Vector3();
      box.getSize(bounds);
      obj.sampleLength = bounds.z;
      obj.sampleWidth = bounds.x;
    }

    // Rebuild position buffer if sampling mode changed
    if (prevMultiPoint !== obj.multiPoint) {
      this.updatePositionBuffer();
    }

    return true;
  }

  /**
   * Update the position buffer from current object positions.
   * Called when objects are added/removed.
   * For multi-point sampling, adds center + 4 cardinal points per object.
   */
  private updatePositionBuffer(): void {
    this.positionBuffer = [];

    for (const obj of this.objects.values()) {
      obj.sampleIndices = [];

      if (obj.multiPoint) {
        // Multi-point sampling: center, bow, stern, port, starboard (5 points)
        for (let i = 0; i < 5; i++) {
          obj.sampleIndices.push(this.positionBuffer.length);
          this.positionBuffer.push(obj.object.position.clone());
        }
      } else {
        // Single-point sampling (1 point)
        obj.sampleIndices.push(this.positionBuffer.length);
        this.positionBuffer.push(obj.object.position.clone());
      }
    }

    // Camera sample is always the last slot
    this._cameraSampleIndex = this.positionBuffer.length;
    this.positionBuffer.push(this._cameraPos);
  }

  // Temporary vectors for multi-point calculations
  private tempForward = new THREE.Vector3();
  private tempRight = new THREE.Vector3();
  private tempPos = new THREE.Vector3();
  private tempEulerTarget = new THREE.Euler();
  private tempEulerCurrent = new THREE.Euler();

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
  private smoothDamp(
    current: number,
    target: number,
    velocity: { value: number },
    smoothTime: number,
    deltaTime: number,
  ): number {
    // Clamp smoothTime to avoid division by zero
    smoothTime = Math.max(0.0001, smoothTime);

    const omega = 2 / smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

    const change = current - target;
    const temp = (velocity.value + omega * change) * deltaTime;

    velocity.value = (velocity.value - omega * temp) * exp;
    return target + (change + temp) * exp;
  }

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
  private smoothDampQuaternion(
    current: THREE.Quaternion,
    target: THREE.Quaternion,
    angularVelocity: THREE.Vector3,
    smoothTime: number,
    deltaTime: number,
  ): void {
    this.tempEulerCurrent.setFromQuaternion(current, "YXZ");
    this.tempEulerTarget.setFromQuaternion(target, "YXZ");

    const velX = { value: angularVelocity.x };
    const velY = { value: angularVelocity.y };
    const velZ = { value: angularVelocity.z };

    let dx = this.tempEulerTarget.x - this.tempEulerCurrent.x;
    let dy = this.tempEulerTarget.y - this.tempEulerCurrent.y;
    let dz = this.tempEulerTarget.z - this.tempEulerCurrent.z;

    while (dx > Math.PI) dx -= 2 * Math.PI;
    while (dx < -Math.PI) dx += 2 * Math.PI;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    while (dz > Math.PI) dz -= 2 * Math.PI;
    while (dz < -Math.PI) dz += 2 * Math.PI;

    const newX = this.smoothDamp(
      this.tempEulerCurrent.x,
      this.tempEulerCurrent.x + dx,
      velX,
      smoothTime,
      deltaTime,
    );
    const newY = this.smoothDamp(
      this.tempEulerCurrent.y,
      this.tempEulerCurrent.y + dy,
      velY,
      smoothTime,
      deltaTime,
    );
    const newZ = this.smoothDamp(
      this.tempEulerCurrent.z,
      this.tempEulerCurrent.z + dz,
      velZ,
      smoothTime,
      deltaTime,
    );

    angularVelocity.set(velX.value, velY.value, velZ.value);

    this.tempEulerCurrent.set(newX, newY, newZ, "YXZ");
    current.setFromEuler(this.tempEulerCurrent);
  }

  /**
   * Update all buoyant objects.
   * Should be called once per frame after the ocean simulation has updated.
   *
   * @param deltaTime Time since last frame in seconds (used for smoothing)
   */
  public async update(deltaTime: number): Promise<void> {
    // Phase 1: Populate position buffers for all objects
    for (const obj of this.objects.values()) {
      this.populateSamplePositions(obj);
    }

    // Phase 2: Sample the ocean at all positions (always runs — camera sample is always active).
    // Frame-late path: drains the previous frame's readback (≈ free) and
    // kicks off this frame's compute without waiting for it. Removes the
    // per-frame GPU sync stall on WebGPU.
    this.sampler.setPositions(this.positionBuffer);
    await this.sampler.updateLowLatency();

    // Read camera water height from the dedicated sample slot
    this._cameraWaterHeight = this.sampler.getSample(
      this._cameraSampleIndex,
    ).height;

    // Phase 3: Apply samples to update object transforms
    for (const obj of this.objects.values()) {
      const target = this.calculateTargetTransform(obj);
      this.applySmoothedTransform(obj, target, deltaTime);
    }
  }

  /**
   * Populate the position buffer with sample positions for an object.
   */
  private populateSamplePositions(obj: BuoyantObject): void {
    const pos = obj.object.position;

    // Use appropriate quaternion based on mode:
    // - Multi-point: use tracked currentQuaternion (we manage rotation)
    // - Single-point: use object's actual quaternion (we don't manage rotation)
    const quat = obj.multiPoint ? obj.currentQuaternion : obj.object.quaternion;

    // Calculate object's current orientation vectors (needed for multi-point and offset)
    this.tempForward.set(0, 0, 1).applyQuaternion(quat);
    this.tempRight.set(1, 0, 0).applyQuaternion(quat);

    // Calculate sample center (accounting for offset)
    this.tempPos.copy(pos);
    if (obj.sampleOffset.x !== 0 || obj.sampleOffset.z !== 0) {
      this.tempPos.addScaledVector(this.tempRight, obj.sampleOffset.x);
      this.tempPos.addScaledVector(this.tempForward, obj.sampleOffset.z);
    }
    const sampleCenter = this.tempPos.clone();

    if (obj.multiPoint && obj.sampleIndices.length === 5) {
      this.populateMultiPointSamples(obj, sampleCenter);
    } else if (obj.sampleIndices.length > 0) {
      this.positionBuffer[obj.sampleIndices[0]].copy(sampleCenter);
    }
  }

  /**
   * Populate 5-point sample positions for multi-point sampling.
   */
  private populateMultiPointSamples(
    obj: BuoyantObject,
    center: THREE.Vector3,
  ): void {
    const halfLength = obj.sampleLength / 2;
    const halfWidth = obj.sampleWidth / 2;

    // Center
    this.positionBuffer[obj.sampleIndices[0]].copy(center);

    // Bow (front)
    this.tempPos.copy(center).addScaledVector(this.tempForward, halfLength);
    this.positionBuffer[obj.sampleIndices[1]].copy(this.tempPos);

    // Stern (back)
    this.tempPos.copy(center).addScaledVector(this.tempForward, -halfLength);
    this.positionBuffer[obj.sampleIndices[2]].copy(this.tempPos);

    // Port (left)
    this.tempPos.copy(center).addScaledVector(this.tempRight, -halfWidth);
    this.positionBuffer[obj.sampleIndices[3]].copy(this.tempPos);

    // Starboard (right)
    this.tempPos.copy(center).addScaledVector(this.tempRight, halfWidth);
    this.positionBuffer[obj.sampleIndices[4]].copy(this.tempPos);
  }

  /**
   * Calculate target height and rotation for an object based on samples.
   * Returns null rotation for single-point mode (no rotation changes).
   */
  private calculateTargetTransform(obj: BuoyantObject): {
    height: number;
    rotation: THREE.Quaternion | null;
  } {
    if (obj.multiPoint && obj.sampleIndices.length === 5) {
      return this.calculateMultiPointTransform(obj);
    }
    return this.calculateSinglePointTransform(obj);
  }

  /**
   * Calculate transform from 5-point sampling (height average + pitch/roll).
   */
  private calculateMultiPointTransform(obj: BuoyantObject): {
    height: number;
    rotation: THREE.Quaternion;
  } {
    const centerSample = this.sampler.getSample(obj.sampleIndices[0]);
    const bowSample = this.sampler.getSample(obj.sampleIndices[1]);
    const sternSample = this.sampler.getSample(obj.sampleIndices[2]);
    const portSample = this.sampler.getSample(obj.sampleIndices[3]);
    const starboardSample = this.sampler.getSample(obj.sampleIndices[4]);

    // Average height from all 5 points
    const height =
      (centerSample.height +
        bowSample.height +
        sternSample.height +
        portSample.height +
        starboardSample.height) /
        5 +
      obj.heightOffset;

    // Calculate pitch (bow/stern tilt) - negate for correct Three.js orientation
    let pitch = 0;
    if (obj.sampleLength > 0) {
      const pitchDiff = bowSample.height - sternSample.height;
      pitch = -Math.atan2(pitchDiff, obj.sampleLength);
    }

    // Calculate roll (port/starboard tilt)
    let roll = 0;
    if (obj.sampleWidth > 0) {
      const rollDiff = starboardSample.height - portSample.height;
      roll = Math.atan2(rollDiff, obj.sampleWidth);
    }

    // Build quaternion from pitch and roll, then apply rotation offset
    this.tempEuler.set(pitch, 0, roll, "YXZ");
    this.tempQuaternion.setFromEuler(this.tempEuler);
    this.tempOffsetQuaternion.setFromEuler(obj.rotationOffset);
    this.tempQuaternion.multiply(this.tempOffsetQuaternion);

    return {
      height,
      rotation: this.applyRotationInfluence(obj, this.tempQuaternion),
    };
  }

  /**
   * Calculate transform from single-point sampling (height only, no rotation).
   * Returns null rotation to indicate no rotation changes should be applied.
   */
  private calculateSinglePointTransform(obj: BuoyantObject): {
    height: number;
    rotation: null;
  } {
    const sample = this.sampler.getSample(obj.sampleIndices[0]);
    const height = sample.height + obj.heightOffset;

    // Single-point mode: no rotation changes, only height
    return { height, rotation: null };
  }

  /**
   * Blend rotation toward upright based on rotation influence.
   */
  private applyRotationInfluence(
    obj: BuoyantObject,
    rotation: THREE.Quaternion,
  ): THREE.Quaternion {
    if (obj.rotationInfluence < 1) {
      this.tempOffsetQuaternion.setFromEuler(obj.rotationOffset);
      rotation.slerp(this.tempOffsetQuaternion, 1 - obj.rotationInfluence);
    }
    return rotation;
  }

  /**
   * Apply smoothed transform to object, handling first frame initialization.
   * If target.rotation is null, only height is updated (single-point mode).
   */
  private applySmoothedTransform(
    obj: BuoyantObject,
    target: { height: number; rotation: THREE.Quaternion | null },
    deltaTime: number,
  ): void {
    if (obj.isFirstFrame) {
      // First frame: set directly without smoothing
      obj.currentHeight = target.height;
      if (target.rotation !== null) {
        obj.currentQuaternion.copy(target.rotation);
      }
      obj.heightVelocity = 0;
      obj.angularVelocity.set(0, 0, 0);
      obj.isFirstFrame = false;
    } else {
      // Apply smooth damping for height
      const heightResponseTime = Math.max(0.02, obj.heightSmoothing);
      const heightVel = { value: obj.heightVelocity };
      obj.currentHeight = this.smoothDamp(
        obj.currentHeight,
        target.height,
        heightVel,
        heightResponseTime,
        deltaTime,
      );
      obj.heightVelocity = heightVel.value;

      // Apply smooth damping for rotation (only if multiPoint mode)
      if (target.rotation !== null) {
        const rotationResponseTime = Math.max(0.02, obj.rotationSmoothing);
        this.smoothDampQuaternion(
          obj.currentQuaternion,
          target.rotation,
          obj.angularVelocity,
          rotationResponseTime,
          deltaTime,
        );
      }
    }

    // Apply to Three.js object
    obj.object.position.y = obj.currentHeight;
    if (target.rotation !== null) {
      obj.object.quaternion.copy(obj.currentQuaternion);
    }
  }

  /**
   * Get the number of registered buoyant objects.
   */
  public getObjectCount(): number {
    return this.objects.size;
  }

  /**
   * Check if an object is registered.
   */
  public hasObject(id: number): boolean {
    return this.objects.has(id);
  }

  /**
   * Clear all buoyant objects.
   */
  public clear(): void {
    this.objects.clear();
    this.updatePositionBuffer();
  }

  /**
   * Set the camera position for water height sampling.
   * Call before update() each frame.
   */
  public setCameraPosition(x: number, z: number): void {
    this._cameraPos.x = x;
    this._cameraPos.z = z;
  }

  /**
   * Get the water height at the camera's position.
   * Only valid after update() has been called.
   */
  public getCameraWaterHeight(): number {
    return this._cameraWaterHeight;
  }

  /**
   * Replace the wave sampler (e.g., after quality level change).
   */
  public setSampler(sampler: IWaveSampler): void {
    this.sampler = sampler;
  }

  /**
   * Update cascade uniforms (call when ocean simulation cascades change).
   */
  public updateCascadeUniforms(): void {
    this.sampler.updateCascadeUniforms();
  }

  /**
   * Rebind to the wave simulation when its cascade config changes.
   * Uses the stored sampler — the parameter is for interface uniformity
   * with other cascade subscribers.
   */
  public onCascadeChanged(_sim: IWaveSimulation): void {
    this.updateCascadeUniforms();
  }

  /**
   * Get the internal WaveSampler instance.
   * Useful for underwater detection or other systems that need to sample the ocean surface.
   */
  public getSampler(): IWaveSampler {
    return this.sampler;
  }

  /**
   * Get debug data for visualization.
   * Returns sample point positions, heights, and normals for each buoyant object.
   */
  public getDebugData(): BuoyancyDebugData[] {
    const debugData: BuoyancyDebugData[] = [];

    for (const obj of this.objects.values()) {
      const samplePoints: SamplePointData[] = [];

      if (obj.multiPoint && obj.sampleIndices.length === 5) {
        // Multi-point sampling: skip center (index 0), show only cardinal points
        const labels = ["bow", "stern", "port", "starboard"];
        for (let i = 1; i < 5; i++) {
          const sample = this.sampler.getSample(obj.sampleIndices[i]);
          const pos = this.positionBuffer[obj.sampleIndices[i]];
          samplePoints.push({
            position: pos.clone(),
            height: sample.height,
            normal: sample.normal.clone(),
            label: labels[i - 1],
          });
        }
      } else if (obj.sampleIndices.length > 0) {
        // Single-point sampling
        const sample = this.sampler.getSample(obj.sampleIndices[0]);
        const pos = this.positionBuffer[obj.sampleIndices[0]];
        samplePoints.push({
          position: pos.clone(),
          height: sample.height,
          normal: sample.normal.clone(),
          label: "center",
        });
      }

      debugData.push({
        id: obj.id,
        samplePoints,
      });
    }

    return debugData;
  }

  /**
   * Dispose of resources.
   */
  public dispose(): void {
    this.sampler.dispose();
    this.objects.clear();
    this.positionBuffer = [];
  }
}

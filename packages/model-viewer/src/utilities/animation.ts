/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ModelScene } from '../three-components/ModelScene.js';
import { clamp } from '../utilities.js';
import {
  Box3,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  TetrahedronGeometry,
  Vector3,
} from 'three';

const TRANSITION_DURATION = 300;

export const easeInQuint: TimingFunction = (t: number) => t * t * t * t * t;

// Simple ease-in for scale-out animations
export const easeInQuad: TimingFunction = (t: number) => t * t;

// Adapted from https://gist.github.com/gre/1650294
export const easeInOutQuad: TimingFunction = (t: number) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/**
 * A TimingFunction accepts a value from 0-1 and returns a corresponding
 * interpolated value
 */
export type TimingFunction = (time: number) => number;

/**
 * Creates a TimingFunction that uses a given ease to interpolate between
 * two configured number values.
 */
export const interpolate =
  (
    start: number,
    end: number,
    ease: TimingFunction = easeInOutQuad
  ): TimingFunction =>
  (time: number) =>
    start + (end - start) * ease(time);

/**
 * Creates a TimingFunction that interpolates through a weighted list
 * of other TimingFunctions ("tracks"). Tracks are interpolated in order, and
 * allocated a percentage of the total time based on their relative weight.
 */
export const sequence = (
  tracks: Array<TimingFunction>,
  weights: Array<number>
): TimingFunction => {
  const cumulativeSum = (sum: number) => (value: number) => (sum += value);
  const times = weights.map(cumulativeSum(0));

  return (time: number) => {
    time = clamp(time, 0, 1);
    time *= times[times.length - 1];
    const i = times.findIndex((val) => val >= time);

    const start = i < 1 ? 0 : times[i - 1];
    const end = times[i];

    return tracks[i]((time - start) / (end - start));
  };
};

/**
 * A Frame groups a target value, the number of frames to interpolate towards
 * that value and an optional easing function to use for interpolation.
 */
export interface Frame {
  value: number;
  frames: number;
  ease?: TimingFunction;
}

export interface Path {
  initialValue: number;
  keyframes: Frame[];
}

/**
 * Creates a "timeline" TimingFunction out of an initial value and a series of
 * Keyframes. The timeline function accepts value from 0-1 and returns the
 * current value based on keyframe interpolation across the total number of
 * frames. Frames are only used to indicate the relative length of each keyframe
 * transition, so interpolated values will be computed for fractional frames.
 */
export const timeline = (path: Path): TimingFunction => {
  const tracks: Array<TimingFunction> = [];
  const weights: Array<number> = [];

  let lastValue = path.initialValue;

  for (let i = 0; i < path.keyframes.length; ++i) {
    const keyframe = path.keyframes[i];
    const { value, frames } = keyframe;
    const ease = keyframe.ease || easeInOutQuad;
    const track = interpolate(lastValue, value, ease);

    tracks.push(track);
    weights.push(frames);
    lastValue = value;
  }

  return sequence(tracks, weights);
};

/**
 * Quaternion animation state used for stepping quaternion slerp driven
 * by an external tick (delta time in ms).
 */
export interface QuatAnimation {
  elapsed: number;
  duration: number; // ms
  startQuat: Quaternion;
  endQuat: Quaternion;
}

/**
 * Create a new quaternion animation state. Clones quaternions to avoid
 * accidental mutation by callers.
 */
export const createQuatAnimation = (
  startQuat: Quaternion,
  endQuat: Quaternion,
  duration = TRANSITION_DURATION
): QuatAnimation => ({
  elapsed: 0,
  duration,
  startQuat: startQuat.clone(),
  endQuat: endQuat.clone(),
});

/**
 * Step a map of quaternion animations by `deltaMs` milliseconds. This will
 * slerp each object's quaternion towards its target and remove completed
 * animations from the map. Uses `easeInOutQuad` easing.
 */
export const stepQuatAnimations = (
  map: Map<Object3D, QuatAnimation>,
  deltaMs: number
): void => {
  if (!map || map.size === 0) return;

  for (const [obj, anim] of Array.from(map.entries())) {
    anim.elapsed += deltaMs;
    const t = Math.min(1, Math.max(0, anim.elapsed / anim.duration));
    const eased = easeInOutQuad(t);

    try {
      obj.quaternion.copy(anim.startQuat);
      obj.quaternion.slerp(anim.endQuat, eased);
    } catch (e) {
      // ignore per-object failures
    }

    if (t >= 1) {
      try {
        obj.quaternion.copy(anim.endQuat);
      } catch (e) {}
      map.delete(obj);
    }
  }
};

export const stopQuatAnimation = (
  map: Map<Object3D, QuatAnimation>,
  obj: Object3D
): void => {
  map.delete(obj);
};

// Track in-progress explosion animations (Star Fox-style fragments)
const explosionFragments: Array<{
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  startScale: Vector3;
  elapsedFrames: number;
  maxFrames: number;
  scaleStartFrame: number;
}> = [];

/**
 * Create Star Fox-style explosion fragments for an object.
 * Spawns 3-6 tetrahedron fragments that fly outward while rotating and scaling down.
 */
export function createExplosionFragments(
  obj: Object3D,
  scene: ModelScene | undefined,
  options?: {
    fragmentCount?: number; // Number of fragments (default: 8)
    fragmentSize?: number; // Size of each fragment (default: 0.2)
    duration?: number; // Total frames the animation lasts (default: 40)
    distance?: number; // Max distance to travel (default: object radius, min 1)
    scaleStartFrame?: number; // Frame at which scaling begins (default: 15)
    onComplete?: () => void;
    setupComplete?: () => void;
  }
) {
  const {
    fragmentCount = 8,
    fragmentSize = 0.1,
    duration = 30,
    distance: distanceOption,
    scaleStartFrame = 20,
    onComplete,
  } = options || {};

  if (!scene) return;

  // Calculate the center point of the object
  const box = new Box3().setFromObject(obj);
  const center = new Vector3();
  box.getCenter(center);

  // Calculate object radius and use it for distance if not provided
  const size = new Vector3();
  box.getSize(size);
  const radius = Math.max(size.x, size.y, size.z) / 2;
  const distance = distanceOption ?? Math.max(radius, 1);

  // Calculate speed based on duration and distance
  const speed = distance / duration;

  // Create fragments
  for (let i = 0; i < fragmentCount; i++) {
    // Create a small tetrahedron for each fragment
    const geometry = new TetrahedronGeometry(fragmentSize, 0);
    const material = new MeshBasicMaterial({
      color: 0xffffff, // Math.random() * 0xffffff Random color per fragment
    });
    const fragment = new Mesh(geometry, material);

    // Position at object center
    fragment.position.copy(center);

    // Random outward velocity
    const velocity = new Vector3(
      (Math.random() - 0.5) * speed * 2,
      (Math.random() - 0.5) * speed * 2,
      (Math.random() - 0.5) * speed * 2
    );

    // Ensure some minimum outward velocity
    if (velocity.length() < speed * 0.5) {
      velocity.normalize().multiplyScalar(speed * 0.5);
    }

    // Random angular velocity for rotation
    const angularVelocity = new Vector3(
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.3,
      (Math.random() - 0.5) * 0.3
    );

    // Add to scene
    scene.add(fragment);

    // Track fragment animation state
    explosionFragments.push({
      mesh: fragment,
      velocity,
      angularVelocity,
      startScale: new Vector3(1, 1, 1),
      elapsedFrames: 0,
      maxFrames: duration,
      scaleStartFrame,
    });
  }

  // Store completion callback on the first fragment (any will do)
  if (onComplete && explosionFragments.length > 0) {
    (
      explosionFragments[explosionFragments.length - fragmentCount] as any
    )._onComplete = onComplete;
  }

  options?.setupComplete?.();
}

/**
 * Step explosion fragment animations forward by one frame.
 * Moves fragments outward, rotates them, and scales them down over time.
 */
export function stepExplosionFragments(scene: ModelScene) {
  if (explosionFragments.length === 0) return false;

  // Step explosion fragment animations
  const explosionBefore = explosionFragments.length;

  const toRemove: number[] = [];

  for (let i = 0; i < explosionFragments.length; i++) {
    const fragment = explosionFragments[i];
    fragment.elapsedFrames++;

    // Move fragment outward
    fragment.mesh.position.add(fragment.velocity);

    // Rotate fragment
    fragment.mesh.rotation.x += fragment.angularVelocity.x;
    fragment.mesh.rotation.y += fragment.angularVelocity.y;
    fragment.mesh.rotation.z += fragment.angularVelocity.z;

    // Scale down only after scaleStartFrame
    if (fragment.elapsedFrames >= fragment.scaleStartFrame) {
      const scaleDuration = fragment.maxFrames - fragment.scaleStartFrame;
      const scaleProgress =
        (fragment.elapsedFrames - fragment.scaleStartFrame) / scaleDuration;
      const scale = Math.max(0, 1 - scaleProgress);
      fragment.mesh.scale.set(scale, scale, scale);
    }

    // Mark for removal if animation complete
    if (fragment.elapsedFrames >= fragment.maxFrames) {
      toRemove.push(i);
      if (scene) {
        scene.remove(fragment.mesh);
      }
      // Dispose geometry and material to free memory
      try {
        fragment.mesh.geometry.dispose();
        if (Array.isArray(fragment.mesh.material)) {
          fragment.mesh.material.forEach((m) => m.dispose());
        } else {
          (fragment.mesh.material as MeshBasicMaterial).dispose();
        }
      } catch (e) {}
    }
  }

  // Remove completed fragments (iterate backwards to avoid index issues)
  for (let i = toRemove.length - 1; i >= 0; i--) {
    const idx = toRemove[i];
    const removed = explosionFragments.splice(idx, 1)[0];
    // Call completion callback if this fragment had one
    if ((removed as any)._onComplete) {
      try {
        (removed as any)._onComplete();
      } catch (e) {}
    }
  }

  const explosionAfter = explosionFragments.length;

  if (explosionBefore > 0 || explosionAfter > 0) {
    return true;
  }
  return false;
}

export function clearExplosionFragments(scene: ModelScene) {
  if (scene) {
    for (const fragment of explosionFragments) {
      scene.remove(fragment.mesh);
      // Dispose geometry and material to free memory
      try {
        fragment.mesh.geometry.dispose();
        if (Array.isArray(fragment.mesh.material)) {
          fragment.mesh.material.forEach((m) => m.dispose());
        } else {
          (fragment.mesh.material as MeshBasicMaterial).dispose();
        }
      } catch (e) {}
    }
  }
  explosionFragments.length = 0;
}

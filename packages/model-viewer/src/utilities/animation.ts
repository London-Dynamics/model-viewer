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

import { clamp } from '../utilities.js';
import { Object3D } from 'three';

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
 * Animates an object falling with gravity physics, including bounce and wobble effects
 * @param model The 3D object to animate
 * @param startY Starting Y position
 * @param targetY Target Y position (ground level)
 * @param mass Mass of the object in kg (affects fall speed, bounce, and wobble)
 * @param onUpdate Callback function to trigger rendering
 * @param onComplete Optional callback function called when animation completes
 */
export const animateGravityFall = (
  model: Object3D,
  startY: number,
  targetY: number,
  mass: number = 1.0,
  onUpdate: () => void,
  onComplete?: () => void
): void => {
  const gravity = 9.81; // m/s² - more realistic gravity
  const timeScale = 1000; // Convert to milliseconds

  // Calculate fall time based on physics: t = sqrt(2h/g)
  const fallDistance = Math.abs(startY - targetY); // Use absolute value for safety

  console.log('animateGravityFall called:', {
    startY,
    targetY,
    fallDistance,
    mass,
  });

  // Early exit if no fall distance
  if (fallDistance <= 0.001) {
    model.position.y = targetY;
    onUpdate();
    return;
  }

  // Calculate fall time - make it faster for better visual feedback
  const baseFallTime = Math.sqrt((2 * fallDistance) / gravity) * timeScale;

  // Make fall time shorter for better responsiveness (minimum 200ms, max 800ms)
  const adjustedFallTime = Math.max(200, Math.min(800, baseFallTime * 0.7));

  // Bounce parameters based on mass
  const baseBounceHeight = fallDistance * 0.15; // Reduce bounce height to 15%
  const massInverse = 1.0 / Math.max(mass, 0.1);
  const bounceHeight = baseBounceHeight * Math.min(massInverse * 0.8, 1.0); // More reasonable bounce scaling
  const bounceCount = Math.floor(2 + massInverse * 1.5); // 2-4 bounces max
  const bounceDamping = 0.7 + (mass - 1.0) * 0.05; // Better damping

  // Wobble parameters
  const wobbleIntensity = Math.min(massInverse * 0.06, 0.1); // Slightly less wobble
  const wobbleFrequency = 6 + massInverse * 3; // Adjusted frequency
  const wobbleDuration = 800 + mass * 100; // Shorter wobble duration

  console.log('Animation parameters:', {
    adjustedFallTime,
    bounceHeight,
    bounceCount,
    wobbleDuration,
  });

  // Store initial rotation for wobble reset
  const initialRotation = {
    x: model.rotation.x,
    y: model.rotation.y,
    z: model.rotation.z,
  };

  const startTime = performance.now();
  let currentBounce = 0;
  let currentBounceHeight = bounceHeight;
  let bounceStartTime = 0;
  let isInBouncePhase = false;
  let bouncePhaseComplete = false;
  let wobbleStartTime = 0;

  const animate = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    // Debug logging - uncomment for debugging
    // console.log(`Animation frame: elapsed=${elapsed}ms, currentY=${model.position.y}`);

    if (!isInBouncePhase) {
      // Initial fall phase - use different easing for more immediate visual feedback
      const progress = Math.min(elapsed / adjustedFallTime, 1.0);

      // Use a less aggressive easing that starts faster
      const easedProgress =
        progress < 0.5
          ? 2 * progress * progress
          : 1 - 2 * (1 - progress) * (1 - progress);

      // Calculate position - handle both positive and negative fall directions
      const currentY =
        startY > targetY
          ? startY - fallDistance * easedProgress // Falling down
          : startY + fallDistance * easedProgress; // Falling up (unusual but handle it)

      model.position.y =
        startY > targetY
          ? Math.max(currentY, targetY) // Don't go below target when falling down
          : Math.min(currentY, targetY); // Don't go above target when falling up

      if (progress >= 1.0 && !bouncePhaseComplete) {
        // Hit the ground, start bounce phase
        isInBouncePhase = true;
        bounceStartTime = currentTime;
        wobbleStartTime = currentTime;
        model.position.y = targetY;
      }
    } else {
      // Bounce phase
      const bounceElapsed = currentTime - bounceStartTime;
      const bounceTime =
        Math.sqrt((2 * currentBounceHeight) / gravity) * timeScale;
      const totalBounceTime = bounceTime * 2; // Up and down

      if (bounceElapsed < totalBounceTime && currentBounce < bounceCount) {
        // Calculate bounce position
        const bounceProgress = bounceElapsed / totalBounceTime;
        let bounceY;

        if (bounceProgress < 0.5) {
          // Going up - use quadratic easing out for smooth launch
          const upProgress = bounceProgress * 2;
          bounceY =
            targetY +
            currentBounceHeight * (1 - (1 - upProgress) * (1 - upProgress));
        } else {
          // Coming down - use quadratic easing in for gravity effect
          const downProgress = (bounceProgress - 0.5) * 2;
          bounceY =
            targetY + currentBounceHeight * (1 - downProgress * downProgress);
        }

        model.position.y = bounceY;
      } else {
        // Bounce finished, prepare for next bounce or end
        model.position.y = targetY;
        currentBounce++;

        if (currentBounce < bounceCount && currentBounceHeight > 0.005) {
          // Start next bounce
          currentBounceHeight *= bounceDamping;
          bounceStartTime = currentTime;
        } else {
          // All bounces finished
          isInBouncePhase = false;
          bouncePhaseComplete = true;
        }
      }
    }

    // Add wobble effect during and after landing
    const wobbleElapsed = currentTime - wobbleStartTime;
    if (wobbleStartTime > 0 && wobbleElapsed < wobbleDuration) {
      const wobbleProgress = wobbleElapsed / wobbleDuration;
      const wobbleDecay = Math.pow(1 - wobbleProgress, 2); // Quadratic decay
      const wobbleAmount = wobbleIntensity * wobbleDecay;

      // Create subtle wobble on X and Z axes
      const wobbleTime = wobbleElapsed * wobbleFrequency * 0.001;
      const wobbleX = Math.sin(wobbleTime) * wobbleAmount;
      const wobbleZ = Math.cos(wobbleTime * 1.3) * wobbleAmount * 0.7; // Slightly different frequency and amplitude

      model.rotation.x = initialRotation.x + wobbleX;
      model.rotation.z = initialRotation.z + wobbleZ;
    } else if (wobbleStartTime > 0) {
      // Reset rotation to initial values
      model.rotation.x = initialRotation.x;
      model.rotation.y = initialRotation.y;
      model.rotation.z = initialRotation.z;
    }

    // Trigger render
    onUpdate();

    // Continue animation if not completely finished
    const stillFalling = !isInBouncePhase && elapsed < adjustedFallTime;
    const stillBouncing = isInBouncePhase && !bouncePhaseComplete;
    const stillWobbling = wobbleStartTime > 0 && wobbleElapsed < wobbleDuration;

    if (stillFalling || stillBouncing || stillWobbling) {
      requestAnimationFrame(animate);
    } else {
      // Ensure final position and rotation are exact
      model.position.y = targetY;
      model.rotation.x = initialRotation.x;
      model.rotation.y = initialRotation.y;
      model.rotation.z = initialRotation.z;
      onUpdate();

      // Call completion callback if provided
      if (onComplete) {
        onComplete();
      }
    }
  };

  console.log('Starting animation...');
  requestAnimationFrame(animate);
};

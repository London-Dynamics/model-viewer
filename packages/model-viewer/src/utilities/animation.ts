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
import { Object3D, Quaternion, Vector3 } from 'three';

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

/**
 * Scale animation state used for stepping scale lerps driven by an
 * external tick (delta time in ms).
 */
export interface ScaleAnimation {
  elapsed: number;
  duration: number; // ms
  start: Vector3;
  end: Vector3;
  onComplete?: (obj: Object3D) => void;
}

/**
 * Create a scale animation state. Clones vectors to avoid accidental
 * mutation by callers.
 */
export const createScaleAnimation = (
  start: Vector3,
  end: Vector3,
  onComplete?: (obj: Object3D) => void,
  duration = TRANSITION_DURATION
): ScaleAnimation => ({
  elapsed: 0,
  duration,
  start: start.clone(),
  end: end.clone(),
  onComplete,
});

/**
 * Step a map of scale animations by `deltaMs` milliseconds. This will
 * lerp each object's scale towards its target and remove completed
 * animations from the map. Uses `easeInQuint` easing by default.
 */
export const stepScaleAnimations = (
  map: Map<Object3D, ScaleAnimation>,
  deltaMs: number
): void => {
  if (!map || map.size === 0) return;

  for (const [obj, anim] of Array.from(map.entries())) {
    anim.elapsed += deltaMs;
    const t = Math.min(1, Math.max(0, anim.elapsed / anim.duration));
    const eased = easeInQuint(t);

    try {
      const v = anim.start.clone().lerp(anim.end, eased);
      obj.scale.copy(v);
    } catch (e) {
      // ignore per-object failures
    }

    if (t >= 1) {
      try {
        obj.scale.copy(anim.end);
      } catch (e) {}
      try {
        if (anim.onComplete) anim.onComplete(obj);
      } catch (e) {}
      map.delete(obj);
    }
  }
};

export const stopScaleAnimation = (
  map: Map<Object3D, ScaleAnimation>,
  obj: Object3D
): void => {
  map.delete(obj);
};

/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
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

import {Camera, PerspectiveCamera, Vector3} from 'three';

import {TraceCrop} from './trace-coverage.js';

/**
 * Holdout floor, the way KeyShot / Cycles / Arnold draw a product on a page.
 *
 * The floor surface is never shaded. A shadow is
 * `1 - luminance(light with the subject) / luminance(light without it)`,
 * over environment and direct lights together. The ratio is a coverage, so a
 * coloured HDR changes where the contact shadow falls and does not tint the
 * page. A reflection is the subject's radiance times Fresnel, strength, and
 * the same distance falloff; a ray that misses the subject adds nothing.
 *
 * The fade is `exp(-3 (d / radius)^2)` outside the subject footprint, which
 * is about 0.05 at one radius and about 0.02 at `effectReach`. Past that the
 * pixel matches the page (alpha 0).
 */
export const PATH_TRACER_FLOOR_MODES = [
  'none',
  'shadow',
  'shadow-reflection',
] as const;

export type PathTracerFloorMode = typeof PATH_TRACER_FLOOR_MODES[number];

export const FLOOR_OCCLUSION_SAMPLES = 8;
export const DEFAULT_FLOOR_REFLECTION = 0.45;
export const FLOOR_REFLECTION_F0 = 0.04;
/** Fade length as a fraction of the subject's longer horizontal side. */
export const FLOOR_FALLOFF_FACTOR = 0.75;
/** Gaussian coefficient. exp(-3) is ~5% at one radius. */
export const FLOOR_FALLOFF_SHARPNESS = 3;
/** Pixels dimmer than this are not worth tracing. */
export const FLOOR_EFFECT_LIMIT = 0.02;
export const FLOOR_CROP_FULL_FRAME_RATIO = 0.92;
/** Realtime contact darkening. The trace replaces it with the real ratio. */
export const FLOOR_PREVIEW_SHADOW = 0.5;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface FloorFootprint {
  centerX: number;
  centerZ: number;
  halfX: number;
  halfZ: number;
  /** Distance outside the rect over which the effect fades out. */
  radius: number;
  floorY: number;
}

export interface FloorPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const normalizePathTracerFloorMode =
    (value: unknown): PathTracerFloorMode => {
      if (value === true || value === 1) {
        return 'shadow';
      }
      if (value === false || value === 0 || value == null) {
        return 'none';
      }
      const text = String(value).trim().toLowerCase();
      if (text === '' || text === '1' || text === 'true' || text === 'shadow') {
        return 'shadow';
      }
      if (text === 'shadow-reflection' || text === 'shadow_reflection' ||
          text === 'reflection') {
        return 'shadow-reflection';
      }
      return 'none';
    };

/**
 * `none` stays none unless the viewer is in the legacy path-tracer shadow
 * mode, which still means a shadow catcher.
 */
export const effectiveFloorMode = (
    mode: PathTracerFloorMode,
    shadowMode: string,
    ): PathTracerFloorMode => {
  if (mode !== 'none') {
    return mode;
  }
  return shadowMode === 'path-tracer' ? 'shadow' : 'none';
};

export const luminance = (color: Rgb): number =>
    color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

/**
 * Shadow coverage in [0, 1]. Zero when the empty floor receives no light, so
 * a black environment does not paint a floor. The ratio uses luminance, so
 * the page stays neutral.
 */
export const shadowCatcherCoverage = (withLight: Rgb, withoutLight: Rgb):
    number => {
      const open = luminance(withoutLight);
      if (!(open > 1e-4)) {
        return 0;
      }
      return clamp01(1 - luminance(withLight) / open);
    };

export const floorDistanceFalloff =
    (distance: number, radius: number): number => {
      if (!(radius > 0) || !(distance > 0)) {
        return 1;
      }
      const ratio = distance / radius;
      return Math.exp(-FLOOR_FALLOFF_SHARPNESS * ratio * ratio);
    };

export const footprintDistance = (
    x: number,
    z: number,
    footprint: FloorFootprint,
    ): number => {
  const dx = Math.max(0, Math.abs(x - footprint.centerX) - footprint.halfX);
  const dz = Math.max(0, Math.abs(z - footprint.centerZ) - footprint.halfZ);
  return Math.hypot(dx, dz);
};

export const schlickFresnel =
    (cosTheta: number, f0: number = FLOOR_REFLECTION_F0): number => {
      const cos = clamp01(cosTheta);
      const base = 1 - cos;
      const raised = base * base * base * base * base;
      return f0 + (1 - f0) * raised;
    };

/** Zero when the reflection ray missed the subject. */
export const reflectionWeight = (
    hitSubject: boolean,
    cosTheta: number,
    strength: number,
    falloff: number,
    ): number => {
      if (!hitSubject) {
        return 0;
      }
      return clamp01(schlickFresnel(cosTheta) * clamp01(strength) * falloff);
    };

/**
 * Straight-alpha pixel. `reflection` is premultiplied subject radiance
 * (Lo * weight). Alpha 0 leaves the page unchanged.
 */
export const compositeFloorPixel = (
    shadow: number,
    reflection: Rgb,
    weight: number,
    ): FloorPixel => {
  const coverage = clamp01(shadow);
  const reflectivity = clamp01(weight);
  const alpha = 1 - (1 - coverage) * (1 - reflectivity);
  if (!(alpha > 1e-5)) {
    return {r: 0, g: 0, b: 0, a: 0};
  }
  return {
    r: reflection.r / alpha,
    g: reflection.g / alpha,
    b: reflection.b / alpha,
    a: alpha,
  };
};

export const falloffRadiusForFootprint =
    (halfX: number, halfZ: number): number => {
      const span = Math.max(halfX, halfZ, 0.05) * 2;
      return span * FLOOR_FALLOFF_FACTOR;
    };

/** Distance at which the fade drops through FLOOR_EFFECT_LIMIT. */
export const effectReach = (radius: number): number => {
  if (!(radius > 0)) {
    return 0;
  }
  return radius *
      Math.sqrt(-Math.log(FLOOR_EFFECT_LIMIT) / FLOOR_FALLOFF_SHARPNESS);
};

export const footprintFromBounds = (
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    ): FloorFootprint => {
  void maxY;
  const halfX = Math.max(0, (maxX - minX) * 0.5);
  const halfZ = Math.max(0, (maxZ - minZ) * 0.5);
  return {
    centerX: (minX + maxX) * 0.5,
    centerZ: (minZ + maxZ) * 0.5,
    halfX,
    halfZ,
    radius: falloffRadiusForFootprint(halfX, halfZ),
    floorY: minY,
  };
};

/**
 * Extends the full-strength rect along the shadow, away from the light.
 * `towardLight` points from the floor toward the light. Overhead light does
 * not stretch the rect. The near edge stays on the subject.
 */
export const applyShadowStretch = (
    footprint: FloorFootprint,
    towardLight: readonly [number, number, number],
    ): FloorFootprint => {
  const length = Math.hypot(towardLight[0], towardLight[1], towardLight[2]);
  if (!(length > 1e-8)) {
    return footprint;
  }
  const tx = -towardLight[0] / length;
  const ty = -towardLight[1] / length;
  const tz = -towardLight[2] / length;
  const horizontal = Math.hypot(tx, tz);
  // ty < 0: the shadow travels downward, so the light is above the floor.
  if (!(horizontal > 1e-3) || ty >= 0) {
    return footprint;
  }
  const stretch = footprint.radius * horizontal;
  return {
    ...footprint,
    centerX: footprint.centerX + tx * stretch * 0.5,
    centerZ: footprint.centerZ + tz * stretch * 0.5,
    halfX: footprint.halfX + Math.abs(tx) * stretch * 0.5,
    halfZ: footprint.halfZ + Math.abs(tz) * stretch * 0.5,
  };
};

/** Rect that still contains a non-negligible shadow or reflection. */
export const effectSupport = (footprint: FloorFootprint): FloorFootprint => {
  const reach = effectReach(footprint.radius);
  return {
    ...footprint,
    halfX: footprint.halfX + reach,
    halfZ: footprint.halfZ + reach,
  };
};

export const rectCorners =
    (rect: FloorFootprint): Array<[number, number, number]> => {
      const {centerX, centerZ, halfX, halfZ, floorY} = rect;
      return [
        [centerX - halfX, floorY, centerZ - halfZ],
        [centerX + halfX, floorY, centerZ - halfZ],
        [centerX - halfX, floorY, centerZ + halfZ],
        [centerX + halfX, floorY, centerZ + halfZ],
      ];
    };

const point = new Vector3();

/**
 * Top-left crop of the world points that land on the screen. Points behind
 * the camera are skipped. Null means the points cover the frame, or none of
 * them are in front of the camera.
 */
export const screenBoundsOfWorldPoints = (
    points: Array<[number, number, number]>,
    camera: Camera,
    fullWidth: number,
    fullHeight: number,
    ): TraceCrop|null => {
  if (fullWidth < 1 || fullHeight < 1 || points.length === 0) {
    return null;
  }
  camera.updateMatrixWorld();
  if (camera instanceof PerspectiveCamera) {
    camera.updateProjectionMatrix();
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const entry of points) {
    point.set(entry[0], entry[1], entry[2]).project(camera);
    if (point.z < -1 || point.z > 1) {
      continue;
    }
    const px = (point.x * 0.5 + 0.5) * fullWidth;
    const py = (1 - (point.y * 0.5 + 0.5)) * fullHeight;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
    count++;
  }
  if (count === 0) {
    return null;
  }
  const x = Math.max(0, Math.floor(minX));
  const y = Math.max(0, Math.floor(minY));
  const right = Math.min(fullWidth, Math.ceil(maxX));
  const bottom = Math.min(fullHeight, Math.ceil(maxY));
  if (right <= x || bottom <= y) {
    return null;
  }
  return {x, y, width: right - x, height: bottom - y};
};

/**
 * Null on either side means "the whole frame", which is how the tracer
 * encodes a crop it will not shrink.
 */
export const unionCrops = (
    left: TraceCrop|null,
    right: TraceCrop|null,
    fullWidth: number,
    fullHeight: number,
    ): TraceCrop|null => {
  if (left == null || right == null) {
    return null;
  }
  const x = Math.max(0, Math.min(left.x, right.x));
  const y = Math.max(0, Math.min(left.y, right.y));
  const rightEdge = Math.min(
      fullWidth, Math.max(left.x + left.width, right.x + right.width));
  const bottom = Math.min(
      fullHeight, Math.max(left.y + left.height, right.y + right.height));
  const crop = {x, y, width: rightEdge - x, height: bottom - y};
  if (crop.width < 1 || crop.height < 1) {
    return null;
  }
  if (crop.width * crop.height >=
      fullWidth * fullHeight * FLOOR_CROP_FULL_FRAME_RATIO) {
    return null;
  }
  return crop;
};

export const traceAreaPercent =
    (tracedPixels: number, fullPixels: number): number => {
      if (!(fullPixels > 0)) {
        return 0;
      }
      return 100 * tracedPixels / fullPixels;
    };

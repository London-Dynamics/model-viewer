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

import {DoubleSide, Ray, Vector3} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const ray = new Ray();
const origin = new Vector3();
const up = new Vector3(0, 1, 0);

export const halton = (index: number, base: number): number => {
  let f = 1;
  let result = 0;
  let i = index + 1;
  while (i > 0) {
    f /= base;
    result += f * (i % base);
    i = Math.floor(i / base);
  }
  return result;
};

export const contactTexelOrigin = (
    i: number,
    j: number,
    resolution: number,
    centerX: number,
    centerZ: number,
    width: number,
    depth: number,
    y: number,
    target: Vector3,
    ): Vector3 => {
  const u = (i + 0.5) / resolution;
  const v = (j + 0.5) / resolution;
  target.x = centerX + (u - 0.5) * width;
  target.y = y;
  target.z = centerZ + (0.5 - v) * depth;
  return target;
};

export interface ContactJob {
  resolution: number;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  y: number;
  softnessRadius: number;
  samples: number;
  /** Unjittered core ray. Short, so only real contact goes dark. */
  maxDistance: number;
  /**
   * Jittered samples. Longer than the core so the skirt can still see the
   * hull, and scaled down so it stays lighter than the core.
   */
  penumbraDistance: number;
  grid: Float32Array;
  cursor: number;
}

export const stepContactRays = (
    job: ContactJob,
    bvh: MeshBVH,
    budgetMs: number,
    ): boolean => {
  const start = performance.now();
  const count = job.resolution * job.resolution;
  const bias = Math.max(1e-3, job.maxDistance * 0.002);
  while (job.cursor < count) {
    if (performance.now() - start >= budgetMs) {
      return false;
    }
    const i = job.cursor % job.resolution;
    const j = Math.floor(job.cursor / job.resolution);
    // Start just under the plane so the ray meets the underside instead of
    // beginning inside the hull and missing the contact.
    contactTexelOrigin(
        i,
        j,
        job.resolution,
        job.centerX,
        job.centerZ,
        job.width,
        job.depth,
        job.y - bias,
        origin);
    let core = 0;
    let penumbra = 0;
    let penumbraSamples = 0;
    const samples = Math.max(1, job.samples);
    const penumbraFar = Math.max(job.maxDistance, job.penumbraDistance || 0);
    for (let s = 0; s < samples; s++) {
      const ox = origin.x;
      const oz = origin.z;
      let jitter = 0;
      if (s > 0 && job.softnessRadius > 0) {
        const angle = halton(s, 2) * Math.PI * 2;
        jitter = Math.sqrt(halton(s, 3));
        const radius = jitter * job.softnessRadius;
        origin.x = ox + Math.cos(angle) * radius;
        origin.z = oz + Math.sin(angle) * radius;
      }
      const far = s === 0 ? job.maxDistance : penumbraFar;
      ray.set(origin, up);
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, far);
      origin.x = ox;
      origin.z = oz;
      if (hit == null) {
        if (s > 0) {
          penumbraSamples++;
        }
        continue;
      }
      const t = Math.min(1, hit.distance / far);
      const weight = (1 - t) * (1 - t);
      if (s === 0) {
        core = weight;
      } else {
        // Outer disk samples contribute less, so the skirt fades out.
        const spatial = (1 - jitter) * (1 - jitter);
        penumbra += weight * spatial;
        penumbraSamples++;
      }
    }
    const soft = penumbraSamples > 0 ? penumbra / penumbraSamples : 0;
    // A hit on the center ray is the core. Extra samples only fill texels
    // the center ray missed, and at a lower weight.
    job.grid[job.cursor] = core > 0 ? core : soft * 0.55;
    job.cursor++;
  }
  return true;
};

/**
 * Spread a light skirt around the core. Jittered rays are sparse, so the
 * visible ground beside a hull would otherwise stay empty. The skirt is
 * always dimmer than the core texel it spreads from, and it falls off before
 * the disk edge.
 */
export const expandPenumbra = (
    grid: Float32Array,
    resolution: number,
    width: number,
    depth: number,
    radiusMeters: number,
    strength: number,
    ): void => {
  if (radiusMeters <= 1e-4 || strength <= 0 || resolution <= 1) {
    return;
  }
  const mx = width / resolution;
  const mz = depth / resolution;
  const rx = Math.max(1, Math.ceil(radiusMeters / mx));
  const rz = Math.max(1, Math.ceil(radiusMeters / mz));
  const copy = grid.slice();
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const core = copy[j * resolution + i];
      if (core < 0.2) {
        continue;
      }
      const cap = Math.min(strength, core * 0.62);
      for (let dj = -rz; dj <= rz; dj++) {
        const y = j + dj;
        if (y < 0 || y >= resolution) {
          continue;
        }
        for (let di = -rx; di <= rx; di++) {
          const x = i + di;
          if (x < 0 || x >= resolution) {
            continue;
          }
          const dist = Math.hypot(di * mx, dj * mz);
          if (dist <= 0 || dist >= radiusMeters) {
            continue;
          }
          const t = 1 - dist / radiusMeters;
          const skirt = cap * t * t;
          const idx = y * resolution + x;
          if (skirt > grid[idx]) {
            grid[idx] = skirt;
          }
        }
      }
    }
  }
};

export const blurOcclusion = (
    grid: Float32Array,
    resolution: number,
    radius: number,
    ): Float32Array => {
  if (radius <= 0) {
    return grid;
  }
  const tmp = new Float32Array(grid.length);
  const r = Math.max(1, Math.floor(radius));
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const sx = Math.min(resolution - 1, Math.max(0, x + k));
        sum += grid[y * resolution + sx];
        n++;
      }
      tmp[y * resolution + x] = sum / n;
    }
  }
  const out = new Float32Array(grid.length);
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const sy = Math.min(resolution - 1, Math.max(0, y + k));
        sum += tmp[sy * resolution + x];
        n++;
      }
      out[y * resolution + x] = sum / n;
    }
  }
  return out;
};

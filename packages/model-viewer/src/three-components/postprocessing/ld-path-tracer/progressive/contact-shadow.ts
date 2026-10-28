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
  maxDistance: number;
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
  const bias = Math.max(1e-4, job.maxDistance * 1e-4);
  while (job.cursor < count) {
    if (performance.now() - start >= budgetMs) {
      return false;
    }
    const i = job.cursor % job.resolution;
    const j = Math.floor(job.cursor / job.resolution);
    contactTexelOrigin(
        i,
        j,
        job.resolution,
        job.centerX,
        job.centerZ,
        job.width,
        job.depth,
        job.y + bias,
        origin);
    let hits = 0;
    const samples = Math.max(1, job.samples);
    for (let s = 0; s < samples; s++) {
      const ox = origin.x;
      const oz = origin.z;
      if (job.softnessRadius > 0 && samples > 1) {
        const angle = halton(s, 2) * Math.PI * 2;
        const radius = Math.sqrt(halton(s, 3)) * job.softnessRadius;
        origin.x = ox + Math.cos(angle) * radius;
        origin.z = oz + Math.sin(angle) * radius;
      }
      ray.set(origin, up);
      const hit = bvh.raycastFirst(ray, DoubleSide, 0, job.maxDistance);
      origin.x = ox;
      origin.z = oz;
      if (hit != null) {
        const t = Math.min(1, hit.distance / job.maxDistance);
        // Quadratic so the darkest core is where the surface nearly touches
        // the ground. Geometry higher up only feathers the penumbra.
        hits += (1 - t) * (1 - t);
      }
    }
    job.grid[job.cursor] = hits / samples;
    job.cursor++;
  }
  return true;
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

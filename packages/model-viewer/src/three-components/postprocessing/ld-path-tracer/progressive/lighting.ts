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

import {halton} from './contact-shadow.js';

const ray = new Ray();
const origin = new Vector3();
const direction = new Vector3();
const tangent = new Vector3();
const bitangent = new Vector3();

const orient = (nx: number, ny: number, nz: number) => {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  if (ay > ax && ay > az) {
    tangent.set(1, 0, 0);
  } else {
    tangent.set(0, 1, 0);
  }
  tangent.cross(direction.set(nx, ny, nz)).normalize();
  bitangent.crossVectors(direction, tangent);
};

export const occlusionAtPoint = (
    bvh: MeshBVH,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    samples: number,
    distance: number,
    ): number => {
  orient(nx, ny, nz);
  // A few millimetres, not a fraction of a long ray. A large bias starts
  // the sample inside neighbouring geometry and greys open panels.
  const bias = Math.max(5e-4, Math.min(0.004, distance * 0.004));
  let occ = 0;
  const count = Math.max(1, samples);
  for (let i = 0; i < count; i++) {
    const u = halton(i + 1, 2);
    const v = halton(i + 1, 3);
    const phi = Math.PI * 2 * u;
    // Bias toward the normal, but keep some grazing rays so a side wall
    // a few centimetres away still darkens a corner.
    const cosTheta = Math.sqrt(1 - v * 0.65);
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const lx = Math.cos(phi) * sinTheta;
    const ly = Math.sin(phi) * sinTheta;
    const lz = cosTheta;
    direction.set(0, 0, 0);
    direction.addScaledVector(tangent, lx);
    direction.addScaledVector(bitangent, ly);
    direction.addScaledVector(origin.set(nx, ny, nz), lz).normalize();
    origin.set(x + nx * bias, y + ny * bias, z + nz * bias);
    ray.set(origin, direction);
    const hit = bvh.raycastFirst(ray, DoubleSide, 0, distance);
    if (hit != null) {
      const t = Math.min(1, hit.distance / distance);
      // Only nearby hits darken. A graze at the far end of the ray does not.
      const falloff = (1 - t) * (1 - t);
      occ += falloff;
    }
  }
  // Open faces stay near 1. Corners, where several rays hit nearby, shade.
  const ao = Math.max(0, 1 - occ / count);
  return Math.pow(ao, 1.15);
};

/**
 * Average overlapping writes, bleed one texel into unwritten gutters, then
 * a 1px blur. Unwritten texels stay white so chart padding does not go grey.
 */
export const finalizeAmbientOcclusion = (
    sumAndCount: Float32Array,
    resolution: number,
    ): Float32Array => {
  const count = resolution * resolution;
  const value = new Float32Array(count);
  value.fill(-1);
  for (let i = 0; i < count; i++) {
    const n = sumAndCount[i * 4 + 3];
    if (n > 0) {
      value[i] = sumAndCount[i * 4] / n;
    }
  }
  const dilated = value.slice();
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const idx = y * resolution + x;
      if (value[idx] >= 0) {
        continue;
      }
      let sum = 0;
      let n = 0;
      for (let ky = -2; ky <= 2; ky++) {
        for (let kx = -2; kx <= 2; kx++) {
          const sx = x + kx;
          const sy = y + ky;
          if (sx < 0 || sy < 0 || sx >= resolution || sy >= resolution) {
            continue;
          }
          const neighbor = value[sy * resolution + sx];
          if (neighbor >= 0) {
            sum += neighbor;
            n++;
          }
        }
      }
      if (n > 0) {
        dilated[idx] = sum / n;
      }
    }
  }
  const out = new Float32Array(count);
  const radius = 1;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      let sum = 0;
      let n = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const sx = Math.min(resolution - 1, Math.max(0, x + kx));
          const sy = Math.min(resolution - 1, Math.max(0, y + ky));
          const sample = dilated[sy * resolution + sx];
          if (sample >= 0) {
            sum += sample;
            n++;
          }
        }
      }
      out[y * resolution + x] = n > 0 ? sum / n : 1;
    }
  }
  return out;
};

export interface PunctualSample {
  kind: 'point'|'spot'|'directional';
  px: number;
  py: number;
  pz: number;
  dx: number;
  dy: number;
  dz: number;
  colorR: number;
  colorG: number;
  colorB: number;
  distance: number;
  angle: number;
  decay: number;
  /** Intensity captured at bake time. The layer fade is current/this. */
  intensity: number;
}

export const directAtPoint = (
    bvh: MeshBVH,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    light: PunctualSample,
    ): [number, number, number] => {
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let dist = 0;
  if (light.kind === 'directional') {
    lx = -light.dx;
    ly = -light.dy;
    lz = -light.dz;
    dist = 1e6;
  } else {
    lx = light.px - x;
    ly = light.py - y;
    lz = light.pz - z;
    dist = Math.hypot(lx, ly, lz);
    if (dist < 1e-5) {
      return [0, 0, 0];
    }
    lx /= dist;
    ly /= dist;
    lz /= dist;
  }
  const ndotl = nx * lx + ny * ly + nz * lz;
  if (ndotl <= 0) {
    return [0, 0, 0];
  }
  if (light.kind === 'spot') {
    const dot = -(lx * light.dx + ly * light.dy + lz * light.dz);
    if (dot < Math.cos(light.angle)) {
      return [0, 0, 0];
    }
  }
  let attenuation = 1;
  if (light.kind !== 'directional') {
    if (light.distance > 0 && dist >= light.distance) {
      return [0, 0, 0];
    }
    const falloff = light.decay > 0 ? Math.pow(dist, light.decay) : 1;
    attenuation = 1 / Math.max(1e-4, falloff);
    if (light.distance > 0) {
      const ratio = dist / light.distance;
      const window = Math.max(0, 1 - ratio * ratio);
      attenuation *= window * window;
    }
  }
  const bias = 1e-3;
  origin.set(x + nx * bias, y + ny * bias, z + nz * bias);
  direction.set(lx, ly, lz);
  ray.set(origin, direction);
  // Stop short of the lamp so the housing does not shadow its own light.
  const clearance = light.kind === 'directional' ?
      0 :
      Math.min(0.15, Math.max(0.02, dist * 0.35));
  const far = light.kind === 'directional' ? 1e6 :
                                           Math.max(0, dist - clearance);
  if (bvh.raycastFirst(ray, DoubleSide, 0, far) != null) {
    return [0, 0, 0];
  }
  const scale = ndotl * attenuation * light.intensity;
  return [light.colorR * scale, light.colorG * scale, light.colorB * scale];
};

export interface EmissiveSample {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  r: number;
  g: number;
  b: number;
  area: number;
}

export const emissiveAtPoint = (
    bvh: MeshBVH,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    samples: EmissiveSample[],
    ): [number, number, number] => {
  let r = 0;
  let g = 0;
  let b = 0;
  const bias = 1e-3;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    let lx = sample.x - x;
    let ly = sample.y - y;
    let lz = sample.z - z;
    const dist = Math.hypot(lx, ly, lz);
    if (dist < 1e-4) {
      continue;
    }
    lx /= dist;
    ly /= dist;
    lz /= dist;
    const ndotl = nx * lx + ny * ly + nz * lz;
    const facing = -(sample.nx * lx + sample.ny * ly + sample.nz * lz);
    if (ndotl <= 0 || facing <= 0) {
      continue;
    }
    origin.set(x + nx * bias, y + ny * bias, z + nz * bias);
    direction.set(lx, ly, lz);
    ray.set(origin, direction);
    // Stop a couple of centimetres short so the emitter does not occlude itself.
    if (bvh.raycastFirst(ray, DoubleSide, 0, Math.max(0, dist - 0.02)) !=
        null) {
      continue;
    }
    const scale = sample.area * ndotl * facing / (dist * dist);
    r += sample.r * scale;
    g += sample.g * scale;
    b += sample.b * scale;
  }
  return [r, g, b];
};

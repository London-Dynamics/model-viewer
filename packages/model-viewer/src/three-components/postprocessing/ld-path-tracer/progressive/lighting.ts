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
  const bias = Math.max(2e-3, distance * 0.015);
  let occ = 0;
  const count = Math.max(1, samples);
  for (let i = 0; i < count; i++) {
    const u = halton(i + 1, 2);
    const v = halton(i + 1, 3);
    const phi = Math.PI * 2 * u;
    const cosTheta = Math.sqrt(1 - v);
    const sinTheta = Math.sqrt(v);
    const lx = Math.cos(phi) * sinTheta;
    const ly = Math.sin(phi) * sinTheta;
    const lz = cosTheta;
    direction.set(0, 0, 0);
    direction.addScaledVector(tangent, lx);
    direction.addScaledVector(bitangent, ly);
    direction.addScaledVector(origin.set(nx, ny, nz), lz).normalize();
    origin.set(x + nx * bias, y + ny * bias, z + nz * bias);
    ray.set(origin, direction);
    const hit = bvh.raycastFirst(ray, DoubleSide, bias, distance);
    if (hit != null) {
      occ += 1 - Math.min(1, hit.distance / distance);
    }
  }
  return 1 - occ / count;
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
  const far = light.kind === 'directional' ? 1e6 : Math.max(0, dist - bias);
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
    if (bvh.raycastFirst(ray, DoubleSide, 0, Math.max(0, dist - bias)) !=
        null) {
      continue;
    }
    const scale = sample.area * ndotl * facing / (dist * dist * samples.length);
    r += sample.r * scale;
    g += sample.g * scale;
    b += sample.b * scale;
  }
  return [r, g, b];
};

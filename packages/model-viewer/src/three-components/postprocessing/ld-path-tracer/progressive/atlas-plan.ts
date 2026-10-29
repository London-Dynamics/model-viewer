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

import {BakeResolution} from './options.js';

/** Usable fraction of an atlas after 8px padding between charts. */
const PACK = 0.55;
/** Middle of the 5–10 texels/cm band. */
const TARGET_PER_CM = 8;
const MIN_PER_CM = 5;

export const BAKE_SIZE: Record<Exclude<BakeResolution, 'auto'>, number> = {
  '0.5k': 512,
  '1k': 1024,
  '2k': 2048,
  '4k': 4096,
};

/**
 * A phone or a small heap. A trackpad reports touch points on desktop, so
 * that alone must not clamp a 4k atlas down to 2k.
 */
export const coarseBakeDevice = (): boolean => {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const nav = navigator as Navigator&{deviceMemory?: number};
  const lowMemory = nav.deviceMemory != null && nav.deviceMemory <= 4;
  const finePointer = typeof matchMedia === 'function' &&
      matchMedia('(pointer: fine)').matches;
  const touchOnly = navigator.maxTouchPoints > 0 && !finePointer;
  return touchOnly || lowMemory;
};

/**
 * AO is low frequency. A boat-scale mesh wants about 2 texels/cm; a
 * cabinet stays sharper. This is the floor the packer uses so a 4k atlas
 * is split only when the group would fall below it.
 */
export const targetTexelsPerCm = (extentM: number): number => {
  if (!(extentM > 0)) {
    return 8;
  }
  if (extentM >= 6) {
    return 2;
  }
  if (extentM >= 2.5) {
    return 4;
  }
  return 8;
};

const nextPow2 = (value: number): number => {
  let side = 512;
  while (side < value && side < 4096) {
    side *= 2;
  }
  return side;
};

/** Texels per centimetre if `size`² holds `areaM2` at the packing fraction. */
export const densityAt = (size: number, areaM2: number): number => {
  const areaCm2 = Math.max(areaM2, 1e-8) * 10000;
  return Math.sqrt((size * size * PACK) / areaCm2);
};

/**
 * Per-atlas side length. Auto aims for ~8 texels/cm, stays at 2k unless a
 * desktop hero part would otherwise fall under 5 texels/cm, and never
 * exceeds 2k on a coarse device. 4k is clamped to 2k on those devices.
 */
export const atlasSide = (
    areaM2: number, mode: BakeResolution, coarse: boolean): number => {
  if (mode !== 'auto') {
    const picked = BAKE_SIZE[mode];
    return coarse ? Math.min(2048, picked) : picked;
  }
  const cap = coarse ? 2048 : 4096;
  const areaCm2 = Math.max(areaM2, 1e-8) * 10000;
  const want = Math.sqrt(areaCm2 * TARGET_PER_CM * TARGET_PER_CM / PACK);
  let side = Math.min(cap, Math.max(512, nextPow2(want)));
  if (side > 2048) {
    if (densityAt(2048, areaM2) >= MIN_PER_CM) {
      side = 2048;
    }
  }
  return side;
};

export interface AreaPart<T> {
  item: T;
  areaM2: number;
}

/**
 * Split a material group into bins that each fit in one atlas at the
 * target density. One bin when the group already fits.
 */
/**
 * First-fit decreasing into shared atlases. A bin holds every mesh that
 * still fits at `texelsPerCm` on `side`. One mesh that is larger than that
 * still gets a single atlas and reports the real density.
 */
export const packIntoSide = <T>(
    parts: AreaPart<T>[], side: number, texelsPerCm: number,
    ): AreaPart<T>[][] => {
  const density = Math.max(0.25, texelsPerCm);
  const capacityM2 = (side * side * PACK) / (density * density * 10000);
  const ordered = parts.slice().sort((a, b) => b.areaM2 - a.areaM2);
  const bins: {parts: AreaPart<T>[]; area: number;}[] = [];
  for (const part of ordered) {
    let placed = false;
    for (const bin of bins) {
      if (bin.area + part.areaM2 <= capacityM2 + 1e-6) {
        bin.parts.push(part);
        bin.area += part.areaM2;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({parts: [part], area: part.areaM2});
    }
  }
  return bins.length > 0 ? bins.map((bin) => bin.parts) : [[]];
};

export const splitByDensity = <T>(
    parts: AreaPart<T>[], side: number): AreaPart<T>[][] => {
  const usable = side * side * PACK;
  const bins: AreaPart<T>[][] = [];
  let bin: AreaPart<T>[] = [];
  let areaCm2 = 0;
  const ordered = parts.slice().sort((a, b) => b.areaM2 - a.areaM2);
  for (const part of ordered) {
    const add = Math.max(part.areaM2, 0) * 10000;
    const need = (areaCm2 + add) * MIN_PER_CM * MIN_PER_CM;
    if (bin.length > 0 && need > usable) {
      bins.push(bin);
      bin = [];
      areaCm2 = 0;
    }
    bin.push(part);
    areaCm2 += add;
  }
  if (bin.length > 0) {
    bins.push(bin);
  }
  return bins.length > 0 ? bins : [[]];
};

/**
 * Copy written factors into empty texels within `radius` px so a bilinear
 * fetch on the chart edge does not read the unwritten gutter.
 */
export const dilateFactor = (
    value: Float32Array, resolution: number, radius = 6): void => {
  const seeds: number[] = [];
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const i = y * resolution + x;
      if (value[i] < 0) {
        continue;
      }
      const empty = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
          return false;
        }
        return value[ny * resolution + nx] < 0;
      };
      if (empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) ||
          empty(x, y + 1)) {
        seeds.push(i);
      }
    }
  }
  const radiusSq = radius * radius;
  for (let s = 0; s < seeds.length; s++) {
    const i = seeds[s];
    const x = i % resolution;
    const y = (i / resolution) | 0;
    const sample = value[i];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radiusSq) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= resolution || ny >= resolution) {
          continue;
        }
        const j = ny * resolution + nx;
        if (value[j] < 0) {
          value[j] = sample;
        }
      }
    }
  }
};

export const packFactorR8 = (
    value: Float32Array, resolution: number): Uint8Array => {
  const bytes = new Uint8Array(resolution * resolution);
  for (let i = 0; i < bytes.length; i++) {
    const sample = value[i];
    bytes[i] = sample < 0 ? 255 :
                             Math.round(Math.min(1, Math.max(0, sample)) * 255);
  }
  return bytes;
};

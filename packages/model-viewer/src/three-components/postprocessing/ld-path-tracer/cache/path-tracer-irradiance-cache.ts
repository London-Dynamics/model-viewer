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

/** Power-of-two hash slots. The megakernel masks with 65535. */
export const IRRADIANCE_SLOT_COUNT = 65536;
export const IRRADIANCE_FLOATS_PER_SLOT = 8;
export const IRRADIANCE_MIN_SAMPLES = 4;

export interface IrradianceGridMeta {
  slots: number;
  origin: [number, number, number];
  cellSize: number;
  minSamples: number;
}

export const irradianceFloatCount = (
    slots = IRRADIANCE_SLOT_COUNT,
    ): number => slots * IRRADIANCE_FLOATS_PER_SLOT;

export const createIrradianceGrid = (
    slots = IRRADIANCE_SLOT_COUNT,
    ): Float32Array => new Float32Array(irradianceFloatCount(slots));

const u32mul = (a: number, b: number): number => Math.imul(a | 0, b | 0) >>> 0;

/**
 * Spatial hash shared with ldCacheHash in the megakernel. The normal is
 * reduced to its octant so opposite faces do not share a cell.
 */
export const irradianceSlot = (
    cellX: number,
    cellY: number,
    cellZ: number,
    nx: number,
    ny: number,
    nz: number,
    slots = IRRADIANCE_SLOT_COUNT,
    ): number => {
  const nqx = nx >= 0 ? 1 : 0;
  const nqy = ny >= 0 ? 1 : 0;
  const nqz = nz >= 0 ? 1 : 0;
  let hash = u32mul(cellX, 73856093) ^ u32mul(cellY, 19349663) ^
      u32mul(cellZ, 83492791);
  hash = (hash ^ u32mul(nqx + nqy * 2 + nqz * 4 + 1, 16777619)) >>> 0;
  return hash & (slots - 1);
};

export const worldToCell = (
    position: readonly[number, number, number],
    origin: readonly[number, number, number],
    cellSize: number,
    ): [number, number, number] =>
    [Math.floor((position[0] - origin[0]) / cellSize),
     Math.floor((position[1] - origin[1]) / cellSize),
     Math.floor((position[2] - origin[2]) / cellSize),
];

export const gridForBounds = (
    min: readonly[number, number, number],
    max: readonly[number, number, number],
    ): Pick<IrradianceGridMeta, 'origin'|'cellSize'> => {
  const extent = Math.max(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
      1e-3,
  );
  return {
    origin: [min[0], min[1], min[2]],
    cellSize: extent / 32,
  };
};

/** Incoming lighting, with the diffuse albedo divided out. */
export const irradianceFromRadiance = (
    radiance: readonly[number, number, number],
    albedo: readonly[number, number, number],
    ): [number, number, number] =>
    [radiance[0] / Math.max(albedo[0], 0.04),
     radiance[1] / Math.max(albedo[1], 0.04),
     radiance[2] / Math.max(albedo[2], 0.04),
];

export const radianceFromIrradiance = (
    irradiance: readonly[number, number, number],
    albedo: readonly[number, number, number],
    ): [number, number, number] =>
    [albedo[0] * irradiance[0],
     albedo[1] * irradiance[1],
     albedo[2] * irradiance[2],
];

export const accumulateIrradiance = (
    grid: Float32Array,
    meta: IrradianceGridMeta,
    position: readonly[number, number, number],
    normal: readonly[number, number, number],
    radiance: readonly[number, number, number],
    albedo: readonly[number, number, number],
    ): void => {
  const cell = worldToCell(position, meta.origin, meta.cellSize);
  const slot = irradianceSlot(
      cell[0], cell[1], cell[2], normal[0], normal[1], normal[2], meta.slots);
  const base = slot * IRRADIANCE_FLOATS_PER_SLOT;
  const weight = grid[base + 3];
  const incoming = irradianceFromRadiance(radiance, albedo);
  const next = weight + 1;
  grid[base] = (grid[base] * weight + incoming[0]) / next;
  grid[base + 1] = (grid[base + 1] * weight + incoming[1]) / next;
  grid[base + 2] = (grid[base + 2] * weight + incoming[2]) / next;
  grid[base + 3] = next;
  const nx = grid[base + 4] * weight + normal[0];
  const ny = grid[base + 5] * weight + normal[1];
  const nz = grid[base + 6] * weight + normal[2];
  const length = Math.hypot(nx, ny, nz) || 1;
  grid[base + 4] = nx / length;
  grid[base + 5] = ny / length;
  grid[base + 6] = nz / length;
};

export const readIrradiance = (
    grid: Float32Array,
    meta: IrradianceGridMeta,
    position: readonly[number, number, number],
    normal: readonly[number, number, number],
    ): [number, number, number]|null => {
  const cell = worldToCell(position, meta.origin, meta.cellSize);
  const slot = irradianceSlot(
      cell[0], cell[1], cell[2], normal[0], normal[1], normal[2], meta.slots);
  const base = slot * IRRADIANCE_FLOATS_PER_SLOT;
  const weight = grid[base + 3];
  if (weight < meta.minSamples) {
    return null;
  }
  const dot = grid[base + 4] * normal[0] + grid[base + 5] * normal[1] +
      grid[base + 6] * normal[2];
  if (dot <= 0.5) {
    return null;
  }
  return [grid[base], grid[base + 1], grid[base + 2]];
};

export const encodeIrradiancePayload = (
    grid: Float32Array,
    meta: IrradianceGridMeta,
    ): {bytes: Uint8Array, meta: IrradianceGridMeta} => {
  const copy = new Float32Array(grid);
  return {
    bytes: new Uint8Array(copy.buffer),
    meta: {...meta, origin: [...meta.origin]},
  };
};

export const decodeIrradiancePayload = (
    bytes: Uint8Array,
    meta: Partial<IrradianceGridMeta>|undefined,
    ): {grid: Float32Array, meta: IrradianceGridMeta} => {
  const floats = new Float32Array(bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const slots = meta?.slots ??
      (floats.length / IRRADIANCE_FLOATS_PER_SLOT || IRRADIANCE_SLOT_COUNT);
  const grid = createIrradianceGrid(slots);
  grid.set(floats.subarray(0, grid.length));
  return {
    grid,
    meta: {
      slots,
      origin: meta?.origin ?? [0, 0, 0],
      cellSize: meta?.cellSize ?? 1,
      minSamples: meta?.minSamples ?? IRRADIANCE_MIN_SAMPLES,
    },
  };
};

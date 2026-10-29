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

import {BufferAttribute, BufferGeometry, InterleavedBufferAttribute} from 'three';

const overlaps =
    (ax: number,
     ay: number,
     bx: number,
     by: number,
     cx: number,
     cy: number,
     px: number,
     py: number): boolean => {
      const v0x = cx - ax;
      const v0y = cy - ay;
      const v1x = bx - ax;
      const v1y = by - ay;
      const v2x = px - ax;
      const v2y = py - ay;
      const dot00 = v0x * v0x + v0y * v0y;
      const dot01 = v0x * v1x + v0y * v1y;
      const dot02 = v0x * v2x + v0y * v2y;
      const dot11 = v1x * v1x + v1y * v1y;
      const dot12 = v1x * v2x + v1y * v2y;
      const denom = dot00 * dot11 - dot01 * dot01;
      if (Math.abs(denom) < 1e-12) {
        return false;
      }
      const u = (dot11 * dot02 - dot01 * dot12) / denom;
      const v = (dot00 * dot12 - dot01 * dot02) / denom;
      return u >= -1e-4 && v >= -1e-4 && u + v <= 1.0001;
    };

export const uv1IsValid = (
    geometry: BufferGeometry,
    resolution = 48,
    ): boolean => {
  const uv = geometry.getAttribute('uv1');
  if (uv == null || uv.count < 3) {
    return false;
  }
  if ((uv as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    return false;
  }
  const index = geometry.getIndex();
  const triCount =
      index != null ? Math.floor(index.count / 3) : Math.floor(uv.count / 3);
  if (triCount <= 0) {
    return false;
  }
  const grid = new Uint8Array(resolution * resolution);
  let written = 0;
  let overlap = 0;
  for (let tri = 0; tri < triCount; tri++) {
    const i0 = index != null ? index.getX(tri * 3) : tri * 3;
    const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
    const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
    const ax = uv.getX(i0);
    const ay = uv.getY(i0);
    const bx = uv.getX(i1);
    const by = uv.getY(i1);
    const cx = uv.getX(i2);
    const cy = uv.getY(i2);
    const coords = [ax, ay, bx, by, cx, cy];
    for (let c = 0; c < coords.length; c++) {
      if (coords[c] < -1e-3 || coords[c] > 1.001) {
        return false;
      }
    }
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay));
    if (area < 1e-8) {
      continue;
    }
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx) * resolution));
    const maxX =
        Math.min(resolution - 1, Math.ceil(Math.max(ax, bx, cx) * resolution));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy) * resolution));
    const maxY =
        Math.min(resolution - 1, Math.ceil(Math.max(ay, by, cy) * resolution));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = (x + 0.5) / resolution;
        const py = (y + 0.5) / resolution;
        if (!overlaps(ax, ay, bx, by, cx, cy, px, py)) {
          continue;
        }
        const slot = y * resolution + x;
        if (grid[slot] === 1) {
          overlap++;
        } else {
          grid[slot] = 1;
          written++;
        }
      }
    }
  }
  if (written < 4 || overlap > 0) {
    return false;
  }
  return true;
};

interface EdgeTable {
  mask: number;
  keyA: Uint32Array;
  keyB: Uint32Array;
  tri0: Int32Array;
  tri1: Int32Array;
  cursor: number;
}

/** Pixel rectangle inside the shared AO atlas. Charts are packed here. */
export interface UvTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PackWork {
  stage: 'seed'|'basis'|'bounds'|'place'|'corners'|'emit';
  cursor: number;
  minX: Float32Array;
  minY: Float32Array;
  maxX: Float32Array;
  maxY: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  seen: Uint8Array;
  tx: Float32Array;
  ty: Float32Array;
  tz: Float32Array;
  bx: Float32Array;
  by: Float32Array;
  bz: Float32Array;
  place: Float32Array|null;
  map: Map<number, number>|null;
  unique: number;
  corners: Int32Array|null;
  keys: Float64Array|null;
}

export interface UvJob {
  done: boolean;
  resolution: number;
  /** When set, charts stay inside this atlas rectangle instead of the full texture. */
  tile: UvTile|null;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triCount: number;
  phase: 'copy'|'normals'|'edges'|'charts'|'pack'|'emit';
  copyCursor: number;
  indexCursor: number;
  geometry: BufferGeometry;
  normals: Float32Array;
  normalCursor: number;
  edges: EdgeTable|null;
  edgeCursor: number;
  chartOf: Int32Array;
  chartCursor: number;
  chartCount: number;
  chartQueue: number[];
  seedNormal: Float32Array;
  chartActive: boolean;
  rects: Float32Array;
  source: Uint32Array|null;
  uv1: Float32Array|null;
  outIndex: Uint32Array|null;
  pack: PackWork|null;
}

const hashEdge = (a: number, b: number, mask: number): number => {
  let h = Math.imul(a, 1664525) ^ Math.imul(b, 1013904223);
  h = (h ^ (h >>> 16)) >>> 0;
  return h & mask;
};

const faceNormal =
    (positions: Float32Array,
     indices: Uint32Array,
     tri: number,
     out: Float32Array,
     offset: number) => {
      const ia = indices[tri * 3] * 3;
      const ib = indices[tri * 3 + 1] * 3;
      const ic = indices[tri * 3 + 2] * 3;
      const abx = positions[ib] - positions[ia];
      const aby = positions[ib + 1] - positions[ia + 1];
      const abz = positions[ib + 2] - positions[ia + 2];
      const acx = positions[ic] - positions[ia];
      const acy = positions[ic + 1] - positions[ia + 1];
      const acz = positions[ic + 2] - positions[ia + 2];
      let x = aby * acz - abz * acy;
      let y = abz * acx - abx * acz;
      let z = abx * acy - aby * acx;
      const len = Math.hypot(x, y, z) || 1;
      x /= len;
      y /= len;
      z /= len;
      out[offset] = x;
      out[offset + 1] = y;
      out[offset + 2] = z;
    };

export const createUvJob = (
    geometry: BufferGeometry,
    resolution: number,
    tile: UvTile|null = null,
    ): UvJob|null => {
  const position = geometry.getAttribute('position');
  if (position == null ||
      (position as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    return null;
  }
  const indexAttr = geometry.getIndex();
  if (indexAttr != null &&
      (indexAttr as unknown as InterleavedBufferAttribute)
          .isInterleavedBufferAttribute) {
    return null;
  }
  const vertexCount = position.count;
  const triCount = indexAttr != null ? Math.floor(indexAttr.count / 3) :
                                       Math.floor(vertexCount / 3);
  if (triCount <= 0 || vertexCount <= 0) {
    return null;
  }
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(triCount * 3);
  return {
    done: false,
    resolution: Math.max(8, resolution),
    tile,
    positions,
    indices,
    vertexCount,
    triCount,
    phase: 'copy',
    copyCursor: 0,
    indexCursor: 0,
    geometry,
    normals: new Float32Array(triCount * 3),
    normalCursor: 0,
    edges: null,
    edgeCursor: 0,
    chartOf: new Int32Array(triCount),
    chartCursor: 0,
    chartCount: 0,
    chartQueue: [],
    seedNormal: new Float32Array(3),
    chartActive: false,
    rects: new Float32Array(0),
    source: null,
    uv1: null,
    outIndex: null,
    pack: null,
  };
};

const insertEdge = (table: EdgeTable, a: number, b: number, tri: number) => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let slot = hashEdge(lo, hi, table.mask);
  for (let n = 0; n < table.mask; n++) {
    if (table.tri0[slot] === -1) {
      table.keyA[slot] = lo;
      table.keyB[slot] = hi;
      table.tri0[slot] = tri;
      return;
    }
    if (table.keyA[slot] === lo && table.keyB[slot] === hi) {
      if (table.tri1[slot] === -1) {
        table.tri1[slot] = tri;
      }
      return;
    }
    slot = (slot + 1) & table.mask;
  }
};

const neighbor =
    (table: EdgeTable, a: number, b: number, tri: number): number => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      let slot = hashEdge(lo, hi, table.mask);
      for (let n = 0; n < table.mask; n++) {
        if (table.tri0[slot] === -1) {
          return -1;
        }
        if (table.keyA[slot] === lo && table.keyB[slot] === hi) {
          if (table.tri0[slot] === tri) {
            return table.tri1[slot];
          }
          if (table.tri1[slot] === tri) {
            return table.tri0[slot];
          }
          return -1;
        }
        slot = (slot + 1) & table.mask;
      }
      return -1;
    };

export const planAtlasTiles = (weights: number[], resolution: number): UvTile[] => {
  const count = weights.length;
  const safe = Math.max(8, resolution);
  const pad = 4;
  if (count === 0) {
    return [];
  }
  if (count === 1) {
    return [{x: pad, y: pad, w: safe - pad * 2, h: safe - pad * 2}];
  }
  const order = weights.map((weight, index) => ({
    index,
    weight: Math.max(1e-6, weight),
  }));
  order.sort((a, b) => b.weight - a.weight);
  const total = order.reduce((sum, item) => sum + item.weight, 0);
  let scale = 0.92;
  let placed = false;
  const rects: UvTile[] = new Array(count);
  for (let attempt = 0; attempt < 8 && !placed; attempt++) {
    let x = pad;
    let y = pad;
    let rowH = 0;
    placed = true;
    for (let n = 0; n < count; n++) {
      const side = Math.max(
          4,
          Math.floor(Math.sqrt(order[n].weight / total) * scale * (safe - pad * 2)));
      if (x + side > safe - pad) {
        x = pad;
        y += rowH + pad;
        rowH = 0;
      }
      if (y + side > safe - pad) {
        placed = false;
        scale *= 0.72;
        break;
      }
      rects[order[n].index] = {x, y, w: side, h: side};
      x += side + pad;
      rowH = Math.max(rowH, side);
    }
  }
  if (!placed) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
    const cell = Math.max(2, Math.floor((safe - pad * (cols + 1)) / cols));
    for (let n = 0; n < count; n++) {
      const col = n % cols;
      const row = Math.floor(n / cols);
      rects[order[n].index] = {
        x: pad + col * (cell + pad),
        y: pad + row * (cell + pad),
        w: cell,
        h: cell,
      };
    }
  }
  return rects;
};

const beginPack = (job: UvJob): PackWork => {
  const chartCount = Math.max(0, job.chartCount);
  const minX = new Float32Array(chartCount);
  const minY = new Float32Array(chartCount);
  const maxX = new Float32Array(chartCount);
  const maxY = new Float32Array(chartCount);
  minX.fill(Infinity);
  minY.fill(Infinity);
  maxX.fill(-Infinity);
  maxY.fill(-Infinity);
  return {
    stage: 'seed',
    cursor: 0,
    minX,
    minY,
    maxX,
    maxY,
    nx: new Float32Array(chartCount),
    ny: new Float32Array(chartCount),
    nz: new Float32Array(chartCount),
    seen: new Uint8Array(chartCount),
    tx: new Float32Array(chartCount),
    ty: new Float32Array(chartCount),
    tz: new Float32Array(chartCount),
    bx: new Float32Array(chartCount),
    by: new Float32Array(chartCount),
    bz: new Float32Array(chartCount),
    place: null,
    map: null,
    unique: 0,
    corners: null,
    keys: null,
  };
};

const projectChart = (
    job: UvJob, pack: PackWork, chart: number, vertex: number,
    ): [number, number] => {
  const p = vertex * 3;
  const dx = job.positions[p];
  const dy = job.positions[p + 1];
  const dz = job.positions[p + 2];
  return [
    dx * pack.tx[chart] + dy * pack.ty[chart] + dz * pack.tz[chart],
    dx * pack.bx[chart] + dy * pack.by[chart] + dz * pack.bz[chart],
  ];
};

const placePackedCharts = (job: UvJob, pack: PackWork): Float32Array => {
  const {chartCount, resolution} = job;
  const widthOf = (c: number) => Math.max(1e-6, pack.maxX[c] - pack.minX[c]);
  const heightOf = (c: number) => Math.max(1e-6, pack.maxY[c] - pack.minY[c]);
  const order = new Int32Array(chartCount);
  for (let i = 0; i < chartCount; i++) {
    order[i] = i;
  }
  order.sort((a, b) => heightOf(b) - heightOf(a));
  const gutter = 4;
  const originX = job.tile?.x ?? gutter;
  const originY = job.tile?.y ?? gutter;
  const spanX = Math.max(1, job.tile?.w ?? resolution - gutter * 2);
  const spanY = Math.max(1, job.tile?.h ?? resolution - gutter * 2);
  const pad = Math.min(
      gutter, Math.max(1, Math.floor(Math.min(spanX, spanY) / 8)));
  let maxExtent = 1e-6;
  let areaSum = 0;
  for (let i = 0; i < chartCount; i++) {
    maxExtent = Math.max(maxExtent, widthOf(i), heightOf(i));
    areaSum += widthOf(i) * heightOf(i);
  }
  const areaScale = Math.sqrt(
      Math.max(1, (spanX - pad * 2) * (spanY - pad * 2)) * 0.8 /
      Math.max(areaSum, 1e-6));
  let scale = Math.min((Math.min(spanX, spanY) * 0.9) / maxExtent, areaScale);
  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 1;
  }
  const limitX = originX + spanX - pad;
  const limitY = originY + spanY - pad;
  const tryShelf = (useScale: number): Float32Array|null => {
    const placed = new Float32Array(chartCount * 4);
    let cursorX = originX + pad;
    let cursorY = originY + pad;
    let rowH = 0;
    for (let n = 0; n < chartCount; n++) {
      const c = order[n];
      const w = Math.max(2, Math.ceil(widthOf(c) * useScale));
      const h = Math.max(2, Math.ceil(heightOf(c) * useScale));
      if (cursorX + w > limitX) {
        cursorX = originX + pad;
        cursorY += rowH + pad;
        rowH = 0;
      }
      if (cursorX + w > limitX || cursorY + h > limitY) {
        return null;
      }
      placed[c * 4] = cursorX;
      placed[c * 4 + 1] = cursorY;
      placed[c * 4 + 2] = w;
      placed[c * 4 + 3] = h;
      cursorX += w + pad;
      rowH = Math.max(rowH, h);
    }
    return placed;
  };
  let place: Float32Array|null = null;
  for (let attempt = 0; attempt < 14 && place == null; attempt++) {
    place = tryShelf(scale);
    scale *= 0.62;
  }
  if (place == null) {
    place = new Float32Array(chartCount * 4);
    const cols = Math.max(
        1, Math.ceil(Math.sqrt(chartCount * spanX / Math.max(spanY, 1))));
    const rows = Math.max(1, Math.ceil(Math.max(chartCount, 1) / cols));
    const cellW = spanX / cols;
    const cellH = spanY / rows;
    const gap = Math.min(
        pad, Math.max(0, Math.floor(Math.min(cellW, cellH) / 4)));
    for (let n = 0; n < chartCount; n++) {
      const c = order[n];
      const col = n % cols;
      const row = Math.floor(n / cols);
      place[c * 4] = originX + col * cellW + gap;
      place[c * 4 + 1] = originY + row * cellH + gap;
      place[c * 4 + 2] = Math.max(1, cellW - gap * 2);
      place[c * 4 + 3] = Math.max(1, cellH - gap * 2);
    }
  }
  return place;
};

/** True when packing has finished. Large meshes yield across frames. */
export const stepPack = (job: UvJob, budgetMs: number): boolean => {
  const start = performance.now();
  const expired = () => performance.now() - start >= budgetMs;
  if (job.pack == null) {
    job.pack = beginPack(job);
  }
  const pack = job.pack;
  const {triCount, chartCount, indices, resolution} = job;
  if (pack.stage === 'seed') {
    while (pack.cursor < triCount) {
      if (expired()) {
        return false;
      }
      const tri = pack.cursor++;
      const chart = job.chartOf[tri];
      if (chart < 0 || pack.seen[chart] !== 0) {
        continue;
      }
      pack.nx[chart] = job.normals[tri * 3];
      pack.ny[chart] = job.normals[tri * 3 + 1];
      pack.nz[chart] = job.normals[tri * 3 + 2];
      pack.seen[chart] = 1;
    }
    pack.stage = 'basis';
    pack.cursor = 0;
  }
  if (pack.stage === 'basis') {
    while (pack.cursor < chartCount) {
      if (expired()) {
        return false;
      }
      const c = pack.cursor++;
      const ax = Math.abs(pack.nx[c]);
      const ay = Math.abs(pack.ny[c]);
      const az = Math.abs(pack.nz[c]);
      let ux = 0;
      let uy = 1;
      let uz = 0;
      if (ay > ax && ay > az) {
        ux = 1;
        uy = 0;
        uz = 0;
      }
      let x = uy * pack.nz[c] - uz * pack.ny[c];
      let y = uz * pack.nx[c] - ux * pack.nz[c];
      let z = ux * pack.ny[c] - uy * pack.nx[c];
      let len = Math.hypot(x, y, z) || 1;
      pack.tx[c] = x / len;
      pack.ty[c] = y / len;
      pack.tz[c] = z / len;
      x = pack.ny[c] * pack.tz[c] - pack.nz[c] * pack.ty[c];
      y = pack.nz[c] * pack.tx[c] - pack.nx[c] * pack.tz[c];
      z = pack.nx[c] * pack.ty[c] - pack.ny[c] * pack.tx[c];
      len = Math.hypot(x, y, z) || 1;
      pack.bx[c] = x / len;
      pack.by[c] = y / len;
      pack.bz[c] = z / len;
    }
    pack.stage = 'bounds';
    pack.cursor = 0;
  }
  if (pack.stage === 'bounds') {
    while (pack.cursor < triCount) {
      if (expired()) {
        return false;
      }
      const tri = pack.cursor++;
      const chart = job.chartOf[tri];
      if (chart < 0) {
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const [u, v] = projectChart(job, pack, chart, indices[tri * 3 + k]);
        pack.minX[chart] = Math.min(pack.minX[chart], u);
        pack.minY[chart] = Math.min(pack.minY[chart], v);
        pack.maxX[chart] = Math.max(pack.maxX[chart], u);
        pack.maxY[chart] = Math.max(pack.maxY[chart], v);
      }
    }
    pack.place = placePackedCharts(job, pack);
    pack.map = new Map();
    pack.unique = 0;
    pack.corners = new Int32Array(triCount * 3);
    pack.keys = new Float64Array(Math.max(1, triCount * 3));
    pack.stage = 'corners';
    pack.cursor = 0;
  }
  if (pack.stage === 'corners' && pack.map != null && pack.corners != null &&
      pack.keys != null) {
    while (pack.cursor < triCount) {
      if (expired()) {
        return false;
      }
      const tri = pack.cursor++;
      const chart = job.chartOf[tri];
      for (let k = 0; k < 3; k++) {
        const vertex = indices[tri * 3 + k];
        const key = chart < 0 ? vertex : vertex + (chart + 1) * job.vertexCount;
        let id = pack.map.get(key);
        if (id == null) {
          id = pack.unique++;
          pack.map.set(key, id);
          pack.keys[id] = key;
        }
        pack.corners[tri * 3 + k] = id;
      }
    }
    const source = new Uint32Array(pack.unique);
    const uv1 = new Float32Array(pack.unique * 2);
    job.source = source;
    job.uv1 = uv1;
    job.outIndex = new Uint32Array(triCount * 3);
    job.outIndex.set(pack.corners);
    job.rects = pack.place ?? new Float32Array(0);
    pack.stage = 'emit';
    pack.cursor = 0;
  }
  if (pack.stage === 'emit' && job.uv1 != null && job.source != null &&
      pack.keys != null && pack.place != null) {
    const place = pack.place;
    const gutter = 4;
    const originX = job.tile?.x ?? gutter;
    const originY = job.tile?.y ?? gutter;
    const spanX = Math.max(1, job.tile?.w ?? resolution - gutter * 2);
    const spanY = Math.max(1, job.tile?.h ?? resolution - gutter * 2);
    const minU = originX / resolution;
    const minV = originY / resolution;
    const maxU = Math.max(minU, (originX + spanX - 0.5) / resolution);
    const maxV = Math.max(minV, (originY + spanY - 0.5) / resolution);
    const widthOf = (c: number) => Math.max(1e-6, pack.maxX[c] - pack.minX[c]);
    const heightOf = (c: number) => Math.max(1e-6, pack.maxY[c] - pack.minY[c]);
    while (pack.cursor < pack.unique) {
      if (expired()) {
        return false;
      }
      const id = pack.cursor++;
      const key = pack.keys[id];
      const chart = key < job.vertexCount ? -1 :
                                            Math.floor(key / job.vertexCount) - 1;
      const vertex = chart < 0 ? key : key - (chart + 1) * job.vertexCount;
      job.source[id] = vertex;
      if (chart < 0) {
        job.uv1[id * 2] = minU;
        job.uv1[id * 2 + 1] = minV;
        continue;
      }
      const [u, v] = projectChart(job, pack, chart, vertex);
      const px = place[chart * 4] +
          ((u - pack.minX[chart]) / widthOf(chart)) * place[chart * 4 + 2];
      const py = place[chart * 4 + 1] +
          ((v - pack.minY[chart]) / heightOf(chart)) * place[chart * 4 + 3];
      job.uv1[id * 2] = Math.min(maxU, Math.max(minU, px / resolution));
      job.uv1[id * 2 + 1] = Math.min(maxV, Math.max(minV, py / resolution));
    }
    return true;
  }
  return pack.stage === 'emit' && pack.unique === 0;
};


export const stepUvJob = (job: UvJob, budgetMs: number) => {
  if (job.done) {
    return;
  }
  const start = performance.now();
  if (job.phase === 'copy') {
    const position = job.geometry.getAttribute('position');
    const indexAttr = job.geometry.getIndex();
    while (job.copyCursor < job.vertexCount) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      const i = job.copyCursor++;
      job.positions[i * 3] = position.getX(i);
      job.positions[i * 3 + 1] = position.getY(i);
      job.positions[i * 3 + 2] = position.getZ(i);
    }
    if (indexAttr == null) {
      while (job.indexCursor < job.indices.length) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        job.indices[job.indexCursor] = job.indexCursor;
        job.indexCursor++;
      }
    } else {
      while (job.indexCursor < job.indices.length) {
        if (performance.now() - start >= budgetMs) {
          return;
        }
        job.indices[job.indexCursor] = indexAttr.getX(job.indexCursor);
        job.indexCursor++;
      }
    }
    job.phase = 'normals';
  }
  if (job.phase === 'normals') {
    while (job.normalCursor < job.triCount) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      faceNormal(
          job.positions,
          job.indices,
          job.normalCursor,
          job.normals,
          job.normalCursor * 3);
      job.normalCursor++;
    }
    let cap = 1;
    const edges = job.triCount * 3;
    while (cap < edges * 2) {
      cap <<= 1;
    }
    const table: EdgeTable = {
      mask: cap - 1,
      keyA: new Uint32Array(cap),
      keyB: new Uint32Array(cap),
      tri0: new Int32Array(cap),
      tri1: new Int32Array(cap),
      cursor: 0,
    };
    table.tri0.fill(-1);
    table.tri1.fill(-1);
    job.edges = table;
    job.phase = 'edges';
  }
  if (job.phase === 'edges' && job.edges != null) {
    const table = job.edges;
    while (job.edgeCursor < job.triCount) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      const tri = job.edgeCursor;
      const a = job.indices[tri * 3];
      const b = job.indices[tri * 3 + 1];
      const c = job.indices[tri * 3 + 2];
      insertEdge(table, a, b, tri);
      insertEdge(table, b, c, tri);
      insertEdge(table, c, a, tri);
      job.edgeCursor++;
    }
    job.chartOf.fill(-1);
    job.phase = 'charts';
  }
  if (job.phase === 'charts' && job.edges != null) {
    const queue = job.chartQueue;
    while (job.chartCursor < job.triCount || queue.length > 0) {
      if (performance.now() - start >= budgetMs) {
        return;
      }
      if (!job.chartActive) {
        if (job.chartCursor >= job.triCount) {
          break;
        }
        const seed = job.chartCursor++;
        if (job.chartOf[seed] >= 0) {
          continue;
        }
        job.seedNormal[0] = job.normals[seed * 3];
        job.seedNormal[1] = job.normals[seed * 3 + 1];
        job.seedNormal[2] = job.normals[seed * 3 + 2];
        job.chartOf[seed] = job.chartCount++;
        queue.push(seed);
        job.chartActive = true;
      }
      const chart = job.chartCount - 1;
      const sx = job.seedNormal[0];
      const sy = job.seedNormal[1];
      const sz = job.seedNormal[2];
      let steps = 0;
      while (queue.length > 0 && steps < 2500) {
        steps++;
        const tri = queue.pop() as number;
        const a = job.indices[tri * 3];
        const b = job.indices[tri * 3 + 1];
        const c = job.indices[tri * 3 + 2];
        const pairs: Array<[number, number]> = [[a, b], [b, c], [c, a]];
        for (let e = 0; e < 3; e++) {
          const other = neighbor(job.edges, pairs[e][0], pairs[e][1], tri);
          if (other < 0 || job.chartOf[other] >= 0) {
            continue;
          }
          const ox = job.normals[other * 3];
          const oy = job.normals[other * 3 + 1];
          const oz = job.normals[other * 3 + 2];
          const seedDot = ox * sx + oy * sy + oz * sz;
          const edgeDot = ox * job.normals[tri * 3] +
              oy * job.normals[tri * 3 + 1] + oz * job.normals[tri * 3 + 2];
          if (seedDot > 0.82 && edgeDot > 0.35) {
            job.chartOf[other] = chart;
            queue.push(other);
          }
        }
      }
      if (queue.length === 0) {
        job.chartActive = false;
      }
    }
    job.phase = 'pack';
    return;
  }
  if (job.phase === 'pack') {
    if (!stepPack(job, Math.max(0, budgetMs - (performance.now() - start)))) {
      return;
    }
    job.phase = 'emit';
    job.done = true;
  }
};

export const applyUvJob = (
    geometry: BufferGeometry,
    job: UvJob,
    ): BufferGeometry|null => {
  if (!job.done || job.source == null || job.uv1 == null ||
      job.outIndex == null) {
    return null;
  }
  const source = job.source;
  let needsSplit = source.length !== job.vertexCount;
  if (!needsSplit) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] !== i) {
        needsSplit = true;
        break;
      }
    }
  }
  const uv1 = new BufferAttribute(job.uv1, 2);
  if (!needsSplit) {
    geometry.setAttribute('uv1', uv1);
    return geometry;
  }
  const clone = new BufferGeometry();
  const names = Object.keys(geometry.attributes);
  for (const name of names) {
    const attr = geometry.getAttribute(name);
    if ((attr as InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      continue;
    }
    const itemSize = attr.itemSize;
    const src = attr.array as ArrayLike<number>;
    const Ctor =
        (attr.array as Float32Array).constructor as Float32ArrayConstructor;
    const out = new Ctor(source.length * itemSize);
    for (let i = 0; i < source.length; i++) {
      const from = source[i] * itemSize;
      const to = i * itemSize;
      for (let k = 0; k < itemSize; k++) {
        out[to + k] = src[from + k];
      }
    }
    clone.setAttribute(
        name, new BufferAttribute(out, itemSize, attr.normalized));
  }
  clone.setAttribute('uv1', uv1);
  clone.setIndex(new BufferAttribute(job.outIndex, 1));
  return clone;
};

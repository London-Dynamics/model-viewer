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
  const step = Math.max(1, Math.floor(triCount / 4000));
  for (let tri = 0; tri < triCount; tri += step) {
    const i0 = index != null ? index.getX(tri * 3) : tri * 3;
    const i1 = index != null ? index.getX(tri * 3 + 1) : tri * 3 + 1;
    const i2 = index != null ? index.getX(tri * 3 + 2) : tri * 3 + 2;
    const ax = uv.getX(i0);
    const ay = uv.getY(i0);
    const bx = uv.getX(i1);
    const by = uv.getY(i1);
    const cx = uv.getX(i2);
    const cy = uv.getY(i2);
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
  if (written < 4) {
    return false;
  }
  return overlap / written <= 0.02;
};

interface EdgeTable {
  mask: number;
  keyA: Uint32Array;
  keyB: Uint32Array;
  tri0: Int32Array;
  tri1: Int32Array;
  cursor: number;
}

export interface UvJob {
  done: boolean;
  resolution: number;
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

const packCharts = (job: UvJob) => {
  const {triCount, chartCount, normals, indices, positions, resolution} = job;
  const minX = new Float32Array(chartCount);
  const minY = new Float32Array(chartCount);
  const maxX = new Float32Array(chartCount);
  const maxY = new Float32Array(chartCount);
  const nx = new Float32Array(chartCount);
  const ny = new Float32Array(chartCount);
  const nz = new Float32Array(chartCount);
  const seen = new Uint8Array(chartCount);
  minX.fill(Infinity);
  minY.fill(Infinity);
  maxX.fill(-Infinity);
  maxY.fill(-Infinity);
  for (let tri = 0; tri < triCount; tri++) {
    const chart = job.chartOf[tri];
    if (chart < 0) {
      continue;
    }
    if (seen[chart] === 0) {
      nx[chart] = normals[tri * 3];
      ny[chart] = normals[tri * 3 + 1];
      nz[chart] = normals[tri * 3 + 2];
      seen[chart] = 1;
    }
  }
  const tx = new Float32Array(chartCount);
  const ty = new Float32Array(chartCount);
  const tz = new Float32Array(chartCount);
  const bx = new Float32Array(chartCount);
  const by = new Float32Array(chartCount);
  const bz = new Float32Array(chartCount);
  for (let c = 0; c < chartCount; c++) {
    const ax = Math.abs(nx[c]);
    const ay = Math.abs(ny[c]);
    const az = Math.abs(nz[c]);
    let ux = 0, uy = 1, uz = 0;
    if (ay > ax && ay > az) {
      ux = 1;
      uy = 0;
      uz = 0;
    }
    let x = uy * nz[c] - uz * ny[c];
    let y = uz * nx[c] - ux * nz[c];
    let z = ux * ny[c] - uy * nx[c];
    let len = Math.hypot(x, y, z) || 1;
    tx[c] = x / len;
    ty[c] = y / len;
    tz[c] = z / len;
    x = ny[c] * tz[c] - nz[c] * ty[c];
    y = nz[c] * tx[c] - nx[c] * tz[c];
    z = nx[c] * ty[c] - ny[c] * tx[c];
    len = Math.hypot(x, y, z) || 1;
    bx[c] = x / len;
    by[c] = y / len;
    bz[c] = z / len;
  }
  const project = (chart: number, vertex: number) => {
    const p = vertex * 3;
    const dx = positions[p];
    const dy = positions[p + 1];
    const dz = positions[p + 2];
    return [
      dx * tx[chart] + dy * ty[chart] + dz * tz[chart],
      dx * bx[chart] + dy * by[chart] + dz * bz[chart],
    ];
  };
  for (let tri = 0; tri < triCount; tri++) {
    const chart = job.chartOf[tri];
    if (chart < 0) {
      continue;
    }
    for (let k = 0; k < 3; k++) {
      const [u, v] = project(chart, indices[tri * 3 + k]);
      minX[chart] = Math.min(minX[chart], u);
      minY[chart] = Math.min(minY[chart], v);
      maxX[chart] = Math.max(maxX[chart], u);
      maxY[chart] = Math.max(maxY[chart], v);
    }
  }
  const order = new Int32Array(chartCount);
  for (let i = 0; i < chartCount; i++) {
    order[i] = i;
  }
  const widthOf = (c: number) => Math.max(1e-6, maxX[c] - minX[c]);
  const heightOf = (c: number) => Math.max(1e-6, maxY[c] - minY[c]);
  order.sort((a, b) => heightOf(b) - heightOf(a));
  const pad = 4;
  let maxExtent = 1e-6;
  for (let i = 0; i < chartCount; i++) {
    maxExtent = Math.max(maxExtent, widthOf(i), heightOf(i));
  }
  let areaSum = 0;
  for (let i = 0; i < chartCount; i++) {
    areaSum += widthOf(i) * heightOf(i);
  }
  const areaScale = Math.sqrt(((resolution - pad * 2) ** 2) * 0.55 / Math.max(areaSum, 1e-6));
  let scale = Math.min((resolution * 0.85) / maxExtent, areaScale);
  if (!Number.isFinite(scale) || scale <= 0) {
    scale = 1;
  }
  const place = new Float32Array(chartCount * 4);
  let fitted = false;
  for (let attempt = 0; attempt < 14 && !fitted; attempt++) {
    let cursorX = pad;
    let cursorY = pad;
    let rowH = 0;
    fitted = true;
    for (let n = 0; n < chartCount; n++) {
      const c = order[n];
      const w = Math.max(3, Math.ceil(widthOf(c) * scale));
      const h = Math.max(3, Math.ceil(heightOf(c) * scale));
      if (cursorX + w + pad > resolution) {
        cursorX = pad;
        cursorY += rowH + pad;
        rowH = 0;
      }
      if (cursorY + h + pad > resolution) {
        fitted = false;
        scale *= 0.6;
        break;
      }
      place[c * 4] = cursorX;
      place[c * 4 + 1] = cursorY;
      place[c * 4 + 2] = w;
      place[c * 4 + 3] = h;
      cursorX += w + pad;
      rowH = Math.max(rowH, h);
    }
  }
  const map = new Map<number, number>();
  let unique = 0;
  const cornerSource = new Int32Array(triCount * 3);
  for (let tri = 0; tri < triCount; tri++) {
    const chart = job.chartOf[tri];
    for (let k = 0; k < 3; k++) {
      const vertex = indices[tri * 3 + k];
      const key = chart < 0 ? vertex : vertex + (chart + 1) * job.vertexCount;
      let id = map.get(key);
      if (id == null) {
        id = unique++;
        map.set(key, id);
      }
      cornerSource[tri * 3 + k] = id;
    }
  }
  const source = new Uint32Array(unique);
  const uv1 = new Float32Array(unique * 2);
  map.forEach((id, key) => {
    const chart =
        key < job.vertexCount ? -1 : Math.floor(key / job.vertexCount) - 1;
    const vertex = chart < 0 ? key : key - (chart + 1) * job.vertexCount;
    source[id] = vertex;
    if (chart < 0) {
      uv1[id * 2] = 0;
      uv1[id * 2 + 1] = 0;
      return;
    }
    const [u, v] = project(chart, vertex);
    const spanU = widthOf(chart);
    const spanV = heightOf(chart);
    const px =
        place[chart * 4] + ((u - minX[chart]) / spanU) * place[chart * 4 + 2];
    const py = place[chart * 4 + 1] +
        ((v - minY[chart]) / spanV) * place[chart * 4 + 3];
    uv1[id * 2] = Math.min(1 - 0.5 / resolution, Math.max(0, px / resolution));
    uv1[id * 2 + 1] =
        Math.min(1 - 0.5 / resolution, Math.max(0, py / resolution));
  });
  const outIndex = new Uint32Array(triCount * 3);
  outIndex.set(cornerSource);
  job.source = source;
  job.uv1 = uv1;
  job.outIndex = outIndex;
  job.rects = place;
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
    packCharts(job);
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

/**
 * Lightmap unwrap with xatlas (WASM). Positions are metres.
 * Boat-scale density is 1–2 texels/cm. A cabinet is close-up, so the
 * floor rises to 8 texels/cm and a 2048 atlas can actually fill.
 */
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';

import {Api} from './vendor/xatlas/api.mjs';

const require = createRequire(import.meta.url);
const createXAtlasModule = require('./vendor/xatlas/xatlas.cjs');

const here = dirname(fileURLToPath(import.meta.url));
const CHUNK_VERTS = 12000;

const texelsPerCm = (maxSideM) => {
  if (maxSideM >= 6) return 2;
  if (maxSideM >= 2.5) return 4;
  return 8;
};

const meshesOf = (root) => {
  const meshes = [];
  root.traverse((child) => {
    if (child.isMesh && child.geometry?.getAttribute('position')) {
      meshes.push(child);
    }
  });
  return meshes;
};

/**
 * Chunks carry world-space positions and normals so xatlas sizes charts by
 * real metres, even under node scale. The caller maps them back to local.
 */
const chunksOf = (geometry, world) => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const normalMatrix = new Matrix3().getNormalMatrix(world);
  const p = new Vector3();
  const nv = new Vector3();
  const uv = geometry.getAttribute('uv');
  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(position.count / 3);
  const chunks = [];
  let map = new Map();
  let positions = [];
  let normals = [];
  let uvs = [];
  let indices = [];
  const flush = () => {
    if (indices.length === 0) return;
    chunks.push({
      indices: new Uint16Array(indices),
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: uvs.length ? new Float32Array(uvs) : null,
    });
    map = new Map();
    positions = [];
    normals = [];
    uvs = [];
    indices = [];
  };
  for (let tri = 0; tri < triCount; tri++) {
    const ids = [0, 1, 2].map((k) =>
      index ? index.getX(tri * 3 + k) : tri * 3 + k);
    const fresh = ids.filter((id) => !map.has(id)).length;
    if (positions.length / 3 + fresh > CHUNK_VERTS) flush();
    for (const id of ids) {
      let local = map.get(id);
      if (local == null) {
        local = positions.length / 3;
        map.set(id, local);
        p.fromBufferAttribute(position, id).applyMatrix4(world);
        positions.push(p.x, p.y, p.z);
        if (normal) {
          nv.fromBufferAttribute(normal, id).applyMatrix3(normalMatrix).normalize();
          normals.push(nv.x, nv.y, nv.z);
        } else {
          normals.push(0, 1, 0);
        }
        if (uv) uvs.push(uv.getX(id), uv.getY(id));
      }
      indices.push(local);
    }
  }
  flush();
  return chunks;
};

const waitLoaded = async (atlas) => {
  const start = performance.now();
  while (!atlas.loaded) {
    if (performance.now() - start > 30000) {
      throw new Error('xatlas wasm did not load');
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
};

const parseGlb = (file) => {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(file.buffer, file.byteOffset + 20, jsonLength)));
  const bin = new Uint8Array(file.buffer, file.byteOffset + 20 + jsonLength + 8);
  return {json, bin};
};

const dracoDecoder = async () => {
  const src = join(here, '../../../../node_modules/three/examples/jsm/libs/draco/gltf');
  const dir = '/tmp/ld-draco';
  await mkdir(dir, {recursive: true});
  await copyFile(join(src, 'draco_decoder.js'), join(dir, 'draco_decoder.cjs'));
  await copyFile(join(src, 'draco_decoder.wasm'), join(dir, 'draco_decoder.wasm'));
  const DracoDecoderModule = require(join(dir, 'draco_decoder.cjs'));
  return DracoDecoderModule({locateFile: () => join(dir, 'draco_decoder.wasm')});
};

const decodePrimitive = (draco, decoder, bytes, attributes) => {
  const buffer = new draco.DecoderBuffer();
  buffer.Init(new Int8Array(bytes), bytes.length);
  const geometry = new draco.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, geometry);
  if (!status.ok()) {
    throw new Error(status.error_msg());
  }
  const faces = geometry.num_faces();
  const indexPtr = draco._malloc(faces * 12);
  decoder.GetTrianglesUInt32Array(geometry, faces * 12, indexPtr);
  const indices = new Uint32Array(draco.HEAPU8.buffer, indexPtr, faces * 3).slice();
  draco._free(indexPtr);
  const points = geometry.num_points();
  const attribute = (id) => {
    const attr = decoder.GetAttributeByUniqueId(geometry, id);
    const components = attr.num_components();
    const ptr = draco._malloc(points * components * 4);
    decoder.GetAttributeDataArrayForAllPoints(
        geometry, attr, draco.DT_FLOAT32, points * components * 4, ptr);
    const values = new Float32Array(draco.HEAPU8.buffer, ptr, points * components).slice();
    draco._free(ptr);
    return values;
  };
  const read = (id) => attribute(id);
  const decoded = {
    indices,
    positions: read(attributes.POSITION),
    normals: attributes.NORMAL != null ? read(attributes.NORMAL) : null,
    uvs: attributes.TEXCOORD_0 != null ? read(attributes.TEXCOORD_0) : null,
  };
  draco.destroy(geometry);
  draco.destroy(buffer);
  return decoded;
};

const COMPONENTS = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4};
const ARRAYS = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const NORMALIZE = {5120: 127, 5121: 255, 5122: 32767, 5123: 65535};

/** Plain (non-Draco) accessor, de-interleaved to Float32 or Uint32. */
const readAccessor = (json, bin, id, asIndex = false) => {
  const accessor = json.accessors[id];
  const view = json.bufferViews[accessor.bufferView];
  const Type = ARRAYS[accessor.componentType];
  const size = COMPONENTS[accessor.type];
  const elementBytes = Type.BYTES_PER_ELEMENT * size;
  const stride = view.byteStride || elementBytes;
  const base = bin.byteOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = asIndex ? new Uint32Array(accessor.count * size) : new Float32Array(accessor.count * size);
  const data = new DataView(bin.buffer);
  const scale = !asIndex && accessor.normalized ? NORMALIZE[accessor.componentType] : 1;
  const readers = {
    5120: (o) => data.getInt8(o),
    5121: (o) => data.getUint8(o),
    5122: (o) => data.getInt16(o, true),
    5123: (o) => data.getUint16(o, true),
    5125: (o) => data.getUint32(o, true),
    5126: (o) => data.getFloat32(o, true),
  };
  const read = readers[accessor.componentType];
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < size; c++) {
      const value = read(base + i * stride + c * Type.BYTES_PER_ELEMENT);
      out[i * size + c] = scale !== 1 ? Math.max(value / scale, -1) : value;
    }
  }
  return out;
};

const plainPrimitive = (json, bin, primitive) => {
  const attributes = primitive.attributes;
  const positions = readAccessor(json, bin, attributes.POSITION);
  const indices = primitive.indices != null ?
      readAccessor(json, bin, primitive.indices, true) :
      Uint32Array.from({length: positions.length / 3}, (_, i) => i);
  return {
    indices,
    positions,
    normals: attributes.NORMAL != null ? readAccessor(json, bin, attributes.NORMAL) : null,
    uvs: attributes.TEXCOORD_0 != null ? readAccessor(json, bin, attributes.TEXCOORD_0) : null,
  };
};

const loadMeshes = async (glbPath) => {
  const file = await readFile(glbPath);
  const {json, bin} = parseGlb(file);
  const draco = await dracoDecoder();
  const decoder = new draco.Decoder();
  const root = new Group();
  const nodes = json.nodes || [];
  const visit = (index, parent) => {
    const node = nodes[index];
    const holder = new Group();
    holder.name = node.name || String(index);
    const matrix = new Matrix4();
    if (node.matrix) {
      matrix.fromArray(node.matrix);
    } else {
      matrix.compose(
          new Vector3(...(node.translation || [0, 0, 0])),
          new Quaternion(...(node.rotation || [0, 0, 0, 1])),
          new Vector3(...(node.scale || [1, 1, 1])),
      );
    }
    holder.matrix.copy(matrix);
    holder.matrixAutoUpdate = false;
    parent.add(holder);
    if (node.mesh != null) {
      const mesh = json.meshes[node.mesh];
      mesh.primitives.forEach((primitive, n) => {
        const dracoExt = primitive.extensions && primitive.extensions.KHR_draco_mesh_compression;
        let decoded;
        if (dracoExt == null) {
          decoded = plainPrimitive(json, bin, primitive);
        } else {
          const view = json.bufferViews[dracoExt.bufferView];
          const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
          decoded = decodePrimitive(draco, decoder, bytes, dracoExt.attributes);
        }
        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new BufferAttribute(decoded.positions, 3));
        if (decoded.normals) {
          geometry.setAttribute('normal', new BufferAttribute(decoded.normals, 3));
        }
        if (decoded.uvs) {
          geometry.setAttribute('uv', new BufferAttribute(decoded.uvs, 2));
        }
        geometry.setIndex(new BufferAttribute(decoded.indices, 1));
        const object = new Mesh(geometry);
        object.name = mesh.primitives.length > 1 ? `${holder.name}:${n}` : holder.name;
        holder.add(object);
      });
    }
    for (const child of node.children || []) visit(child, holder);
  };
  const scene = json.scenes[json.scene || 0];
  for (const index of scene.nodes) visit(index, root);
  decoder.delete?.();
  return root;
};

export async function unwrapLightmap(glbPath, outPath, resolution = 2048) {
  const root = await loadMeshes(glbPath);
  root.updateMatrixWorld(true);
  const meshes = meshesOf(root);
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const maxSide = Math.max(size.x, size.y, size.z);
  const perCm = texelsPerCm(maxSide);
  // World surface area decides whether the class floor fits one atlas.
  let area = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const triCount = index ? index.count / 3 : position.count / 3;
    for (let tri = 0; tri < triCount; tri++) {
      const i0 = index ? index.getX(tri * 3) : tri * 3;
      const i1 = index ? index.getX(tri * 3 + 1) : tri * 3 + 1;
      const i2 = index ? index.getX(tri * 3 + 2) : tri * 3 + 2;
      a.fromBufferAttribute(position, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, i2).applyMatrix4(mesh.matrixWorld);
      area += b.sub(a).cross(c.sub(a)).length() * 0.5;
    }
  }
  const fitUnit = Math.sqrt(0.75 * resolution * resolution / Math.max(area, 1e-6));
  let texelsPerUnit = Math.min(perCm * 100, fitUnit);

  const wasmUrl = pathToFileURL(join(here, 'vendor/xatlas/xatlas.wasm')).href;
  const Xatlas = Api(createXAtlasModule);
  const atlas = new Xatlas(
      () => {},
      (path) => (path.endsWith('xatlas.wasm') ? wasmUrl : path),
      (mode, progress) => {
        if (progress === 0 || progress >= 100) {
          console.log('XATLAS', mode, progress);
        }
      },
  );
  await waitLoaded(atlas);
  const allChunks = meshes.map((mesh) => chunksOf(mesh.geometry, mesh.matrixWorld));
  const meshChunks = allChunks.map((chunks) => chunks.length);
  let result = null;
  let unwrapMs = 0;
  let attempts = 0;
  // Many tiny charts make padding, not density, the limit, so a failed
  // attempt first thins the padding and merges charts, then drops density.
  let padding = 4;
  let maxCost = 2;
  const started = performance.now();
  for (;;) {
    attempts++;
    atlas.createAtlas();
    for (let m = 0; m < meshes.length; m++) {
      for (const chunk of allChunks[m]) {
        const added = atlas.addMesh(
            chunk.indices,
            chunk.positions,
            chunk.normals,
            chunk.uvs,
            meshes[m].name,
            true,
            false,
        );
        if (added == null) {
          throw new Error(`xatlas rejected ${meshes[m].name}`);
        }
      }
    }
    result = atlas.generateAtlas({
      useInputMeshUvs: false,
      maxIterations: 1,
      maxCost,
    }, {
      resolution,
      padding,
      texelsPerUnit,
      bilinear: true,
      rotateCharts: true,
      rotateChartsToAxis: true,
    }, true);
    atlas.destroyAtlas();
    console.log('XATLAS_ATTEMPT', JSON.stringify({attempts, texelsPerUnit, padding, maxCost, atlasCount: result.atlasCount, area, ms: Math.round(performance.now() - started)}));
    if (result.atlasCount <= 1 || attempts >= 8) break;
    if (padding > 2) {
      padding = 2;
    } else if (maxCost < 16) {
      maxCost *= 2;
    }
    texelsPerUnit *= result.atlasCount > 2 ? 0.7 : 0.85;
  }
  unwrapMs = Math.round(performance.now() - started);
  if (result.atlasCount > 1) {
    throw new Error(`xatlas still needs ${result.atlasCount} atlases at ${texelsPerUnit} texels/m`);
  }

  const parts = [];
  let cursor = 0;
  for (let m = 0; m < meshes.length; m++) {
    const count = meshChunks[m];
    const group = result.meshes.slice(cursor, cursor + count);
    cursor += count;
    let vertexCount = 0;
    let indexCount = 0;
    for (const piece of group) {
      vertexCount += piece.vertexCount;
      indexCount += piece.index.length;
    }
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uv = new Float32Array(vertexCount * 2);
    const uv1 = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(indexCount);
    let vBase = 0;
    let iBase = 0;
    const toLocal = meshes[m].matrixWorld.clone().invert();
    const normalBack = new Matrix3().setFromMatrix4(meshes[m].matrixWorld).transpose();
    const lp = new Vector3();
    for (const piece of group) {
      const wv = piece.vertex.vertices;
      for (let i = 0; i < wv.length; i += 3) {
        lp.set(wv[i], wv[i + 1], wv[i + 2]).applyMatrix4(toLocal);
        wv[i] = lp.x; wv[i + 1] = lp.y; wv[i + 2] = lp.z;
      }
      const wn = piece.vertex.normals;
      if (wn) {
        for (let i = 0; i < wn.length; i += 3) {
          lp.set(wn[i], wn[i + 1], wn[i + 2]).applyMatrix3(normalBack).normalize();
          wn[i] = lp.x; wn[i + 1] = lp.y; wn[i + 2] = lp.z;
        }
      }
      if (piece.vertexCount > 65535) {
        throw new Error(`${meshes[m].name} chart chunk has ${piece.vertexCount} vertices`);
      }
      positions.set(piece.vertex.vertices, vBase * 3);
      if (piece.vertex.normals) normals.set(piece.vertex.normals, vBase * 3);
      if (piece.vertex.coords) uv.set(piece.vertex.coords, vBase * 2);
      const light = piece.vertex.coords1;
      let maxU = 0;
      let maxV = 0;
      for (let i = 0; i < light.length; i += 2) {
        maxU = Math.max(maxU, light[i]);
        maxV = Math.max(maxV, light[i + 1]);
      }
      const uScale = maxU > 1.5 ? result.width : 1;
      const vScale = maxV > 1.5 ? result.height : 1;
      for (let i = 0; i < piece.vertexCount; i++) {
        uv1[(vBase + i) * 2] = light[i * 2] / uScale;
        uv1[(vBase + i) * 2 + 1] = light[i * 2 + 1] / vScale;
      }
      for (let i = 0; i < piece.index.length; i++) {
        indices[iBase + i] = piece.index[i] + vBase;
      }
      vBase += piece.vertexCount;
      iBase += piece.index.length;
    }
    parts.push({
      name: meshes[m].name,
      positions,
      normals,
      uv,
      uv1,
      indices,
    });
  }

  const header = {
    resolution,
    unwrapMs,
    texelsPerCm: texelsPerUnit / 100,
    classTexelsPerCm: perCm,
    padding,
    maxCost,
    texelsPerUnit,
    areaM2: area,
    attempts,
    maxSide,
    atlasWidth: result.width,
    atlasHeight: result.height,
    meshes: parts.map((part) => ({
      name: part.name,
      vertexCount: part.positions.length / 3,
      indexCount: part.indices.length,
    })),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const pad = (4 - (headerBytes.length % 4)) % 4;
  const padded = Buffer.concat([headerBytes, Buffer.alloc(pad)]);
  const chunks = [Buffer.alloc(8)];
  chunks[0].writeUInt32LE(0x3156554c, 0);
  chunks[0].writeUInt32LE(padded.length, 4);
  chunks.push(padded);
  for (const part of parts) {
    chunks.push(Buffer.from(part.positions.buffer));
    chunks.push(Buffer.from(part.normals.buffer));
    chunks.push(Buffer.from(part.uv.buffer));
    chunks.push(Buffer.from(part.uv1.buffer));
    chunks.push(Buffer.from(part.indices.buffer));
  }
  await writeFile(outPath, Buffer.concat(chunks));
  let covered = 0;
  const stamp = new Uint8Array(resolution * resolution);
  for (const part of parts) {
    const uv = part.uv1;
    const index = part.indices;
    for (let i = 0; i < index.length; i += 3) {
      const a = index[i] * 2;
      const b = index[i + 1] * 2;
      const c = index[i + 2] * 2;
      const xs = [uv[a], uv[b], uv[c]].map((u) => Math.min(resolution - 1, Math.max(0, Math.floor(u * resolution))));
      const ys = [uv[a + 1], uv[b + 1], uv[c + 1]].map((v) => Math.min(resolution - 1, Math.max(0, Math.floor(v * resolution))));
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) stamp[y * resolution + x] = 1;
      }
    }
  }
  for (let i = 0; i < stamp.length; i++) if (stamp[i]) covered++;
  header.coverage = covered / stamp.length;
  console.log('UNWRAP', JSON.stringify(header));
  return header;
}

if (process.argv[1] && process.argv[1].endsWith('unwrap-lightmap.mjs')) {
  const glb = process.argv[2];
  const out = process.argv[3];
  unwrapLightmap(glb, out, Number(process.argv[4] || 2048)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}


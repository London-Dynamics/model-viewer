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

const chunksOf = (geometry) => {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
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
        positions.push(position.getX(id), position.getY(id), position.getZ(id));
        if (normal) {
          normals.push(normal.getX(id), normal.getY(id), normal.getZ(id));
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
        if (dracoExt == null) {
          throw new Error('primitive is not Draco compressed');
        }
        const view = json.bufferViews[dracoExt.bufferView];
        const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
        const decoded = decodePrimitive(draco, decoder, bytes, dracoExt.attributes);
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
  const texelsPerUnit = perCm * 100;

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
  atlas.createAtlas();
  const meshChunks = [];
  for (const mesh of meshes) {
    const chunks = chunksOf(mesh.geometry);
    meshChunks.push(chunks.length);
    for (const chunk of chunks) {
      const added = atlas.addMesh(
          chunk.indices,
          chunk.positions,
          chunk.normals,
          chunk.uvs,
          mesh.name,
          true,
          false,
      );
      if (added == null) {
        throw new Error(`xatlas rejected ${mesh.name}`);
      }
    }
  }
  const started = performance.now();
  const result = atlas.generateAtlas({
    useInputMeshUvs: false,
    maxIterations: 1,
  }, {
    resolution,
    padding: 4,
    texelsPerUnit,
    bilinear: true,
    rotateCharts: true,
    rotateChartsToAxis: true,
  }, true);
  const unwrapMs = Math.round(performance.now() - started);
  atlas.destroyAtlas();

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
    for (const piece of group) {
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
    texelsPerCm: perCm,
    texelsPerUnit,
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


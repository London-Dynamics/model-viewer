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

import {Box3, BufferGeometry, Mesh, Object3D} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

import {fnv1aHex} from './path-tracer-cache-format.js';

export interface SerializedBvhMesh {
  name: string;
  vertexCount: number;
  indexCount: number;
  roots: ArrayBuffer[];
  index: ArrayBuffer|null;
  indexType: 'u16'|'u32'|'none';
  indirect: ArrayBuffer|null;
}

const indexTypeOf = (array: ArrayLike<number>|null): 'u16'|'u32'|'none' => {
  if (array == null) {
    return 'none';
  }
  return array instanceof Uint16Array ? 'u16' : 'u32';
};

const bytesOf = (array: ArrayBuffer|ArrayBufferView|null): ArrayBuffer|null => {
  if (array == null) {
    return null;
  }
  if (array instanceof ArrayBuffer) {
    return array.slice(0);
  }
  return array.buffer.slice(
      array.byteOffset, array.byteOffset + array.byteLength);
};

const typedIndex = (
    buffer: ArrayBuffer|null,
    indexType: 'u16'|'u32'|'none',
    ): Uint16Array|Uint32Array|null => {
  if (buffer == null || indexType === 'none') {
    return null;
  }
  return indexType === 'u16' ? new Uint16Array(buffer) :
                               new Uint32Array(buffer);
};

export const serializeMeshBvh = (mesh: Mesh): SerializedBvhMesh|null => {
  const geometry = mesh.geometry as BufferGeometry | undefined;
  const boundsTree = geometry?.boundsTree as MeshBVH | undefined;
  const position = geometry?.getAttribute('position');
  if (geometry == null || boundsTree == null || position == null) {
    return null;
  }
  const serialized = MeshBVH.serialize(boundsTree, {cloneBuffers: true}) as {
    roots: ArrayBuffer[];
    index: ArrayLike<number>|null;
    indirectBuffer: ArrayBufferView|null;
  };
  const index = serialized.index;
  return {
    name: mesh.name,
    vertexCount: position.count,
    indexCount: geometry.index?.count ?? 0,
    roots: serialized.roots.map((root) => root.slice(0)),
    index: bytesOf(index == null ? null : index as unknown as ArrayBufferView),
    indexType: indexTypeOf(index),
    indirect: bytesOf(serialized.indirectBuffer),
  };
};

export const captureSceneBvh = (root: Object3D): SerializedBvhMesh[] => {
  const records: SerializedBvhMesh[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.userData?.pathTracerShadowCatcher === true) {
      return;
    }
    const record = serializeMeshBvh(mesh);
    if (record != null) {
      records.push(record);
    }
  });
  return records;
};

export const matchBvhRecord = (
    mesh: Mesh,
    records: readonly SerializedBvhMesh[],
    used: Set<number>,
    ): SerializedBvhMesh|null => {
  const position = mesh.geometry?.getAttribute('position');
  const vertexCount = position?.count ?? -1;
  const named = records.findIndex(
      (record, index) => !used.has(index) && record.name !== '' &&
          record.name === mesh.name && record.vertexCount === vertexCount);
  const match = named >= 0 ? named :
                             records.findIndex(
                                 (record, index) => !used.has(index) &&
                                     record.vertexCount === vertexCount);
  if (match < 0) {
    return null;
  }
  used.add(match);
  return records[match];
};

export const restoreMeshBvh = (
    mesh: Mesh,
    record: SerializedBvhMesh,
    ): MeshBVH|null => {
  const geometry = mesh.geometry as BufferGeometry | undefined;
  const position = geometry?.getAttribute('position');
  if (geometry == null || position == null ||
      position.count !== record.vertexCount) {
    return null;
  }
  try {
    const index = typedIndex(record.index, record.indexType);
    const indirect =
        record.indirect == null ? null : new Uint32Array(record.indirect);
    const bvh = MeshBVH.deserialize(
        {
          version: 1,
          roots: record.roots,
          index,
          indirectBuffer: indirect,
        } as never,
        geometry,
        {setIndex: index != null});
    geometry.boundingBox = bvh.getBoundingBox(new Box3());
    geometry.boundsTree = bvh;
    return bvh;
  } catch (error) {
    console.warn(
        '[model-viewer] Path tracer BVH cache entry did not fit this mesh.',
        mesh.name,
        error);
    return null;
  }
};

export const encodeBvhRecords =
    (records: readonly SerializedBvhMesh[]): Uint8Array => {
      const parts: Uint8Array[] = [];
      const directory = records.map((record) => {
        const rootLengths = record.roots.map((root) => root.byteLength);
        return {
          name: record.name,
          vertexCount: record.vertexCount,
          indexCount: record.indexCount,
          indexType: record.indexType,
          rootLengths,
          indexBytes: record.index?.byteLength ?? 0,
          indirectBytes: record.indirect?.byteLength ?? 0,
        };
      });
      const json = new TextEncoder().encode(JSON.stringify(directory));
      parts.push(new Uint8Array(new Uint32Array([json.byteLength]).buffer));
      parts.push(json);
      for (const record of records) {
        for (const root of record.roots) {
          parts.push(new Uint8Array(root));
        }
        if (record.index != null) {
          parts.push(new Uint8Array(record.index));
        }
        if (record.indirect != null) {
          parts.push(new Uint8Array(record.indirect));
        }
      }
      let total = 0;
      for (const part of parts) {
        total += part.byteLength;
      }
      const file = new Uint8Array(total);
      let cursor = 0;
      for (const part of parts) {
        file.set(part, cursor);
        cursor += part.byteLength;
      }
      return file;
    };

export const decodeBvhRecords = (bytes: Uint8Array): SerializedBvhMesh[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(0, true);
  const jsonBytes = bytes.subarray(4, 4 + jsonLength);
  const directory = JSON.parse(new TextDecoder().decode(jsonBytes)) as Array<{
                      name: string; vertexCount: number; indexCount: number;
                      indexType: 'u16' | 'u32' | 'none';
                      rootLengths: number[];
                      indexBytes: number;
                      indirectBytes: number;
                    }>;
  let cursor = 4 + jsonLength;
  const take = (length: number): ArrayBuffer|null => {
    if (length <= 0) {
      return null;
    }
    const slice = bytes.slice(cursor, cursor + length);
    cursor += length;
    return slice.buffer.slice(
        slice.byteOffset, slice.byteOffset + slice.byteLength);
  };
  return directory.map((entry) => {
    const roots: ArrayBuffer[] = [];
    for (const length of entry.rootLengths) {
      const root = take(length);
      if (root != null) {
        roots.push(root);
      }
    }
    return {
      name: entry.name,
      vertexCount: entry.vertexCount,
      indexCount: entry.indexCount,
      roots,
      index: take(entry.indexBytes),
      indexType: entry.indexType,
      indirect: take(entry.indirectBytes),
    };
  });
};

export const hashMeshPositions = (root: Object3D): string => {
  let hash = 0x811c9dc5;
  let meshes = 0;
  let vertices = 0;
  root.traverse((object) => {
    const mesh = object as Mesh;
    const position =
        mesh.isMesh ? mesh.geometry?.getAttribute('position') : null;
    if (position == null || mesh.userData?.pathTracerShadowCatcher === true) {
      return;
    }
    meshes++;
    vertices += position.count;
    const array = (position as {array?: ArrayLike<number>}).array;
    if (array == null) {
      return;
    }
    const step = Math.max(1, Math.floor(array.length / 4096));
    for (let i = 0; i < array.length; i += step) {
      const value = Math.round(array[i] * 1000);
      hash ^= value;
      hash = Math.imul(hash, 0x01000193);
    }
  });
  return fnv1aHex(`${meshes}:${vertices}:${hash >>> 0}`);
};

export const restoreSceneBvh = (
    root: Object3D,
    records: readonly SerializedBvhMesh[],
    ): {restored: number, missed: number} => {
  const used = new Set<number>();
  let restored = 0;
  let missed = 0;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.userData?.pathTracerShadowCatcher === true ||
        mesh.geometry == null ||
        mesh.geometry.getAttribute('position') == null) {
      return;
    }
    if (mesh.geometry.boundsTree != null) {
      return;
    }
    const record = matchBvhRecord(mesh, records, used);
    if (record == null) {
      missed++;
      return;
    }
    if (restoreMeshBvh(mesh, record) == null) {
      missed++;
      return;
    }
    restored++;
  });
  return {restored, missed};
};

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

import {Color, Material, Mesh, MeshStandardMaterial, Object3D} from 'three';

export interface MaterialCacheRecord {
  meshName: string;
  materialName: string;
  color: [number, number, number];
  emissive: [number, number, number];
  roughness: number;
  metalness: number;
  transmission: number;
  opacity: number;
  mapId: string;
}

export interface MaterialWatchSample {
  meshUuid: string;
  materialUuid: string;
  color: string;
  emissive: string;
  /** Metalness, transmission, opacity, and map ids. Roughness is separate. */
  shading: string;
  roughness: string;
}

const colorTuple =
    (color: Color|undefined, fallback: number): [number, number, number] =>
        [color?.r ?? fallback,
         color?.g ?? fallback,
         color?.b ?? fallback,
];

const materialsOf = (mesh: Mesh): Material[] => {
  if (mesh.material == null) {
    return [];
  }
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
};

const asStandard = (material: Material): MeshStandardMaterial|null => {
  if ((material as MeshStandardMaterial).isMeshStandardMaterial === true) {
    return material as MeshStandardMaterial;
  }
  return null;
};

export const collectMaterialRecords =
    (root: Object3D): MaterialCacheRecord[] => {
      const records: MaterialCacheRecord[] = [];
      root.traverse((object) => {
        const mesh = object as Mesh;
        if (!mesh.isMesh || mesh.userData?.pathTracerShadowCatcher === true) {
          return;
        }
        for (const material of materialsOf(mesh)) {
          const standard = asStandard(material);
          const basicColor = (material as {color?: Color}).color;
          records.push({
            meshName: mesh.name,
            materialName: material.name,
            color: colorTuple(standard?.color ?? basicColor, 1),
            emissive: colorTuple(standard?.emissive, 0),
            roughness: standard?.roughness ?? 1,
            metalness: standard?.metalness ?? 0,
            transmission:
                (standard as {transmission?: number} | null)?.transmission ?? 0,
            opacity: material.opacity,
            mapId: standard?.map?.uuid ?? '',
          });
        }
      });
      return records;
    };

export const encodeMaterialRecords =
    (records: readonly MaterialCacheRecord[]): Uint8Array =>
        new TextEncoder().encode(JSON.stringify(records));

export const decodeMaterialRecords =
    (bytes: Uint8Array): MaterialCacheRecord[] =>
        JSON.parse(new TextDecoder().decode(bytes)) as MaterialCacheRecord[];

const round = (value: number|undefined): string =>
    value == null || !Number.isFinite(value) ? '' : value.toFixed(5);

export const sampleMaterialWatch = (root: Object3D): MaterialWatchSample[] => {
  const samples: MaterialWatchSample[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || mesh.userData?.pathTracerShadowCatcher === true) {
      return;
    }
    for (const material of materialsOf(mesh)) {
      const standard = asStandard(material);
      const color = standard?.color ?? (material as {color?: Color}).color;
      samples.push({
        meshUuid: mesh.uuid,
        materialUuid: material.uuid,
        color: color == null ?
            '' :
            `${round(color.r)},${round(color.g)},${round(color.b)}`,
        emissive: standard?.emissive == null ?
            '' :
            `${round(standard.emissive.r)},${round(standard.emissive.g)},${
                round(standard.emissive.b)}`,
        shading: [
          round(standard?.metalness),
          round((standard as {transmission?: number} | null)?.transmission),
          round(material.opacity),
          standard?.map?.uuid ?? '',
          standard?.normalMap?.uuid ?? '',
          standard?.roughnessMap?.uuid ?? '',
          standard?.metalnessMap?.uuid ?? '',
        ].join('|'),
        roughness: String(round(standard?.roughness)),
      });
    }
  });
  return samples;
};

/**
 * A new material identity, metalness, transmission, or a map edit is a
 * swap. Colour and roughness leave the albedo-free irradiance cache in
 * place. The primary hit is shaded again with the new colour or roughness.
 */
export const diffMaterialWatch = (
    previous: readonly MaterialWatchSample[],
    next: readonly MaterialWatchSample[],
    ): 'material-swap'|'material-adjust'|null => {
  if (previous.length !== next.length) {
    return 'material-swap';
  }
  let adjust = false;
  for (let i = 0; i < previous.length; i++) {
    const before = previous[i];
    const after = next[i];
    if (before.meshUuid !== after.meshUuid ||
        before.materialUuid !== after.materialUuid ||
        before.shading !== after.shading) {
      return 'material-swap';
    }
    if (before.color !== after.color || before.emissive !== after.emissive ||
        before.roughness !== after.roughness) {
      adjust = true;
    }
  }
  return adjust ? 'material-adjust' : null;
};

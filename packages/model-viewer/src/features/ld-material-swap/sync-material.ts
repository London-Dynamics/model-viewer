/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
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

import {Color, MeshPhysicalMaterial, Texture, Vector2} from 'three';

const MAP_KEYS = [
  'map',
  'alphaMap',
  'aoMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'emissiveMap',
  'metalnessMap',
  'roughnessMap',
  'lightMap',
  'envMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
  'specularIntensityMap',
  'specularColorMap',
] as const;

const FEATURE_KEYS = [
  'clearcoat',
  'sheen',
  'transmission',
  'iridescence',
  'anisotropy',
  'dispersion',
] as const;

const SCALAR_KEYS = [
  'roughness',
  'metalness',
  'opacity',
  'emissiveIntensity',
  'envMapIntensity',
  'aoMapIntensity',
  'bumpScale',
  'displacementScale',
  'displacementBias',
  'lightMapIntensity',
  'ior',
  'specularIntensity',
  'thickness',
  'attenuationDistance',
  'clearcoatRoughness',
  'iridescenceIOR',
  'sheenRoughness',
  'anisotropyRotation',
] as const;

type MapKey = typeof MAP_KEYS[number];
type FeatureKey = typeof FEATURE_KEYS[number];
type ScalarKey = typeof SCALAR_KEYS[number];

/**
 * Copies surface properties from the cached source onto an owned material.
 * Returns true when a shader define changed (map presence, feature on/off,
 * side, alpha test, alpha hash). Uniform-only changes, such as colour and
 * factors, are written without `needsUpdate`, so three.js does not rebuild
 * the program. Vertex colours, flat shading and a flipped normal-scale Y are
 * left alone: `assignFinalMaterial` sets those per mesh.
 */
export function syncOwnedMaterial(
    owned: MeshPhysicalMaterial, source: MeshPhysicalMaterial): boolean {
  let definesChanged = false;

  if (owned.name !== source.name) {
    owned.name = source.name;
  }

  syncColor(owned.color, source.color);
  syncColor(owned.emissive, source.emissive);
  syncColor(owned.sheenColor, source.sheenColor);
  syncColor(owned.specularColor, source.specularColor);
  syncColor(owned.attenuationColor, source.attenuationColor);

  for (const key of SCALAR_KEYS) {
    syncScalar(owned, source, key);
  }
  for (const key of FEATURE_KEYS) {
    if (syncFeature(owned, source, key)) {
      definesChanged = true;
    }
  }
  for (const key of MAP_KEYS) {
    if (syncMap(owned, source, key)) {
      definesChanged = true;
    }
  }

  syncNormalScale(owned.normalScale, source.normalScale);
  syncNormalScale(owned.clearcoatNormalScale, source.clearcoatNormalScale);

  const range = source.iridescenceThicknessRange;
  const ownedRange = owned.iridescenceThicknessRange;
  if (ownedRange[0] !== range[0] || ownedRange[1] !== range[1]) {
    owned.iridescenceThicknessRange = [range[0], range[1]];
  }

  if (owned.side !== source.side) {
    owned.side = source.side;
    definesChanged = true;
  }

  const alphaWasOn = owned.alphaTest > 0;
  if (owned.alphaTest !== source.alphaTest) {
    owned.alphaTest = source.alphaTest;
  }
  if (alphaWasOn !== owned.alphaTest > 0) {
    definesChanged = true;
  }

  if (owned.alphaHash !== source.alphaHash) {
    owned.alphaHash = source.alphaHash;
    definesChanged = true;
  }
  if (owned.transparent !== source.transparent) {
    owned.transparent = source.transparent;
  }
  if (owned.depthWrite !== source.depthWrite) {
    owned.depthWrite = source.depthWrite;
  }
  if (owned.depthTest !== source.depthTest) {
    owned.depthTest = source.depthTest;
  }
  if (owned.opacity !== source.opacity) {
    owned.opacity = source.opacity;
  }

  if (definesChanged) {
    owned.needsUpdate = true;
  }
  return definesChanged;
}

function syncColor(owned: Color, source: Color) {
  if (!owned.equals(source)) {
    owned.copy(source);
  }
}

function numbers(material: MeshPhysicalMaterial): Record<string, number> {
  return material as unknown as Record<string, number>;
}

function syncScalar(
    owned: MeshPhysicalMaterial, source: MeshPhysicalMaterial, key: ScalarKey) {
  if (numbers(owned)[key] !== numbers(source)[key]) {
    numbers(owned)[key] = numbers(source)[key];
  }
}

function syncFeature(
    owned: MeshPhysicalMaterial, source: MeshPhysicalMaterial, key: FeatureKey):
    boolean {
  const before = numbers(owned)[key] > 0;
  if (numbers(owned)[key] !== numbers(source)[key]) {
    numbers(owned)[key] = numbers(source)[key];
  }
  return before !== (numbers(owned)[key] > 0);
}

function syncMap(
    owned: MeshPhysicalMaterial, source: MeshPhysicalMaterial, key: MapKey):
    boolean {
  const ownedMaps = owned as unknown as Record<string, Texture|null>;
  const sourceMaps = source as unknown as Record<string, Texture|null>;
  const before = ownedMaps[key] != null;
  const next = sourceMaps[key];
  if (ownedMaps[key] !== next) {
    ownedMaps[key] = next;
  }
  return before !== (next != null);
}

function syncNormalScale(owned: Vector2, source: Vector2) {
  const flipped = (owned.y < 0) !== (source.y < 0);
  const y = flipped ? -source.y : source.y;
  if (owned.x !== source.x || owned.y !== y) {
    owned.set(source.x, y);
  }
}

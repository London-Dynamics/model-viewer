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

import {Mesh} from 'three';

import {PrimitiveNode} from '../scene-graph/nodes/primitive-node.js';

export interface GltfMeshName {
  name?: string;
}

export interface ResolvedSwapTargets {
  /** glTF mesh names, de-duplicated, targets first then pattern matches. */
  meshes: string[];
  /** Exact targets and patterns that matched no glTF mesh name. */
  missing: string[];
}

/**
 * Expands one Puzzle target pattern against glTF mesh names.
 *
 * A pattern ending in `*` is a case-sensitive prefix match on
 * `meshes[].name` (the character before `*` is the prefix; `*` matches every
 * name). Any other string is an exact mesh name. This is the prefix-pattern
 * rule Puzzle's resolveTargetPatterns applies; the star is not a general glob.
 */
export function expandPrefixPattern(
    pattern: string, meshNames: readonly string[]): string[] {
  if (!pattern.endsWith('*')) {
    return meshNames.indexOf(pattern) === -1 ? [] : [pattern];
  }
  const prefix = pattern.slice(0, -1);
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const name of meshNames) {
    if (name.startsWith(prefix) && !seen.has(name)) {
      seen.add(name);
      matched.push(name);
    }
  }
  return matched;
}

/**
 * Resolves exact `targets` and `targetPatterns` the way Puzzle does: against
 * glTF mesh names, not three.js object names. Duplicate mesh names collapse
 * to one entry here; every primitive of every mesh with that name is swapped
 * later.
 */
export function resolveMaterialSwapTargets(
    meshNames: readonly string[],
    targets: readonly string[] = [],
    targetPatterns: readonly string[] = []): ResolvedSwapTargets {
  const unique: string[] = [];
  const known = new Set<string>();
  for (const name of meshNames) {
    if (!known.has(name)) {
      known.add(name);
      unique.push(name);
    }
  }

  const meshes: string[] = [];
  const matched = new Set<string>();
  const missing: string[] = [];
  const missingSeen = new Set<string>();

  const addMesh = (name: string) => {
    if (!matched.has(name)) {
      matched.add(name);
      meshes.push(name);
    }
  };
  const addMissing = (name: string) => {
    if (!missingSeen.has(name)) {
      missingSeen.add(name);
      missing.push(name);
    }
  };

  for (const target of targets) {
    if (known.has(target)) {
      addMesh(target);
    } else {
      addMissing(target);
    }
  }

  for (const pattern of targetPatterns) {
    const names = expandPrefixPattern(pattern, unique);
    if (names.length === 0) {
      addMissing(pattern);
      continue;
    }
    for (const name of names) {
      addMesh(name);
    }
  }

  return {meshes, missing};
}

/**
 * Groups scene-graph primitives by the glTF mesh name stored in
 * GLTFLoader's associations. Multi-primitive meshes become several three.js
 * meshes (often renamed with `_1`, `_2`); they share `associations.meshes`
 * and therefore one glTF name.
 */
export function groupPrimitivesByGltfMeshName(
    primitives: readonly PrimitiveNode[],
    gltfMeshes: readonly GltfMeshName[]|
    undefined): Map<string, PrimitiveNode[]> {
  const groups = new Map<string, PrimitiveNode[]>();
  const defs = gltfMeshes ?? [];
  for (const primitive of primitives) {
    const mesh = primitive.mesh;
    const index = gltfMeshAssociation(mesh);
    if (index == null || defs[index] == null) {
      continue;
    }
    const name = defs[index].name ?? '';
    const list = groups.get(name);
    if (list == null) {
      groups.set(name, [primitive]);
    } else {
      list.push(primitive);
    }
  }
  return groups;
}

export function gltfMeshAssociation(mesh: Mesh): number|null {
  const associations =
      mesh.userData?.associations as {meshes?: unknown} | undefined;
  const index = associations?.meshes;
  return typeof index === 'number' ? index : null;
}

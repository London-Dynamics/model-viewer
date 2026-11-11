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

import {MeshPhysicalMaterial} from 'three';

import {IS_MOBILE} from '../constants.js';
import ModelViewerElementBase, {$needsRender, $onModelLoad, $renderer} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {CachedMaterialFile, DEFAULT_MATERIAL_SWAP_CACHE_SIZE, MaterialFileLoad, MaterialSwapCache, materialSwapCacheKey, MaterialSwapQuality} from './ld-material-swap/material-cache.js';
import {ensurePhysicalMaterial} from './ld-material-swap/physical-material.js';
import {syncOwnedMaterial} from './ld-material-swap/sync-material.js';
import {GltfMeshName, groupPrimitivesByGltfMeshName, resolveMaterialSwapTargets} from './ld-material-swap/targets.js';
import {Material as SceneMaterial} from './scene-graph/material.js';
import {$primitivesList, Model} from './scene-graph/model.js';
import {PrimitiveNode} from './scene-graph/nodes/primitive-node.js';
import {$correlatedObjects} from './scene-graph/three-dom-element.js';

export const MATERIAL_SWAP_EVENT = 'material-swap';
export const MATERIAL_SWAP_ERROR_EVENT = 'material-swap-error';

export interface MaterialSwapRequest {
  /**
   * Absolute or root-relative URL of a material GLB. Puzzle uses the first
   * material.
   */
  url: string;
  /** Exact glTF mesh names (`meshes[].name`). */
  targets?: readonly string[];
  /**
   * Puzzle prefix patterns. A trailing `*` matches glTF mesh names that start
   * with the prefix. `*` matches every mesh name.
   */
  targetPatterns?: readonly string[];
  /**
   * Owned-material identity. Defaults to `url`, which is one instance per
   * file, shared by every mesh that swaps to that file. Repeated swaps reuse
   * it instead of cloning again.
   */
  key?: string;
}

export interface MaterialSwapOptions {
  signal?: AbortSignal;
  /**
   * `mobile` tries `<file>@mobile.glb` and falls back to `url`. `desktop`
   * loads `url` only. The default follows model-viewer's `IS_MOBILE`
   * user-agent check. Agora should pass the same quality it would send to
   * Puzzle when that differs (tablets, forced quality).
   */
  quality?: MaterialSwapQuality;
}

export interface MaterialSwapApplied {
  key: string;
  url: string;
  resolvedUrl: string;
  materialName: string;
  meshes: string[];
}

export interface MaterialSwapResult {
  applied: MaterialSwapApplied[];
  missingTargets: string[];
  warnings: string[];
  quality: MaterialSwapQuality;
}

export type MaterialSwapErrorReason = 'load'|'no-model'|'invalid'|'aborted';

export interface MaterialSwapErrorDetail {
  reason: MaterialSwapErrorReason;
  message: string;
  url?: string;
  key?: string;
}

export class MaterialSwapError extends Error {
  readonly detail: MaterialSwapErrorDetail;

  constructor(detail: MaterialSwapErrorDetail) {
    super(detail.message);
    this.name = 'MaterialSwapError';
    this.detail = detail;
  }
}

export interface LDMaterialSwapInterface {
  applyMaterialSwaps(
      swaps: readonly MaterialSwapRequest[],
      options?: MaterialSwapOptions): Promise<MaterialSwapResult>;
}

export interface LDMaterialSwapStatic {
  materialSwapCacheSize: number;
  clearMaterialSwapCache(): void;
}

interface OwnedSwap {
  cacheKey: string;
  logicalUrl: string;
  sceneMaterial: SceneMaterial;
  source: MeshPhysicalMaterial;
}

interface Winner {
  request: MaterialSwapRequest;
  meshes: string[];
  instanceKey: string;
}

interface SwapModelHost {
  model?: Model;
  originalGltfJson: {meshes?: GltfMeshName[]}|null;
  withCredentials?: boolean;
  getPathTracerComposer?: () => {
    markSceneDirty?: () => void
  } | null;
}

const $swapGeneration = Symbol('swapGeneration');
const $swapChain = Symbol('swapChain');
const $heldSwapKeys = Symbol('heldSwapKeys');
const $ownedSwaps = Symbol('ownedSwaps');

let sharedCache: MaterialSwapCache|null = null;
let sharedThreshold = DEFAULT_MATERIAL_SWAP_CACHE_SIZE;

export function getMaterialSwapCache(): MaterialSwapCache {
  if (sharedCache == null) {
    sharedCache = new MaterialSwapCache(sharedThreshold);
  }
  return sharedCache;
}

export function clearMaterialSwapCache() {
  if (sharedCache != null) {
    sharedCache.clear();
  }
  sharedCache = null;
}

function setMaterialSwapCacheThreshold(value: number) {
  sharedThreshold = value;
  if (sharedCache != null) {
    sharedCache.evictionThreshold = value;
  }
}

/**
 * Applies Puzzle material swaps on the loaded model without a server rebuild
 * or a `src` change. Pass the full ordered swap list for the selection each
 * time; later entries win when they name the same glTF mesh. There is no
 * revert: a mesh left out of the list keeps whatever material it has.
 */
export const LDMaterialSwapMixin = <
    T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement:
        T): Constructor<LDMaterialSwapInterface>&T&LDMaterialSwapStatic => {
  class MaterialSwapModelViewerElement extends ModelViewerElement {
    static get materialSwapCacheSize(): number {
      return sharedThreshold;
    }

    static set materialSwapCacheSize(value: number) {
      setMaterialSwapCacheThreshold(value);
    }

    static clearMaterialSwapCache() {
      clearMaterialSwapCache();
    }

    private[$swapGeneration] = 0;
    private[$swapChain]: Promise<unknown> = Promise.resolve();
    private[$heldSwapKeys] = new Set<string>();
    private[$ownedSwaps] = new Map<string, OwnedSwap>();

    [$onModelLoad]() {
      super[$onModelLoad]();
      this[$swapGeneration]++;
      this.disposeOwnedSwaps();
      this.releaseSwapHolds();
    }

    async applyMaterialSwaps(
        swaps: readonly MaterialSwapRequest[],
        options?: MaterialSwapOptions): Promise<MaterialSwapResult> {
      const run = this[$swapChain].then(
          () => this.applyMaterialSwapsNow(swaps, options));
      this[$swapChain] = run.then(() => undefined, () => undefined);
      return run;
    }

    private async applyMaterialSwapsNow(
        swaps: readonly MaterialSwapRequest[],
        options?: MaterialSwapOptions): Promise<MaterialSwapResult> {
      const quality = options?.quality ?? (IS_MOBILE ? 'mobile' : 'desktop');
      const loaded: CachedMaterialFile[] = [];
      try {
        const invalid = validateRequests(swaps);
        if (invalid != null) {
          this.failSwap({reason: 'invalid', message: invalid});
        }
        if (options?.signal?.aborted) {
          this.failSwap({reason: 'aborted', message: 'Material swap aborted'});
        }

        const host = this as unknown as SwapModelHost;
        const model = host.model;
        if (model == null) {
          this.failSwap({
            reason: 'no-model',
            message: 'Cannot apply a material swap before the model has loaded',
          });
        }
        const generation = this[$swapGeneration];
        const gltfMeshes = host.originalGltfJson?.meshes;
        const groups =
            groupPrimitivesByGltfMeshName(model[$primitivesList], gltfMeshes);
        const meshNames = (gltfMeshes ?? []).map((mesh) => mesh.name ?? '');
        const missingTargets: string[] = [];
        const missingSeen = new Set<string>();
        const resolutions = swaps.map((request) => {
          const resolved = resolveMaterialSwapTargets(
              meshNames, request.targets ?? [], request.targetPatterns ?? []);
          for (const name of resolved.missing) {
            if (!missingSeen.has(name)) {
              missingSeen.add(name);
              missingTargets.push(name);
              console.warn(
                  `[model-viewer] material swap has no glTF mesh for "${
                      name}".`);
            }
          }
          return resolved;
        });

        const owner = new Map<string, number>();
        for (let i = 0; i < resolutions.length; i++) {
          for (const name of resolutions[i].meshes) {
            owner.set(name, i);
          }
        }
        const winners: Winner[] = [];
        const meshesByRequest: string[][] = swaps.map(() => []);
        for (const [name, index] of owner) {
          meshesByRequest[index].push(name);
        }
        for (let i = 0; i < swaps.length; i++) {
          if (meshesByRequest[i].length === 0) {
            continue;
          }
          winners.push({
            request: swaps[i],
            meshes: meshesByRequest[i],
            instanceKey: instanceKeyFor(swaps[i]),
          });
        }

        const cache = getMaterialSwapCache();
        const load = this.materialFileLoader();
        const byCacheKey = new Map<string, CachedMaterialFile>();
        for (const winner of winners) {
          if (this.swapStale(generation, model)) {
            this.abandonLoaded(loaded);
            return this.finishSwap(this.changedResult(quality, missingTargets));
          }
          const key = materialSwapCacheKey(winner.request.url, quality);
          let cached = byCacheKey.get(key);
          if (cached == null) {
            cached = await cache.acquire(
                winner.request.url, quality, load, options?.signal);
            loaded.push(cached);
            byCacheKey.set(key, cached);
          }
        }

        if (this.swapStale(generation, model)) {
          this.abandonLoaded(loaded);
          return this.finishSwap(this.changedResult(quality, missingTargets));
        }

        const warnings: string[] = [];
        const applied: MaterialSwapApplied[] = [];
        for (const winner of winners) {
          const key = materialSwapCacheKey(winner.request.url, quality);
          const cached = byCacheKey.get(key)!;
          for (const warning of cached.warnings) {
            if (warnings.indexOf(warning) === -1) {
              warnings.push(warning);
            }
          }
          const owned = this.ownedSwapFor(model, winner.instanceKey, cached);
          this.holdSwap(cached.cacheKey);
          const index = owned.sceneMaterial.index;
          const primitives = primitivesFor(groups, winner.meshes);
          for (const primitive of primitives) {
            primitive.materials.set(index, owned.sceneMaterial);
            await primitive.setActiveMaterial(index);
            if (this.swapStale(generation, model)) {
              this.abandonLoaded(loaded);
              return this.finishSwap(
                  this.changedResult(quality, missingTargets));
            }
          }
          applied.push({
            key: winner.instanceKey,
            url: winner.request.url,
            resolvedUrl: cached.resolvedUrl,
            materialName: owned.sceneMaterial.name,
            meshes: winner.meshes.slice(),
          });
        }

        return this.finishSwap({applied, missingTargets, warnings, quality});
      } catch (error) {
        this.abandonLoaded(loaded);
        if (error instanceof MaterialSwapError) {
          throw error;
        }
        if ((error as Error)?.name === 'AbortError') {
          this.failSwap({reason: 'aborted', message: 'Material swap aborted'});
        }
        this.failSwap({
          reason: 'load',
          message: errorMessage(error),
        });
      }
    }

    private materialFileLoader(): (url: string) => Promise<MaterialFileLoad> {
      const credentials =
          (this as unknown as SwapModelHost).withCredentials === true;
      const loader = this[$renderer].loader;
      return async (url: string) => {
        const loaded = await loader.loadMaterial(url, credentials);
        return {
          material: ensurePhysicalMaterial(loaded.material),
          warnings: loaded.warnings,
        };
      };
    }

    private ownedSwapFor(
        model: Model, instanceKey: string,
        cached: CachedMaterialFile): OwnedSwap {
      const source = cached.material;
      const name = source.name || '';
      let owned = this[$ownedSwaps].get(instanceKey);
      if (owned == null) {
        const clone = source.clone();
        clone.name = name;
        const sceneMaterial = model.registerExternalMaterial(name, clone);
        owned = {
          cacheKey: cached.cacheKey,
          logicalUrl: cached.logicalUrl,
          sceneMaterial,
          source,
        };
        this[$ownedSwaps].set(instanceKey, owned);
        return owned;
      }

      owned.cacheKey = cached.cacheKey;
      owned.logicalUrl = cached.logicalUrl;
      owned.source = source;
      if (owned.sceneMaterial.name !== name) {
        owned.sceneMaterial.name = name;
      }
      const materials =
          owned.sceneMaterial[$correlatedObjects] as Set<MeshPhysicalMaterial>;
      for (const material of materials) {
        syncOwnedMaterial(material, source);
      }
      return owned;
    }

    private holdSwap(cacheKey: string) {
      if (this[$heldSwapKeys].has(cacheKey)) {
        return;
      }
      getMaterialSwapCache().retain(cacheKey);
      this[$heldSwapKeys].add(cacheKey);
    }

    private releaseSwapHolds() {
      if (sharedCache == null) {
        this[$heldSwapKeys].clear();
        return;
      }
      for (const key of this[$heldSwapKeys]) {
        sharedCache.release(key);
      }
      this[$heldSwapKeys].clear();
    }

    private disposeOwnedSwaps() {
      for (const owned of this[$ownedSwaps].values()) {
        const materials = owned.sceneMaterial[$correlatedObjects] as
            Set<MeshPhysicalMaterial>;
        for (const material of materials) {
          material.dispose();
        }
      }
      this[$ownedSwaps].clear();
    }

    private abandonLoaded(loaded: readonly CachedMaterialFile[]) {
      if (sharedCache == null) {
        return;
      }
      for (const cached of loaded) {
        if (!this[$heldSwapKeys].has(cached.cacheKey)) {
          sharedCache.touch(cached.cacheKey);
        }
      }
    }

    private swapStale(generation: number, model: Model): boolean {
      const host = this as unknown as SwapModelHost;
      return this[$swapGeneration] !== generation || host.model !== model;
    }

    private changedResult(
        quality: MaterialSwapQuality,
        missingTargets: string[]): MaterialSwapResult {
      return {
        applied: [],
        missingTargets,
        warnings: [
          'The model changed before the material swap was applied.',
        ],
        quality,
      };
    }

    private finishSwap(result: MaterialSwapResult): MaterialSwapResult {
      if (result.applied.length > 0) {
        const tracer =
            (this as unknown as SwapModelHost).getPathTracerComposer?.() ??
            null;
        tracer?.markSceneDirty?.();
        this[$needsRender]();
      }
      this.dispatchEvent(new CustomEvent(MATERIAL_SWAP_EVENT, {
        detail: result,
        bubbles: true,
        composed: true,
      }));
      return result;
    }

    private failSwap(detail: MaterialSwapErrorDetail): never {
      this.dispatchEvent(new CustomEvent(MATERIAL_SWAP_ERROR_EVENT, {
        detail,
        bubbles: true,
        composed: true,
      }));
      throw new MaterialSwapError(detail);
    }
  }

  return MaterialSwapModelViewerElement;
};

function validateRequests(swaps: readonly MaterialSwapRequest[]): string|null {
  if (!Array.isArray(swaps)) {
    return 'applyMaterialSwaps expects an array of swaps';
  }
  for (let i = 0; i < swaps.length; i++) {
    const request = swaps[i];
    if (request == null || typeof request !== 'object') {
      return `Material swap ${i} is not an object`;
    }
    if (typeof request.url !== 'string' || request.url.trim() === '') {
      return `Material swap ${i} is missing a url`;
    }
    if (request.targets != null && !isStringList(request.targets)) {
      return `Material swap ${i} targets must be an array of strings`;
    }
    if (request.targetPatterns != null &&
        !isStringList(request.targetPatterns)) {
      return `Material swap ${i} targetPatterns must be an array of strings`;
    }
    if (request.key != null && typeof request.key !== 'string') {
      return `Material swap ${i} key must be a string`;
    }
  }
  return null;
}

function isStringList(value: readonly string[]): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return false;
    }
  }
  return true;
}

function instanceKeyFor(request: MaterialSwapRequest): string {
  if (request.key != null && request.key !== '') {
    return request.key;
  }
  return request.url;
}

function primitivesFor(
    groups: ReadonlyMap<string, PrimitiveNode[]>,
    names: readonly string[]): PrimitiveNode[] {
  const primitives: PrimitiveNode[] = [];
  for (const name of names) {
    const group = groups.get(name);
    if (group == null) {
      continue;
    }
    for (const primitive of group) {
      primitives.push(primitive);
    }
  }
  return primitives;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) {
    return reason.message;
  }
  return String(reason);
}

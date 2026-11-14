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

import {Material, MeshPhysicalMaterial, Texture} from 'three';

import {CacheEvictionPolicy} from '../../utilities/cache-eviction-policy.js';

import {qualityFileUrl} from './quality-url.js';

export type MaterialSwapQuality = 'mobile'|'desktop';

export interface MaterialFileLoad {
  material: MeshPhysicalMaterial;
  warnings?: string[];
}

export interface CachedMaterialFile {
  cacheKey: string;
  logicalUrl: string;
  resolvedUrl: string;
  quality: MaterialSwapQuality;
  material: MeshPhysicalMaterial;
  warnings: string[];
}

export type MaterialFileLoader = (url: string) => Promise<MaterialFileLoad>;

const TEXTURE_KEYS = [
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
  'specularMap',
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

/**
 * Default number of unused material files to keep decoded. Files a viewer
 * still holds are never evicted and do not consume this budget. This is
 * independent of modelCacheSize and of the environment-model cache.
 */
export const DEFAULT_MATERIAL_SWAP_CACHE_SIZE = 8;

export function materialSwapCacheKey(
    logicalUrl: string, quality: MaterialSwapQuality): string {
  return quality + '\n' + logicalUrl;
}

export function disposeMaterialTextures(material: Material) {
  const seen = new Set<Texture>();
  const record = material as unknown as Record<string, unknown>;
  for (const key of TEXTURE_KEYS) {
    const value = record[key];
    if (value != null && (value as Texture).isTexture === true &&
        !seen.has(value as Texture)) {
      seen.add(value as Texture);
      (value as Texture).dispose();
    }
  }
}

export function disposeCachedMaterial(material: Material) {
  disposeMaterialTextures(material);
  material.dispose();
}

/**
 * Decoded material GLBs. Separate from the product `src` cache and the
 * environment-model cache. On mobile, the `@mobile` file is tried first and
 * a miss falls back to the URL Agora passed; the winner is cached so the
 * miss is not fetched again. Eviction disposes the source material and its
 * textures. Owned clones share those textures, so callers retain a file for
 * as long as a clone is alive.
 */
export class MaterialSwapCache {
  private entries = new Map<string, Promise<CachedMaterialFile>>();
  private policy: CacheEvictionPolicy<string>;

  constructor(evictionThreshold: number = DEFAULT_MATERIAL_SWAP_CACHE_SIZE) {
    this.policy = new CacheEvictionPolicy<string>(
        {
          delete: (key: string) => {
            const pending = this.entries.get(key);
            this.entries.delete(key);
            if (pending == null) {
              return;
            }
            pending
                .then((cached) => {
                  disposeCachedMaterial(cached.material);
                })
                .catch(
                    () => {
                        // A rejected load has nothing to dispose.
                    });
          },
        },
        evictionThreshold,
        {unusedOnly: true});
  }

  get size(): number {
    return this.entries.size;
  }

  get evictionThreshold(): number {
    return this.policy.evictionThreshold;
  }

  set evictionThreshold(value: number) {
    this.policy.evictionThreshold = value;
  }

  retainerCount(logicalUrl: string, quality: MaterialSwapQuality): number {
    return this.policy.retainerCount(materialSwapCacheKey(logicalUrl, quality));
  }

  has(logicalUrl: string, quality: MaterialSwapQuality): boolean {
    return this.entries.has(materialSwapCacheKey(logicalUrl, quality));
  }

  retain(cacheKey: string) {
    this.policy.retain(cacheKey);
  }

  release(cacheKey: string) {
    this.policy.release(cacheKey);
  }

  /**
   * Puts a loaded file on the unused LRU. Used when a load finished but the
   * model went away before the file was held.
   */
  touch(cacheKey: string) {
    this.policy.retain(cacheKey);
    this.policy.release(cacheKey);
  }

  async acquire(
      logicalUrl: string, quality: MaterialSwapQuality,
      load: MaterialFileLoader,
      signal?: AbortSignal): Promise<CachedMaterialFile> {
    if (signal?.aborted) {
      throw abortedError();
    }
    const cacheKey = materialSwapCacheKey(logicalUrl, quality);
    let pending = this.entries.get(cacheKey);
    if (pending == null) {
      pending = this.loadInto(cacheKey, logicalUrl, quality, load);
      this.entries.set(cacheKey, pending);
      const stored = pending;
      stored.catch(() => {
        if (this.entries.get(cacheKey) === stored) {
          this.entries.delete(cacheKey);
        }
      });
    }
    const cached = await pending;
    if (signal?.aborted) {
      throw abortedError();
    }
    return cached;
  }

  clear() {
    const keys = [...this.entries.keys()];
    this.policy.reset();
    for (const key of keys) {
      const pending = this.entries.get(key);
      this.entries.delete(key);
      if (pending == null) {
        continue;
      }
      pending
          .then((cached) => {
            disposeCachedMaterial(cached.material);
          })
          .catch(() => {});
    }
  }

  private async loadInto(
      cacheKey: string, logicalUrl: string, quality: MaterialSwapQuality,
      load: MaterialFileLoader): Promise<CachedMaterialFile> {
    if (quality === 'mobile') {
      const mobileUrl = qualityFileUrl(logicalUrl, 'mobile');
      try {
        const loaded = await load(mobileUrl);
        return this.toCached(cacheKey, logicalUrl, mobileUrl, quality, loaded);
      } catch (mobileError) {
        try {
          const loaded = await load(logicalUrl);
          return this.toCached(
              cacheKey, logicalUrl, logicalUrl, quality, loaded);
        } catch (baseError) {
          throw new Error(
              `Material file failed for ${logicalUrl}: ` +
              `${qualityFileUrl(logicalUrl, 'mobile')} ` +
              `(${errorMessage(mobileError)}); ${logicalUrl} ` +
              `(${errorMessage(baseError)})`);
        }
      }
    }
    const loaded = await load(logicalUrl);
    return this.toCached(cacheKey, logicalUrl, logicalUrl, quality, loaded);
  }

  private toCached(
      cacheKey: string, logicalUrl: string, resolvedUrl: string,
      quality: MaterialSwapQuality,
      loaded: MaterialFileLoad): CachedMaterialFile {
    return {
      cacheKey,
      logicalUrl,
      resolvedUrl,
      quality,
      material: loaded.material,
      warnings: loaded.warnings ?? [],
    };
  }
}

function abortedError(): Error {
  const error = new Error('Material swap aborted');
  error.name = 'AbortError';
  return error;
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return String(reason);
}

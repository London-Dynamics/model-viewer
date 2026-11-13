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

import {acceptCacheFingerprint, CacheAcceptDecision, DecodedPathTracerCache, decodePathTracerCache, encodePathTracerCache, PathTracerCacheEntryMeta, PathTracerCacheFingerprint, PathTracerCachePayload} from './path-tracer-cache-format.js';
import {cacheTypesClearedBy, defaultPathTracerCacheFlags, PATH_TRACER_CACHE_TYPES, PathTracerCacheFlags, PathTracerCacheInvalidation, PathTracerCacheLoadRequest, PathTracerCacheType, typesToApply} from './path-tracer-cache-types.js';

export interface StoredPathTracerCacheEntry {
  bytes: Uint8Array;
  meta: PathTracerCacheEntryMeta;
}

export interface PathTracerCacheLoadResult {
  accepted: boolean;
  reason: CacheAcceptDecision['reason']|string;
  matched: boolean;
  applied: PathTracerCacheType[];
  skipped: PathTracerCacheType[];
}

export interface PathTracerCacheTimings {
  bvhBuildMs: number|null;
  bvhRestored: number;
  bvhBuilt: number;
  firstSampleMs: number|null;
  convergedMs: number|null;
}

export const emptyPathTracerCacheTimings = (): PathTracerCacheTimings => ({
  bvhBuildMs: null,
  bvhRestored: 0,
  bvhBuilt: 0,
  firstSampleMs: null,
  convergedMs: null,
});

/**
 * In-memory cache file. GPU upload and BVH restore sit on top of the bytes
 * stored here. Fingerprint verification is off unless the caller asks.
 */
export class PathTracerCacheStore {
  flags: PathTracerCacheFlags = defaultPathTracerCacheFlags();
  fingerprint: PathTracerCacheFingerprint = {
    glb: '',
    environment: '',
    settings: '',
  };
  timings: PathTracerCacheTimings = emptyPathTracerCacheTimings();
  lastLoad: PathTracerCacheLoadResult|null = null;
  private readonly entries =
      new Map<PathTracerCacheType, StoredPathTracerCacheEntry>();

  setFlags(partial: Partial<PathTracerCacheFlags>&{
    enabled?: Partial<PathTracerCacheFlags['enabled']>;
    load?: Partial<PathTracerCacheFlags['load']>;
  }): void {
    if (partial.enabled != null) {
      this.flags.enabled = {...this.flags.enabled, ...partial.enabled};
    }
    if (partial.load != null) {
      this.flags.load = {...this.flags.load, ...partial.load};
    }
    if (partial.verifyFingerprint != null) {
      this.flags.verifyFingerprint = partial.verifyFingerprint;
    }
  }

  has(type: PathTracerCacheType): boolean {
    return this.entries.has(type);
  }

  get(type: PathTracerCacheType): StoredPathTracerCacheEntry|null {
    return this.entries.get(type) ?? null;
  }

  set(type: PathTracerCacheType, bytes: Uint8Array,
      meta: PathTracerCacheEntryMeta = {}): void {
    this.entries.set(type, {bytes, meta});
  }

  sizeOf(type: PathTracerCacheType): number {
    return this.entries.get(type)?.bytes.byteLength ?? 0;
  }

  clear(types?: PathTracerCacheType|
        readonly PathTracerCacheType[]): PathTracerCacheType[] {
    const list = types == null ?
        [...PATH_TRACER_CACHE_TYPES] :
        (Array.isArray(types) ? types : [types]) as PathTracerCacheType[];
    const cleared: PathTracerCacheType[] = [];
    for (const type of list) {
      if (this.entries.delete(type)) {
        cleared.push(type);
      } else if (types != null) {
        cleared.push(type);
      }
    }
    return cleared;
  }

  invalidate(reason: PathTracerCacheInvalidation): PathTracerCacheType[] {
    const affected = cacheTypesClearedBy(reason);
    for (const type of affected) {
      this.entries.delete(type);
    }
    return affected;
  }

  exportBlob(
      fingerprint: PathTracerCacheFingerprint = this.fingerprint,
      types?: readonly PathTracerCacheType[],
      ): Blob {
    const wanted = new Set(types ?? PATH_TRACER_CACHE_TYPES);
    const payloads: PathTracerCachePayload[] = [];
    for (const type of PATH_TRACER_CACHE_TYPES) {
      if (!wanted.has(type)) {
        continue;
      }
      const entry = this.entries.get(type);
      if (entry == null) {
        continue;
      }
      payloads.push({type, bytes: entry.bytes, meta: entry.meta});
    }
    const file = encodePathTracerCache(fingerprint, payloads);
    return new Blob([file], {type: 'application/octet-stream'});
  }

  /**
   * Decode a file and keep the types the flags allow. When verification is
   * off, a fingerprint mismatch does not reject the file.
   */
  loadBytes(
      input: ArrayBuffer|Uint8Array,
      live: PathTracerCacheFingerprint,
      request: PathTracerCacheLoadRequest = {},
      ): PathTracerCacheLoadResult {
    const decoded = decodePathTracerCache(input);
    const decision = acceptCacheFingerprint(
        decoded.header.fingerprint, live, this.flags.verifyFingerprint);
    if (!decision.accept) {
      const result: PathTracerCacheLoadResult = {
        accepted: false,
        reason: decision.reason,
        matched: false,
        applied: [],
        skipped: presentTypes(decoded),
      };
      this.lastLoad = result;
      return result;
    }
    const present = presentTypes(decoded);
    const applied = typesToApply(present, this.flags, request);
    const appliedSet = new Set(applied);
    for (const type of applied) {
      const bytes = decoded.payloads[type];
      if (bytes == null) {
        continue;
      }
      const meta =
          decoded.header.entries.find((entry) => entry.type === type)?.meta ??
          {};
      this.entries.set(type, {bytes, meta});
    }
    const result: PathTracerCacheLoadResult = {
      accepted: true,
      reason: decision.reason,
      matched: decision.matched,
      applied,
      skipped: present.filter((type) => !appliedSet.has(type)),
    };
    this.lastLoad = result;
    return result;
  }
}

const presentTypes = (decoded: DecodedPathTracerCache): PathTracerCacheType[] =>
    PATH_TRACER_CACHE_TYPES.filter((type) => decoded.payloads[type] != null);

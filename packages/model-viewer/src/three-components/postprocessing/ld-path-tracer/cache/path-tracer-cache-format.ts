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

import {isPathTracerCacheType, PathTracerCacheType} from './path-tracer-cache-types.js';

export const PATH_TRACER_CACHE_MAGIC = 0x5450444c;
export const PATH_TRACER_CACHE_VERSION = 1;

export interface PathTracerCacheFingerprint {
  /** FNV-1a of the model URL plus geometry positions. */
  glb: string;
  /** Environment image, skybox, intensity, exposure, rotation. */
  environment: string;
  /** Bounces, BVH build options, floor, and light rig. */
  settings: string;
}

export interface PathTracerCacheEntryMeta {
  [key: string]: unknown;
}

export interface PathTracerCacheFileEntry {
  type: PathTracerCacheType;
  byteLength: number;
  meta: PathTracerCacheEntryMeta;
}

export interface PathTracerCacheFileHeader {
  format: number;
  created: string;
  fingerprint: PathTracerCacheFingerprint;
  digest: string;
  entries: PathTracerCacheFileEntry[];
}

export interface PathTracerCachePayload {
  type: PathTracerCacheType;
  bytes: Uint8Array;
  meta?: PathTracerCacheEntryMeta;
}

export interface DecodedPathTracerCache {
  header: PathTracerCacheFileHeader;
  payloads: Partial<Record<PathTracerCacheType, Uint8Array>>;
}

export interface CacheAcceptDecision {
  accept: boolean;
  /** True when the live fingerprint equals the header. */
  matched: boolean;
  reason: 'matched'|'verification-skipped'|'fingerprint-mismatch';
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const fnv1aHex = (input: string|Uint8Array): string => {
  const bytes = typeof input === 'string' ? textEncoder.encode(input) : input;
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const fingerprintDigest =
    (fingerprint: PathTracerCacheFingerprint): string => fnv1aHex(`${
        fingerprint.glb}\n${fingerprint.environment}\n${fingerprint.settings}`);

export const fingerprintsMatch = (
    file: PathTracerCacheFingerprint,
    live: PathTracerCacheFingerprint,
    ): boolean => file.glb === live.glb &&
    file.environment === live.environment && file.settings === live.settings;

/**
 * The header always carries the fingerprint. The comparison runs only when
 * `verify` is true. With it off, a mismatched file is still used.
 */
export const acceptCacheFingerprint = (
    file: PathTracerCacheFingerprint,
    live: PathTracerCacheFingerprint,
    verify: boolean,
    ): CacheAcceptDecision => {
  const matched = fingerprintsMatch(file, live);
  if (!verify) {
    return {
      accept: true,
      matched,
      reason: matched ? 'matched' : 'verification-skipped',
    };
  }
  if (!matched) {
    return {accept: false, matched: false, reason: 'fingerprint-mismatch'};
  }
  return {accept: true, matched: true, reason: 'matched'};
};

const pad4 = (length: number): number => (4 - (length % 4)) % 4;

export const encodePathTracerCache = (
    fingerprint: PathTracerCacheFingerprint,
    payloads: readonly PathTracerCachePayload[],
    created = new Date().toISOString(),
    ): Uint8Array => {
  const bodies = payloads.map((payload) => ({
                                type: payload.type,
                                bytes: payload.bytes,
                                meta: payload.meta ?? {},
                              }));
  const header: PathTracerCacheFileHeader = {
    format: PATH_TRACER_CACHE_VERSION,
    created,
    fingerprint,
    digest: fingerprintDigest(fingerprint),
    entries: bodies.map((body) => ({
                          type: body.type,
                          byteLength: body.bytes.byteLength,
                          meta: body.meta,
                        })),
  };
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  let total = 12 + headerBytes.byteLength;
  for (const body of bodies) {
    total += pad4(total) + body.bytes.byteLength;
  }
  const file = new Uint8Array(total);
  const view = new DataView(file.buffer);
  view.setUint32(0, PATH_TRACER_CACHE_MAGIC, true);
  view.setUint32(4, PATH_TRACER_CACHE_VERSION, true);
  view.setUint32(8, headerBytes.byteLength, true);
  file.set(headerBytes, 12);
  let cursor = 12 + headerBytes.byteLength;
  for (const body of bodies) {
    cursor += pad4(cursor);
    file.set(body.bytes, cursor);
    cursor += body.bytes.byteLength;
  }
  return file;
};

export const decodePathTracerCache = (input: ArrayBuffer|
                                      Uint8Array): DecodedPathTracerCache => {
  const bytes = input instanceof Uint8Array ?
      (input.byteOffset === 0 && input.byteLength === input.buffer.byteLength ?
           input :
           input.slice()) :
      new Uint8Array(input);
  if (bytes.byteLength < 12) {
    throw new Error('Path tracer cache file is too small.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== PATH_TRACER_CACHE_MAGIC) {
    throw new Error('Path tracer cache file has a bad header.');
  }
  const version = view.getUint32(4, true);
  if (version !== PATH_TRACER_CACHE_VERSION) {
    throw new Error(`Path tracer cache version ${version} is not supported.`);
  }
  const headerLength = view.getUint32(8, true);
  if (headerLength < 2 || 12 + headerLength > bytes.byteLength) {
    throw new Error('Path tracer cache header is truncated.');
  }
  const header =
      JSON.parse(textDecoder.decode(bytes.subarray(12, 12 + headerLength))) as
      PathTracerCacheFileHeader;
  if (header == null || !Array.isArray(header.entries) ||
      header.fingerprint == null) {
    throw new Error('Path tracer cache header is incomplete.');
  }
  const payloads: Partial<Record<PathTracerCacheType, Uint8Array>> = {};
  let cursor = 12 + headerLength;
  for (const entry of header.entries) {
    if (entry.byteLength < 0) {
      throw new Error(
          `Path tracer cache entry "${String(entry.type)}" is invalid.`);
    }
    cursor += pad4(cursor);
    const end = cursor + entry.byteLength;
    if (end > bytes.byteLength) {
      throw new Error(
          `Path tracer cache entry "${String(entry.type)}" is truncated.`);
    }
    if (isPathTracerCacheType(entry.type)) {
      payloads[entry.type] = bytes.slice(cursor, end);
    }
    cursor = end;
  }
  return {header, payloads};
};

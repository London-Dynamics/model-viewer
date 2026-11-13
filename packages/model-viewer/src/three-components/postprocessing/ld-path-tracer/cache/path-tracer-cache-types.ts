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

export const PATH_TRACER_CACHE_TYPES = [
  'bvh',
  'irradiance',
  'materials',
] as const;

export type PathTracerCacheType = (typeof PATH_TRACER_CACHE_TYPES)[number];

/**
 * What a scene edit invalidates. Camera motion is intentionally absent:
 * every cache below is view-independent, so a camera move keeps all of them.
 */
export type PathTracerCacheInvalidation =
    |'geometry'|'material-swap'|'material-adjust'|'environment';

export interface PathTracerCacheDependency {
  geometry: boolean;
  'material-swap': boolean;
  'material-adjust': boolean;
  environment: boolean;
}

/**
 * bvh: acceleration structure. Geometry only.
 * irradiance: world-space lighting with albedo divided out. Geometry,
 * non-albedo material replacement, and lights/HDRI. A pure colour adjust
 * keeps it. Camera motion keeps it.
 * materials: packed PBR factors for the scene material table. Material
 * identity and colour/factor edits. Not environment, not camera. A geometry
 * swap does not clear it by itself; entries are matched by mesh name, and a
 * material edit that comes with a new model still clears them.
 */
export const PATH_TRACER_CACHE_DEPENDENCIES:
    Record<PathTracerCacheType, PathTracerCacheDependency> = {
      bvh: {
        geometry: true,
        'material-swap': false,
        'material-adjust': false,
        environment: false,
      },
      irradiance: {
        geometry: true,
        'material-swap': true,
        'material-adjust': false,
        environment: true,
      },
      materials: {
        geometry: false,
        'material-swap': true,
        'material-adjust': true,
        environment: false,
      },
    };

export const PATH_TRACER_CACHE_INVALIDATIONS:
    readonly PathTracerCacheInvalidation[] =
        ['geometry', 'material-swap', 'material-adjust', 'environment'];

export const cacheTypesClearedBy =
    (reason: PathTracerCacheInvalidation): PathTracerCacheType[] =>
        PATH_TRACER_CACHE_TYPES.filter(
            (type) => PATH_TRACER_CACHE_DEPENDENCIES[type][reason]);

export interface PathTracerCacheFlags {
  enabled: Record<PathTracerCacheType, boolean>;
  load: Record<PathTracerCacheType, boolean>;
  verifyFingerprint: boolean;
}

export const defaultPathTracerCacheFlags = (): PathTracerCacheFlags => ({
  enabled: {bvh: false, irradiance: false, materials: false},
  load: {bvh: true, irradiance: true, materials: true},
  verifyFingerprint: false,
});

export const isPathTracerCacheType =
    (value: string): value is PathTracerCacheType =>
        (PATH_TRACER_CACHE_TYPES as readonly string[]).includes(value);

/**
 * Colour and emissive colour are albedo. Roughness, metalness, transmission,
 * maps, and a replaced material identity change the reflectance, so they
 * count as a material swap for the lighting cache.
 */
export const MATERIAL_ADJUST_PROPERTY_KEYS = [
  'baseColorFactor',
  'color',
  'emissiveFactor',
  'emissive',
] as const;

export const classifyMaterialProperties =
    (properties: object): 'material-swap'|'material-adjust' => {
      const keys = Object.keys(properties);
      const adjust = new Set<string>(MATERIAL_ADJUST_PROPERTY_KEYS);
      if (keys.length > 0 && keys.every((key) => adjust.has(key))) {
        return 'material-adjust';
      }
      return 'material-swap';
    };

export interface PathTracerCacheLoadRequest {
  types?: readonly PathTracerCacheType[];
  /**
   * Automatic loads from path-tracer-cache-url honour the per-type load flags.
   */
  respectLoadFlags?: boolean;
}

export const typesToApply = (
    present: readonly PathTracerCacheType[],
    flags: PathTracerCacheFlags,
    request: PathTracerCacheLoadRequest = {},
    ): PathTracerCacheType[] => {
  const requested = request.types == null ? null : new Set(request.types);
  return present.filter((type) => {
    if (!flags.enabled[type]) {
      return false;
    }
    if (requested != null && !requested.has(type)) {
      return false;
    }
    if (request.respectLoadFlags === true && !flags.load[type]) {
      return false;
    }
    return true;
  });
};

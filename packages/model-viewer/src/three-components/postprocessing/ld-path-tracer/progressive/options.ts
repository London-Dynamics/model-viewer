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

export type PathTracerMode = 'immediate'|'progressive';

/** beauty is the product. The other three are review views. */
export type PathTracerView = 'beauty'|'realtime'|'occlusion'|'bake';

/** uniform white makes the path tracer output the occlusion factor. */
export type OcclusionEnvironment = 'scene'|'uniform';

export interface ContactShadowOptions {
  enabled: boolean;
  resolution: number;
  softness: number;
  opacity: number;
}

export interface TextureAOOptions {
  enabled: boolean;
  resolution: number;
  samples: number;
  distance: number;
}

export interface LightmapOptions {
  enabled: boolean;
}

export interface LightLayerOptions {
  include: boolean;
  separateLayers: boolean;
}

export interface ProbeOptions {
  enabled: boolean;
  count: number;
  resolution: number;
}

export interface ProgressiveSettings {
  mode: PathTracerMode;
  view: PathTracerView;
  occlusionEnvironment: OcclusionEnvironment;
  fadeMs: number;
  traceRevealSamples: number;
  idleDelayMs: number;
  budgetMs: number;
  environment: string|null;
  bake: {
    contactShadow: ContactShadowOptions; textureAO: TextureAOOptions;
    lightmap: LightmapOptions;
  };
  lights: LightLayerOptions;
  probes: ProbeOptions;
}

export interface ProgressiveOptionsPatch {
  mode?: PathTracerMode;
  view?: PathTracerView;
  occlusionEnvironment?: OcclusionEnvironment;
  fadeMs?: number;
  traceRevealSamples?: number;
  idleDelayMs?: number;
  budgetMs?: number;
  environment?: string|null;
  bake?: {
    contactShadow?: Partial<ContactShadowOptions>;
    textureAO?: Partial<TextureAOOptions>;
    lightmap?: Partial<LightmapOptions>;
  };
  lights?: Partial<LightLayerOptions>;
  probes?: Partial<ProbeOptions>;
}

export const DEFAULT_PROGRESSIVE_SETTINGS: ProgressiveSettings = {
  mode: 'immediate',
  view: 'beauty',
  occlusionEnvironment: 'uniform',
  fadeMs: 600,
  traceRevealSamples: 6,
  idleDelayMs: 500,
  budgetMs: 4,
  environment: null,
  bake: {
    contactShadow: {
      enabled: true,
      resolution: 192,
      softness: 0.08,
      opacity: 0.62,
    },
    textureAO: {
      enabled: true,
      resolution: 192,
      samples: 16,
      distance: 0,
    },
    lightmap: {enabled: false},
  },
  lights: {include: true, separateLayers: true},
  probes: {enabled: true, count: 1, resolution: 64},
};

const clampInt =
    (value: number, min: number, max: number, fallback: number): number => {
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return Math.min(max, Math.max(min, Math.floor(value)));
    };

const clampNum =
    (value: number, min: number, max: number, fallback: number): number => {
      if (!Number.isFinite(value)) {
        return fallback;
      }
      return Math.min(max, Math.max(min, value));
    };

export const cloneProgressiveSettings =
    (settings: ProgressiveSettings): ProgressiveSettings => ({
      mode: settings.mode,
      view: settings.view,
      occlusionEnvironment: settings.occlusionEnvironment,
      fadeMs: settings.fadeMs,
      traceRevealSamples: settings.traceRevealSamples,
      idleDelayMs: settings.idleDelayMs,
      budgetMs: settings.budgetMs,
      environment: settings.environment,
      bake: {
        contactShadow: {...settings.bake.contactShadow},
        textureAO: {...settings.bake.textureAO},
        lightmap: {...settings.bake.lightmap},
      },
      lights: {...settings.lights},
      probes: {...settings.probes},
    });

export const resolveProgressiveSettings = (
    current: ProgressiveSettings,
    patch?: ProgressiveOptionsPatch|null,
    ): ProgressiveSettings => {
  const next = cloneProgressiveSettings(current);
  if (patch == null) {
    return next;
  }

  if (patch.mode === 'immediate' || patch.mode === 'progressive') {
    next.mode = patch.mode;
  }
  if (patch.view === 'beauty' || patch.view === 'realtime' ||
      patch.view === 'occlusion' || patch.view === 'bake') {
    next.view = patch.view;
  }
  if (patch.occlusionEnvironment === 'scene' ||
      patch.occlusionEnvironment === 'uniform') {
    next.occlusionEnvironment = patch.occlusionEnvironment;
  }
  if (patch.fadeMs != null) {
    next.fadeMs = clampNum(patch.fadeMs, 0, 10000, next.fadeMs);
  }
  if (patch.traceRevealSamples != null) {
    next.traceRevealSamples =
        clampInt(patch.traceRevealSamples, 1, 10000, next.traceRevealSamples);
  }
  if (patch.idleDelayMs != null) {
    next.idleDelayMs = clampNum(patch.idleDelayMs, 0, 120000, next.idleDelayMs);
  }
  if (patch.budgetMs != null) {
    next.budgetMs = clampNum(patch.budgetMs, 0.5, 32, next.budgetMs);
  }
  if (patch.environment !== undefined) {
    next.environment =
        typeof patch.environment === 'string' && patch.environment.length > 0 ?
        patch.environment :
        null;
  }

  const contact = patch.bake?.contactShadow;
  if (contact != null) {
    if (typeof contact.enabled === 'boolean') {
      next.bake.contactShadow.enabled = contact.enabled;
    }
    if (contact.resolution != null) {
      next.bake.contactShadow.resolution = clampInt(
          contact.resolution, 8, 1024, next.bake.contactShadow.resolution);
    }
    if (contact.softness != null) {
      next.bake.contactShadow.softness =
          clampNum(contact.softness, 0, 1, next.bake.contactShadow.softness);
    }
    if (contact.opacity != null) {
      next.bake.contactShadow.opacity =
          clampNum(contact.opacity, 0, 1, next.bake.contactShadow.opacity);
    }
  }

  const ao = patch.bake?.textureAO;
  if (ao != null) {
    if (typeof ao.enabled === 'boolean') {
      next.bake.textureAO.enabled = ao.enabled;
    }
    if (ao.resolution != null) {
      next.bake.textureAO.resolution =
          clampInt(ao.resolution, 8, 1024, next.bake.textureAO.resolution);
    }
    if (ao.samples != null) {
      next.bake.textureAO.samples =
          clampInt(ao.samples, 1, 128, next.bake.textureAO.samples);
    }
    if (ao.distance != null) {
      next.bake.textureAO.distance =
          clampNum(ao.distance, 0, 1000, next.bake.textureAO.distance);
    }
  }

  if (typeof patch.bake?.lightmap?.enabled === 'boolean') {
    next.bake.lightmap.enabled = patch.bake.lightmap.enabled;
  }
  if (typeof patch.lights?.include === 'boolean') {
    next.lights.include = patch.lights.include;
  }
  if (typeof patch.lights?.separateLayers === 'boolean') {
    next.lights.separateLayers = patch.lights.separateLayers;
  }
  if (typeof patch.probes?.enabled === 'boolean') {
    next.probes.enabled = patch.probes.enabled;
  }
  if (patch.probes?.count != null) {
    next.probes.count = clampInt(patch.probes.count, 1, 4, next.probes.count);
  }
  if (patch.probes?.resolution != null) {
    next.probes.resolution =
        clampInt(patch.probes.resolution, 8, 256, next.probes.resolution);
  }

  return next;
};

export const progressiveBakeKey = (settings: ProgressiveSettings): string =>
    JSON.stringify({
      contact: settings.bake.contactShadow,
      ao: settings.bake.textureAO,
      lights: settings.lights,
      probes: {
        count: settings.probes.count,
        resolution: settings.probes.resolution,
      },
      environment: settings.environment,
      occlusionEnvironment: settings.occlusionEnvironment,
    });

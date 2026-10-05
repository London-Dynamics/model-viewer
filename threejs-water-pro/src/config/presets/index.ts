// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Ocean environment presets based on oceanographic literature
 *
 * References:
 * - JONSWAP spectrum: Hasselmann et al. (1973)
 * - Directional spreading: Mitsuyasu et al. (1975)
 * - Beaufort wind scale for wave conditions
 * - Pierson-Moskowitz spectrum for fully developed seas
 */

import type {
  PresetConfig,
  PresetName,
  WaterSceneConfig,
  WaterSceneParams,
} from "./types";
import { normalizeWaterColorConfig } from "../../shaders/waterColor";
import { ARCTIC_PRESET } from "./arctic";
import { BLACK_FLAG_PRESET } from "./blackFlag";
import { DUSK_PRESET } from "./dusk";
import { FOGGY_PRESET } from "./foggy";
import { MOONLIT_PRESET } from "./moonlit";
import { SEA_OF_THIEVES_PRESET } from "./seaOfThieves";
import { STORM_PRESET } from "./storm";
import { SUNSET_PRESET } from "./sunset";


export type {
  PresetName,
  PresetConfig,
  WaterSceneConfig,
  WaterSceneParams,
};

// Deep clone helper
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// Deep assign helper - recursively assigns values while preserving target object references
function deepAssign<T extends object>(target: T, source: object): void {
  for (const key in source) {
    const sourceValue = (source as Record<string, unknown>)[key];
    const targetValue = (target as Record<string, unknown>)[key];

    if (sourceValue !== undefined) {
      if (
        typeof sourceValue === "object" &&
        sourceValue !== null &&
        !Array.isArray(sourceValue) &&
        typeof targetValue === "object" &&
        targetValue !== null &&
        !Array.isArray(targetValue)
      ) {
        // Recursively assign to nested objects (preserves reference)
        deepAssign(targetValue as object, sourceValue as object);
      } else {
        // Assign primitive values or replace arrays
        (target as Record<string, unknown>)[key] = deepClone(sourceValue);
      }
    }
  }
}

/** Replace an object's contents while retaining its identity for UI bindings. */
function replaceObject(target: object, source: object): void {
  const targetRecord = target as Record<string, unknown>;
  for (const key of Object.keys(targetRecord)) delete targetRecord[key];
  Object.assign(targetRecord, deepClone(source));
}

// Presets in alphabetical order
export const PRESETS: Record<PresetName, WaterSceneConfig> = {
  arctic: ARCTIC_PRESET,
  blackFlag: BLACK_FLAG_PRESET,
  dusk: DUSK_PRESET,
  foggy: FOGGY_PRESET,
  moonlit: MOONLIT_PRESET,
  seaOfThieves: SEA_OF_THIEVES_PRESET,
  storm: STORM_PRESET,
  sunset: SUNSET_PRESET,
};

/**
 * Get a complete params object for a preset (returns a deep clone)
 */
export function getPresetParams(presetName: PresetName): WaterSceneConfig {
  const preset = PRESETS[presetName];
  return deepClone(preset);
}

/** Convert supported preset input to the canonical v3.4 scene shape. */
export function normalizeWaterSceneConfig(
  params: WaterSceneConfig,
): WaterSceneConfig {
  const normalized = deepClone(params) as WaterSceneConfig;
  normalized.color = normalizeWaterColorConfig(params.color);
  return normalized;
}

/**
 * Apply a preset to an existing params object (mutates in place).
 * Uses deep assignment to preserve object references for UI bindings.
 *
 * Accepts either a built-in preset name or complete scene parameters
 * (e.g. parsed from a downloaded JSON preset).
 */
export function applyPresetToParams(
  params: WaterSceneConfig,
  preset: PresetName | WaterSceneConfig,
): void {
  const presetParams =
    typeof preset === "string"
      ? getPresetParams(preset)
      : normalizeWaterSceneConfig(preset);
  const { color, ...sceneParams } = presetParams;
  deepAssign(params, sceneParams);
  replaceObject(params.color, color);
}

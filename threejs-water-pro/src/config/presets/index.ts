/**
 * Ocean environment presets based on oceanographic literature
 *
 * References:
 * - JONSWAP spectrum: Hasselmann et al. (1973)
 * - Directional spreading: Mitsuyasu et al. (1975)
 * - Beaufort wind scale for wave conditions
 * - Pierson-Moskowitz spectrum for fully developed seas
 */

import type { PresetConfig, PresetName, WaterSceneParams } from "./types";
import { ARCTIC_PRESET } from "./arctic";
import { BLACK_FLAG_PRESET } from "./blackFlag";
import { DUSK_PRESET } from "./dusk";
import { FOGGY_PRESET } from "./foggy";
import { MOONLIT_PRESET } from "./moonlit";
import { SEA_OF_THIEVES_PRESET } from "./seaOfThieves";
import { STORM_PRESET } from "./storm";
import { SUNSET_PRESET } from "./sunset";


export type { PresetName, PresetConfig, WaterSceneParams };

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

// Presets in alphabetical order
export const PRESETS: Record<PresetName, PresetConfig> = {
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
export function getPresetParams(presetName: PresetName): WaterSceneParams {
  const preset = PRESETS[presetName];
  return deepClone(preset);
}

/**
 * Apply a preset to an existing params object (mutates in place).
 * Uses deep assignment to preserve object references for UI bindings.
 *
 * Accepts either a built-in preset name or a complete WaterSceneParams object
 * (e.g. parsed from a downloaded JSON preset).
 */
export function applyPresetToParams(
  params: WaterSceneParams,
  preset: PresetName | WaterSceneParams,
): void {
  const presetParams =
    typeof preset === "string" ? getPresetParams(preset) : deepClone(preset);
  deepAssign(params, presetParams);
}

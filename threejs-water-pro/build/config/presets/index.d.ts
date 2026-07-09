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
export type { PresetName, PresetConfig, WaterSceneParams };
export declare const PRESETS: Record<PresetName, PresetConfig>;
/**
 * Get a complete params object for a preset (returns a deep clone)
 */
export declare function getPresetParams(presetName: PresetName): WaterSceneParams;
/**
 * Apply a preset to an existing params object (mutates in place).
 * Uses deep assignment to preserve object references for UI bindings.
 *
 * Accepts either a built-in preset name or a complete WaterSceneParams object
 * (e.g. parsed from a downloaded JSON preset).
 */
export declare function applyPresetToParams(params: WaterSceneParams, preset: PresetName | WaterSceneParams): void;
//# sourceMappingURL=index.d.ts.map
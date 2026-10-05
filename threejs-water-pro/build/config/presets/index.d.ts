/**
 * Ocean environment presets based on oceanographic literature
 *
 * References:
 * - JONSWAP spectrum: Hasselmann et al. (1973)
 * - Directional spreading: Mitsuyasu et al. (1975)
 * - Beaufort wind scale for wave conditions
 * - Pierson-Moskowitz spectrum for fully developed seas
 */
import type { PresetConfig, PresetName, WaterSceneConfig, WaterSceneParams } from "./types";
export type { PresetName, PresetConfig, WaterSceneConfig, WaterSceneParams, };
export declare const PRESETS: Record<PresetName, WaterSceneConfig>;
/**
 * Get a complete params object for a preset (returns a deep clone)
 */
export declare function getPresetParams(presetName: PresetName): WaterSceneConfig;
/** Convert supported preset input to the canonical v3.4 scene shape. */
export declare function normalizeWaterSceneConfig(params: WaterSceneConfig): WaterSceneConfig;
/**
 * Apply a preset to an existing params object (mutates in place).
 * Uses deep assignment to preserve object references for UI bindings.
 *
 * Accepts either a built-in preset name or complete scene parameters
 * (e.g. parsed from a downloaded JSON preset).
 */
export declare function applyPresetToParams(params: WaterSceneConfig, preset: PresetName | WaterSceneConfig): void;
//# sourceMappingURL=index.d.ts.map
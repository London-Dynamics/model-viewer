// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Type definitions for the WaterSystem high-level API
 */

import type { QualityLevel } from "./config/QualityLevels";
import type { WaveSample } from "./simulation/waves";

// ============================================
// WaterSystem Config (Re-initialization)
// ============================================

/**
 * Configuration that requires re-initialization when changed.
 * Use `water.rebuild(config)` to apply these changes.
 */
export interface WaterSystemConfig {
  quality: QualityLevel;
  /**
   * Cascade resolutions, coarsest to finest, matching the currently loaded
   * quality level's cascade count. Each entry's resolution is independently
   * overridable — tile sizes are derived from `maxScale` and every entry's
   * resolution up to that point (see `deriveCascadeScale`), so overriding
   * one resolution only reshapes cascades after it in the array.
   */
  cascades: { resolution: number; enabled: boolean }[];
}

/**
 * Result from sampling water at a position
 */
export type { WaveSample };

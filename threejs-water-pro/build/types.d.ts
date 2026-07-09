/**
 * Type definitions for the WaterSystem high-level API
 */
import type { QualityLevel } from "./config/QualityLevels";
import type { WaveSample } from "./simulation/waves";
/**
 * Configuration that requires re-initialization when changed.
 * Use `water.rebuild(config)` to apply these changes.
 */
export interface WaterSystemConfig {
    quality: QualityLevel;
    cascades: {
        waves: {
            resolution: number;
            enabled: boolean;
        };
        ripples: {
            resolution: number;
            enabled: boolean;
        };
    };
}
/**
 * Result from sampling water at a position
 */
export type { WaveSample };
//# sourceMappingURL=types.d.ts.map
// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/** Constituent concentrations used by the physical water-color model. */
export interface WaterConstituents {
  /** Phytoplankton concentration. Greens productive water. */
  algae: number;
  /** Mineral suspended sediment. Brightens and mutes turbid water. */
  silt: number;
  /** Colored dissolved organic matter. Browns stained water. */
  stain: number;
}

/** Jerlov water types ordered from clear oceanic to turbid coastal water. */
export type JerlovWaterType =
  | "Oceanic I"
  | "Oceanic IA"
  | "Oceanic IB"
  | "Oceanic II"
  | "Oceanic III"
  | "Coastal 1C"
  | "Coastal 3C"
  | "Coastal 5C"
  | "Coastal 7C"
  | "Coastal 9C";

/**
 * Representative constituent seeds for the Jerlov clarity progression.
 * Selecting a type seeds the sliders; the values remain freely adjustable.
 */
export const JERLOV_WATER_TYPES: Record<JerlovWaterType, WaterConstituents> = {
  "Oceanic I": { algae: 0, silt: 0.03, stain: 0 },
  "Oceanic IA": { algae: 0, silt: 0.08, stain: 0 },
  "Oceanic IB": { algae: 0, silt: 0.19, stain: 0.01 },
  "Oceanic II": { algae: 0.08, silt: 0.3, stain: 0.03 },
  "Oceanic III": { algae: 0.16, silt: 0.45, stain: 0.08 },
  "Coastal 1C": { algae: 0.25, silt: 0.6, stain: 0.15 },
  "Coastal 3C": { algae: 0.4, silt: 0.85, stain: 0.3 },
  "Coastal 5C": { algae: 0.6, silt: 1.15, stain: 0.55 },
  "Coastal 7C": { algae: 0.8, silt: 1.5, stain: 0.9 },
  "Coastal 9C": { algae: 1.05, silt: 2, stain: 1.3 },
};

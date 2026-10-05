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
export type JerlovWaterType = "Oceanic I" | "Oceanic IA" | "Oceanic IB" | "Oceanic II" | "Oceanic III" | "Coastal 1C" | "Coastal 3C" | "Coastal 5C" | "Coastal 7C" | "Coastal 9C";
/**
 * Representative constituent seeds for the Jerlov clarity progression.
 * Selecting a type seeds the sliders; the values remain freely adjustable.
 */
export declare const JERLOV_WATER_TYPES: Record<JerlovWaterType, WaterConstituents>;
//# sourceMappingURL=waterConstituents.d.ts.map
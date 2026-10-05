/**
 * Type definitions for foam shader functions.
 */
import type { Node } from "three/webgpu";
import type { SurfaceFoam } from "./foamSurface";
import type { WaveFoam } from "./foamWaves";
import type { ShorelineFoam } from "./foamShoreline";
/** Coordinates for foam calculation */
export interface FoamCoords {
    fragWorldX: Node;
    fragWorldZ: Node;
}
/** Scene state for foam calculation (computed values only; uniforms come via SurfaceUniforms) */
export interface FoamSceneState {
    waterColumnDepth: Node;
    /** 1.0 when scene geometry is in front of water surface, 0.0 otherwise */
    isObjectInFront: Node;
    fresnel: Node;
}
/**
 * Input parameters for Foam.build.
 */
export interface FoamBuildParams {
    coords: FoamCoords;
    scene: FoamSceneState;
    surfaceFoam: SurfaceFoam;
    waveFoam: WaveFoam;
    shorelineFoam: ShorelineFoam;
    /** Global wind direction (radians) */
    windDirection: Node;
    /**
     * Sampled persistent foam energy from the foam-accumulation field. When
     * provided, `WaveFoam` shades it into wave-crest foam. Omitted on quality
     * tiers where wave foam is off.
     */
    foamEnergy?: Node;
    /**
     * Sampled wake-foam energy from the wake field. When provided, `WaveFoam`
     * shades it through the textured foam path and merges it on top of the
     * crest foam.
     */
    wakeFoamEnergy?: Node;
}
/**
 * Result from Foam.build.
 */
export interface FoamResult {
    /** Combined foam color (white for surface foam) */
    combinedFoamColor: Node;
    /** Combined strength of surface foam (NOT including shoreline) */
    combinedFoamStrength: Node;
    /** Surface foam strength before above-water factor */
    earlyFoamStrength: Node;
    shorelineFoamStrength: Node;
    /** Depth-based shoreline zone mask (0 = deep water, 1 = at shore) for alpha compositing */
    shorelineZoneMask: Node;
    /** Tint color for shoreline foam (from uniforms) */
    shorelineFoamTint: Node;
    effectiveFresnel: Node;
}
//# sourceMappingURL=foamTypes.d.ts.map
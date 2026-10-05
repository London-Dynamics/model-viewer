// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Main foam orchestrator that combines all foam effects.
 *
 * Coordinates the sub-foam classes (SurfaceFoam, WaveFoam, ShorelineFoam)
 * into a single unified result. Wake foam is composited separately in the
 * fragment shader, where the wake field's persistent foam-energy buffer is
 * maxed into the crest-foam energy (see `src/shaders/waterFragment.ts`).
 */
import {
  float,
  clamp,
  mix,
} from "three/tsl";
import type { Node } from "three/webgpu";
import type { FoamBuildParams, FoamResult } from "./foamTypes";

/**
 * Foam orchestrator that combines surface, wave, and shoreline foam.
 *
 * Unlike other shader classes, Foam doesn't own uniforms. It coordinates
 * the sub-foam classes which each own their own uniforms, and combines
 * their outputs into a unified result.
 */
export class Foam {
  /**
   * Builds all foam effects and combines them.
   *
   * Surface foam and turbulent foam are blended additively. Shoreline
   * foam has its own tint color and is blended separately.
   *
   * @param params - Parameters for foam calculation including sub-foam instances.
   * @returns Object with foam strengths, tint colors, and effective fresnel.
   */
  build(params: FoamBuildParams): FoamResult {
    const {
      coords,
      scene,
      surfaceFoam: surfaceFoamInstance,
      waveFoam: waveFoamInstance,
      shorelineFoam: shorelineFoamInstance,
      windDirection,
      foamEnergy,
      wakeFoamEnergy,
    } = params;
    const { fragWorldX, fragWorldZ } = coords;
    const {
      waterColumnDepth,
      isObjectInFront,
      fresnel,
    } = scene;

    // Surface foam
    const surfaceFoamResult = surfaceFoamInstance.build({
      worldX: fragWorldX,
      worldZ: fragWorldZ,
    });
    const surfaceFoamStrength: Node = surfaceFoamResult.strength;
    const surfaceFoamColor: Node = surfaceFoamResult.color;

    // Wave-crest foam (persistent energy field, anisotropic wind stretching)
    const waveFoamResult = waveFoamInstance.build({
      worldX: fragWorldX,
      worldZ: fragWorldZ,
      windDirection,
      foamEnergy,
      wakeFoamEnergy,
    });
    const turbulentFoamStrength: Node = waveFoamResult.strength;
    const waveFoamColor: Node = waveFoamResult.color;

    // Shoreline foam (texture-based with own tint color)
    const shorelineFoamResult = shorelineFoamInstance.build({
      worldX: fragWorldX,
      worldZ: fragWorldZ,
      waterColumnDepth,
    });
    const shorelineFoamStrength: Node = shorelineFoamResult.strength;
    const shorelineFoamTint: Node = shorelineFoamResult.color;
    const shorelineZoneMask: Node = shorelineFoamResult.zoneMask;

    // Additive blend of surface and turbulent foam
    const totalFoamStrength = clamp(
      surfaceFoamStrength.add(turbulentFoamStrength),
      0.0,
      1.0,
    );

    // Foam reduces fresnel (foam is diffuse/matte). Multiplier > 1 (clamped)
    // so the reflectivity saturates to ~0 at the achievable foam strength
    // (capped by foam opacity), giving dense foam a fully matte look.
    const effectiveFresnel = fresnel.mul(
      clamp(float(1.0).sub(totalFoamStrength.mul(2.0)), 0.0, 1.0),
    );

    // Not visible when objects are in front of water
    const notInFrontFactor = float(1.0).sub(isObjectInFront);
    const foamVisibility = notInFrontFactor;

    const combinedFoamStrength = totalFoamStrength.mul(foamVisibility);

    // Blend foam colors based on relative strengths
    const totalStrengthBias = surfaceFoamStrength.add(turbulentFoamStrength).add(0.0001);
    const surfaceWeight = surfaceFoamStrength.div(totalStrengthBias);
    const combinedFoamColor = mix(
      waveFoamColor,
      surfaceFoamColor,
      surfaceWeight,
    );

    // Shoreline foam follows the same in-front visibility as the rest of
    // the foam (hidden where scene geometry occludes the water surface).
    const shorelineVisibility = foamVisibility;

    return {
      combinedFoamColor,
      combinedFoamStrength,
      earlyFoamStrength: totalFoamStrength,
      shorelineFoamStrength: shorelineFoamStrength.mul(shorelineVisibility),
      shorelineZoneMask: shorelineZoneMask.mul(shorelineVisibility),
      shorelineFoamTint,
      effectiveFresnel,
    };
  }
}

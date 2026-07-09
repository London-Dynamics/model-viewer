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

/** Eigenvalues from normal sampling for Jacobian foam */
export interface FoamEigenvalues {
  eigen0: Node;
  eigen1: Node;
}

/** Scene state for foam calculation (computed values only; uniforms come via SurfaceUniforms) */
export interface FoamSceneState {
  waterColumnDepth: Node;
  /** 1.0 when scene geometry is in front of water surface, 0.0 otherwise */
  isObjectInFront: Node;
  fresnel: Node;
  /** Displaced surface normal (for leading edge detection) */
  surfaceNormal: Node;
}

/** Capability flags for foam (not runtime toggles — these depend on backend support) */
export interface FoamFeatures {
  hasJacobianFoam?: boolean;
}

/**
 * Input parameters for Foam.build.
 */
export interface FoamBuildParams {
  coords: FoamCoords;
  eigenvalues: FoamEigenvalues;
  scene: FoamSceneState;
  surfaceFoam: SurfaceFoam;
  waveFoam: WaveFoam;
  shorelineFoam: ShorelineFoam;
  features: FoamFeatures;
  /** Global wind direction (radians) */
  windDirection: Node;
  /**
   * Sampled persistent foam energy from `FoamAccumulation`.
   * When provided (WebGPU + quality feature enabled), `WaveFoam` uses it
   * in place of the stateless smoothstep mask. Omitted on WebGL.
   */
  foamEnergy?: Node;
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

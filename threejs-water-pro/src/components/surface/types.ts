// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Configuration interfaces for reactive params API.
 */

/** Artist-authored water color configuration. */
export interface ColorConfig {
  absorptionColor: string;
  mode?: "custom";
  transmissionColor: string;
  waterColor: string;
}

export interface FresnelConfig {
  iorRatio: number;
  refractionStrength: number;
}

export interface SSSConfig {
  enabled: boolean;
  intensity: number;
  power: number;
}

export interface HorizonConfig {
  fogEnabled: boolean;
  fadeStart: number;
  fadeEnd: number;
}

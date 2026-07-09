/**
 * Configuration interfaces for reactive params API.
 */

export interface ColorConfig {
  absorptionColor: string;
  transmissionColor: string;
  waterColor: string;
}

export interface FresnelConfig {
  fadePower: number;
  fadeStart: number;
  iorRatio: number;
  normalStrength: number;
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


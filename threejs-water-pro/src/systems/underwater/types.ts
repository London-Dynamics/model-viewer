// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Underwater ambient particle parameters.
 * Properties are sorted alphabetically.
 */
export interface ParticleParams {
  /** Particle color (hex string) */
  color: string;
  /** Number of active particles */
  count: number;
  /** Whether particles are enabled */
  enabled: boolean;
  /** Far distance from camera where particles fully fade out */
  farDistance: number;
  /** Maximum particle size */
  maxSize: number;
  /** Minimum particle size */
  minSize: number;
  /** Near distance from camera where particles start to appear */
  nearDistance: number;
  /** Master opacity (0-1) */
  opacity: number;
}

export const PARTICLE_DEFAULTS: ParticleParams = {
  color: "#ffffff",
  count: 1000,
  enabled: true,
  farDistance: 40,
  maxSize: 0.15,
  minSize: 0.03,
  nearDistance: 2,
  opacity: 0.5,
};

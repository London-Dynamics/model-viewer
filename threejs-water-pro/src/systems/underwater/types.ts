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
  farDistance: 209,
  maxSize: 0.5,
  minSize: 0.1,
  nearDistance: 9,
  opacity: 0.5,
};

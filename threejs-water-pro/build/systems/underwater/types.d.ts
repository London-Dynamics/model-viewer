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
export declare const PARTICLE_DEFAULTS: ParticleParams;
//# sourceMappingURL=types.d.ts.map
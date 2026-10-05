/**
 * CPU-side full-spectrum optical model. Optical properties are sampled from
 * 400–700 nm and integrated into linear RGB so per-fragment shading remains
 * an RGB lookup rather than a spectral calculation.
 */
import * as THREE from "three/webgpu";
import type { WaterConstituents } from "./waterConstituents";
/** Deep-water in-scatter reflectance integrated into linear RGB. */
export declare function computeInScatterReflectance(constituents: WaterConstituents): THREE.Vector3;
/** Sunlight transmission through a wave crest, integrated into linear RGB. */
export declare function computeCrestTransmission(constituents: WaterConstituents, pathLength: number): THREE.Vector3;
/** Options for the path-length-to-transmittance lookup table. */
export interface TransmittanceLUTOptions {
    size: number;
    lengthScale: number;
}
/** Build broadband RGB transmittance over a non-linear path-length axis. */
export declare function buildTransmittanceLUT(constituents: WaterConstituents, { size, lengthScale }: TransmittanceLUTOptions): Float32Array;
//# sourceMappingURL=waterSpectrum.d.ts.map
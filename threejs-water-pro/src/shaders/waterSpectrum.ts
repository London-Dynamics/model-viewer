// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * CPU-side full-spectrum optical model. Optical properties are sampled from
 * 400–700 nm and integrated into linear RGB so per-fragment shading remains
 * an RGB lookup rather than a spectral calculation.
 */
import * as THREE from "three/webgpu";
import type { WaterConstituents } from "./waterConstituents";

const WAVELENGTHS: number[] = [];
for (let wavelength = 400; wavelength <= 700; wavelength += 5) {
  WAVELENGTHS.push(wavelength);
}

const MOREL_REFLECTANCE_FACTOR = 0.33;
const MAX_IRRADIANCE_REFLECTANCE = 0.1;
const ABSORPTION_FLOOR = 1e-4;

function gaussianLobe(
  x: number,
  mean: number,
  sigmaLow: number,
  sigmaHigh: number,
): number {
  const sigma = x < mean ? sigmaLow : sigmaHigh;
  const t = (x - mean) / sigma;
  return Math.exp(-0.5 * t * t);
}

function cieX(wavelength: number): number {
  return (
    1.056 * gaussianLobe(wavelength, 599.8, 37.9, 31) +
    0.362 * gaussianLobe(wavelength, 442, 16, 26.7) -
    0.065 * gaussianLobe(wavelength, 501.1, 20.4, 26.2)
  );
}

function cieY(wavelength: number): number {
  return (
    0.821 * gaussianLobe(wavelength, 568.8, 46.9, 40.5) +
    0.286 * gaussianLobe(wavelength, 530.9, 16.3, 31.1)
  );
}

function cieZ(wavelength: number): number {
  return (
    1.217 * gaussianLobe(wavelength, 437, 11.8, 36) +
    0.681 * gaussianLobe(wavelength, 459, 26, 13.8)
  );
}

const XYZ_TO_RGB = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.204, 1.057],
];

const RESPONSE_WEIGHTS = (() => {
  const channels = { r: [] as number[], g: [] as number[], b: [] as number[] };
  for (const wavelength of WAVELENGTHS) {
    const xyz = [cieX(wavelength), cieY(wavelength), cieZ(wavelength)];
    channels.r.push(
      Math.max(
        0,
        XYZ_TO_RGB[0][0] * xyz[0] +
          XYZ_TO_RGB[0][1] * xyz[1] +
          XYZ_TO_RGB[0][2] * xyz[2],
      ),
    );
    channels.g.push(
      Math.max(
        0,
        XYZ_TO_RGB[1][0] * xyz[0] +
          XYZ_TO_RGB[1][1] * xyz[1] +
          XYZ_TO_RGB[1][2] * xyz[2],
      ),
    );
    channels.b.push(
      Math.max(
        0,
        XYZ_TO_RGB[2][0] * xyz[0] +
          XYZ_TO_RGB[2][1] * xyz[1] +
          XYZ_TO_RGB[2][2] * xyz[2],
      ),
    );
  }
  for (const weights of Object.values(channels)) {
    const sum = weights.reduce((total, value) => total + value, 0);
    for (let index = 0; index < weights.length; index++) {
      weights[index] /= sum;
    }
  }
  return channels;
})();

function integrateToRGB(spectrum: number[]): THREE.Vector3 {
  const result = new THREE.Vector3();
  for (let index = 0; index < spectrum.length; index++) {
    result.x += spectrum[index] * RESPONSE_WEIGHTS.r[index];
    result.y += spectrum[index] * RESPONSE_WEIGHTS.g[index];
    result.z += spectrum[index] * RESPONSE_WEIGHTS.b[index];
  }
  return result;
}

const WATER_ABSORPTION_10NM: Record<number, number> = {
  400: 0.00663,
  410: 0.00473,
  420: 0.00454,
  430: 0.00495,
  440: 0.00635,
  450: 0.00922,
  460: 0.00979,
  470: 0.0106,
  480: 0.0127,
  490: 0.015,
  500: 0.0204,
  510: 0.0325,
  520: 0.0409,
  530: 0.0434,
  540: 0.0474,
  550: 0.0565,
  560: 0.0619,
  570: 0.0695,
  580: 0.0896,
  590: 0.1351,
  600: 0.2224,
  610: 0.2644,
  620: 0.2755,
  630: 0.2916,
  640: 0.3108,
  650: 0.34,
  660: 0.41,
  670: 0.439,
  680: 0.465,
  690: 0.516,
  700: 0.624,
};

function waterAbsorption(wavelength: number): number {
  const low = Math.floor(wavelength / 10) * 10;
  const high = low + 10;
  const lowValue = WATER_ABSORPTION_10NM[low];
  const highValue = WATER_ABSORPTION_10NM[high];
  if (highValue === undefined) return lowValue;
  return lowValue + (highValue - lowValue) * ((wavelength - low) / 10);
}

function waterBackscatter(wavelength: number): number {
  return 0.001 * Math.pow(wavelength / 500, -4.3);
}

function absorptionAt(
  constituents: WaterConstituents,
  wavelength: number,
): number {
  const cdom = Math.exp(-0.014 * (wavelength - 440));
  const mineral = 0.195 * Math.exp(-0.011 * (wavelength - 440));
  const phytoplankton =
    0.24 * gaussianLobe(wavelength, 440, 28, 28) +
    0.15 * gaussianLobe(wavelength, 675, 22, 22) +
    0.018;
  return (
    waterAbsorption(wavelength) +
    constituents.algae * phytoplankton +
    constituents.stain * cdom +
    constituents.silt * mineral
  );
}

function backscatterAt(
  constituents: WaterConstituents,
  wavelength: number,
): number {
  const phytoplankton = 0.0018 * (545 / wavelength);
  const mineral = 0.013;
  return (
    waterBackscatter(wavelength) +
    constituents.algae * phytoplankton +
    constituents.silt * mineral
  );
}

/** Deep-water in-scatter reflectance integrated into linear RGB. */
export function computeInScatterReflectance(
  constituents: WaterConstituents,
): THREE.Vector3 {
  return integrateToRGB(
    WAVELENGTHS.map((wavelength) => {
      const absorption = Math.max(
        absorptionAt(constituents, wavelength),
        ABSORPTION_FLOOR,
      );
      return Math.min(
        (MOREL_REFLECTANCE_FACTOR *
          backscatterAt(constituents, wavelength)) /
          absorption,
        MAX_IRRADIANCE_REFLECTANCE,
      );
    }),
  );
}

/** Sunlight transmission through a wave crest, integrated into linear RGB. */
export function computeCrestTransmission(
  constituents: WaterConstituents,
  pathLength: number,
): THREE.Vector3 {
  return integrateToRGB(
    WAVELENGTHS.map((wavelength) =>
      Math.exp(-absorptionAt(constituents, wavelength) * pathLength),
    ),
  );
}

/** Options for the path-length-to-transmittance lookup table. */
export interface TransmittanceLUTOptions {
  size: number;
  lengthScale: number;
}

/** Build broadband RGB transmittance over a non-linear path-length axis. */
export function buildTransmittanceLUT(
  constituents: WaterConstituents,
  { size, lengthScale }: TransmittanceLUTOptions,
): Float32Array {
  const absorption = WAVELENGTHS.map((wavelength) =>
    absorptionAt(constituents, wavelength),
  );
  const data = new Float32Array(size * 4);
  for (let index = 0; index < size; index++) {
    const pathLength = -lengthScale * Math.log(1 - index / size);
    const rgb = integrateToRGB(
      absorption.map((value) => Math.exp(-value * pathLength)),
    );
    data[index * 4] = rgb.x;
    data[index * 4 + 1] = rgb.y;
    data[index * 4 + 2] = rgb.z;
    data[index * 4 + 3] = 1;
  }
  return data;
}

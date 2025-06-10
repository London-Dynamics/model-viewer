export const metersToFeet = (meters: number, precision: number = 1) =>
  (meters * 3.28084).toFixed(precision);

export const metersToInches = (meters: number, precision: number = 1) =>
  (meters * 39.3701).toFixed(precision);

export const metersToYards = (meters: number, precision: number = 1) =>
  (meters * 1.09361).toFixed(precision);

export const metersToMiles = (meters: number, precision: number = 1) =>
  (meters * 0.000621371).toFixed(precision);

export const metersToCentimeters = (meters: number, precision: number = 1) =>
  (meters * 100).toFixed(precision);

export const metersToMillimeters = (meters: number, precision: number = 1) =>
  (meters * 1000).toFixed(precision);

export const convertMeters = (
  meters: number,
  unit: string,
  precision: number = 2
) => {
  switch (unit) {
    case 'ft':
      return metersToFeet(meters, precision);
    case 'in':
      return metersToInches(meters, precision);
    case 'yd':
      return metersToYards(meters, precision);
    case 'mi':
      return metersToMiles(meters, precision);
    case 'cm':
      return metersToCentimeters(meters, precision);
    case 'mm':
      return metersToMillimeters(meters, precision);
    default:
      return meters.toFixed(precision);
  }
};

export const AZIMUTHAL_OCTANT_LABELS = [
  'front',
  'front-right',
  'right',
  'back-right',
  'back',
  'back-left',
  'left',
  'front-left',
];

export const TAU = 2 * Math.PI;
export const QUARTER_PI = Math.PI / 4;
export const HALF_PI = Math.PI / 2;

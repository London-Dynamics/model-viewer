export const metersToFeet = (meters: number, decimals: number = 1) =>
  (meters * 3.28084).toFixed(decimals);

export const metersToInches = (meters: number, decimals: number = 1) =>
  (meters * 39.3701).toFixed(decimals);

export const metersToYards = (meters: number, decimals: number = 1) =>
  (meters * 1.09361).toFixed(decimals);

export const metersToMiles = (meters: number, decimals: number = 1) =>
  (meters * 0.000621371).toFixed(decimals);

export const metersToCentimeters = (meters: number, decimals: number = 1) =>
  (meters * 100).toFixed(decimals);

export const metersToMillimeters = (meters: number, decimals: number = 1) =>
  (meters * 1000).toFixed(decimals);

export const convertMeters = (
  meters: number,
  unit: string,
  decimals: number = 1
) => {
  switch (unit) {
    case 'feet':
      return metersToFeet(meters, decimals);
    case 'inches':
      return metersToInches(meters, decimals);
    case 'yards':
      return metersToYards(meters, decimals);
    case 'miles':
      return metersToMiles(meters, decimals);
    case 'centimeters':
      return metersToCentimeters(meters, decimals);
    case 'millimeters':
      return metersToMillimeters(meters, decimals);
    default:
      return meters.toFixed(decimals);
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

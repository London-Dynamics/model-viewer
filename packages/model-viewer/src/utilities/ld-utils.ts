// Pure conversion functions (float only)
export const metersToFeetFloat = (meters: number) => meters * 3.28084;
export const feetToMetersFloat = (feet: number) => feet / 3.28084;

export const metersToInchesFloat = (meters: number) => meters * 39.3701;
export const inchesToMetersFloat = (inches: number) => inches / 39.3701;

export const metersToYardsFloat = (meters: number) => meters * 1.09361;
export const yardsToMetersFloat = (yards: number) => yards / 1.09361;

export const metersToMilesFloat = (meters: number) => meters * 0.000621371;
export const milesToMetersFloat = (miles: number) => miles / 0.000621371;

export const metersToCentimetersFloat = (meters: number) => meters * 100;
export const centimetersToMetersFloat = (cm: number) => cm / 100;

export const metersToMillimetersFloat = (meters: number) => meters * 1000;
export const millimetersToMetersFloat = (mm: number) => mm / 1000;

// Pretty-formatting functions
export const metersToFeet = (meters: number, precision: number = 1) =>
  metersToFeetFloat(meters).toFixed(precision) + `'`;

export const metersToInches = (meters: number, precision: number = 1) =>
  metersToInchesFloat(meters).toFixed(precision) + `"`;

export const metersToFeetAndInches = (
  meters: number,
  _precision: number = 1
) => {
  const totalFeet = metersToFeetFloat(meters);
  const feet = Math.floor(totalFeet);
  const inches = Math.round((metersToInchesFloat(meters) % 12) * 10) / 10;
  return `${feet}' ${inches}"`;
};

export const metersToYards = (meters: number, precision: number = 1) =>
  metersToYardsFloat(meters).toFixed(precision) + ' yd';

export const metersToMiles = (meters: number, precision: number = 1) =>
  metersToMilesFloat(meters).toFixed(precision) + ' mi';

export const metersToCentimeters = (meters: number, precision: number = 1) =>
  metersToCentimetersFloat(meters).toFixed(precision) + ' cm';

export const metersToMillimeters = (meters: number, precision: number = 1) =>
  metersToMillimetersFloat(meters).toFixed(precision) + ' mm';

// Renamed for clarity: formats meters as a pretty string with unit
export const formatMetersWithUnit = (
  meters: number,
  unit: string,
  precision: number = 2
) => {
  switch (unit) {
    case 'ft':
      return metersToFeet(meters, precision);
    case 'in':
      return metersToInches(meters, precision);
    case 'ft-in':
      return metersToFeetAndInches(meters, precision);
    case 'yd':
      return metersToYards(meters, precision);
    case 'mi':
      return metersToMiles(meters, precision);
    case 'cm':
      return metersToCentimeters(meters, precision);
    case 'mm':
      return metersToMillimeters(meters, precision);
    default:
      return meters.toFixed(precision) + ' m';
  }
};

// Convert from a unit to meters
export const convertToMeters = (value: number, unit: string): number => {
  switch (unit) {
    case 'ft':
    case 'ft-in': // Treat ft-in as ft for spacing
      return feetToMetersFloat(value);
    case 'in':
      return inchesToMetersFloat(value);
    case 'yd':
      return yardsToMetersFloat(value);
    case 'mi':
      return milesToMetersFloat(value);
    case 'cm':
      return centimetersToMetersFloat(value);
    case 'mm':
      return millimetersToMetersFloat(value);
    default:
      return value; // Already in meters
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

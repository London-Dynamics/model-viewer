# Gerstner Waves

Large-scale rolling swells layered on top of the FFT ocean simulation. Works on both WebGPU and WebGL backends.

Access via `water.gerstner`.

## Properties

```typescript
water.gerstner.wavelength = 300;
water.gerstner.amplitude = 3.0;
water.gerstner.wavelengthSpread = 1.4;
water.gerstner.directionalSpread = 0.1;

// Or bulk update
water.gerstner.update({
  wavelength: 300,
  amplitude: 3.0,
  wavelengthSpread: 1.4,
  directionalSpread: 0.1,
});
```

| Property            | Type     | Default | Description                                                |
| ------------------- | -------- | ------- | ---------------------------------------------------------- |
| `amplitude`         | `number` | `1.0`   | Base swell height in world units (0–10)                    |
| `directionalSpread` | `number` | `0.1`   | Angular spread of swell directions in radians (0–2)        |
| `wavelength`        | `number` | `200`   | Base wavelength in world units (10–2000)                   |
| `wavelengthSpread`  | `number` | `1.4`   | Variation ratio between consecutive wave wavelengths (1–3) |

::: tip
Gerstner amplitude scales with wind speed: `effectiveAmplitude = amplitude × (windSpeed / 10) × waves.amplitude`. Raising wind speed amplifies swells automatically. See [Wave Tuning](/guide/wave-tuning) for practical guidance.
:::

## Methods

### `update`

```typescript
update(params: GerstnerParams): void
```

Bulk-update all four swell parameters in one call.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `GerstnerParams` | `{ amplitude, directionalSpread, wavelength, wavelengthSpread }` — all four are required. See [Properties](#properties) for each field. |

## Quality Levels

The number of Gerstner waves depends on the quality level:

| Quality | Max Waves |
| ------- | --------- |
| Low     | 0         |
| Medium  | 2         |
| High    | 4         |
| Ultra   | 8         |

At "low" quality, Gerstner waves are disabled.

## Example

```typescript
const water = await WaterSystem.create(renderer, scene, camera, "high");

// Gentle rolling swells
water.gerstner.wavelength = 400;
water.gerstner.amplitude = 0.8;
water.gerstner.directionalSpread = 0.6;

// Chaotic storm swells
water.gerstner.wavelength = 460;
water.gerstner.amplitude = 2.9;
water.gerstner.directionalSpread = 1.4;
```

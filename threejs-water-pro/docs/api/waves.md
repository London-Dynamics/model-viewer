# Waves

FFT ocean simulation parameters. Drives the full wave field, from the dominant sea to small ripples.

Access via `water.waves`. Values are TSL uniform nodes; set them via `.value`. The exception is `animationSpeed`, which is a plain number.

## Properties

| Property               | Type                  | Default | Description                                                          |
| ---------------------- | --------------------- | ------- | -------------------------------------------------------------------- |
| `amplitude`            | `UniformNode<number>` | `1.0`   | Artistic wave-height multiplier. `1` = physically correct height |
| `animationSpeed`       | `number`              | `1.0`   | Wave animation multiplier. `0` = frozen, `1` = real-time (physical)  |
| `choppiness`           | `UniformNode<number>` | `1.0`   | Horizontal displacement. `0.5` smooth, `1.0` natural, `1.5+` choppy  |
| `gravity`              | `UniformNode<number>` | `9.81`  | Gravitational constant                                               |
| `jonswapGamma`         | `UniformNode<number>` | `3.3`   | JONSWAP peak enhancement                                             |
| `peakWavelength`       | `UniformNode<number>` | `70`    | Dominant wavelength in meters — the JONSWAP spectral peak. Sets wave size directly; `windSpeed` controls energy and steepness at that size, independently |
| `spectralSharpness`    | `UniformNode<number>` | `1.0`   | Multiplier on the Hasselmann frequency-dependent directional spread. `1.0` is physically calibrated; higher narrows waves toward the wind direction, lower broadens them |
| `standingWaveRatio`    | `UniformNode<number>` | `0.0`   | Blend between traveling (0) and standing (1) waves                   |
| `windDirection`        | `UniformNode<number>` | `0.0`   | Wind direction in radians                                            |
| `windSpeed`            | `UniformNode<number>` | `8.0`   | Wind speed in m/s. `3–5` calm, `6–10` moderate, `15–25` storm        |

The simulation is physically calibrated: wave heights are in meters and wave motion runs in real seconds. The spectrum is a JONSWAP model (Hasselmann et al. 1973): `peakWavelength` sets the dominant wave size directly, while `windSpeed` controls the energy and steepness of the sea at that size, independently.

## Cascade tile size

The FFT runs as three cascades — **swell** (the longest, longest-period waves), **waves** (wind-driven, mid-scale), and **ripples** (finest capillary detail) — each covering its own band of wavelengths. A single number, the preset's `waves.fft.cascades.maxScale` (default `1024`, in meters), sizes the whole set: the swell cascade always uses `maxScale`, and each cascade after it derives its tile size from `maxScale` and the resolution of every cascade before it, so adjacent bands abut without a gap or overlap. `maxScale` is the largest tile, and therefore the distance at which the swell field repeats, so a larger value pushes any visible tiling farther away.

Set it at runtime with `water.setMaxScale(maxScale)`, which resizes every cascade and their band edges together.

```typescript
water.setMaxScale(2048); // larger tile, repetition pushed farther out
```

Each cascade's resolution is independently adjustable at runtime with [`water.setCascadeResolution`](/api/water-system#setcascaderesolution). Lowering one cascade's resolution only reshapes the cascades after it — the swell cascade's tile never moves, and cascades before the one you adjust are unaffected.

Default per-quality resolutions, tile sizes, and finest wavelength at `maxScale = 1024`:

| Quality | Cascades Enabled      | Resolutions       | Tiles (m)      | Finest wavelength |
| ------- | ---------------------- | ------------------ | --------------- | ------------------ |
| Low     | Swell                   | 256                 | 1024             | ~12 m                |
| Medium  | Swell, Waves            | 256 / 256           | 1024 / 96        | ~1.1 m                |
| High    | Swell, Waves, Ripples   | 256 / 256 / 256     | 1024 / 96 / 9    | ~10.5 cm              |
| Ultra   | Swell, Waves, Ripples   | 256 / 256 / 512     | 1024 / 96 / 9    | ~5.3 cm               |
| Max     | Swell, Waves, Ripples   | 512 / 512 / 512     | 1024 / 48 / 2.25 | ~1.3 cm               |

## Methods

### `update`

```typescript
update(params: WaveUniformParams): void
```

Bulk-update the wave parameters in one call. This is how `loadPreset` applies a preset's wave slice.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `WaveUniformParams` | `{ amplitude, choppiness, spectralSharpness, windDirection, windSpeed }` plus optional `animationSpeed`, `gravity`, `jonswapGamma`, and `standingWaveRatio`. An omitted `animationSpeed` keeps its current value; the other optional fields reset to their defaults when omitted. See [Properties](#properties) for each field. |

## Example

```typescript
water.waves.windSpeed.value = 10;
water.waves.choppiness.value = 1.2;
water.waves.animationSpeed = 0.5; // plain number, not .value
```

See [Wave Tuning](/guide/wave-tuning) for practical guidance on tuning the wave field.

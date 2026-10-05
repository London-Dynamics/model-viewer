# Wave Tuning

This guide describes how to tune the ocean's appearance. The wave field is a single FFT simulation driven by a JONSWAP spectrum, covering everything from ripples to the dominant sea, controlled through `water.waves`.

## Physical Calibration

The simulation operates in real-world units: meters, seconds, and meters per second. `peakWavelength` sets the size of the dominant sea directly; `windSpeed` controls its height and steepness independently of size. Waves travel at their physical phase speed.

For reference, wind speeds correspond to sea states as follows:

| Wind speed (m/s) | Sea state |
| --- | --- |
| 2–4 | Calm, small ripples and wavelets |
| 5–8 | Light to gentle breeze, scattered whitecaps |
| 9–12 | Moderate to fresh breeze, regular whitecaps |
| 13–18 | Strong breeze to gale, streaked foam |
| 19–25 | Severe gale to storm, high seas |

`amplitude` and `animationSpeed` are artistic multipliers that default to `1`, which is the physically correct setting. Raise or lower them only for deliberate stylization.

## Parameter Overview

### FFT Parameters (`water.waves`)

| Parameter              | Effect                                         | Calm    | Moderate | Storm   |
| ---------------------- | ---------------------------------------------- | ------- | -------- | ------- |
| `windSpeed`            | Sea state. Drives wave height and speed (m/s), and energy at the peak wavelength | 3–5 | 6–10 | 15–25 |
| `peakWavelength`       | Dominant wave size in meters. Independent of wind speed — pick the wave size you want directly | 80–200 | 60–150 | 40–100 |
| `amplitude`            | Artistic multiplier on all wave heights (1 = physical) | 1 | 1 | 1 |
| `choppiness`           | Horizontal peak sharpness                       | 0.5     | 1.0–1.5  | >2.0 |
| `spectralSharpness`    | Multiplier on Hasselmann directional spread. `1.0` physical, >1 narrows, <1 broadens | 1.0–1.5 | 1.0      | 0.7–1.0 |
| `standingWaveRatio`    | Blend between traveling (0) and standing (1) waves | 0.3–0.5 | 0.1–0.3 | 0       |
| `animationSpeed`       | Time multiplier (1 = real-time, physical)       | 1       | 1        | 1       |

```typescript
water.waves.windSpeed.value = 8;
water.waves.peakWavelength.value = 75;
water.waves.choppiness.value = 0.8;
water.waves.standingWaveRatio.value = 0.3;
```

## How the Parameters Interact

**Peak wavelength and wind speed are independent axes.** `peakWavelength` sets how big the dominant waves are; `windSpeed` sets how much energy and steepness they carry at that size. Raising wind speed alone makes the same-size waves choppier and more energetic without growing them.

**Wind direction drives the whole sea.** `water.waves.windDirection` sets the direction the dominant waves travel toward.

**Standing wave ratio controls wave travel.** At `0`, waves propagate with the wind (standard behavior). At `1`, waves oscillate in place as standing waves. Wind directional bias only applies to the traveling portion, so the spectrum becomes more omnidirectional as `standingWaveRatio` increases. Values of `0.3–0.5` produce a natural sheltered-water look in which waves bob without sweeping in one direction.

## Recipes

### Calm Harbor

Gentle, subtle surface. Low wind and a long peak wavelength keep the sea calm without much chop.

```typescript
water.waves.windSpeed.value = 4;
water.waves.peakWavelength.value = 95;
water.waves.choppiness.value = 0.5;
water.waves.standingWaveRatio.value = 0.4;
```

### Tropical Coast

Clear, lively water with visible but non-threatening waves.

```typescript
water.waves.windSpeed.value = 6;
water.waves.peakWavelength.value = 80;
water.waves.choppiness.value = 0.8;
```

### Open Ocean

Moderate conditions with rolling swells and active surface detail.

```typescript
water.waves.windSpeed.value = 10;
water.waves.peakWavelength.value = 95;
water.waves.choppiness.value = 0.7;
```

### Storm

High energy, steep peaks, short chop.

```typescript
water.waves.windSpeed.value = 20;
water.waves.peakWavelength.value = 60;
water.waves.choppiness.value = 1.4;
```

## Tuning Tips

- **Start from a preset** and adjust from there. `water.loadPreset("sunset")` provides a known-good starting point.
- **Adjust `peakWavelength` first** to pick the size of the dominant sea, then adjust wind speed for its energy and steepness at that size.
- **`peakWavelength`** sets the dominant wave size directly. Short (tens of meters) reads as a young, choppy sea; long (hundreds of meters) reads as large, rolling swells — independent of wind speed.
- **Use the demo app** to experiment interactively, then read the final values with the "Print Settings to Console" button.
- **Animation speed is cosmetic.** It only affects the playback rate, not the wave shape. At the default of `1`, waves move at their physical speed; higher values make the sea appear more energetic without changing its form.
- **`spectralSharpness`** scales the frequency-dependent directional spread (Hasselmann 1980). At `1.0`, energy is narrowly concentrated near the wind direction at the peak frequency and naturally broadens at higher frequencies, so ripples appear nearly omnidirectional while the dominant sea tracks the wind. Values above 1 narrow the whole spectrum uniformly; values below 1 broaden it for a more chaotic look. The normalization keeps total wave energy constant as the spread changes.
- **`standingWaveRatio`** makes waves oscillate in place rather than travel. It is useful for calm harbors, lakes, and sheltered water. Wind direction only affects the traveling portion, so higher values produce a more omnidirectional surface.

## Related

- [Waves API](/api/waves): Full parameter reference.
- [Presets](/guide/presets): Ready-made configurations.

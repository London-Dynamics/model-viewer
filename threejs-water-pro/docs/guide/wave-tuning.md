# Wave Tuning

A practical guide to dialing in the ocean look you want. Three.js Water Pro has two independent wave systems that combine to produce the final surface:

- **FFT waves** — Small-to-medium frequency detail driven by wind simulation (JONSWAP spectrum)
- **Gerstner swells** — Large-scale rolling waves evaluated analytically on top of the FFT

Both are controlled through `water.waves` (FFT) and `water.gerstner` (swells).

## Parameter Overview

### FFT Parameters (`water.waves`)

| Parameter              | Effect                                         | Calm    | Moderate | Storm   |
| ---------------------- | ---------------------------------------------- | ------- | -------- | ------- |
| `windSpeed`            | Overall energy. Drives wave height and Gerstner | 5–8    | 10–15   | 25–35  |
| `amplitude`            | Global multiplier for all wave heights          | 0.25    | 0.5      | 0.65    |
| `choppiness`           | Horizontal peak sharpness                       | 0.5     | 1.0-1.5      | >2.0 |
| `spectralSharpness`    | Multiplier on Hasselmann directional spread. `1.0` physical, >1 narrows, <1 broadens | 1.0–1.5 | 1.0      | 0.7–1.0 |
| `standingWaveRatio`    | Blend between traveling (0) and standing (1) waves | 0.3–0.5 | 0.1–0.3 | 0       |
| `animationSpeed`       | Time multiplier (0 = frozen, 1 = real-time)     | 2.5     | 3.0      | 4.5     |

```typescript
water.waves.windSpeed.value = 8;
water.waves.amplitude.value = 0.4;
water.waves.choppiness.value = 0.8;
water.waves.standingWaveRatio.value = 0.3;
```

### Gerstner Parameters (`water.gerstner`)

| Parameter           | Effect                                    | Calm    | Moderate | Storm   |
| ------------------- | ----------------------------------------- | ------- | -------- | ------- |
| `wavelength`        | Distance between swell crests             | 300–400 | 150–300 | 300–500 |
| `amplitude`         | Base swell height (scaled by wind speed)  | 0.8–2.0 | 2.0–3.0 | 2.5–5.5 |
| `wavelengthSpread`  | Variation between consecutive wavelengths | 1.5–2.0 | 1.4–1.8 | 2.0–2.5 |
| `directionalSpread` | Angular spread of swell directions (rad)  | 0.6     | 0.9–1.2 | 1.2–1.5 |

```typescript
water.gerstner.wavelength = 200;
water.gerstner.amplitude = 2.0;
water.gerstner.wavelengthSpread = 1.5;
water.gerstner.directionalSpread = 0.8;
```

## How the Parameters Interact

**Gerstner amplitudes scale with wind speed.** The final swell height is:

```
effectiveAmplitude = gerstner.amplitude × (windSpeed / 10) × waves.amplitude
```

Doubling `windSpeed` from 10 to 20 doubles the Gerstner swell height. Keep this in mind when adjusting — if you raise wind speed, you may need to lower `gerstner.amplitude` to compensate.

**Choppiness has diminishing returns.** It controls Gerstner steepness via `min(choppiness × 0.5, 1.0)`. Values above 1.0 still sharpen FFT peaks but won't increase Gerstner steepness further.

**Wind direction is shared.** Both FFT waves and Gerstner swells align to `water.waves.windDirection`. Gerstner waves then spread around that direction by `directionalSpread` radians.

**Standing wave ratio controls wave travel.** At `0`, waves propagate with the wind (standard behavior). At `1`, waves oscillate in place as standing waves. Wind directional bias only applies to the traveling portion — as `standingWaveRatio` increases, the spectrum becomes more omnidirectional. Values of `0.3–0.5` give a natural sheltered-water look where waves bob without clearly sweeping in one direction.

## Recipes

### Calm Harbor

Gentle surface with slow, wide swells. Low wind keeps FFT ripples subtle.

```typescript
water.waves.windSpeed.value = 5;
water.waves.amplitude.value = 0.25;
water.waves.choppiness.value = 0.5;
water.waves.standingWaveRatio.value = 0.4;
water.waves.animationSpeed = 2.5;

water.gerstner.wavelength = 400;
water.gerstner.amplitude = 0.8;
water.gerstner.wavelengthSpread = 2.0;
water.gerstner.directionalSpread = 0.6;
```

### Tropical Coast

Clear, lively water with visible but non-threatening waves.

```typescript
water.waves.windSpeed.value = 8;
water.waves.amplitude.value = 0.43;
water.waves.choppiness.value = 0.77;
water.waves.animationSpeed = 2.8;

water.gerstner.wavelength = 156;
water.gerstner.amplitude = 2.1;
water.gerstner.wavelengthSpread = 1.6;
water.gerstner.directionalSpread = 0.9;
```

### Open Ocean

Moderate conditions with rolling swells and active surface detail.

```typescript
water.waves.windSpeed.value = 12;
water.waves.amplitude.value = 0.7;
water.waves.choppiness.value = 0.6;
water.waves.animationSpeed = 4.3;

water.gerstner.wavelength = 360;
water.gerstner.amplitude = 5.5;
water.gerstner.wavelengthSpread = 2.25;
water.gerstner.directionalSpread = 1.1;
```

### Storm

High energy, steep peaks, chaotic swell directions.

```typescript
water.waves.windSpeed.value = 35;
water.waves.amplitude.value = 0.66;
water.waves.choppiness.value = 1.4;
water.waves.animationSpeed = 4.5;

water.gerstner.wavelength = 460;
water.gerstner.amplitude = 2.9;
water.gerstner.wavelengthSpread = 2.5;
water.gerstner.directionalSpread = 1.4;
```

## Tuning Tips

- **Start from a preset** and adjust from there. `water.loadPreset("sunset")` gets you a known-good starting point.
- **Adjust wind speed first** — it has the most visible impact since it drives both FFT energy and Gerstner amplitude.
- **Use the demo app** to experiment interactively, then read the final values with the "Print Settings to Console" button.
- **Animation speed is cosmetic** — it only affects playback rate, not wave physics or appearance. Higher values make waves feel more energetic without changing their shape.
- **`spectralSharpness`** scales the frequency-dependent directional spread (Hasselmann 1980). At `1.0`, energy is narrowly concentrated near the wind direction at the peak frequency and naturally broadens at higher frequencies — so ripples look near-omnidirectional while swells track the wind. Values >1 narrow the whole spectrum uniformly; values <1 broaden it for a more chaotic look.
- **`standingWaveRatio`** makes waves oscillate in place rather than travel. Useful for calm harbors, lakes, or sheltered water. Wind direction only affects the traveling portion, so higher values produce a more omnidirectional surface.
- **Gerstner `directionalSpread`** controls swell chaos. At 0.1 rad, all swells travel the same direction (uniform rolling). At 2.0 rad, swells come from many angles (confused sea state).

## Related

- [Waves API](/api/waves) — Full parameter reference
- [Gerstner Waves](/api/gerstner) — Swell system details and formula
- [Presets](/guide/presets) — Ready-made configurations

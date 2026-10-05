# Migrating from v3.2 to v3.3

v3.3 rebuilds the wave simulation on a physically calibrated spectrum. Wave heights, speeds, and sizes are now expressed in real meters, seconds, and meters per second. Every breaking change is in the wave, fresnel, and sky parameter shapes; the rest of the API is unchanged.

Saved presets from v3.2 will load with wrong wave settings until they are updated. Plan to re-tune wave parameters visually rather than converting old values; the units changed, so old numbers do not carry over.

For the full list of changes, see the [v3.3.0 changelog](/changelog#v3-3-0-7-27-26).

## Quick Scan

| Area | What changed |
| --- | --- |
| [Wave sizing](#wave-sizing) | `cascades.waves` / `cascades.ripples` scales and `frequency` replaced by a single `cascades.maxScale`; new `peakWavelength` sets dominant wave size |
| [Wave amplitude](#wave-amplitude) | Per-band `amplitudeScale` removed; `amplitude` is a global multiplier on physical wave height |
| [Wind and animation speed](#wind-and-animation-speed) | `windSpeed` is now in meters per second; waves travel at their physical phase speed |
| [Gerstner swell](#gerstner-swell) | The `waves.gerstner` block and `water.gerstner` are removed |
| [Runtime cascade access](#runtime-cascade-access) | `water.config.cascades` is now an array; new `setMaxScale` and `setCascadeResolution` methods |
| [Fresnel](#fresnel) | `fadePower`, `fadeStart`, and `normalStrength` removed from `fresnel.surface` |
| [Sky](#sky) | `reflectionBlurDistance` and `reflectionDistanceBlur` removed; `reflectionRoughness` default raised |

## Wave Sizing

The two named cascade scales and the `frequency` multiplier are gone. The wave field is now sized by one value, `cascades.maxScale`, the tile size of the largest cascade in meters; the finer cascades derive from it. The size of the dominant waves is set directly by the new `peakWavelength` (meters, default `70`).

```typescript
// v3.2
waves: {
  fft: {
    frequency: 1.0,
    windSpeed: 20.9,
    cascades: {
      waves:   { scale: 1251, amplitudeScale: 0.34 },
      ripples: { scale: 198,  amplitudeScale: 0.12 },
    },
    // ...
  },
}

// v3.3
waves: {
  fft: {
    windSpeed: 10,        // now meters per second
    peakWavelength: 70,   // dominant wave size in meters
    cascades: {
      maxScale: 1024,     // largest tile in meters
    },
    // ...
  },
}
```

In v3.2, growing the sea meant raising wind speed until the spectrum collapsed into a few oversized waves. In v3.3, pick the wave size with `peakWavelength` and the energy with `windSpeed`; the two are independent. See the [wave tuning guide](/guide/wave-tuning) for recommended value ranges per sea state.

## Wave Amplitude

Per-band `amplitudeScale` is removed. Wave heights are physically derived from `windSpeed` and `peakWavelength`; the global `amplitude` remains as a single multiplier on the result, with `1.0` meaning physically accurate height.

```typescript
// v3.2: per-band amplitude scaling
cascades: {
  waves:   { scale: 1251, amplitudeScale: 0.34 },
  ripples: { scale: 198,  amplitudeScale: 0.12 },
}

// v3.3: one global multiplier
waves: { fft: { amplitude: 1.0 /* etc */ } }
```

If your v3.2 preset used small `amplitudeScale` values to tame the sea, delete them and lower `windSpeed` instead; that is now the physically meaningful control.

## Wind and Animation Speed

`windSpeed` is now in meters per second. Real seas range from about `3` (light chop) to `25` (storm); v3.2 values were unitless and do not convert. Re-tune from the [wave tuning guide](/guide/wave-tuning) table.

Waves also travel at their physical phase speed. If your v3.2 preset raised `animationSpeed` to make the sea feel livelier, reset it to `1.0` first and only adjust it afterward as a deliberate stylization.

## Gerstner Swell

The analytical Gerstner swell layer is removed. The spectrum now produces the full wave field, including large swells, on its own. Delete the `waves.gerstner` block from presets and any reads of `water.gerstner`; there is no replacement to configure. To emphasize long swells, raise `peakWavelength`.

```typescript
// v3.2
waves: {
  fft: { /* ... */ },
  gerstner: { wavelength: 852, amplitude: 0.84, wavelengthSpread: 3, directionalSpread: 0.8 },
}

// v3.3
waves: {
  fft: { peakWavelength: 120 /* etc */ },
}
```

## Runtime Cascade Access

`water.config.cascades` is now an array of `{ resolution, enabled }` entries ordered coarsest to finest (swell, waves, ripples), replacing the named `waves` and `ripples` fields.

```typescript
// v3.2
const res = water.config.cascades.ripples.resolution;

// v3.3
const res = water.config.cascades[2].resolution;
```

Two methods cover the runtime operations the old shape supported:

- `water.setMaxScale(meters)` resizes the wave field.
- `water.setCascadeResolution(index, resolution, params)` changes one cascade's resolution without switching quality level.

## Fresnel

`fresnel.surface.fadePower`, `fadeStart`, and `normalStrength` are removed. The distance fades and grazing reflectance they tuned are now automatic, driven by the measured wave roughness and the pixel footprint. Presets containing the removed fields still load; the values are ignored. Remove them at your convenience.

```typescript
// v3.2
fresnel: {
  surface: { fadePower: 2.0, fadeStart: 15, normalStrength: 1.0, iorRatio: 1.33, refractionStrength: 0.1 },
}

// v3.3
fresnel: {
  surface: { iorRatio: 1.33, refractionStrength: 0.1 },
}
```

## Sky

`sky.reflectionBlurDistance` and `sky.reflectionDistanceBlur` are removed from presets and from `new Sky(...)` options. Reflection blur now adapts automatically to wave roughness and viewing distance. `sky.reflectionRoughness` remains as the base blur and its default rose from `0.02` to `0.15`; set it lower for a sharper, more mirror-like sky.

```typescript
// v3.2
sky: { reflectionBlurDistance: 1500, reflectionDistanceBlur: 0.5, reflectionRoughness: 0.02 /* etc */ }

// v3.3
sky: { reflectionRoughness: 0.15 /* etc */ }
```

## After Upgrading

Once presets load cleanly, two additions are worth trying:

- The new `max` quality level, above `ultra`, renders finer wave and ripple detail.
- Wave shape is now identical across quality levels; lower levels render fewer frequency bands rather than coarser versions of all of them, so switching quality no longer changes the sea's silhouette.

Re-tune each preset visually starting from `windSpeed` and `peakWavelength`; the [wave tuning guide](/guide/wave-tuning) walks through the parameters in order.

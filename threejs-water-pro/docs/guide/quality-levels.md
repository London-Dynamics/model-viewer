# Quality Levels

Five quality levels control mesh resolution, FFT cascade count/resolution, and optional visual features. Mesh resolution is `segments` on the relevant `QUALITY_LEVELS` entry.

## Resolution Settings

| Setting                | Low   | Medium       | High                   | Ultra                  | Max                     |
| ----------------------- | ----- | ------------ | ----------------------- | ------------------------ | ------------------------- |
| Mesh Segments            | 16    | 32           | 64                       | 128                       | 128                        |
| Cascades Enabled          | Swell | Swell, Waves | Swell, Waves, Ripples   | Swell, Waves, Ripples    | Swell, Waves, Ripples      |
| Cascade Resolutions       | 256   | 256 / 256    | 256 / 256 / 256          | 256 / 256 / 512           | 512 / 512 / 512             |
| Scene Color Resolution    | 1/4x  | 1/2x         | 1/2x                     | 1x                         | 1x                          |
| Finest Wave Detail         | ~12 m | ~1.1 m       | ~10.5 cm                  | ~5.3 cm                   | ~1.3 cm                     |

Finest wave detail is the shortest resolved wavelength at the default `maxScale` of `1024` meters. Changing `maxScale` changes these values proportionally.

## Feature Availability

| Feature                  | Low | Medium | High | Ultra | Max |
| ------------------------- | --- | ------ | ---- | ----- | --- |
| Wave Displacement         | Yes | Yes    | Yes  | Yes   | Yes |
| Reflection                | Yes | Yes    | Yes  | Yes   | Yes |
| Water Color               | Yes | Yes    | Yes  | Yes   | Yes |
| Fog                       | Yes | Yes    | Yes  | Yes   | Yes |
| Sparkle                   | Yes | Yes    | Yes  | Yes   | Yes |
| Subsurface Scattering     | Yes | Yes    | Yes  | Yes   | Yes |
| Snell's-Window TIR        | Yes | Yes    | Yes  | Yes   | Yes |
| Wave Foam                 | Yes | Yes    | Yes  | Yes   | Yes |
| Surface Foam              | Yes | Yes    | Yes  | Yes   | Yes |
| Shoreline Foam            | Yes | Yes    | Yes  | Yes   | Yes |
| Screen Refraction          | -   | -      | Yes  | Yes   | Yes |
| Domain Warp Foam           | -   | -      | Yes  | Yes   | Yes |
| Screen-Space Reflections   | -   | -      | Yes  | Yes   | Yes |

## Setting Quality

### At Initialization

```typescript
const scene = new THREE.Scene();
const water = await WaterSystem.create(renderer, scene, camera, "high");
```

### At Runtime

Use `setQualityLevel()` to change quality without full disposal:

```typescript
await water.setQualityLevel("medium", params);
```

Note that this invalidates internal render pass textures, so you must rebuild your post-processing pipeline afterwards. See [Post-Processing](/guide/post-processing#rebuilding-after-quality-changes).

### Overriding a Single Cascade's Resolution

Use `setCascadeResolution()` to change one FFT cascade's resolution independently of the rest of the quality level:

```typescript
await water.setCascadeResolution(2, 512, params); // finer ripples only
```

This uses the same rebuild path as `setQualityLevel()`, so the same post-processing rebuild note applies.

## Custom Quality Levels

For advanced use cases, you can create a custom quality configuration by modifying `QUALITY_LEVELS` in `src/config/QualityLevels.ts`.

# Quality Levels

Three.js Water Pro provides four quality levels that control mesh resolution, FFT resolution, and optional visual features.

## Resolution Settings

| Setting                    | Low  | Medium | High | Ultra |
| -------------------------- | ---- | ------ | ---- | ----- |
| Mesh Segments              | 16   | 32     | 64   | 128   |
| Waves                      | 128  | 128    | 256  | 256   |
| Ripples                    | -    | 256    | 256  | 512   |
| Cascades                   | 1    | 2      | 2    | 2     |
| Scene Color Resolution     | 1/4x | 1/2x   | 1/2x | 1x    |

There are two types of resolution settings

1. The resolution of the water surface mesh
2. The resolution of the FFT

The mesh resolution sets the upper limit on the displacement detail. This can actually be set fairly low and you will still get good results since all of the lighting is calculated at the fragment level. You may need to increase mesh resolution with very large wave heights or when the camera is close to the water surface. Mesh resolution is a property of the quality level — to change it, edit the `segments` value on the relevant `QUALITY_LEVELS` entry before creating the water system, or define your own quality configuration.

The FFT resolution determines the upper limit of the wave detail. Higher FFT resolution = more detailed waves. Always use powers of 2. This setting has the biggest impact on performance.

## Optional Features

These features can be enabled or disabled based on quality level:

| Feature                  | Low | Medium | High | Ultra |
| ------------------------ | --- | ------ | ---- | ----- |
| Screen Refraction        | -   | -      | Yes  | Yes   |
| Domain Warp Foam         | -   | -      | Yes  | Yes   |
| Screen-Space Reflections | -   | -      | Yes  | Yes   |

Core rendering features (displacement, reflection, water color, fog, sparkle, sub-surface scattering, Snell's-window total internal reflection, wave foam, surface foam, shoreline foam) are always enabled at all quality levels.

## Which Level Should I Use?

- **Low**: Mobile devices or integrated GPUs. Basic ocean with a single FFT cascade.

- **Medium**: Mid-range hardware. Adds wave detail and shoreline foam.

- **High**: Dedicated GPUs. Full feature set including screen-space reflections and refraction.

- **Ultra**: High-end systems. Same features as High with higher FFT resolution for finer wave detail.

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

## Custom Quality Levels

For advanced use cases, you can create a custom quality configuration by modifying `QUALITY_LEVELS` in `src/config/QualityLevels.ts`.

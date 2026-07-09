# Custom Sky

The library ships a single `Sky` class that samples an **equirectangular image** and exposes an optional **sun disk overlay** for cases where you want to move the visible sun without re-baking the image. Several HDRIs have been provided in the demo which you are free to use in your own projects.

## Quick Start

```typescript
import * as THREE from "three/webgpu";
import { UltraHDRLoader } from "three/addons/loaders/UltraHDRLoader.js";
import { WaterSystem, Sky } from "threejs-water-pro";

const water = await WaterSystem.create(renderer, scene, camera, "high");

// Load an Adobe UltraHDR JPG (linear HDR data, no colour-space tagging needed).
const loader = new UltraHDRLoader();
const equirect = await loader.loadAsync("sky.jpg");
equirect.mapping = THREE.EquirectangularReflectionMapping;
equirect.wrapS = THREE.RepeatWrapping;
equirect.generateMipmaps = false;
equirect.minFilter = THREE.LinearFilter;
equirect.magFilter = THREE.LinearFilter;

const sky = new Sky({
  equirect,
  brightness: 1.0,
  sunDirection: water.lighting.sun.direction,
});

water.setSky(sky);
for (const mesh of sky.getMeshes()) scene.add(mesh);
```

## Texture Formats

`Sky` is loader-agnostic. Use the loader that matches your source format:

| Format               | Loader                                               | Notes                                                |
|----------------------|------------------------------------------------------|------------------------------------------------------|
| `.hdr` (RGBE)        | `RGBELoader` (`three/addons/loaders/RGBELoader.js`)  | Linear HDR. No colour-space assignment.              |
| `.exr`               | `EXRLoader` (`three/addons/loaders/EXRLoader.js`)    | Linear HDR. No colour-space assignment.              |
| Adobe UltraHDR `.jpg`| `UltraHDRLoader` (`three/addons/loaders/UltraHDRLoader.js`) | Linear HDR via embedded gain map.            |
| Plain LDR `.jpg`     | `THREE.TextureLoader`                                | Tag `texture.colorSpace = THREE.SRGBColorSpace`.     |

In every case set `texture.mapping = THREE.EquirectangularReflectionMapping`. To avoid the seam at the back of the dome (the `atan2` discontinuity at U=0/U=1), set `wrapS = RepeatWrapping`, disable mipmaps, and use `LinearFilter`.

`Sky` can also render from a cube map instead of an equirectangular image: pass `{ cubeMap }` (a `THREE.CubeTexture`) rather than `{ equirect }`. Exactly one of the two is required.

## Sun Disk Overlay

Off by default. Most HDRIs already contain a baked sun; the overlay is for cases where you want to move the sun or pin it to a particular direction.

```typescript
const sky = new Sky({
  equirect,
  sunDirection: water.lighting.sun.direction,
  sunOverlay: {
    enabled: true,
    radius: 0.005,
    color: "#fff8e0",
    emissiveColor: "#fff8e0",
    emissiveIntensity: 5,
  },
});
```

The overlay reads its direction from the same uniform that drives the directional light and sparkle — moving the sun via `lighting.sun.update({ azimuth, elevation, ... })` updates everything in lockstep. The disk shader is gated by a TSL `If()` block, so toggling `enabled` off skips the dot/smoothstep work at the fragment level.

## Reflections

Three `Sky` options tune the reflection blur:

| Option                   | Default  | Range       | Controls                                                                                                        |
|--------------------------|----------|-------------|-----------------------------------------------------------------------------------------------------------------|
| `reflectionRoughness`    | `0.02`   | `0`–`1`     | Base blur applied everywhere. `0` is a sharp mirror; small values soften a razor-sharp baked sun disc.          |
| `reflectionDistanceBlur` | `0.5`    | `0`–`1`     | How much the blur grows with distance from the camera. `0` keeps far water as sharp as the near field.          |
| `reflectionBlurDistance` | `1500`   | world units | Distance at which `reflectionDistanceBlur` reaches its maximum. Scale to match your scene's water extent.       |

```typescript
const sky = new Sky({
  equirect,
  sunDirection: water.lighting.sun.direction,
  reflectionRoughness: 0.02,
  reflectionDistanceBlur: 0.5,
  reflectionBlurDistance: 1500,
});
```

All three are also live uniforms — `sky.reflectionRoughnessUniform.value`, `sky.reflectionDistanceBlurUniform.value`, and `sky.reflectionBlurDistanceUniform.value` — so you can adjust them at runtime without rebuilding the material.

## Swapping Textures at Runtime

```typescript
const next = await loader.loadAsync("other-sky.jpg");
next.mapping = THREE.EquirectangularReflectionMapping;
// (apply the seam-fix settings as above)
sky.setTexture(next, renderer);
```

`setTexture` copies the new image onto the existing source in place and re-prefilters the reflection environment from it — a one-time cost per swap — so the dome, fog, and reflections all pick up the new texture without a shader rebuild. (`water.setSky(sky)` handles this prefilter for you when you first attach a sky.)

## Ambient Lighting

Ambient (the `HemisphereLight` fill on shaded sides) is **not** derived from the sky image. Set the colours and intensity directly on preset params — `lighting.ambient.skyColor`, `lighting.ambient.groundColor`, `lighting.ambient.intensity` — or write to `water.lighting.ambient` at runtime. See [Sun & Lighting](/api/sun).

## Migration

`RayleighSky`, `GradientSky`, `CubeMapSky`, and the `SkyProvider` interface were removed in v3. Bake whatever you need into an equirect image and use `Sky`. See the [v2 migration guide](/guide/migrating-from-v2#sky-providers).

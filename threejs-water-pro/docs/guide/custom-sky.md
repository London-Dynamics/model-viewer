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

const sky = new Sky(renderer, {
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
const sky = new Sky(renderer, {
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

The overlay reads its direction from the same uniform that drives the directional light and sparkle, so moving the sun via `lighting.sun.update({ azimuth, elevation, ... })` updates everything together. Disabling the overlay removes its shading cost.

## Reflections

The reflection blur is driven by the surface itself: the water material measures how much wave detail each pixel folds away and reads a correspondingly rougher prefiltered environment mip, so distant and wind-roughened water blurs the sky reflection automatically. One `Sky` option sets the floor:

| Option                | Default | Range   | Controls                                                                                               |
|-----------------------|---------|---------|--------------------------------------------------------------------------------------------------------|
| `reflectionRoughness` | `0.15`  | `0`–`1` | Base blur applied everywhere. `0` is a sharp mirror; small values soften a razor-sharp baked sun disc. |

```typescript
const sky = new Sky(renderer, {
  equirect,
  sunDirection: water.lighting.sun.direction,
  reflectionRoughness: 0.15,
});
```

It is also exposed as a live uniform (`sky.reflectionRoughnessUniform.value`), so you can adjust it at runtime without rebuilding the material.

## Swapping Textures at Runtime

```typescript
const next = await loader.loadAsync("other-sky.jpg");
next.mapping = THREE.EquirectangularReflectionMapping;
// Apply the same seam-fix settings as in Quick Start.
sky.setTexture(next, renderer);
```

`setTexture` copies the new image onto the existing source in place and re-prefilters the reflection environment from it, which is a one-time cost per swap. The dome, fog, and reflections all pick up the new texture without a shader rebuild. `water.setSky(sky)` performs the same prefilter when you first attach a sky.

## Ambient Lighting

Ambient lighting is derived from the sky image: the water system assigns the sky's prefiltered environment to `scene.environment`, and `water.environment.intensity` scales it. See [Sun & Lighting](/api/sun).

## Migration

`RayleighSky`, `GradientSky`, and `CubeMapSky` were removed in v3. Bake whatever you need into an equirect image and use `Sky`. See the [v2 migration guide](/guide/migrating-from-v2#sky-providers). For a procedural sky, use [Sky Pro](/guide/sky-pro-integration), which plugs in through the `SkyProvider` interface.

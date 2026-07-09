# Migrating from v2 to v3

v3 introduces several breaking changes alongside new features. This guide walks each rename, removal, and semantics change with concrete before/after code so you can upgrade a working v2 project in one pass.

Most projects will only need to touch a handful of lines — the changes are localised to lighting access, a few parameter renames, and the underwater config shape.

For the full list of new features, behaviour changes, and bug fixes, see the [v3.0.0 changelog](/changelog#_3-0-0).

## Quick Scan

If you just want to know what to grep for in your code, here is the full list. Each item links to a section below.

| Area | What changed |
| --- | --- |
| [Lighting](#lighting) | `water.sun` / `water.sunLight` / `water.hemisphereLight` moved under `water.lighting` |
| [Wave simulation](#wave-simulation) | `directionalSpreading` replaced by `spectralSharpness` |
| [Foam](#foam) | `foam.waves.windBias` removed; `foam.*.texture` is now a bundled foam name, not a filename |
| [Fresnel](#fresnel) | `power` replaced by `iorRatio` |
| [Color](#color) | Physical Beer-Lambert; `shallowWaterColor`, `deepWaterColor`, `depthFalloff`, `absorptionRate`, `alpha` replaced by `waterColor` + `absorptionColor` |
| [Underwater](#underwater) | Surface glow effect removed; fog now reads `color.waterColor` and `color.absorptionColor` (no separate `fogColor` / `fogDensity` / `fogPower`) |
| [Sky](#sky-providers) | Procedural sky stack (`RayleighSky` / `GradientSky` / `CubeMapSky` / `SkyProvider`) removed → single `Sky` class; `setEnvironmentMap` → `setSky` |
| [Wake](#wake) | Wake-foam API removed (`foam.wake`, `Wake`, `WakeCompute`, …) → `water.wake.addGenerator()` |
| [Rendering](#rendering) | `water.createPostProcessingNode()` → `water.postProcessing.buildNode()`; dynamic-object API removed |
| [Debug](#debug-api-removed) | `water.debug` visualization API removed (no replacement) |
| [Exports](#renamed-exports) | `DepthPass` → `SceneDepthPass`; `Particles` → `UnderwaterParticles` |

## Lighting

`water.sun` (sun-direction / intensity uniforms) moved under a new `water.lighting` subsystem. Mechanical rename, no value changes.

```typescript
// v2
water.sun.direction.value.set(0.3, 0.6, 0.5).normalize();
water.sun.intensity.value = 2.0;

// v3
water.lighting.sun.direction.value.set(0.3, 0.6, 0.5).normalize();
water.lighting.sun.intensity.value = 2.0;
```

While you're there, v3 adds two new lighting handles that weren't in v2: `water.lighting.sunLight` (the `THREE.DirectionalLight` driving the scene; toggle `castShadow` and tune the shadow camera) and `water.lighting.hemisphereLight` (scene-wide ambient fill whose colours and intensity follow `preset.lighting.ambient`). Neither is a migration concern — they're new APIs you may want to take advantage of. See [Sun & Lighting](/api/sun) for the full surface.

## Wave Simulation

`waves.fft.directionalSpreading` is gone. Use `waves.fft.spectralSharpness` (default `1.0`).

```typescript
// v2
waves: { fft: { directionalSpreading: 4.0 /* etc */ } }

// v3
waves: { fft: { spectralSharpness: 1.0 /* etc */ } }
```

**Existing values do not map directly.** `directionalSpreading` was a constant exponent; `spectralSharpness` is a multiplier on a frequency-dependent spread curve grounded in the Hasselmann directional spread model. Treat this as a re-tuning, not a rename — start from `1.0` and adjust visually.

| Old `directionalSpreading` | Suggested starting `spectralSharpness` |
| --- | --- |
| `<= 2.0` (broad) | `0.5` |
| `~4.0` (default-ish) | `1.0` |
| `>= 8.0` (narrow) | `2.0` |

## Foam

`foam.waves.windBias` was removed. The leading-edge gating it controlled is now handled by the new persistent-foam buffer on WebGPU, and by internal defaults on WebGL.

```typescript
// v2
foam: { waves: { windBias: 0.7 /* etc */ } }

// v3 — drop windBias; tune persistence.windwardStrength if you want
// the equivalent control (WebGPU only).
foam: {
  waves: {
    /* ... */
    persistence: { windwardStrength: 0.7 /* etc */ },
  },
}
```

Two notes:

- **On WebGL, there is no direct replacement.** The library uses internal defaults — drop `windBias` and the leading-edge look stays reasonable, with no further tuning needed.
- **On WebGPU, `persistence.windwardStrength` covers the same intent** as the old `windBias` but operates on the persistent foam accumulation, so the numerical scale is different. Start at the preset's default and adjust visually rather than copying your old `windBias` value across.

### Bundled Foam Textures

The four foam textures (`foam1.jpg`–`foam4.jpg`) are now bundled with the library. Presets reference them by name, not by filename, and you no longer need to copy the JPGs into your app's public folder.

```typescript
// v2 — filename, you had to host the JPG yourself
foam: {
  surface: { texture: "foam2.jpg" /* etc */ },
  waves:   { texture: "foam3.jpg" /* etc */ },
  // ...
}

// v3 — bundled name; library resolves and loads it
foam: {
  surface: { texture: "foam2" /* etc */ },
  waves:   { texture: "foam3" /* etc */ },
  // ...
}
```

To use your own foam image, assign a `THREE.Texture` to the relevant shader class after preset load:

```typescript
water.foam.surface.foamTexture = myCustomTexture;
```

## Fresnel

`water.fresnel.power` is replaced by `water.fresnel.iorRatio` (refractive index of water relative to air, default `1.33`).

```typescript
// v2
water.fresnel.power = 5.0;
// preset:
fresnel: { surface: { power: 5.0 /* etc */ } }

// v3
water.fresnel.iorRatio = 1.33;
// preset:
fresnel: { surface: { iorRatio: 1.33 /* etc */ } }
```

This is a physics change, not a rename. `power` was an arbitrary exponent fitted to a Fresnel-like curve; `iorRatio` drives the same curve from real optical physics. Higher `iorRatio` shrinks Snell's window and raises grazing reflectance. Start from `1.33` (real seawater) and adjust if you want a stylised look.

## Color

The water color model is now physically based. The depth-dependent look falls out of per-channel Beer-Lambert absorption against a single intrinsic water color rather than a shallow→deep color blend. The old `color.shallowWaterColor`, `color.deepWaterColor`, `color.depthFalloff`, the scalar `color.absorptionRate`, and `color.alpha` are gone. Replace them with two fields:

```typescript
// v2
color: {
  shallowWaterColor: "#3a9bbf",
  deepWaterColor:    "#003366",
  depthFalloff:      0.25,
  absorptionRate:    0.02,
  alpha:             0.85,
}

// v3
color: {
  waterColor:       "#003366", // copy your old deepWaterColor here
  absorptionColor:  "#0a0503", // per-channel extinction (1/m), as hex
}
```

`absorptionColor` is the per-channel coefficient that turns clear ocean blue-green with depth. Each RGB byte is its own extinction rate — for example `#0a0503` ≈ R=0.04, G=0.02, B=0.01 per metre, which is roughly clear ocean. Larger values uniformly = murkier water. Tinted values let one channel pass farther (e.g. a redder absorption keeps blue light at depth).

Transparency is now driven entirely by absorption. If your v2 project lowered `alpha` to see boats and terrain through the surface, drop the knob and lower `absorptionColor` instead — thin water naturally fades toward transparent because the dielectric Fresnel + absorption already produce that. If you used `alpha < 1` for a stylised translucent look everywhere, the closest v3 equivalent is a lower (more transparent) `absorptionColor`.

## Underwater

Two changes.

### Surface Glow Effect Removed

The bright Snell's window halo now comes entirely from the corrected refraction sampling, so the bolt-on glow is gone:

- Delete any reads/writes of `water.underwaterSurfaceGlow`.
- Drop `oceanFloor.surfaceGlow` from custom preset objects.
- Drop the `underwaterTIR` entry from any quality-feature override.

No replacement is needed — the visible effect is now driven by the unified Fresnel curve and is on by default.

### Fog Inherits from the Surface Water Color

Underwater fog no longer has its own `fogColor`, `fogDensity`, or `fogPower` fields. It reads `color.waterColor` and `color.absorptionColor` directly, so above- and below-water rendering use the same per-channel Beer-Lambert attenuation:

```typescript
// v2 — custom underwater config (with v2 field names)
postProcessing: {
  underwater: {
    enabled: true,
    fogDensity: 0.04,
    distortionEnabled: true,
    distortionIntensity: 0.02,
    distortionScale: 3.0,
    distortionSpeed: 0.5,
  },
}

// v3 — fog params removed; appearance is driven by color.{waterColor, absorptionColor}
postProcessing: {
  underwater: {
    enabled: true,
    distortionEnabled: true,
    distortionIntensity: 0.02,
    distortionScale: 3.0,
    distortionSpeed: 0.5,
  },
}
```

Pick `color.waterColor` so it reads correctly *both* looking at the water from above and looking through it from below — that single value is now the in-scatter color on both sides of the waterline. To tune how quickly things disappear with distance underwater, raise `color.absorptionColor` (per-channel extinction in 1/world-unit); lower it for clearer water.

v3 also adds `water.underwater.tintColor` (default `#ffffff`): a multiplicative color grade applied over the entire underwater view. It has no v2 equivalent — use it when you want to shift the overall hue without touching the physical absorption parameters.

## Sky Providers

**v3 removed the procedural sky stack entirely.** `RayleighSky`, `GradientSky`, `CubeMapSky`, and the `SkyProvider` interface no longer exist. The library ships a single `Sky` class that samples an equirectangular HDRI (with an optional sun disk overlay). Bake whatever look you previously got from the procedural / gradient skies into an equirect image.

```typescript
// v2
const sky = new RayleighSky(preset.sky);

// v3
import * as THREE from "three/webgpu";
import { UltraHDRLoader } from "three/addons/loaders/UltraHDRLoader.js";
import { Sky } from "threejs-water-pro";

const loader = new UltraHDRLoader();
const equirect = await loader.loadAsync("sky.jpg");
equirect.mapping = THREE.EquirectangularReflectionMapping;
equirect.wrapS = THREE.RepeatWrapping;
equirect.generateMipmaps = false;
equirect.minFilter = THREE.LinearFilter;
equirect.magFilter = THREE.LinearFilter;

const sky = new Sky({
  equirect,
  sunDirection: water.lighting.sun.direction,
});
```

`water.setSky(sky)` still takes the result. `setEnvironmentMap` is gone — pass the cubemap-baked-as-equirect through `Sky` instead.

Preset shape moved at the same time:
- `preset.sky.atmosphere`, `preset.sky.clouds`, and `preset.sky.ambient` are gone.
- Ambient now lives at `preset.lighting.ambient` (`skyColor`, `groundColor`, `intensity`).
- The visible sun disk moved to `preset.sky.sun.diskEnabled` (off by default).
- Optional `preset.sky.source = { type: "hdri", url }` lets a preset specify a default HDRI for the demo/app to load.

## Wake

The old wake-foam API is gone. Wake foam is now automatic on breaking crests (WebGPU). Remove any references to `foam.wake`, `WakeSystem.applyParams`, `WaterSurfaceMaterial.setWakeSystem`, and the removed exports `Wake`, `WakeCompute`, `MAX_WAKE_GENERATORS`, `WAKE_DEFAULTS`, and `WakeParams`. Register wake-generating objects with `water.wake.addGenerator()` instead.

```typescript
// v2 — manual wake-foam config in the preset
foam: { wake: { /* ... */ } }

// v3 — register a generator; foam is automatic
const id = water.wake.addGenerator(shipModel, { radius: 6, depth: 1.5 });
```

See the [Wake API](/api/wake) for generator options.

## Rendering

`water.createPostProcessingNode()` moved under the new `water.postProcessing` subsystem. Same signature, same return value:

```typescript
// v2
outputNode = water.createPostProcessingNode(scenePass, outputNode);

// v3
outputNode = water.postProcessing.buildNode(scenePass, outputNode);
```

The dynamic-object API was removed: `water.rendering.addDynamicObject()`, `water.rendering.removeDynamicObject()`, `water.rendering.getDynamicObjects()`, and `WaterSystem.DYNAMIC_MESH_LAYER` no longer exist. Marking a floating object as "dynamic" no longer changes how the water renders, so delete any of these calls. One visible difference: shoreline foam now appears around floating objects (boats, buoys) the same as anywhere else, where v2 suppressed it under registered dynamic objects.

## Debug API Removed

`water.debug` and the `Debug` class are gone, along with `DebugVisualizationMode`, `DEBUG_MODE_NAMES`, and the `DebugParams` / `DebugConfig` types. The API only ever exposed inert knobs (a single-state `visualizationMode` and a no-op displacement scale), so delete any references — there is no replacement.

## Renamed Exports

A couple of low-level exports were renamed. Update your imports if you reference them directly:

| v2 | v3 |
| --- | --- |
| `DepthPass` | `SceneDepthPass` |
| `Particles` | `UnderwaterParticles` |

## After Upgrading

Once the breaking changes are addressed, run through the [v3.0.0 changelog](/changelog#_3-0-0) for the new features and tuning knobs (persistent wave-crest foam, sea spray emitters, rain, local Fresnel transparency, `lighting.ambient`, etc.). Most are opt-in and your existing scene will look better even if you change nothing else.

# Presets

Three.js Water Pro includes 8 ready-to-use environment presets that configure the entire system for different ocean conditions and moods.

## Available Presets

| Preset         | Characteristics                                      |
| -------------- | ---------------------------------------------------- |
| `arctic`       | Cold blue-gray waters with stormy conditions         |
| `blackFlag`    | Teal-tinted high seas with dense foam under blue sky |
| `dusk`         | Calm twilight swells beneath a low golden-pink sun   |
| `foggy`        | Misty conditions with reduced visibility             |
| `moonlit`      | Nighttime scene with moonlight reflections           |
| `seaOfThieves` | Stylized rolling swells with dramatic foam           |
| `storm`        | Violent waves, dark dramatic skies                   |
| `sunset`       | Golden hour lighting, warm colors                    |

## Using Presets

### After Initialization

```typescript
const scene = new THREE.Scene();
const water = await WaterSystem.create(renderer, scene, camera);
water.loadPreset("sunset");
```

### Switching at Runtime

```typescript
water.loadPreset("storm");
```

::: info
Presets configure water parameters only (waves, foam, color, etc.). They do not affect the sky. Set up your sky separately via `water.setSky()`.
:::

## Creating Custom Presets

The easiest way to create a custom preset:

1. Run the demo app (`npm run dev`) and adjust parameters to your liking
2. Click the **Print Settings to Console** button
3. Copy the JSON output and use it as a `WaterPresetConfig` object:

```typescript
import type { WaterPresetConfig } from "threejs-water-pro";

const myPreset: WaterPresetConfig = { /* paste JSON here */ };
water.loadPreset(myPreset);
```

Alternatively, copy one of the existing preset files in `src/config/presets` and modify it directly.

## Preset Types and Normalization

`WaterPreset`, `WaterPresetConfig`, and `WaterSceneConfig` are equivalent exported names for the complete preset shape. `WaterPresetConfig` is the clearest choice for application-authored presets passed to `water.loadPreset()`.

Use `normalizeWaterSceneConfig()` when persisted preset data should be cloned with an explicit physical or custom color mode:

```typescript
import {
  normalizeWaterSceneConfig,
  type WaterPresetConfig,
} from "threejs-water-pro";

const preset: WaterPresetConfig = loadSavedPreset();
const normalizedPreset = normalizeWaterSceneConfig(preset);
```

The normalizer checks the color block and returns a deep clone; it does not perform runtime validation of every non-color preset field.

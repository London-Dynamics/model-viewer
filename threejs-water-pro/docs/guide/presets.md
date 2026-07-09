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
3. Copy the JSON output and use it as a `WaterPreset` object:

```typescript
import type { WaterPreset } from "threejs-water-pro";

const myPreset: WaterPreset = { /* paste JSON here */ };
water.loadPreset(myPreset);
```

Alternatively, copy one of the existing preset files in `src/config/presets` and modify it directly.

# Foam

All foam is grouped under `water.foam` with three sub-groups:

1. `surface` — ambient foam that does not change over time.
2. `waves` — dynamic foam that gathers on the forward edges of waves, collects on the crests, and falls off the back.
3. `shoreline` — depth-based foam that appears on shorelines and water-object interactions.

Foam around moving objects is owned by the wake system and shades through the same crest-foam pipeline — see [`water.wake`](/api/wake).

## Foam textures

The library bundles four tileable foam textures named `"foam1"`, `"foam2"`, `"foam3"`, and `"foam4"`. Presets reference them by name through the `texture` field on each foam slice (`foam.surface.texture`, `foam.waves.texture`, `foam.shoreline.texture`). The matching JPGs are emitted into the consumer's build output automatically — there's no separate asset-copy step.

To use your own foam image at runtime, assign a `THREE.Texture` to the `foamTexture` setter on the appropriate shader class (e.g. `water.foam.surface.foamTexture = myTexture`). Custom assignments override the bundled texture until the next preset load.

## `water.foam.surface`

Simple texture-based foam across the entire surface.

| Property      | Type            | Default   | Description                  |
| ------------- | --------------- | --------- | ---------------------------- |
| `color`       | `THREE.Color`   | `#ffffff` | Foam tint color              |
| `coverage`    | `number`        | `0.5`     | How much foam is visible (0–1) |
| `enabled`     | `boolean`       | `true`    | Enable/disable surface foam  |
| `foamTexture` | `THREE.Texture` | (default) | Tileable foam texture        |
| `opacity`     | `number`        | `0.5`     | Master opacity (0–1)         |
| `size`        | `number`        | `100.0`   | Texture size in world units  |

## `water.foam.waves`

Foam on wave crests using Jacobian wave-breaking detection.

On WebGPU, the persistent buffer drives foam through a dissolve mask: the buffer value is compared against the foam texture as a threshold, so as energy decays foam patches break up via the bubble pattern instead of fading uniformly.

| Property        | Type            | Default   | Description                                                                          |
| --------------- | --------------- | --------- | ------------------------------------------------------------------------------------ |
| `color`         | `THREE.Color`   | `#ffffff` | Foam tint color                                                                      |
| `coverage`      | `number`        | `0.5`     | How much foam is visible (0–1)                                                       |
| `crestCoverage` | `number`        | `0.5`     | How much foam appears on wave crests (0–1)                                           |
| `enabled`       | `boolean`       | `true`    | Enable/disable wave-crest foam                                                       |
| `foamTexture`   | `THREE.Texture` | (default) | Tileable foam texture                                                                |
| `opacity`       | `number`        | `0.5`     | Master opacity (0–1)                                                                 |
| `peakIntensity` | `number`        | `1.0`     | Caps maximum foam intensity (0–1). Thins dense crests without affecting subtler foam |
| `rippleWeight`  | `number`        | `1.0`     | Ripple cascade contribution to foam (0–1)                                            |
| `size`          | `number`        | `100.0`   | Texture size in world units                                                          |
| `waveWeight`    | `number`        | `1.0`     | Wave cascade contribution to foam (0–1)                                              |
| `windStretch`   | `number`        | `0.5`     | Stretches foam in wind direction for streaky whitecaps (0–0.8)                       |

### Persistent wave-crest foam

Persistent wave-crest foam accumulation. Each breaking event injects energy into a GPU buffer that decays exponentially, producing foam streaks and tails. Requires the WebGPU backend; on WebGL and at the `low` / `medium` quality levels a stateless fallback path is used and these parameters have no effect.

In a preset these fields live under `foam.waves.persistence`. At runtime they are read and written on [`water.foamAccumulation`](/api/water-system#properties) — e.g. `water.foamAccumulation.crestStrength = 3.0` — which is `null` on the WebGL backend.

| Property           | Type     | Default | Description                                                                                                                                                  |
| ------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crestStrength`    | `number` | `2.5`   | Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. Should exceed 1.0 to push fresh-crest foam to solid white through the dissolve mask |
| `decayTime`        | `number` | `0.5`   | Exponential e-folding time in seconds (clamped at 0.05). Longer values keep foam visible for longer after breaking                                            |
| `windwardStrength` | `number` | `1.5`   | Windward-face foam strength. Equilibrium energy on a fully wind-facing pixel. Drives foam onto the rising face; persistence carries it past the crest         |

## `water.foam.shoreline`

Depth-based foam near objects and terrain.

| Property      | Type            | Default   | Description                     |
| ------------- | --------------- | --------- | ------------------------------- |
| `color`       | `THREE.Color`   | `#ffffff` | Foam color                      |
| `coverage`    | `number`        | `0.5`     | How much foam is visible (0–1)  |
| `enabled`     | `boolean`       | `true`    | Enable/disable shoreline foam   |
| `foamTexture` | `THREE.Texture` | (default) | Tileable foam texture           |
| `opacity`     | `number`        | `0.5`     | Master opacity (0–1)            |
| `range`       | `number`        | `50.0`    | How far foam extends from shore |
| `size`        | `number`        | `50.0`    | Texture size in world units     |

## Example

```typescript
// Heavier shoreline foam, calmer surface foam
water.foam.surface.coverage = 0.3;
water.foam.waves.crestCoverage = 0.7;
water.foam.shoreline.coverage = 0.8;
water.foam.shoreline.range = 80;
```

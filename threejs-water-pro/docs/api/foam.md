# Foam

All foam is grouped under `water.foam` with three sub-groups:

1. `surface`: Ambient foam that does not change over time.
2. `waves`: Dynamic foam that gathers on the forward edges of waves, collects on the crests, and falls off the back.
3. `shoreline`: Depth-based foam that appears on shorelines and water-object interactions.

Foam around moving objects is owned by the wake system and shades through the same crest-foam pipeline. See [`water.wake`](/api/wake).

## Foam textures

The library bundles four tileable foam textures named `"foam1"`, `"foam2"`, `"foam3"`, and `"foam4"`. Presets reference them by name through the `texture` field on each foam slice (`foam.surface.texture`, `foam.waves.texture`, `foam.shoreline.texture`). The matching JPGs are emitted into the consumer's build output automatically; there is no separate asset-copy step.

To switch to a different bundled texture by name at runtime, call `loadTexture(name)` on the appropriate shader class (e.g. `water.foam.waves.loadTexture("foam3")`). This changes only the texture and leaves every other foam setting untouched.

To use your own foam image instead, assign a `THREE.Texture` to the `foamTexture` setter on the appropriate shader class (e.g. `water.foam.surface.foamTexture = myTexture`). Custom assignments override the bundled texture until the next preset load.

## `water.foam.surface`

Simple texture-based foam across the entire surface.

| Property      | Type            | Default   | Description                  |
| ------------- | --------------- | --------- | ---------------------------- |
| `color`       | `THREE.Color`   | `#ffffff` | Foam tint color              |
| `coverage`    | `number`        | `0.5`     | How much foam is visible (0–1) |
| `enabled`     | `boolean`       | `true`    | Enable/disable surface foam  |
| `foamTexture` | `THREE.Texture` | (default) | Tileable foam texture        |
| `opacity`     | `number`        | `0.5`     | Master opacity (0–1)         |
| `size`        | `number`        | `20.0`    | Texture size in world units  |

## `water.foam.waves`

Foam on wave crests, also known as whitecaps.

| Property      | Type            | Default   | Description                                                    |
| ------------- | --------------- | --------- | ------------------------------------------------------------- |
| `color`       | `THREE.Color`   | `#ffffff` | Foam tint color                                               |
| `enabled`     | `boolean`       | `true`    | Enable/disable wave-crest foam                                |
| `foamTexture` | `THREE.Texture` | (default) | Tileable foam texture                                         |
| `opacity`     | `number`        | `0.5`     | Master opacity (0–1)                                          |
| `size`        | `number`        | `12.0`    | Texture size in world units                                   |
| `windStretch` | `number`        | `0.5`     | Stretches foam in wind direction for streaky whitecaps (0–1) |

### `water.foam.waves.persistence`

How strongly breaking crests and wind-facing faces inject foam energy, and how long it lingers. The runtime path matches the preset path `foam.waves.persistence`, e.g. `water.foam.waves.persistence.crestStrength = 3.0`.

| Property           | Type     | Default | Description                                                                                                                                                  |
| ------------------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `crestStrength`    | `number` | `2.5`   | Crest-driven foam strength. Equilibrium energy at a sustained sharp fold. Should exceed 1.0 to push fresh-crest foam to solid white through the dissolve mask |
| `decayTime`        | `number` | `0.5`   | Exponential e-folding time in seconds (clamped at 0.05). Longer values keep foam visible for longer after breaking                                            |
| `windwardStrength` | `number` | `1.5`   | Windward-face foam strength. Equilibrium energy on a fully wind-facing pixel. Drives foam onto the rising face; persistence carries it past the crest         |

The energy is carried in a camera-anchored field whose size and resolution are fixed by the active quality level (256 / 512 / 1024 / 2048 texels per side for low / medium / high / ultra); these are not runtime-tunable.

## `water.foam.shoreline`

Depth-based foam near objects and terrain.

| Property      | Type            | Default   | Description                     |
| ------------- | --------------- | --------- | ------------------------------- |
| `color`       | `THREE.Color`   | `#ffffff` | Foam color                      |
| `coverage`    | `number`        | `0.5`     | How much foam is visible (0–1)  |
| `enabled`     | `boolean`       | `true`    | Enable/disable shoreline foam   |
| `foamTexture` | `THREE.Texture` | (default) | Tileable foam texture           |
| `opacity`     | `number`        | `0.5`     | Master opacity (0–1)            |
| `range`       | `number`        | `2.0`     | Water depth in meters over which foam fades from shore |
| `size`        | `number`        | `10.0`    | Texture size in world units     |

## Example

```typescript
// Heavier shoreline foam, calmer surface foam, longer-lasting wave-crest foam
water.foam.surface.coverage = 0.3;
water.foam.shoreline.coverage = 0.8;
water.foam.shoreline.range = 3;
water.foam.waves.persistence.decayTime = 1.5;
```

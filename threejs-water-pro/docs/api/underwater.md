# Underwater Fog & Distortion

Post-processing effects applied when the camera is below the water surface: per-channel Beer-Lambert fog matching the above-water surface composite, and a noise-based UV distortion that warps the underwater scene.

Underwater fog reads the active physical or custom [`water.color`](/api/color) model directly, so surface transmission and underwater attenuation stay continuous across the waterline.

Caustics on the ocean floor are configured separately on [`water.floor.caustics`](/api/ocean-floor#caustics).

## `water.underwater`

| Property    | Type                  | Default     | Description                                                                                |
| ----------- | --------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `enabled`   | `boolean`             | `true`      | Enable/disable underwater effects                                                          |
| `tintColor` | `THREE.Color \| string` | `#ffffff`   | Multiplicative color grade applied over the entire underwater view. White applies no tint. |

## `water.underwaterDistortion`

| Property    | Type      | Default | Description                          |
| ----------- | --------- | ------- | ------------------------------------ |
| `enabled`   | `boolean` | `true`  | Enable/disable underwater distortion |
| `intensity` | `number`  | `0.02`  | UV offset strength                   |
| `scale`     | `number`  | `3.0`   | Noise frequency                      |
| `speed`     | `number`  | `0.5`   | Animation speed                      |

### Methods

#### `update`

```typescript
update(params: UnderwaterConfig): void
```

Sets all distortion properties in a single call, typically from a preset.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `UnderwaterConfig` | The distortion values to apply: `distortionEnabled`, `distortionIntensity`, `distortionScale`, and `distortionSpeed`. |

## Example

```typescript
water.underwaterDistortion.enabled = true;
water.underwaterDistortion.intensity = 0.02;
water.underwaterDistortion.speed = 0.5;
water.underwaterDistortion.scale = 3.0;
```

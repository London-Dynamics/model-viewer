# Underwater Fog & Distortion

Post-processing effects applied when the camera is below the water surface: per-channel Beer-Lambert fog matching the above-water surface composite, and a noise-based UV distortion that warps the underwater scene.

Underwater fog reads `color.waterColor` (intrinsic in-scatter color) and `color.absorptionColor` (per-channel extinction, 1/world-unit) directly from the surface — see [Color](/api/color) — so above- and below-water rendering use one Beer-Lambert curve and the waterline transition is seamless. To darken or murk up underwater, raise `color.absorptionColor`; to clear it up, lower it.

Caustics on the ocean floor are configured separately on [`water.floor.caustics`](/api/ocean-floor#caustics).

## `water.underwater`

| Property    | Type      | Default     | Description                                                                                     |
| ----------- | --------- | ----------- | ----------------------------------------------------------------------------------------------- |
| `enabled`   | `boolean` | `true`      | Enable/disable underwater effects                                                               |
| `tintColor` | `Color`   | `#ffffff`   | Multiplicative color grade applied over the entire underwater view. White = no tint. |

## `water.underwaterDistortion`

| Property    | Type      | Default | Description                          |
| ----------- | --------- | ------- | ------------------------------------ |
| `enabled`   | `boolean` | `true`  | Enable/disable underwater distortion |
| `intensity` | `number`  | `0.02`  | UV offset strength                   |
| `scale`     | `number`  | `3.0`   | Noise frequency                      |
| `speed`     | `number`  | `0.5`   | Animation speed                      |

## Example

```typescript
water.underwaterDistortion.enabled = true;
water.underwaterDistortion.intensity = 0.02;
water.underwaterDistortion.speed = 0.5;
water.underwaterDistortion.scale = 3.0;
```

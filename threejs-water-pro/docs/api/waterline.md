# Waterline

Meniscus effect at the camera clip plane boundary. Tilts the surface normal toward the camera and adds a rim highlight where the water surface meets the camera's near-clip transition.

Access via `water.waterline`.

## Properties

| Property             | Type      | Default | Description                                                    |
| -------------------- | --------- | ------- | ------------------------------------------------------------- |
| `enabled`            | `boolean` | `true`  | Enable/disable the meniscus effect                            |
| `highlightSharpness` | `number`  | `3.0`   | Rim highlight falloff power (higher = sharper edge)            |
| `highlightStrength`  | `number`  | `0.8`   | Rim highlight intensity at the waterline                       |
| `normalStrength`     | `number`  | `0.7`   | How much surface normal tilts toward camera at waterline (0–1) |
| `smoothness`         | `number`  | `0.3`   | Edge fade width (0 = hard edge, higher = softer)              |
| `thickness`          | `number`  | `0.5`   | Half-width of the effect in world units (meters)              |

## Methods

### `update`

```typescript
update(params: WaterlineParams): void
```

Sets `highlightSharpness`, `highlightStrength`, `normalStrength`, `smoothness`, and `thickness` in a single call, typically from a preset. `update` does not change `enabled`.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `WaterlineParams` | The meniscus values to apply. `enabled` is not part of `WaterlineParams`. |

## Example

```typescript
water.waterline.enabled = true;
water.waterline.thickness = 0.8; // wider meniscus band
water.waterline.highlightStrength = 1.0;
```

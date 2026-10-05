# Sun Shafts

Underwater sun shafts (god rays) using procedural projection. Shafts fade out as the sun approaches the horizon and are not visible when the sun is behind the camera.

Access via `water.sunShafts`.

## Properties

| Property    | Type      | Default | Description                                           |
| ----------- | --------- | ------- | ----------------------------------------------------- |
| `enabled`   | `boolean` | `true`  | Enable/disable sun shafts                             |
| `fadeIn`    | `number`  | `0.25`  | Distance from sun where rays start appearing (0–1)    |
| `falloff`   | `number`  | `1.5`   | Radial falloff from sun center (0.5–3)                |
| `intensity` | `number`  | `0.2`   | Master brightness (0–1)                               |
| `softness`  | `number`  | `0.75`  | Width of intensity fade region (0–1). Higher = softer |

## Methods

### `update`

```typescript
update(params: SunShaftsParams): void
```

Sets `enabled` and `intensity` in a single call, typically from a preset. The other properties are unaffected.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `SunShaftsParams` | The `enabled` and `intensity` values to apply. |

## Example

```typescript
water.sunShafts.enabled = true;
water.sunShafts.intensity = 0.3;
water.sunShafts.softness = 0.75;
```

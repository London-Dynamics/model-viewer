# Sun Shafts

Underwater sun shafts (god rays) using procedural projection. Works from any viewing angle. Automatically fades when the sun is below the horizon.

Access via `water.sunShafts`.

## Properties

| Property    | Type      | Default | Description                                           |
| ----------- | --------- | ------- | ----------------------------------------------------- |
| `enabled`   | `boolean` | `true`  | Enable/disable sun shafts                             |
| `fadeIn`    | `number`  | `0.25`  | Distance from sun where rays start appearing (0–1)    |
| `falloff`   | `number`  | `1.5`   | Radial falloff from sun center (0.5–3)                |
| `intensity` | `number`  | `0.2`   | Master brightness (0–1)                               |
| `softness`  | `number`  | `0.75`  | Width of intensity fade region (0–1). Higher = softer |

## Example

```typescript
water.sunShafts.enabled = true;
water.sunShafts.intensity = 0.3;
water.sunShafts.softness = 0.75;
```

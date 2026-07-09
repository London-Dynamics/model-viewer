# Screen-Space Reflections

Screen-space reflections of the scene above the water surface, blended with sky reflection. Available at `high` and `ultra` quality. Automatically disabled when the camera is underwater.

Access via `water.ssr`.

## Properties

| Property    | Type      | Default | Description                                                                 |
| ----------- | --------- | ------- | -------------------------------------------------------------------------- |
| `enabled`   | `boolean` | `true`  | Enable/disable SSR                                                         |
| `strength`  | `number`  | `0.8`   | Blend factor vs sky reflection (0–1)                                       |
| `thickness` | `number`  | `0.1`   | Depth tolerance for ray-march hit testing. Larger values accept thicker / more distant hits |

`enabled`, `strength`, and `thickness` are user-facing knobs. `maxDistance` and `stepCount` are quality-tier knobs set by the active quality level.

## Example

```typescript
water.ssr.enabled = true;
water.ssr.strength = 0.6; // mix more sky into the reflection
```

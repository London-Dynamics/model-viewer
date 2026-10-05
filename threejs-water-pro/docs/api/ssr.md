# Screen-Space Reflections

Screen-space reflections of the scene above the water surface, blended with sky reflection. Available at `high` and `ultra` quality. Automatically disabled when the camera is underwater.

Access via `water.ssr`.

## Properties

| Property    | Type      | Default | Description                                                                 |
| ----------- | --------- | ------- | -------------------------------------------------------------------------- |
| `enabled`   | `boolean` | `true`  | Enable/disable SSR                                                         |
| `strength`  | `number`  | `0.8`   | Blend factor vs sky reflection (0–1)                                       |
| `thickness` | `number`  | `0.1`   | Depth-ratio threshold that rejects false reflections from geometry close in front of the water; larger values reject more hits |

`enabled`, `strength`, and `thickness` are user-facing controls. `maxDistance` and `stepCount` are set by the active quality level; they can also be set via `water.ssr`, but switching quality levels overwrites manual values.

## Example

```typescript
water.ssr.enabled = true;
water.ssr.strength = 0.6; // mix more sky into the reflection
```

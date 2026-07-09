# Sparkle

Sun glints on the wave surface. A view-dependent specular highlight scaled by the surface normal, with distance-based fade.

Access via `water.sparkle`.

## Properties

| Property       | Type      | Default | Description                            |
| -------------- | --------- | ------- | -------------------------------------- |
| `enabled`      | `boolean` | `true`  | Enable/disable sparkle                 |
| `fadeDistance` | `number`  | `500.0` | Distance where sparkles fully fade     |
| `intensity`    | `number`  | `1.0`   | Sparkle brightness                     |
| `minDistance`  | `number`  | `10.0`  | Distance where sparkles fully appear   |
| `power`        | `number`  | `512.0` | Concentration (higher = smaller spots) |

## Example

```typescript
water.sparkle.intensity = 0.7;
water.sparkle.power = 256.0; // larger, softer sparkles
```

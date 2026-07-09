# Subsurface Scattering

Approximates light passing through wave crests when viewed against the sun. Enabled at all quality levels.

Access via `water.sss`. The transmission tint is configured on [`water.color.transmissionColor`](/api/color#water-color).

## Properties

| Property    | Type      | Default | Description           |
| ----------- | --------- | ------- | --------------------- |
| `enabled`   | `boolean` | `true`  | Enable/disable SSS    |
| `intensity` | `number`  | `1.0`   | Scattering brightness |
| `power`     | `number`  | `4.0`   | Falloff exponent      |

## Example

```typescript
water.sss.intensity = 1.5;
water.sss.power = 6.0; // narrower, more concentrated halo
```

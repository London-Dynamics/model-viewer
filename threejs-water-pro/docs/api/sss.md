# Subsurface Scattering

Approximates light passing through wave crests when viewed against the sun. Enabled at all quality levels.

Access via `water.sss`. Custom mode uses [`water.color.transmissionColor`](/api/color#custom-mode) for the crest tint; physical mode derives the tint from the active algae, silt, and stain concentrations.

## Properties

| Property    | Type      | Default | Description           |
| ----------- | --------- | ------- | --------------------- |
| `enabled`   | `boolean` | `true`  | Enable/disable SSS    |
| `intensity` | `number`  | `1.0`   | Scattering brightness (0–2)    |
| `power`     | `number`  | `4.0`   | Falloff exponent (0.05–3)      |

## Example

```typescript
water.sss.intensity = 1.5;
water.sss.power = 3.0; // narrower, more concentrated halo
```

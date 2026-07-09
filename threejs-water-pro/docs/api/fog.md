# Atmospheric Fog

Post-processing atmospheric fog applied above water. Nearby geometry fades into a flat `color`; with distance that fog color blends toward the sky color so the horizon has no seam. For underwater fog, see [Underwater](/api/underwater).

Access via `water.fog`.

## Properties

| Property           | Type                | Default     | Description                                                                      |
| ------------------ | ------------------- | ----------- | -------------------------------------------------------------------------------- |
| `color`            | `THREE.Color\|string` | `"#b4c0cc"` | Flat near-distance fog color that distant fog blends out of toward the sky color |
| `enabled`          | `boolean`           | `true`      | Enable/disable fog                                                               |
| `fadeEnd`          | `number`            | `1800.0`    | Distance where fog reaches full intensity                                        |
| `fadePower`        | `number`            | `1.0`       | Power curve for fog falloff (1 = linear, <1 faster, >1 slower)                   |
| `fadeStart`        | `number`            | `500.0`     | Distance where fog begins                                                        |
| `skyBlendDistance` | `number`            | `1500.0`    | Distance over which the fog color blends from `color` to the sky color           |

## Example

```typescript
water.fog.enabled = true;
water.fog.color = "#c8ccc0";
water.fog.fadeStart = 300;
water.fog.fadePower = 1.5;
// Fog stays its flat color up close, reaching the sky color by 2000m out.
water.fog.skyBlendDistance = 2000;
```

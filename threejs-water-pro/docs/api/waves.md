# Waves

FFT ocean simulation parameters. Drives the small- and mid-scale wave field. For large-scale rolling swells layered on top, see [Gerstner Waves](/api/gerstner).

Access via `water.waves`. Values are TSL uniform nodes — set via `.value` (except `animationSpeed`, which is a plain number).

## Properties

| Property               | Type                  | Default | Description                                                          |
| ---------------------- | --------------------- | ------- | -------------------------------------------------------------------- |
| `amplitude`            | `UniformNode<number>` | `1.0`   | Global wave amplitude multiplier (affects FFT and Gerstner)          |
| `animationSpeed`       | `number`              | `1.0`   | Wave animation multiplier. `0` = frozen, `1` = normal                |
| `choppiness`           | `UniformNode<number>` | `1.0`   | Horizontal displacement. `0.5` smooth, `1.0` natural, `1.5+` choppy  |
| `gravity`              | `UniformNode<number>` | `9.81`  | Gravitational constant                                               |
| `jonswapGamma`         | `UniformNode<number>` | `3.3`   | JONSWAP peak enhancement                                             |
| `spectralSharpness`    | `UniformNode<number>` | `1.0`   | Multiplier on the Hasselmann frequency-dependent directional spread. `1.0` is physically calibrated; higher narrows waves toward the wind direction, lower broadens them |
| `standingWaveRatio`    | `UniformNode<number>` | `0.0`   | Blend between traveling (0) and standing (1) waves                   |
| `windDirection`        | `UniformNode<number>` | `0.0`   | Wind direction in radians                                            |
| `windSpeed`            | `UniformNode<number>` | `50.0`  | Wind speed in m/s. `5–10` calm, `15–25` moderate, `30–50` storm      |

## Example

```typescript
water.waves.windSpeed.value = 30;
water.waves.choppiness.value = 1.2;
water.waves.animationSpeed = 0.5; // plain number, not .value
```

See [Wave Tuning](/guide/wave-tuning) for practical guidance on combining FFT and Gerstner parameters.

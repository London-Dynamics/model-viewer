# Rain

World-space instanced billboard rain particles with procedural water surface ripples.

Access via `water.rain` — a `RainSystem` that exposes `water.rain.particles` (streaks) and `water.rain.ripples` (surface ripples). Both are controlled by the same `enabled` flag from the preset.

## `water.rain`

Combined rain manager. Owns the particles, ripples, and the dedicated render scene used for post-fog compositing.

### Properties

| Property    | Type             | Description                           |
| ----------- | ---------------- | ------------------------------------- |
| `particles` | `RainParticles`  | Billboard streak particles            |
| `ripples`   | `RainRipples`    | Procedural surface ripple simulation  |

## `water.rain.particles`

Billboard streak particles that fall in world space. Each streak is a quad oriented along the fall direction. Wind direction and speed automatically tilt the streaks.

### Properties

| Property       | Type              | Default     | Description                                  |
| -------------- | ----------------- | ----------- | -------------------------------------------- |
| `color`        | `string \| THREE.Color` | `#b3bfcc` | Streak tint color                          |
| `enabled`      | `boolean`         | `false`     | Enable/disable rain particles                |
| `fadeDistance` | `number`          | `40`        | Distance (m) at which streaks begin fading toward the domain boundary (60 m) |
| `intensity`    | `number`          | `0.0`       | Streak density (0–1). Maps to active instance count |
| `opacity`      | `number`          | `0.6`       | Visual opacity of streaks (0–1)              |
| `speed`        | `number`          | `5.0`       | Fall speed multiplier                        |
| `streakLength` | `number`          | `0.4`       | Maximum streak length in world units         |
| `streakWidth`  | `number`          | `0.01`      | Maximum streak width in world units          |

### Methods

#### `dispose`

```typescript
dispose(): void
```

Release GPU resources.

## `water.rain.ripples`

Procedural rain ripple normal perturbation. Tiles world space into cells; each cell spawns a raindrop on a time cycle. Computed analytically in the fragment shader — no buffers, no compute dispatches.

### Properties

| Property  | Type      | Default | Description                                                |
| --------- | --------- | ------- | ---------------------------------------------------------- |
| `decay`   | `number`  | `1.0`   | How quickly ripples fade (0.1–5). Scales temporal and spatial decay |
| `density` | `number`  | `1.0`   | Ripple spawn density (0–1). Higher = more ripples per area |
| `enabled` | `boolean` | `false` | Enable/disable ripples. Tied to `water.rain.particles.enabled` |
| `fadeEnd` | `number`  | `500.0` | Distance in world units where ripples fully fade out       |
| `size`    | `number`  | `2.5`   | Ripple cell size in world units (1–10)                     |
| `strength`| `number`  | `0.5`   | Normal perturbation strength (0–1)                         |

## Example

```typescript
// Enable rain with storm-strength settings
water.rain.particles.enabled = true;
water.rain.particles.intensity = 0.8;
water.rain.particles.opacity = 0.5;
water.rain.particles.speed = 6.0;
water.rain.particles.color = "#b3bfcc";
water.rain.particles.streakLength = 0.5;

// Tune surface ripples
water.rain.ripples.strength = 0.6;
water.rain.ripples.density = 1.5;
water.rain.ripples.size = 3.0;
water.rain.ripples.decay = 1.0;
water.rain.ripples.fadeEnd = 400;
```

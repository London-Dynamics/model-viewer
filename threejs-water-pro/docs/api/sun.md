# Sun & Lighting

Sun direction and intensity drive surface highlights, sparkle, sun shafts, sky lighting (when used), and the directional light that casts shadows in the scene. The lighting subsystem is exposed as `water.lighting`.

## `water.lighting.sun`

`direction` and `intensity` are TSL uniform nodes — set via `.value`. `color` is a plain `THREE.Color` (CPU-only) that drives the directional light's tint.

| Property    | Type                         | Default                      | Description                                             |
| ----------- | ---------------------------- | ---------------------------- | ------------------------------------------------------- |
| `color`     | `THREE.Color`                | `#ffffff`                    | Sun chromaticity; tints `water.lighting.sunLight.color` |
| `direction` | `UniformNode<THREE.Vector3>` | Normalized `(0.5, 0.2, 0.5)` | Direction toward sun                                    |
| `intensity` | `UniformNode<number>`        | `1.5`                        | Sun brightness multiplier                               |

```typescript
water.lighting.sun.direction.value.set(0.3, 0.6, 0.5).normalize();
water.lighting.sun.intensity.value = 2.0;
water.lighting.sun.color.set("#ffaa55"); // warm sunset tint on scene lighting
```

In presets, the sun color is sourced from `sky.sun.diskColor`, so the visible sun and the scene lighting always agree.

### Methods

#### `update`

```typescript
update(params: SunUniformParams): void
```

Set `direction` (from `azimuth` / `elevation`, in degrees), `intensity`, and `color` (from `diskColor`) in a single call. Convenient for moving the sun by angle.

| Parameter | Type | Description |
| --- | --- | --- |
| `params` | `SunUniformParams` | The sun angles, color, and intensity to apply. See [SunUniformParams](#sununiformparams) below. |

#### `SunUniformParams`

| Option | Type | Description |
| --- | --- | --- |
| `azimuth` | `number` | Horizontal sun angle, in degrees. |
| `diskColor` | `string` | Sun color as a hex string; drives `color`. |
| `elevation` | `number` | Vertical sun angle, in degrees (`0` = horizon, `90` = overhead). |
| `intensity` | `number` | Sun brightness multiplier; drives `intensity`. |

```typescript
// Move the sun by angle (degrees) — updates direction, scene light, and tint together.
water.lighting.sun.update({
  azimuth: 120,
  elevation: 30,
  diskColor: "#fff4e0",
  intensity: 1.5,
});
```

## `water.lighting.sunLight`

Read-only handle to the `THREE.DirectionalLight` driven by `water.lighting.sun`. Position, color, and intensity are owned by the lighting subsystem and overwritten each frame from `sun.direction` / `sun.color` / `sun.intensity` — do not reassign or replace the light.

Toggle shadows and tune the shadow camera to fit your scene:

```typescript
water.lighting.sunLight.castShadow = true;            // default — set false to disable
water.lighting.sunLight.shadow.mapSize.set(2048, 2048);
water.lighting.sunLight.shadow.bias = -0.0005;
water.lighting.sunLight.shadow.camera.left = -800;    // shadow frustum (default ±1500)
water.lighting.sunLight.shadow.camera.right = 800;
```

When `castShadow` is enabled, underwater caustics are also occluded by the same shadow map — boats, fish, and terrain block the dancing light pattern in their shadow.

## `water.lighting.hemisphereLight`

Read-only handle to the `THREE.HemisphereLight` that fills shaded sides of the scene. The lighting subsystem owns it — colour, ground colour, and intensity are overwritten each step from `water.lighting.ambient`, so do not reassign or replace the light itself.

| Field         | Source                                   |
| ------------- | ---------------------------------------- |
| `color`       | `water.lighting.ambient.skyColor`        |
| `groundColor` | `water.lighting.ambient.groundColor`     |
| `intensity`   | `water.lighting.ambient.intensity`       |

`water.lighting.ambient` is a plain mutable object — UI controls and per-preset values write to it directly. The corresponding preset field is `lighting.ambient.{skyColor, groundColor, intensity}` (useful intensity range `0–2`). Ambient is no longer derived from the sky image; the app supplies the values explicitly.
